import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@catgpt/db";
import { env } from "../../env.js";
import { ensureSeeded } from "./channels.js";
import { claimJobs, completeJob, enqueueJob, failJob, PermanentJobError, runClaimedJob, registerJobHandler } from "./jobs.js";
import { syncPublic } from "./sync.js";
import { listVideos } from "./video-api.js";

/**
 * Integration tests against a real Postgres (the local docker/dev DB).
 * Opt-in: SHORTS_IT=1 DATABASE_URL=postgresql://... pnpm --filter @catgpt/api exec vitest run shorts-db.it
 * Only YouTube's HTTP response is stubbed; the queue, transitions and snapshots hit the DB.
 */
const RUN = process.env.SHORTS_IT === "1";

describe.skipIf(!RUN)("shorts integration (DB)", () => {
  const userId = randomUUID();
  let channelId = "";

  beforeAll(async () => {
    await prisma.user.create({ data: { id: userId, email: `${userId}@it.test` } });
    await ensureSeeded(userId);
    channelId = (await prisma.shortsChannel.findUniqueOrThrow({ where: { userId_slug: { userId, slug: "cats" } } })).id;
  });
  afterAll(async () => {
    await prisma.shortsJob.deleteMany({ where: { channelId } });
    await prisma.shortsJob.deleteMany({ where: { idempotencyKey: { startsWith: `it:${userId}` } } });
    await prisma.user.delete({ where: { id: userId } }); // cascades channels/videos/snapshots
    await prisma.$disconnect();
  });

  it("enqueue is idempotent by key", async () => {
    const key = `it:${userId}:idem`;
    const a = await enqueueJob({ type: "it_noop", key, channelId });
    const b = await enqueueJob({ type: "it_noop", key, channelId });
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(b.job.id).toBe(a.job.id);
  });

  it("two workers never claim the same job; an expired lease is re-claimed", async () => {
    const key = `it:${userId}:lease`;
    await enqueueJob({ type: "it_lease", key, channelId });
    const [w1, w2] = await Promise.all([claimJobs(5, { types: ["it_lease"] }, "w1"), claimJobs(5, { types: ["it_lease"] }, "w2")]);
    expect(w1.length + w2.length).toBe(1);
    const job = (w1[0] ?? w2[0])!;
    const owner = w1.length ? "w1" : "w2";
    // Simulate the owner crashing: lease runs out.
    await prisma.shortsJob.update({ where: { id: job.id }, data: { lockedUntil: new Date(Date.now() - 1000) } });
    const [again] = await claimJobs(5, { types: ["it_lease"] }, "w3");
    expect(again?.id).toBe(job.id);
    expect(again?.attempts).toBe(2);
    // The crashed worker can't complete a job it no longer owns.
    await completeJob(job, owner);
    expect((await prisma.shortsJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("running");
    await completeJob(again!, "w3");
    expect((await prisma.shortsJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("done");
  });

  it("retries with backoff, then goes dead; permanent errors die at once", async () => {
    await enqueueJob({ type: "it_fail", key: `it:${userId}:fail`, channelId, maxAttempts: 2 });
    let [j] = await claimJobs(1, { types: ["it_fail"] }, "w");
    expect(await failJob(j!, new Error("boom"), "w")).toBe("retry");
    const row = await prisma.shortsJob.findFirstOrThrow({ where: { idempotencyKey: `it:${userId}:fail` } });
    expect(row.runAt.getTime()).toBeGreaterThan(Date.now() + 20_000);
    await prisma.shortsJob.update({ where: { id: row.id }, data: { runAt: new Date() } });
    [j] = await claimJobs(1, { types: ["it_fail"] }, "w");
    expect(await failJob(j!, new Error("boom"), "w")).toBe("dead");

    await enqueueJob({ type: "it_perm", key: `it:${userId}:perm`, channelId });
    const [p] = await claimJobs(1, { types: ["it_perm"] }, "w");
    expect(await failJob(p!, new PermanentJobError("bad config"), "w")).toBe("dead");
  });

  it("runClaimedJob calls onDead once the job is dead", async () => {
    const dead = vi.fn(async () => {});
    registerJobHandler("it_handler", async () => {
      throw new PermanentJobError("nope");
    }, dead);
    await enqueueJob({ type: "it_handler", key: `it:${userId}:handler`, channelId });
    const [j] = await claimJobs(1, { types: ["it_handler"] });
    expect(await runClaimedJob(j!)).toBe("dead");
    expect(dead).toHaveBeenCalledOnce();
  });

  it("public stats sync stores a snapshot and the dashboard shows it; unknown ids store nothing", async () => {
    const posted = await prisma.shortsVideo.create({
      data: { channelId, userId, status: "manual_posted", path: "B", plannedPath: "B", title: "IT video", youtubeVideoId: "AAAAAAAAAAA", postedAt: new Date() },
    });
    const gone = await prisma.shortsVideo.create({
      data: { channelId, userId, status: "manual_posted", path: "B", plannedPath: "B", title: "Deleted video", youtubeVideoId: "BBBBBBBBBBB", postedAt: new Date() },
    });
    const prevKey = env.YOUTUBE_API_KEY;
    (env as { YOUTUBE_API_KEY?: string }).YOUTUBE_API_KEY = "test-key";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe("/youtube/v3/videos");
      expect(url.searchParams.get("part")).toBe("statistics,status");
      return new Response(
        JSON.stringify({ items: [{ id: "AAAAAAAAAAA", statistics: { viewCount: "1234", likeCount: "56", commentCount: "7" }, status: { privacyStatus: "public" } }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    try {
      const r = await syncPublic([posted.id, gone.id], "24h");
      expect(r).toEqual({ synced: 1, missing: [gone.id] });
    } finally {
      fetchSpy.mockRestore();
      (env as { YOUTUBE_API_KEY?: string }).YOUTUBE_API_KEY = prevKey;
    }
    expect(await prisma.shortsMetricSnapshot.count({ where: { videoId: gone.id } })).toBe(0);
    const list = await listVideos(userId, { status: ["manual_posted"] });
    const row = list.find((v) => v.id === posted.id)!;
    expect(row.latestStats).toMatchObject({ views: 1234, likes: 56, comments: 7 });
  });
});
