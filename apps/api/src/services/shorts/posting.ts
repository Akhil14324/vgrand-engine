import { prisma } from "@catgpt/db";
import type { ShortsStatus } from "@catgpt/types";
import { env } from "../../env.js";
import { HttpError, notFound } from "../../lib/errors.js";
import { shortsHealth } from "./env-check.js";
import { enqueueJob, rearmJob, registerJobHandler, type JobResult } from "./jobs.js";
import { jobKey } from "./jobs-logic.js";
import { recordEvent } from "./log.js";
import { enqueuePost, markFailed } from "./pipeline.js";
import { fetchPublicStats, scheduleCheckpointSyncs } from "./sync.js";
import { getVideo, transition, type ShortsVideoRow } from "./videos.js";
import { parseYoutubeId, shortsUrl, uploadDecision } from "./youtube-logic.js";
import { quotaLeftToday, uploadVideo } from "./youtube.js";

/* -------------------------------- post step -------------------------------- */

/** Uploads start this long before the slot, so the earliest slots claim quota first. */
export const UPLOAD_LEAD_MS = 6 * 60 * 60_000;

/**
 * approved -> uploaded (scheduled/posted) or manual_pending with the reason.
 * The manual decision is made at once (so the owner sees it early); a real
 * upload waits until UPLOAD_LEAD_MS before the slot.
 */
export async function runPostStep(videoId: string): Promise<JobResult> {
  const video = await getVideo(videoId);
  if (video.status !== "approved") return;
  if (video.source === "dry_run") {
    await recordEvent({ videoId, channelId: video.channelId, type: "post.dry_run", message: "Dry run: approved, not uploaded and not queued for manual posting" });
    return;
  }
  if (video.youtubeVideoId) {
    // A previous attempt uploaded it but crashed before moving on: never upload twice.
    await transition(videoId, "approved", "scheduled", {}, "already uploaded (recovered)");
    return;
  }
  const channel = await prisma.shortsChannel.findUniqueOrThrow({ where: { id: video.channelId } });
  const health = await shortsHealth();
  const decision = uploadDecision({ oauthConfigured: health.features.youtubeOAuth, channel, quotaLeft: await quotaLeftToday() });
  if (!decision.upload) {
    await toManual(video, decision.reason);
    return;
  }
  if (video.slotAt && video.slotAt.getTime() - Date.now() > UPLOAD_LEAD_MS) {
    return { deferUntil: new Date(video.slotAt.getTime() - UPLOAD_LEAD_MS) };
  }
  await uploadVideo(video, channel);
}

export async function toManual(video: ShortsVideoRow, reason: string, from: ShortsStatus = "approved"): Promise<void> {
  const moved = await transition(video.id, from, "manual_pending", { manualReason: reason }, reason);
  if (moved) await recordEvent({ videoId: video.id, channelId: video.channelId, level: "warn", type: "post.manual", message: `Manual queue: ${reason}` });
}

/* ------------------------------- owner actions ------------------------------ */

async function owned(userId: string, id: string): Promise<ShortsVideoRow> {
  const v = await prisma.shortsVideo.findFirst({ where: { id, userId } });
  if (!v) throw notFound("Video not found");
  return v;
}

const conflict = (msg: string) => new HttpError(409, msg, "INVALID_STATE");

export async function approveVideo(userId: string, id: string): Promise<void> {
  const v = await owned(userId, id);
  const moved = await transition(v.id, "awaiting_approval", "approved", { approvedAt: new Date() }, "approved by owner");
  if (!moved) throw conflict(`Only a video awaiting approval can be approved (this one is ${v.status})`);
  await enqueuePost(moved);
}

export async function rejectVideo(userId: string, id: string): Promise<void> {
  const v = await owned(userId, id);
  const moved = await transition(v.id, "awaiting_approval", "rejected", {}, "rejected by owner");
  if (!moved) throw conflict(`Only a video awaiting approval can be rejected (this one is ${v.status})`);
}

const STEP_FOR: Partial<Record<ShortsStatus, { type: string; key: (id: string) => string }>> = {
  idea: { type: "script", key: (id) => jobKey.script(id) },
  scripted: { type: "assets", key: (id) => jobKey.assets(id) },
  assets_ready: { type: "render", key: (id) => jobKey.render(id) },
  approved: { type: "post", key: (id) => jobKey.upload(id) },
};

/** Moves a failed video back to the step it failed at and re-runs that step. */
export async function retryVideo(userId: string, id: string): Promise<void> {
  const v = await owned(userId, id);
  if (v.status !== "failed") throw conflict("Only a failed video can be retried");
  const ev = await prisma.shortsEvent.findFirst({ where: { videoId: id, type: "video.failed" }, orderBy: { createdAt: "desc" } });
  let from = ((ev?.data as { failedFrom?: string } | null)?.failedFrom ?? "idea") as ShortsStatus;
  if (from === "rendered" || from === "awaiting_approval") from = "assets_ready"; // re-render
  if (from === "scheduled" || from === "manual_pending") from = "approved";
  const step = STEP_FOR[from];
  if (!step) throw conflict(`Can't retry from ${from}`);
  const moved = await transition(id, "failed", from, { error: null }, "retry by owner");
  if (!moved) throw conflict("Video changed; refresh");
  const key = step.key(id);
  if (!(await rearmJob(key))) await enqueueJob({ type: step.type, key, videoId: id, channelId: v.channelId });
}

/** Owner posted it by hand: verify the URL is a real, public YouTube video before marking it posted. */
export async function markPosted(userId: string, id: string, url: string, postedAt?: string): Promise<ShortsVideoRow> {
  const v = await owned(userId, id);
  if (v.status !== "manual_pending") throw conflict(`Only a video in the manual queue can be marked posted (this one is ${v.status})`);
  const ytId = parseYoutubeId(url);
  if (!ytId) throw new HttpError(400, "That isn't a YouTube video URL (expected youtube.com/shorts/<id>, watch?v=<id> or youtu.be/<id>)", "BAD_URL");
  const clash = await prisma.shortsVideo.findFirst({ where: { youtubeVideoId: ytId, id: { not: id } }, select: { id: true, title: true } });
  if (clash) throw new HttpError(409, `That YouTube video is already linked to "${clash.title ?? clash.id}"`, "DUPLICATE_URL");
  let verified = false;
  if (env.YOUTUBE_API_KEY) {
    const stats = await fetchPublicStats([ytId]).catch(() => null);
    if (stats) {
      if (!stats.has(ytId)) {
        throw new HttpError(400, "YouTube has no public video with that id. Check the URL, or wait until the video is public.", "NOT_FOUND_ON_YOUTUBE");
      }
      verified = true;
    }
  }
  const at = postedAt ? new Date(postedAt) : new Date();
  const moved = await transition(id, "manual_pending", "manual_posted", { youtubeVideoId: ytId, youtubeUrl: shortsUrl(ytId), postedAt: at, privacyStatus: "public", manualReason: null }, verified ? "marked posted (verified on YouTube)" : "marked posted (not verified: YOUTUBE_API_KEY not set)");
  if (!moved) throw conflict("Video changed; refresh");
  await scheduleCheckpointSyncs(id, at);
  return moved;
}

export async function setManualViewedPct(userId: string, id: string, pct: number | null): Promise<void> {
  await owned(userId, id);
  await prisma.shortsVideo.update({ where: { id }, data: { manualViewedPct: pct } });
}

export function registerPostingHandlers(): void {
  registerJobHandler("post", (j) => runPostStep(j.videoId!), markFailed);
}
