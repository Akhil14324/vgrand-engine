/**
 * Pure YouTube helpers: URL parsing, upload/manual decision, request bodies,
 * error classification, quota-day accounting, private-lock detection.
 * API facts checked 2026-11-20 are listed in DECISIONS.md.
 */

const ID = /^[A-Za-z0-9_-]{11}$/;
const YT_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be", "www.youtu.be"]);

/** Video id from any common YouTube URL (watch, shorts, youtu.be, embed, live), or a bare id. */
export function parseYoutubeId(input: string): string | null {
  const raw = input.trim();
  if (ID.test(raw)) return raw;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (!YT_HOSTS.has(u.hostname.toLowerCase())) return null;
  if (u.hostname.toLowerCase().endsWith("youtu.be")) {
    const id = u.pathname.split("/")[1] ?? "";
    return ID.test(id) ? id : null;
  }
  const v = u.searchParams.get("v");
  if (v && ID.test(v)) return v;
  const m = /^\/(shorts|embed|live|v)\/([A-Za-z0-9_-]{11})/.exec(u.pathname);
  return m ? m[2]! : null;
}

export const shortsUrl = (id: string) => `https://www.youtube.com/shorts/${id}`;

export type UploadDecision = { upload: true } | { upload: false; reason: string };

/** Whether a video can be uploaded by the API, or why it goes to the manual queue. */
export function uploadDecision(input: {
  oauthConfigured: boolean;
  channel: { ytStatus: string; ytStatusReason: string | null; ytRefreshTokenEnc: string | null };
  quotaLeft: number;
}): UploadDecision {
  if (!input.oauthConfigured) {
    return { upload: false, reason: "Google OAuth is not configured on the server (GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI, TOKEN_ENCRYPTION_KEY)" };
  }
  if (input.channel.ytStatus === "reauth_required") {
    return { upload: false, reason: `YouTube authorization expired or was revoked: reconnect the channel. ${input.channel.ytStatusReason ?? ""}`.trim() };
  }
  if (input.channel.ytStatus !== "connected" || !input.channel.ytRefreshTokenEnc) {
    return { upload: false, reason: "This channel's YouTube account is not connected" };
  }
  if (input.quotaLeft <= 0) {
    return { upload: false, reason: "Daily YouTube upload quota used up for today (resets at midnight Pacific time)" };
  }
  return { upload: true };
}

/* --------------------------------- quota day -------------------------------- */

/** YouTube quotas reset at midnight Pacific time. */
export function pacificDay(at = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

/** Current docs: videos.insert has its own bucket of 100 calls/day (1 unit each). Keep a margin. */
export const UPLOADS_PER_DAY = 95;

/* ------------------------------- request bodies ----------------------------- */

export interface InsertMeta {
  title: string;
  description: string;
  tags: string[];
  synthetic: boolean;
  /** Future publish time, or null to publish now. */
  publishAt: Date | null;
}

/** Title/description/tags with #Shorts, within YouTube's limits (title 100, description 5000). */
export function shortsSnippet(title: string, description: string, tags: string[]) {
  const t = title.replace(/[<>]/g, "").trim();
  const withTag = /#shorts/i.test(t) || t.length > 92 ? t.slice(0, 100) : `${t} #Shorts`;
  const desc = description.replace(/[<>]/g, "").trim();
  const d = /#shorts/i.test(desc) ? desc : `${desc}\n\n#Shorts`;
  return { title: withTag, description: d.slice(0, 5000), tags };
}

/** videos.insert body: scheduled uploads are private + publishAt (required by the API); otherwise public. */
export function insertBody(m: InsertMeta, now = new Date()) {
  const scheduled = m.publishAt && m.publishAt.getTime() - now.getTime() > 15 * 60_000;
  return {
    snippet: { ...shortsSnippet(m.title, m.description, m.tags), categoryId: "22" },
    status: {
      privacyStatus: scheduled ? "private" : "public",
      ...(scheduled ? { publishAt: m.publishAt!.toISOString() } : {}),
      selfDeclaredMadeForKids: false,
      containsSyntheticMedia: m.synthetic,
    },
  };
}

/* --------------------------------- errors ---------------------------------- */

export type YoutubeErrorKind = "quota" | "auth" | "invalid" | "retryable";

export function classifyYoutubeError(status: number, body: unknown): { kind: YoutubeErrorKind; reason: string; message: string } {
  const e = ((body as { error?: { message?: string; errors?: { reason?: string }[] } })?.error ?? {}) as {
    message?: string;
    errors?: { reason?: string }[];
  };
  const reason = e.errors?.[0]?.reason ?? "";
  const message = (e.message ?? `YouTube request failed (${status})`).slice(0, 300);
  if (["quotaExceeded", "uploadLimitExceeded", "dailyLimitExceeded", "rateLimitExceeded", "userRateLimitExceeded"].includes(reason)) {
    return { kind: "quota", reason, message };
  }
  if (status === 401 || reason === "authError" || reason === "invalid_grant") return { kind: "auth", reason: reason || "unauthorized", message };
  if (status === 403 && /forbidden|insufficientPermissions|youtubeSignupRequired/i.test(reason)) return { kind: "auth", reason, message };
  if (status === 429) return { kind: "quota", reason: reason || "rateLimited", message };
  if (status >= 500) return { kind: "retryable", reason, message };
  if (status === 400 || status === 403 || status === 404) return { kind: "invalid", reason, message };
  return { kind: "retryable", reason, message };
}

/* ------------------------------ private lock -------------------------------- */

/**
 * After an upload YouTube reports the real status. "Locked private" = the video
 * is private although we asked for public, or it is still private after its
 * publish time passed (YouTube didn't honour publishAt).
 */
export function privateLockReason(input: {
  requested: "public" | "private";
  publishAt: Date | null;
  actualPrivacy: string | null;
  actualPublishAt: string | null;
  now?: Date;
}): string | null {
  const now = input.now ?? new Date();
  if (input.actualPrivacy === null) return null;
  if (input.requested === "public" && input.actualPrivacy === "private") {
    return "YouTube set this upload to private although it was sent as public (unverified API projects can be locked to private).";
  }
  if (input.requested === "private" && input.publishAt) {
    if (!input.actualPublishAt && input.actualPrivacy === "private") {
      return "YouTube dropped the scheduled publish time; the video will stay private.";
    }
    if (input.publishAt.getTime() < now.getTime() - 30 * 60_000 && input.actualPrivacy === "private") {
      return "The video is still private 30+ minutes after its scheduled publish time.";
    }
  }
  return null;
}

/* --------------------------------- stats ----------------------------------- */

export interface PublicStats {
  views: number | null;
  likes: number | null;
  comments: number | null;
  privacyStatus: string | null;
}

/** Parses videos.list?part=statistics,status. Missing ids are absent (deleted, private, wrong id). */
export function parsePublicStats(json: unknown): Map<string, PublicStats> {
  const out = new Map<string, PublicStats>();
  const items = (json as { items?: { id?: string; statistics?: Record<string, string>; status?: { privacyStatus?: string } }[] }).items ?? [];
  const num = (v: string | undefined) => (v === undefined ? null : Number(v));
  for (const it of items) {
    if (!it.id) continue;
    out.set(it.id, {
      views: num(it.statistics?.viewCount),
      likes: num(it.statistics?.likeCount),
      comments: num(it.statistics?.commentCount),
      privacyStatus: it.status?.privacyStatus ?? null,
    });
  }
  return out;
}

export const SYNC_CHECKPOINTS = [
  { name: "24h", afterMs: 24 * 3600_000 },
  { name: "72h", afterMs: 72 * 3600_000 },
  { name: "7d", afterMs: 7 * 24 * 3600_000 },
] as const;

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
