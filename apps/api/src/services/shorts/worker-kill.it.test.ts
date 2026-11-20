import { randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@catgpt/db";
import { ensureSeeded } from "./channels.js";
import { drainJobs } from "./jobs.js";
import { createVideo } from "./pipeline.js";
import { registerShortsHandlers } from "./index.js";

/**
 * Crash test: a real worker process is SIGKILLed (with its ffmpeg) in the middle
 * of a render. After its lease expires another worker resumes, and there is
 * still exactly one video, one job per step, one voiceover and one clip per beat.
 * Opt-in: SHORTS_IT=1 with a local Postgres and ffmpeg.
 */
const RUN = process.env.SHORTS_IT === "1" && spawnSync("ffmpeg", ["-version"]).status === 0;
const API_DIR = fileURLToPath(new URL("../../..", import.meta.url));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!RUN)("worker killed mid-job", () => {
  const userId = randomUUID();
  let channelId = "";

  beforeAll(async () => {
    registerShortsHandlers();
    await prisma.user.create({ data: { id: userId, email: `${userId}@it.test` } });
    await ensureSeeded(userId);
    channelId = (await prisma.shortsChannel.findUniqueOrThrow({ where: { userId_slug: { userId, slug: "cats" } } })).id;
  });
  afterAll(async () => {
    const vids = await prisma.shortsVideo.findMany({ where: { userId }, select: { id: true } });
    await prisma.shortsJob.deleteMany({ where: { videoId: { in: vids.map((v) => v.id) } } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("creating the same slot twice makes one video and one job", async () => {
    const slotAt = new Date("2030-01-01T03:00:00Z");
    const a = await createVideo({ channelId, slotAt, source: "dry_run" });
    const b = await createVideo({ channelId, slotAt, source: "dry_run" });
    expect(b.created).toBe(false);
    expect(b.video.id).toBe(a.video.id);
    expect(await prisma.shortsJob.count({ where: { videoId: a.video.id } })).toBe(1);
  });

  it("SIGKILL during render -> resumed by another worker, no duplicates", async () => {
    const slotAt = new Date("2030-01-02T03:00:00Z");
    const { video } = await createVideo({ channelId, slotAt, source: "dry_run" });

    // Worker process: runs this video's jobs. Detached so we can kill its whole group (incl. ffmpeg).
    const child = spawn("npx", ["tsx", "src/shorts-cli.ts", "drain", "--video", video.id], {
      cwd: API_DIR,
      env: { ...process.env, SHORTS_DISABLED: "1" },
      detached: true,
      stdio: "ignore",
    });
    // Wait until the render step is running, give ffmpeg a moment, then kill -9 the group.
    const deadline = Date.now() + 120_000;
    for (;;) {
      const r = await prisma.shortsJob.findFirst({ where: { videoId: video.id, type: "render" } });
      if (r?.status === "running") break;
      if (Date.now() > deadline) throw new Error("render never started");
      await sleep(250);
    }
    await sleep(1500);
    process.kill(-child.pid!, "SIGKILL");
    await sleep(500);

    const mid = await prisma.shortsJob.findFirstOrThrow({ where: { videoId: video.id, type: "render" } });
    expect(mid.status).toBe("running"); // orphaned with a lease
    expect((await prisma.shortsVideo.findUniqueOrThrow({ where: { id: video.id } })).status).toBe("assets_ready");

    // Simulate the lease running out (10 minutes in production), then a new worker drains.
    await prisma.shortsJob.update({ where: { id: mid.id }, data: { lockedUntil: new Date(Date.now() - 1000) } });
    await drainJobs({ videoIds: [video.id] });

    const done = await prisma.shortsVideo.findUniqueOrThrow({ where: { id: video.id }, include: { assets: true } });
    expect(done.status).toBe("awaiting_approval");
    expect((await stat(done.filePath!)).size).toBeGreaterThan(100_000);
    expect(path.basename(done.filePath!)).toBe("short.mp4");
    expect(await prisma.shortsVideo.count({ where: { channelId, slotAt } })).toBe(1);

    const jobs = await prisma.shortsJob.findMany({ where: { videoId: video.id } });
    expect(jobs.map((j) => j.type).sort()).toEqual(["assets", "render", "script"]);
    expect(jobs.every((j) => j.status === "done")).toBe(true);
    expect(jobs.find((j) => j.type === "render")!.attempts).toBe(2);

    const beats = (done.beats as unknown[]).length;
    expect(done.assets.filter((a) => a.kind === "voiceover")).toHaveLength(1);
    expect(done.assets.filter((a) => a.kind === "stock_video")).toHaveLength(beats);
    expect(new Set(done.assets.filter((a) => a.kind === "stock_video").map((a) => a.beatIndex)).size).toBe(beats);
  }, 300_000);
});
