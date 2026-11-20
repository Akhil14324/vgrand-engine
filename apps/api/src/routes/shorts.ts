import type { FastifyInstance } from "fastify";
import { markShortsPostedSchema, SHORTS_STATUSES, shortsManualMetricSchema, updateShortsChannelSchema } from "@catgpt/types";
import { parseBody } from "../lib/errors.js";
import { shortsHealth } from "../services/shorts/env-check.js";
import { z } from "zod";
import { getOwnedChannel, listChannels, updateChannel } from "../services/shorts/channels.js";
import { createVideo } from "../services/shorts/pipeline.js";
import { HttpError } from "../lib/errors.js";
import { listVideos, videoDetail } from "../services/shorts/video-api.js";
import { approveVideo, markPosted, rejectVideo, retryVideo, setManualViewedPct } from "../services/shorts/posting.js";
import { syncPublic } from "../services/shorts/sync.js";
import { prisma } from "@catgpt/db";
import { disconnect, startConnect } from "../services/shorts/youtube.js";
import { mkdir, rm } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { shortsSidecarSchema, SHORTS_HOOK_TYPES } from "@catgpt/types";
import { stageForIngest } from "../services/shorts/ingest.js";
import { pathCBudgetStatus } from "../services/shorts/pathc.js";
import { buildDashboard, requestReportNow } from "../services/shorts/analytics.js";
import { shortsSettingsSchema } from "@catgpt/types";
import { storageRoot } from "../services/shorts/storage.js";

/** Shorts Factory API. Everything here is scoped to the signed-in user. */
export async function shortsRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  app.get("/shorts/health", async () => shortsHealth());

  app.get("/shorts/channels", async (req) => ({ items: await listChannels(req.userId) }));

  app.patch<{ Params: { id: string } }>("/shorts/channels/:id", async (req) => {
    const body = parseBody(updateShortsChannelSchema, req.body);
    return updateChannel(req.userId, req.params.id, body);
  });

  /** "Generate now": one Path B/C video outside the schedule. `offline` = local fixtures, never uploadable. */
  app.post<{ Params: { id: string } }>("/shorts/channels/:id/generate", async (req, reply) => {
    const body = parseBody(z.object({ offline: z.boolean().default(false) }), req.body ?? {});
    const channel = await getOwnedChannel(req.userId, req.params.id);
    if (channel.path === "A") throw new HttpError(400, "Path A channels ingest files rendered elsewhere; drop an MP4 into the ingest folder or upload one", "PATH_A");
    const { video } = await createVideo({ channelId: channel.id, source: body.offline ? "dry_run" : "manual" });
    return reply.code(202).send({ id: video.id, status: video.status });
  });

  const listQuery = z.object({
    status: z
      .string()
      .optional()
      .transform((v) => (v ? v.split(",") : undefined))
      .pipe(z.array(z.enum(SHORTS_STATUSES)).optional()),
    channelId: z.string().uuid().optional(),
    dryRun: z.enum(["1", "0"]).optional(),
  });

  app.get("/shorts/videos", async (req) => {
    const q = parseBody(listQuery, req.query);
    return { items: await listVideos(req.userId, { status: q.status, channelId: q.channelId, includeDryRun: q.dryRun === "1" }) };
  });

  app.get<{ Params: { id: string } }>("/shorts/videos/:id", async (req) => videoDetail(req.userId, req.params.id));

  app.post<{ Params: { id: string } }>("/shorts/videos/:id/approve", async (req) => {
    await approveVideo(req.userId, req.params.id);
    return videoDetail(req.userId, req.params.id);
  });
  app.post<{ Params: { id: string } }>("/shorts/videos/:id/reject", async (req) => {
    await rejectVideo(req.userId, req.params.id);
    return videoDetail(req.userId, req.params.id);
  });
  app.post<{ Params: { id: string } }>("/shorts/videos/:id/retry", async (req) => {
    await retryVideo(req.userId, req.params.id);
    return videoDetail(req.userId, req.params.id);
  });

  /** Manual queue: videos to post by hand, earliest suggested time first. */
  app.get("/shorts/manual", async (req) => ({ items: await listVideos(req.userId, { status: ["manual_pending"] }) }));

  app.post<{ Params: { id: string } }>("/shorts/videos/:id/mark-posted", async (req) => {
    const body = parseBody(markShortsPostedSchema, req.body);
    await markPosted(req.userId, req.params.id, body.url, body.postedAt);
    return videoDetail(req.userId, req.params.id);
  });

  app.patch<{ Params: { id: string } }>("/shorts/videos/:id/manual-metric", async (req) => {
    const body = parseBody(shortsManualMetricSchema, req.body);
    await setManualViewedPct(req.userId, req.params.id, body.viewedPct);
    return videoDetail(req.userId, req.params.id);
  });

  /** "Sync now" for one video's public stats. */
  app.post<{ Params: { id: string } }>("/shorts/videos/:id/sync", async (req) => {
    const v = await prisma.shortsVideo.findFirst({ where: { id: req.params.id, userId: req.userId }, select: { id: true, youtubeVideoId: true } });
    if (!v) throw new HttpError(404, "Video not found");
    if (!v.youtubeVideoId) throw new HttpError(409, "This video has no YouTube id yet", "INVALID_STATE");
    const r = await syncPublic([v.id], "manual");
    if (r.missing.length) throw new HttpError(404, "YouTube returned no public stats for this video (deleted, private, or wrong id)", "NOT_FOUND_ON_YOUTUBE");
    return videoDetail(req.userId, req.params.id);
  });

  /** Starts Google OAuth for one channel (pick that channel's YouTube account/brand channel). */
  app.post<{ Params: { id: string } }>("/shorts/channels/:id/youtube/connect", async (req) => {
    const channel = await getOwnedChannel(req.userId, req.params.id);
    return { url: await startConnect(req.userId, channel.id) };
  });

  app.post<{ Params: { id: string } }>("/shorts/channels/:id/youtube/disconnect", async (req) => {
    const channel = await getOwnedChannel(req.userId, req.params.id);
    await disconnect(channel);
    return { ok: true };
  });

  /** Path A upload: multipart with optional fields title, description, tags (comma separated), synthetic, then the MP4. */
  app.post<{ Params: { id: string } }>("/shorts/channels/:id/ingest", async (req, reply) => {
    const channel = await getOwnedChannel(req.userId, req.params.id);
    if (channel.path !== "A") throw new HttpError(400, "Uploads are for Path A channels; Path B/C channels generate their own videos", "NOT_PATH_A");
    const tmpDir = path.join(storageRoot(), "ingest", ".uploads");
    await mkdir(tmpDir, { recursive: true });
    const fields: Record<string, string> = {};
    let tmp: string | null = null;
    let originalName = "";
    try {
      for await (const part of req.parts({ limits: { fileSize: SHORTS_MAX_UPLOAD_BYTES, files: 1 } })) {
        if (part.type === "file") {
          originalName = part.filename;
          tmp = path.join(tmpDir, `${randomUUID()}.mp4`);
          await pipeline(part.file, createWriteStream(tmp));
          if (part.file.truncated) throw new HttpError(413, `File is larger than ${SHORTS_MAX_UPLOAD_BYTES / 1024 / 1024} MB`);
        } else {
          fields[part.fieldname] = String(part.value);
        }
      }
      if (!tmp) throw new HttpError(400, "No file in the upload");
      const sidecar = parseBody(shortsSidecarSchema, {
        ...(fields.title ? { title: fields.title } : {}),
        ...(fields.description ? { description: fields.description } : {}),
        ...(fields.tags ? { tags: fields.tags.split(",").map((t) => t.trim()).filter(Boolean) } : {}),
        ...(fields.synthetic ? { synthetic: fields.synthetic === "true" } : {}),
        ...(fields.hookType ? { hookType: fields.hookType } : {}),
        ...(fields.topic ? { topic: fields.topic } : {}),
      });
      const r = await stageForIngest({ channelId: channel.id, file: tmp, originalName, sidecar, sidecarSource: fields.source ?? null });
      if (r.status !== "queued") throw new HttpError(r.status === "duplicate" ? 409 : 400, r.detail, r.status.toUpperCase());
      tmp = null;
      return reply.code(202).send({ status: "queued", sha: r.detail });
    } finally {
      if (tmp) await rm(tmp, { force: true });
    }
  });

  /** Edit title/description/tags/flags before the video is on YouTube. */
  app.patch<{ Params: { id: string } }>("/shorts/videos/:id", async (req) => {
    const body = parseBody(
      z.object({
        title: z.string().min(1).max(100).optional(),
        description: z.string().max(5000).optional(),
        tags: z.array(z.string().min(1).max(100)).max(30).optional(),
        synthetic: z.boolean().optional(),
        hookType: z.enum(SHORTS_HOOK_TYPES).optional(),
      }),
      req.body,
    );
    const v = await prisma.shortsVideo.findFirst({ where: { id: req.params.id, userId: req.userId } });
    if (!v) throw new HttpError(404, "Video not found");
    if (v.youtubeVideoId || ["posted", "manual_posted", "scheduled"].includes(v.status)) {
      throw new HttpError(409, "This video is already on YouTube; edit it in YouTube Studio", "INVALID_STATE");
    }
    await prisma.shortsVideo.update({ where: { id: v.id }, data: body });
    return videoDetail(req.userId, v.id);
  });

  /** All dashboards in one payload. metric=views7d (comparable, default) or views (latest). */
  app.get("/shorts/analytics", async (req) => {
    const q = parseBody(z.object({ metric: z.enum(["views7d", "views"]).default("views7d") }), req.query);
    return buildDashboard(req.userId, q.metric);
  });

  app.get("/shorts/reports", async (req) => {
    const rows = await prisma.shortsReport.findMany({ where: { userId: req.userId }, orderBy: { weekStart: "desc" }, take: 20 });
    return { items: rows.map((r) => ({ id: r.id, weekStart: r.weekStart.toISOString().slice(0, 10), content: r.content, createdAt: r.createdAt.toISOString() })) };
  });

  app.post("/shorts/reports", async (req, reply) => {
    await requestReportNow(req.userId);
    return reply.code(202).send({ status: "queued" });
  });

  app.get("/shorts/settings", async (req) => pathCBudgetStatus(req.userId));

  /** Owner-set Path C price per generated second, in BUDGET_CURRENCY (null = use the built-in USD price). */
  app.put("/shorts/settings", async (req) => {
    const body = parseBody(shortsSettingsSchema, req.body);
    await prisma.shortsSettings.upsert({
      where: { userId: req.userId },
      create: { userId: req.userId, pathCPricePerSecond: body.pathCPricePerSecond, pathCModel: body.pathCModel ?? null },
      update: { pathCPricePerSecond: body.pathCPricePerSecond, ...(body.pathCModel !== undefined ? { pathCModel: body.pathCModel } : {}) },
    });
    return pathCBudgetStatus(req.userId);
  });

  /** Channel-level warnings/errors of the last 7 days (failed ingests, reauth needed, ...). */
  app.get("/shorts/alerts", async (req) => {
    const channels = await prisma.shortsChannel.findMany({ where: { userId: req.userId }, select: { id: true, displayName: true } });
    const names = new Map(channels.map((c) => [c.id, c.displayName]));
    const rows = await prisma.shortsEvent.findMany({
      where: { videoId: null, channelId: { in: [...names.keys()] }, level: { in: ["warn", "error"] }, createdAt: { gte: new Date(Date.now() - 7 * 86_400_000) } },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return { items: rows.map((e) => ({ id: e.id, channel: names.get(e.channelId!) ?? "", level: e.level, type: e.type, message: e.message, createdAt: e.createdAt.toISOString() })) };
  });
}

const SHORTS_MAX_UPLOAD_BYTES = 500 * 1024 * 1024;
