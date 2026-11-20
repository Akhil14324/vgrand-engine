import { Prisma, prisma } from "@catgpt/db";
import { env } from "../../env.js";
import { ShortsConfigError } from "./env-check.js";
import { enqueueJob, registerJobHandler } from "./jobs.js";
import { jobKey } from "./jobs-logic.js";
import { log, recordEvent } from "./log.js";
import { chunk, parsePublicStats, SYNC_CHECKPOINTS, type PublicStats } from "./youtube-logic.js";

/**
 * Public stats (no OAuth): YouTube Data API videos.list with YOUTUBE_API_KEY.
 * Works for manually posted videos too. 1 quota unit per call of up to 50 ids.
 */

export async function fetchPublicStats(ids: string[]): Promise<Map<string, PublicStats>> {
  if (!env.YOUTUBE_API_KEY) throw new ShortsConfigError("Not configured: set YOUTUBE_API_KEY");
  const out = new Map<string, PublicStats>();
  for (const part of chunk([...new Set(ids)], 50)) {
    const u = new URL("https://www.googleapis.com/youtube/v3/videos");
    u.searchParams.set("part", "statistics,status");
    u.searchParams.set("id", part.join(","));
    u.searchParams.set("key", env.YOUTUBE_API_KEY);
    const res = await fetch(u, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`YouTube videos.list failed (${res.status})`);
    for (const [k, v] of parsePublicStats(await res.json())) out.set(k, v);
  }
  return out;
}

/** Stores one public snapshot per video. Videos YouTube doesn't return get no snapshot (never invented). */
export async function syncPublic(videoIds: string[], checkpoint: string): Promise<{ synced: number; missing: string[] }> {
  const videos = await prisma.shortsVideo.findMany({
    where: { id: { in: videoIds }, youtubeVideoId: { not: null } },
    select: { id: true, channelId: true, youtubeVideoId: true },
  });
  if (!videos.length) return { synced: 0, missing: [] };
  const stats = await fetchPublicStats(videos.map((v) => v.youtubeVideoId!));
  const missing: string[] = [];
  let synced = 0;
  for (const v of videos) {
    const s = stats.get(v.youtubeVideoId!);
    if (!s) {
      missing.push(v.id);
      continue;
    }
    await prisma.shortsMetricSnapshot.create({
      data: { videoId: v.id, source: "public", checkpoint, views: s.views, likes: s.likes, comments: s.comments, raw: s as unknown as Prisma.InputJsonValue },
    });
    synced++;
  }
  for (const id of missing) {
    const v = videos.find((x) => x.id === id)!;
    await recordEvent({
      videoId: id,
      channelId: v.channelId,
      level: "warn",
      type: "sync.not_found",
      message: "YouTube returned no public stats for this video (deleted, private, or wrong id). No snapshot stored.",
    });
  }
  log.info("sync.public", { checkpoint, requested: videoIds.length, synced, missing: missing.length });
  return { synced, missing };
}

/** Immediate sync plus the 24h / 72h / 7d checkpoints after posting. Idempotent per checkpoint. */
export async function scheduleCheckpointSyncs(videoId: string, postedAt: Date): Promise<void> {
  await enqueueJob({ type: "sync_public", key: jobKey.publicSync(videoId, `posted-${postedAt.getTime()}`), videoId, payload: { checkpoint: "posted" } });
  for (const c of SYNC_CHECKPOINTS) {
    await enqueueJob({
      type: "sync_public",
      key: jobKey.publicSync(videoId, c.name),
      videoId,
      payload: { checkpoint: c.name },
      runAt: new Date(postedAt.getTime() + c.afterMs),
    });
  }
}

/** Daily: every posted video of the last 90 days, batched. */
export async function dailyPublicSync(userId: string): Promise<number> {
  const since = new Date(Date.now() - 90 * 24 * 3600_000);
  const vids = await prisma.shortsVideo.findMany({
    where: { userId, status: { in: ["posted", "manual_posted", "scheduled"] }, youtubeVideoId: { not: null }, OR: [{ postedAt: { gte: since } }, { postedAt: null }] },
    select: { id: true },
  });
  if (!vids.length) return 0;
  return (await syncPublic(vids.map((v) => v.id), "daily")).synced;
}

export function registerSyncHandlers(): void {
  registerJobHandler("sync_public", async (job) => {
    const checkpoint = String((job.payload as { checkpoint?: string }).checkpoint ?? "manual");
    await syncPublic([job.videoId!], checkpoint);
  });
  registerJobHandler("daily_sync", async (job) => {
    await dailyPublicSync(String((job.payload as { userId?: string }).userId));
  });
}
