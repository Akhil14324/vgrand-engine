import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Prisma, prisma } from "@catgpt/db";
import { env } from "../../env.js";
import { sha256 } from "../../lib/social-crypto.js";
import type { ShortsChannelRow } from "./channels.js";
import { ShortsConfigError } from "./env-check.js";
import { enqueueJob, PermanentJobError, registerJobHandler, type JobResult } from "./jobs.js";
import { log, recordEvent } from "./log.js";
import { decryptSecret, encryptSecret } from "./storage.js";
import { scheduleCheckpointSyncs } from "./sync.js";
import { getVideo, transition, type ShortsVideoRow } from "./videos.js";
import {
  classifyYoutubeError,
  insertBody,
  pacificDay,
  privateLockReason,
  shortsUrl,
  UPLOADS_PER_DAY,
} from "./youtube-logic.js";

/**
 * YouTube for the Shorts Factory: per-channel OAuth connect, token refresh,
 * resumable upload with crash-safe resume, post-upload status checks.
 * Endpoints live in `google` so tests can point them at a local fake.
 */
export const google = {
  auth: "https://accounts.google.com/o/oauth2/v2/auth",
  token: "https://oauth2.googleapis.com/token",
  revoke: "https://oauth2.googleapis.com/revoke",
  api: "https://www.googleapis.com/youtube/v3",
  upload: "https://www.googleapis.com/upload/youtube/v3/videos",
  analytics: "https://youtubeanalytics.googleapis.com/v2/reports",
};

export const SHORTS_GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly",
  "https://www.googleapis.com/auth/yt-analytics.readonly",
];

const TESTING_HINT =
  "If this keeps happening every ~7 days, the Google OAuth consent screen is still in \"Testing\": set it to \"In production\" (see README).";

export const redirectUri = () => env.GOOGLE_REDIRECT_URI ?? `${env.API_PUBLIC_URL.replace(/\/+$/, "")}/shorts/oauth/callback`;

/** Thrown when YouTube can't be used for this video; the caller moves it to the manual queue with `reason`. */
export class ManualFallback extends Error {
  constructor(public reason: string) {
    super(reason);
  }
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/* --------------------------------- connect ---------------------------------- */

export async function startConnect(userId: string, channelId: string): Promise<string> {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_REDIRECT_URI || !env.TOKEN_ENCRYPTION_KEY) {
    throw new ShortsConfigError("Not configured: set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI and TOKEN_ENCRYPTION_KEY");
  }
  const state = randomBytes(32).toString("base64url");
  await prisma.socialOAuthSession.create({
    data: { stateHash: sha256(state), userId, platform: `shorts:${channelId}`, expiresAt: new Date(Date.now() + 10 * 60_000) },
  });
  const u = new URL(google.auth);
  u.searchParams.set("client_id", env.GOOGLE_CLIENT_ID);
  u.searchParams.set("redirect_uri", redirectUri());
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", SHORTS_GOOGLE_SCOPES.join(" "));
  u.searchParams.set("access_type", "offline");
  // consent: always return a refresh token; select_account: pick the right brand channel.
  u.searchParams.set("prompt", "consent select_account");
  u.searchParams.set("include_granted_scopes", "true");
  u.searchParams.set("state", state);
  return u.toString();
}

/** OAuth callback. Returns the channel slug on success; throws Error(message) for the UI otherwise. */
export async function completeConnect(code: string, state: string): Promise<{ slug: string; title: string }> {
  const now = new Date();
  const session = await prisma.socialOAuthSession.findUnique({ where: { stateHash: sha256(state) } });
  if (!session || !session.platform.startsWith("shorts:") || session.expiresAt < now) throw new Error("This connect link expired. Try again.");
  // Single use: only the first callback with this state proceeds.
  const consumed = await prisma.socialOAuthSession.updateMany({ where: { id: session.id, consumedAt: null }, data: { consumedAt: now } });
  if (consumed.count === 0) throw new Error("This connect link was already used.");
  const channelId = session.platform.slice("shorts:".length);
  const channel = await prisma.shortsChannel.findFirst({ where: { id: channelId, userId: session.userId } });
  if (!channel) throw new Error("Channel not found");

  const res = await fetch(google.token, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri(), client_id: env.GOOGLE_CLIENT_ID!, client_secret: env.GOOGLE_CLIENT_SECRET! }),
  });
  const tok = await readJson(res);
  if (!res.ok || typeof tok.access_token !== "string") throw new Error(`Google token exchange failed (${res.status})`);
  if (typeof tok.refresh_token !== "string") throw new Error("Google returned no refresh token. Remove the app's access in your Google account and connect again.");
  const scopes = typeof tok.scope === "string" ? tok.scope.split(" ") : [];
  const missing = SHORTS_GOOGLE_SCOPES.filter((s) => !scopes.includes(s));
  if (scopes.length && missing.length) throw new Error(`Some permissions were not granted: ${missing.map((s) => s.split("/").pop()).join(", ")}. Connect again and tick every box.`);

  const ch = await fetch(`${google.api}/channels?part=snippet&mine=true`, { headers: { Authorization: `Bearer ${tok.access_token}` } });
  const chJson = await readJson(ch);
  const yt = (chJson.items as { id?: string; snippet?: { title?: string } }[] | undefined)?.[0];
  if (!ch.ok || !yt?.id) throw new Error("That Google account has no YouTube channel (pick the brand channel when Google asks).");

  const clash = await prisma.shortsChannel.findFirst({ where: { userId: channel.userId, ytChannelId: yt.id, id: { not: channel.id } }, select: { displayName: true } });
  if (clash) throw new Error(`YouTube channel "${yt.snippet?.title}" is already connected to ${clash.displayName}. Each experiment channel needs its own YouTube channel.`);

  await prisma.shortsChannel.update({
    where: { id: channel.id },
    data: {
      ytChannelId: yt.id,
      ytChannelTitle: yt.snippet?.title ?? null,
      ytAccessTokenEnc: encryptSecret(tok.access_token),
      ytRefreshTokenEnc: encryptSecret(tok.refresh_token),
      ytTokenExpiresAt: typeof tok.expires_in === "number" ? new Date(Date.now() + tok.expires_in * 1000) : null,
      ytStatus: "connected",
      ytStatusReason: null,
      ytConnectedAt: new Date(),
    },
  });
  await recordEvent({ channelId: channel.id, type: "youtube.connected", message: `Connected YouTube channel "${yt.snippet?.title}" (${yt.id})` });
  return { slug: channel.slug, title: yt.snippet?.title ?? yt.id };
}

export async function disconnect(channel: ShortsChannelRow): Promise<void> {
  if (channel.ytRefreshTokenEnc) {
    try {
      await fetch(`${google.revoke}?token=${encodeURIComponent(decryptSecret(channel.ytRefreshTokenEnc))}`, { method: "POST" });
    } catch {
      // Best effort: the tokens are deleted here either way.
    }
  }
  await prisma.shortsChannel.update({
    where: { id: channel.id },
    data: { ytAccessTokenEnc: null, ytRefreshTokenEnc: null, ytTokenExpiresAt: null, ytStatus: "disconnected", ytStatusReason: null },
  });
  await recordEvent({ channelId: channel.id, type: "youtube.disconnected", message: "YouTube disconnected by the owner" });
}

/* ---------------------------------- tokens ---------------------------------- */

const inflight = new Map<string, Promise<string>>();

async function markReauth(channelId: string, reason: string): Promise<void> {
  await prisma.shortsChannel.update({ where: { id: channelId }, data: { ytStatus: "reauth_required", ytStatusReason: reason } });
  await recordEvent({ channelId, level: "warn", type: "youtube.reauth_required", message: reason });
}

/** A usable access token, refreshed when it expires within 2 minutes. Throws ManualFallback when auth is gone. */
export async function accessToken(channel: ShortsChannelRow): Promise<string> {
  if (!channel.ytRefreshTokenEnc || channel.ytStatus !== "connected") throw new ManualFallback("This channel's YouTube account is not connected");
  if (channel.ytAccessTokenEnc && channel.ytTokenExpiresAt && channel.ytTokenExpiresAt.getTime() - Date.now() > 120_000) {
    return decryptSecret(channel.ytAccessTokenEnc);
  }
  const running = inflight.get(channel.id);
  if (running) return running;
  const p = (async () => {
    const res = await fetch(google.token, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: decryptSecret(channel.ytRefreshTokenEnc!),
        client_id: env.GOOGLE_CLIENT_ID ?? "",
        client_secret: env.GOOGLE_CLIENT_SECRET ?? "",
      }),
    });
    const j = await readJson(res);
    if (!res.ok || typeof j.access_token !== "string") {
      if (res.status >= 500 || res.status === 429) throw new Error(`Google token refresh failed (${res.status}); will retry`);
      const reason = `YouTube authorization expired or was revoked (${String(j.error ?? res.status)}): reconnect the channel. ${TESTING_HINT}`;
      await markReauth(channel.id, reason);
      throw new ManualFallback(reason);
    }
    await prisma.shortsChannel.update({
      where: { id: channel.id },
      data: {
        ytAccessTokenEnc: encryptSecret(j.access_token),
        ytTokenExpiresAt: typeof j.expires_in === "number" ? new Date(Date.now() + j.expires_in * 1000) : null,
      },
    });
    return j.access_token;
  })().finally(() => inflight.delete(channel.id));
  inflight.set(channel.id, p);
  return p;
}

/* ---------------------------------- quota ----------------------------------- */

/** Uploads left in today's (Pacific time) budget. */
export async function quotaLeftToday(): Promise<number> {
  const row = await prisma.shortsQuotaDay.findUnique({ where: { day: pacificDay() } });
  return UPLOADS_PER_DAY - (row?.uploads ?? 0);
}

/** Atomically takes one upload from today's budget. False when it is used up. */
async function reserveUpload(): Promise<boolean> {
  const day = pacificDay();
  const rows = await prisma.$queryRaw<{ uploads: number }[]>`
    INSERT INTO "shorts_quota_days" ("day", "uploads", "units", "updatedAt") VALUES (${day}, 1, 1, now())
    ON CONFLICT ("day") DO UPDATE SET "uploads" = "shorts_quota_days"."uploads" + 1, "units" = "shorts_quota_days"."units" + 1, "updatedAt" = now()
    WHERE "shorts_quota_days"."uploads" < ${UPLOADS_PER_DAY}
    RETURNING "uploads"`;
  return rows.length > 0;
}

/** YouTube said the quota is gone: stop trying for the rest of the Pacific day. */
async function exhaustQuota(): Promise<void> {
  const day = pacificDay();
  await prisma.shortsQuotaDay.upsert({ where: { day }, create: { day, uploads: UPLOADS_PER_DAY }, update: { uploads: UPLOADS_PER_DAY } });
}

/* ---------------------------------- upload ---------------------------------- */

interface UploadState {
  uri: string;
  size: number;
  requested: "public" | "private";
  publishAt: string | null;
}

type Probe = { kind: "done"; id: string } | { kind: "resume"; offset: number } | { kind: "dead" };

async function probe(uri: string, token: string, size: number): Promise<Probe> {
  const res = await fetch(uri, { method: "PUT", headers: { Authorization: `Bearer ${token}`, "Content-Length": "0", "Content-Range": `bytes */${size}` } });
  if (res.status === 200 || res.status === 201) {
    const j = await readJson(res);
    return typeof j.id === "string" ? { kind: "done", id: j.id } : { kind: "dead" };
  }
  if (res.status === 308) {
    const m = /bytes=0-(\d+)/.exec(res.headers.get("range") ?? "");
    return { kind: "resume", offset: m ? Number(m[1]) + 1 : 0 };
  }
  if (res.status === 404 || res.status === 410) return { kind: "dead" };
  throw new Error(`YouTube upload session check failed (${res.status})`);
}

async function handleApiError(res: Response, channel: ShortsChannelRow): Promise<never> {
  const c = classifyYoutubeError(res.status, await readJson(res));
  if (c.kind === "quota") {
    await exhaustQuota();
    throw new ManualFallback(`YouTube quota exceeded (${c.reason}); resets at midnight Pacific time`);
  }
  if (c.kind === "auth") {
    const reason = `YouTube rejected the channel's authorization (${c.reason}): reconnect it. ${TESTING_HINT}`;
    await markReauth(channel.id, reason);
    throw new ManualFallback(reason);
  }
  if (c.kind === "invalid") throw new PermanentJobError(`YouTube refused the upload: ${c.message}`);
  throw new Error(`YouTube error (${res.status}): ${c.message}`);
}

/**
 * Uploads `video` (status approved). Crash-safe: the session URI is saved
 * before any bytes are sent, the YouTube id is saved the moment it is known,
 * and a retry resumes the saved session instead of starting a new upload.
 */
export async function uploadVideo(video: ShortsVideoRow, channel: ShortsChannelRow): Promise<void> {
  try {
    await doUpload(video, channel);
  } catch (err) {
    if (err instanceof ManualFallback) {
      const moved = await transition(video.id, "approved", "manual_pending", { manualReason: err.reason }, err.reason);
      if (moved) await recordEvent({ videoId: video.id, channelId: video.channelId, level: "warn", type: "post.manual", message: `Manual queue: ${err.reason}` });
      return;
    }
    throw err;
  }
}

async function doUpload(video: ShortsVideoRow, channel: ShortsChannelRow): Promise<void> {
  if (!video.filePath) throw new PermanentJobError("No rendered file to upload");
  const token = await accessToken(channel);
  const file = await readFile(video.filePath);
  let state = video.uploadState as UploadState | null;
  let offset = 0;
  let ytId: string | null = null;

  if (state?.uri) {
    const p = await probe(state.uri, token, state.size);
    if (p.kind === "done") ytId = p.id;
    else if (p.kind === "resume" && state.size === file.byteLength) offset = p.offset;
    else state = null;
  }

  if (!ytId && !state) {
    if (!(await reserveUpload())) throw new ManualFallback("Daily YouTube upload budget used up (resets at midnight Pacific time)");
    const body = insertBody({
      title: video.title ?? "Untitled",
      description: video.description ?? "",
      tags: video.tags,
      synthetic: video.synthetic,
      publishAt: video.slotAt,
    });
    const init = await fetch(`${google.upload}?uploadType=resumable&part=snippet,status`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Length": String(file.byteLength),
        "X-Upload-Content-Type": "video/mp4",
      },
      body: JSON.stringify(body),
    });
    if (!init.ok) await handleApiError(init, channel);
    const uri = init.headers.get("location");
    if (!uri) throw new Error("YouTube returned no upload session");
    state = { uri, size: file.byteLength, requested: body.status.privacyStatus as "public" | "private", publishAt: "publishAt" in body.status ? (body.status.publishAt as string) : null };
    // Persist BEFORE sending bytes so a crash resumes this session instead of uploading twice.
    await prisma.shortsVideo.update({ where: { id: video.id }, data: { uploadState: state as unknown as Prisma.InputJsonValue } });
    await recordEvent({ videoId: video.id, channelId: channel.id, type: "upload.started", message: `Upload session opened (${state.requested}${state.publishAt ? `, publishAt ${state.publishAt}` : ""})` });
  }

  if (!ytId) {
    const res = await fetch(state!.uri, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "video/mp4",
        "Content-Length": String(file.byteLength - offset),
        ...(offset > 0 ? { "Content-Range": `bytes ${offset}-${file.byteLength - 1}/${file.byteLength}` } : {}),
      },
      body: new Uint8Array(file.subarray(offset)),
      signal: AbortSignal.timeout(15 * 60_000),
    });
    if (res.status === 200 || res.status === 201) {
      const j = await readJson(res);
      if (typeof j.id !== "string") throw new Error("YouTube returned no video id");
      ytId = j.id;
    } else if (res.status === 308) {
      throw new Error("YouTube upload incomplete; will resume");
    } else {
      await handleApiError(res, channel);
    }
  }

  // Save the id first: from here on a retry can never upload this video again.
  await prisma.shortsVideo.updateMany({ where: { id: video.id, youtubeVideoId: null }, data: { youtubeVideoId: ytId, youtubeUrl: shortsUrl(ytId!) } });
  log.info("upload.done", { videoId: video.id, youtubeVideoId: ytId, resumedFrom: offset });
  await afterUpload(await getVideo(video.id), channel, state);
}

/** Reads the real status back; schedules, posts, or flags a private lock. */
async function afterUpload(video: ShortsVideoRow, channel: ShortsChannelRow, state: UploadState | null): Promise<void> {
  const st = await fetchStatus(channel, video.youtubeVideoId!);
  const requested = state?.requested ?? "public";
  const publishAt = state?.publishAt ? new Date(state.publishAt) : null;
  const lock = privateLockReason({ requested, publishAt, actualPrivacy: st?.privacyStatus ?? null, actualPublishAt: st?.publishAt ?? null });
  if (lock) {
    const reason = `Uploaded as ${video.youtubeUrl}, but ${lock} Make it public in YouTube Studio (or post it yourself), then mark it posted.`;
    const moved = await transition(video.id, "approved", "manual_pending", { privateLocked: true, privacyStatus: st?.privacyStatus ?? null, manualReason: reason }, "private lock");
    if (moved) await recordEvent({ videoId: video.id, channelId: channel.id, level: "warn", type: "upload.private_locked", message: reason });
    return;
  }
  if (publishAt && publishAt.getTime() > Date.now()) {
    const moved = await transition(video.id, "approved", "scheduled", { publishAt, privacyStatus: st?.privacyStatus ?? "private" }, `scheduled for ${publishAt.toISOString()}`);
    if (moved) {
      await enqueueJob({ type: "publish_check", key: `publish_check:${video.id}`, videoId: video.id, channelId: channel.id, runAt: new Date(publishAt.getTime() + 10 * 60_000), maxAttempts: 6 });
    }
    return;
  }
  const at = new Date();
  const moved = await transition(video.id, "approved", "posted", { postedAt: at, privacyStatus: st?.privacyStatus ?? "public" }, "published");
  if (moved) await scheduleCheckpointSyncs(video.id, at);
}

/** videos.list?part=status with the channel's token (sees private/scheduled videos too). */
export async function fetchStatus(channel: ShortsChannelRow, ytId: string): Promise<{ privacyStatus: string | null; publishAt: string | null; uploadStatus: string | null } | null> {
  const token = await accessToken(channel);
  const res = await fetch(`${google.api}/videos?part=status&id=${encodeURIComponent(ytId)}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    log.warn("youtube.status_failed", { ytId, status: res.status });
    return null;
  }
  const it = ((await readJson(res)).items as { status?: { privacyStatus?: string; publishAt?: string; uploadStatus?: string } }[] | undefined)?.[0];
  if (!it) return null;
  return { privacyStatus: it.status?.privacyStatus ?? null, publishAt: it.status?.publishAt ?? null, uploadStatus: it.status?.uploadStatus ?? null };
}

/** After a scheduled publish time: confirm it went public before calling it posted. */
export async function runPublishCheck(videoId: string): Promise<JobResult> {
  const video = await getVideo(videoId);
  if (video.status !== "scheduled" || !video.youtubeVideoId) return;
  const channel = await prisma.shortsChannel.findUniqueOrThrow({ where: { id: video.channelId } });
  let st: Awaited<ReturnType<typeof fetchStatus>> = null;
  try {
    st = await fetchStatus(channel, video.youtubeVideoId);
  } catch (err) {
    if (err instanceof ManualFallback) {
      const reason = `Scheduled on YouTube, but its status can't be checked: ${err.reason}. Check it in Studio and mark it posted if it is public.`;
      await transition(videoId, "scheduled", "manual_pending", { manualReason: reason }, reason);
      return;
    }
    throw err;
  }
  if (st?.privacyStatus === "public") {
    const at = video.publishAt ?? new Date();
    const moved = await transition(videoId, "scheduled", "posted", { postedAt: at, privacyStatus: "public" }, "went public at its scheduled time");
    if (moved) await scheduleCheckpointSyncs(videoId, at);
    return;
  }
  const lock = privateLockReason({ requested: "private", publishAt: video.publishAt, actualPrivacy: st?.privacyStatus ?? null, actualPublishAt: st?.publishAt ?? null });
  if (lock) {
    const reason = `${lock} Make it public in YouTube Studio, then mark it posted.`;
    await transition(videoId, "scheduled", "manual_pending", { privateLocked: true, privacyStatus: st?.privacyStatus ?? null, manualReason: reason }, "private lock");
    await recordEvent({ videoId, channelId: video.channelId, level: "warn", type: "upload.private_locked", message: reason });
    return;
  }
  const since = video.publishAt ? Date.now() - video.publishAt.getTime() : 0;
  if (since > 6 * 3600_000) {
    const reason = `Not public 6 hours after its scheduled time (YouTube reports ${st?.privacyStatus ?? "no status"}). Check it in Studio, then mark it posted.`;
    await transition(videoId, "scheduled", "manual_pending", { manualReason: reason, privacyStatus: st?.privacyStatus ?? null }, reason);
    return;
  }
  // YouTube can lag a few minutes; check again shortly.
  return { deferUntil: new Date(Date.now() + 15 * 60_000) };
}

export function registerYoutubeHandlers(): void {
  registerJobHandler("publish_check", (j) => runPublishCheck(j.videoId!));
}
