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
}
