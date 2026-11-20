import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server } from "node:http";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@catgpt/db";
import { env } from "../../env.js";
import { ensureSeeded } from "./channels.js";
import { runPostStep } from "./posting.js";
import { encryptSecret, paths } from "./storage.js";
import { google, uploadVideo } from "./youtube.js";
import { pacificDay } from "./youtube-logic.js";

/**
 * Upload flow against a local fake of Google's endpoints (token, resumable
 * upload, videos.list). Opt-in like the other DB tests: SHORTS_IT=1.
 */
const RUN = process.env.SHORTS_IT === "1";

type Mode = { token: "ok" | "invalid_grant"; init: "ok" | "quota"; put: "ok" | "crash_once"; privacy: "scheduled" | "public" | "private" };

describe.skipIf(!RUN)("YouTube upload (fake Google)", () => {
  const userId = randomUUID();
  let server: Server;
  let base = "";
  let mode: Mode;
  let log: { method: string; path: string; headers: IncomingMessage["headers"]; body: string }[] = [];
  let received = 0; // bytes the fake has stored for the current session
  let crashed = false;
  let channelId = "";
  const saved: Record<string, string | undefined> = {};

  beforeAll(async () => {
    for (const k of ["TOKEN_ENCRYPTION_KEY", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REDIRECT_URI"] as const) saved[k] = env[k];
    Object.assign(env, { TOKEN_ENCRYPTION_KEY: "a".repeat(64), GOOGLE_CLIENT_ID: "cid", GOOGLE_CLIENT_SECRET: "secret", GOOGLE_REDIRECT_URI: "http://localhost/cb" });
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => {
        chunks.push(c);
        if (req.url?.startsWith("/session") && req.method === "PUT" && mode.put === "crash_once" && !crashed && Buffer.concat(chunks).length > 1000) {
          crashed = true;
          received = 1000;
          req.socket.destroy(); // network drop mid-upload
        }
      });
      req.on("end", () => {
        const body = Buffer.concat(chunks).toString("latin1");
        log.push({ method: req.method!, path: req.url!, headers: req.headers, body: req.url?.startsWith("/session") ? `<${chunks.reduce((n, c) => n + c.length, 0)} bytes>` : body });
        const json = (code: number, obj: unknown, headers: Record<string, string> = {}) => {
          res.writeHead(code, { "content-type": "application/json", ...headers });
          res.end(JSON.stringify(obj));
        };
        if (req.url === "/token") {
          return mode.token === "ok" ? json(200, { access_token: "at-new", expires_in: 3600 }) : json(400, { error: "invalid_grant" });
        }
        if (req.url?.startsWith("/upload")) {
          if (mode.init === "quota") return json(403, { error: { message: "quota", errors: [{ reason: "quotaExceeded" }] } });
          received = 0;
          return json(200, {}, { location: `${base}/session/1` });
        }
        if (req.url?.startsWith("/session") && req.method === "PUT") {
          const range = req.headers["content-range"];
          if (range?.startsWith("bytes */")) {
            return received > 0 ? (res.writeHead(308, { range: `bytes=0-${received - 1}` }), res.end()) : (res.writeHead(308), res.end());
          }
          return json(200, { id: "VIDEOID0001" });
        }
        if (req.url?.startsWith("/api/videos")) {
          const status =
            mode.privacy === "scheduled"
              ? { privacyStatus: "private", publishAt: new Date(Date.now() + 7200_000).toISOString(), uploadStatus: "uploaded" }
              : { privacyStatus: mode.privacy, uploadStatus: "uploaded" };
          return json(200, { items: [{ id: "VIDEOID0001", status }] });
        }
        json(404, {});
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    Object.assign(google, { token: `${base}/token`, upload: `${base}/upload`, api: `${base}/api` });

    await prisma.user.create({ data: { id: userId, email: `${userId}@it.test` } });
    await ensureSeeded(userId);
    channelId = (await prisma.shortsChannel.findUniqueOrThrow({ where: { userId_slug: { userId, slug: "fails" } } })).id;
  });

  afterAll(async () => {
    server?.close();
    Object.assign(env, saved);
    await prisma.shortsJob.deleteMany({ where: { channelId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    log = [];
    crashed = false;
    received = 0;
    mode = { token: "ok", init: "ok", put: "ok", privacy: "scheduled" };
    await prisma.shortsQuotaDay.deleteMany({ where: { day: pacificDay() } });
    await prisma.shortsChannel.update({
      where: { id: channelId },
      data: { ytStatus: "connected", ytRefreshTokenEnc: encryptSecret("rt"), ytAccessTokenEnc: null, ytTokenExpiresAt: null, ytStatusReason: null },
    });
  });

  async function approvedVideo(slotInMs: number) {
    const id = randomUUID();
    const dir = paths.videoDir(id);
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, "short.mp4");
    await writeFile(file, Buffer.alloc(5000, 7));
    return prisma.shortsVideo.create({
      data: {
        id,
        channelId,
        userId,
        status: "approved",
        path: "C",
        plannedPath: "C",
        title: "Insane trick",
        description: "desc",
        tags: ["skills"],
        synthetic: true,
        filePath: file,
        slotAt: new Date(Date.now() + slotInMs),
      },
    });
  }
  const channel = () => prisma.shortsChannel.findUniqueOrThrow({ where: { id: channelId } });
  const video = (id: string) => prisma.shortsVideo.findUniqueOrThrow({ where: { id } });

  it("uploads a scheduled video with publishAt and the synthetic flag, stores the id, counts quota", async () => {
    const v = await approvedVideo(3 * 3600_000);
    await uploadVideo(v, await channel());
    const after = await video(v.id);
    expect(after.status).toBe("scheduled");
    expect(after.youtubeVideoId).toBe("VIDEOID0001");
    const init = JSON.parse(log.find((l) => l.path.startsWith("/upload"))!.body);
    expect(init.status).toMatchObject({ privacyStatus: "private", containsSyntheticMedia: true, selfDeclaredMadeForKids: false });
    expect(new Date(init.status.publishAt).getTime()).toBe(v.slotAt!.getTime());
    expect(init.snippet.title).toBe("Insane trick #Shorts");
    expect((await prisma.shortsQuotaDay.findUniqueOrThrow({ where: { day: pacificDay() } })).uploads).toBe(1);
    expect(await prisma.shortsJob.count({ where: { videoId: v.id, type: "publish_check" } })).toBe(1);
  });

  it("quotaExceeded -> manual queue with the reason, rest of the day blocked", async () => {
    mode.init = "quota";
    const v = await approvedVideo(3 * 3600_000);
    await uploadVideo(v, await channel());
    const after = await video(v.id);
    expect(after.status).toBe("manual_pending");
    expect(after.manualReason).toMatch(/quota exceeded/i);
    expect(after.youtubeVideoId).toBeNull();
  });

  it("expired refresh token -> channel needs reauth, video to manual queue", async () => {
    mode.token = "invalid_grant";
    const v = await approvedVideo(3 * 3600_000);
    await uploadVideo(v, await channel());
    expect((await video(v.id)).status).toBe("manual_pending");
    expect((await video(v.id)).manualReason).toMatch(/expired or was revoked.*In production/s);
    expect((await channel()).ytStatus).toBe("reauth_required");
    expect(log.some((l) => l.path.startsWith("/upload"))).toBe(false);
  });

  it("forced private -> flagged, manual queue with a clear message, id kept", async () => {
    mode.privacy = "private";
    const v = await approvedVideo(-60_000); // slot already passed: requested public
    await uploadVideo(v, await channel());
    const after = await video(v.id);
    expect(after.status).toBe("manual_pending");
    expect(after.privateLocked).toBe(true);
    expect(after.youtubeVideoId).toBe("VIDEOID0001");
    expect(after.manualReason).toMatch(/private/);
  });

  it("public now -> posted", async () => {
    mode.privacy = "public";
    const v = await approvedVideo(-60_000);
    await uploadVideo(v, await channel());
    const after = await video(v.id);
    expect(after.status).toBe("posted");
    expect(after.postedAt).not.toBeNull();
  });

  it("network drop mid-upload resumes the same session; never a second upload", async () => {
    mode.put = "crash_once";
    const v = await approvedVideo(3 * 3600_000);
    await expect(uploadVideo(v, await channel())).rejects.toThrow();
    const mid = await video(v.id);
    expect(mid.status).toBe("approved");
    expect((mid.uploadState as { uri: string }).uri).toBe(`${base}/session/1`);

    await uploadVideo(mid, await channel());
    const inits = log.filter((l) => l.path.startsWith("/upload")).length;
    expect(inits).toBe(1);
    const resumePut = log.filter((l) => l.path.startsWith("/session") && l.headers["content-range"]?.startsWith("bytes 1000-"));
    expect(resumePut).toHaveLength(1);
    expect((await video(v.id)).status).toBe("scheduled");
    expect((await prisma.shortsQuotaDay.findUniqueOrThrow({ where: { day: pacificDay() } })).uploads).toBe(1);
  });

  it("crash after the id was saved: the post step recovers without uploading again", async () => {
    const v = await approvedVideo(3 * 3600_000);
    await prisma.shortsVideo.update({ where: { id: v.id }, data: { youtubeVideoId: "VIDEOID0001" } });
    log = [];
    await runPostStep(v.id);
    expect((await video(v.id)).status).toBe("scheduled");
    expect(log).toHaveLength(0);
  });
});
