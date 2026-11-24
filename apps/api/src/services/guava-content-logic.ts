/**
 * Pure helpers for Guava's Instagram content review (no network, no DB), so
 * they can be unit tested. The Graph calls live in guava-content.ts.
 */

import {
  GUAVA_SIGNAL_LABELS,
  type GuavaReelRank,
  type GuavaReelSignals,
  type GuavaReelTier,
  type GuavaSignalKey,
  type GuavaSignalSplit,
} from "@catgpt/types";

/** The media fields asked for, both for the brand's own account and via business_discovery. */
export const IG_MEDIA_FIELDS =
  "id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count";
export const IG_PROFILE_FIELDS = "username,name,biography,followers_count,media_count";

export interface IgMedia {
  id: string;
  caption: string;
  mediaType: string;
  productType: string | null;
  mediaUrl: string | null;
  thumbnailUrl: string | null;
  permalink: string | null;
  timestamp: string | null;
  likes: number | null;
  comments: number | null;
}

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** One Graph media object -> IgMedia; null when it has no id. */
export function toIgMedia(raw: unknown): IgMedia | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Record<string, unknown>;
  const id = str(m.id);
  if (!id) return null;
  return {
    id,
    caption: str(m.caption) ?? "",
    mediaType: str(m.media_type) ?? "IMAGE",
    productType: str(m.media_product_type),
    mediaUrl: str(m.media_url),
    thumbnailUrl: str(m.thumbnail_url),
    permalink: str(m.permalink),
    timestamp: str(m.timestamp),
    likes: num(m.like_count),
    comments: num(m.comments_count),
  };
}

export const isReel = (m: IgMedia) => m.productType === "REELS" || m.mediaType === "VIDEO";

/**
 * Newest reels first, up to `limit`. If the account has fewer reels than that,
 * the rest is filled with its newest other posts so the review is never empty;
 * stories and media without anything viewable are skipped.
 */
export function pickMedia(list: IgMedia[], limit: number): IgMedia[] {
  const usable = list.filter((m) => m.productType !== "STORY" && (m.mediaUrl || m.thumbnailUrl || m.caption));
  const byNewest = [...usable].sort((a, b) => (b.timestamp ?? "").localeCompare(a.timestamp ?? ""));
  const reels = byNewest.filter(isReel);
  const others = byNewest.filter((m) => !isReel(m));
  return [...reels, ...others].slice(0, limit);
}

/** Readable reason for a competitor lookup that Meta refused. */
export function competitorErrorReason(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("cannot be found") || m.includes("not found") || m.includes("does not exist") || m.includes("2207013")) {
    return "Instagram couldn't find this account, or it is a personal account. Only public Business or Creator accounts can be read.";
  }
  if (m.includes("permission") || m.includes("(#10)") || m.includes("(#200)")) {
    return "Your connected Instagram account doesn't have permission to look up other accounts yet (Meta app review).";
  }
  if (m.includes("rate") || m.includes("limit")) return "Instagram's rate limit was hit. Try again in a while.";
  return "Couldn't read this account from Instagram.";
}

/** Average likes/comments per post, only over posts that report them. */
export function engagementAverages(list: { likes: number | null; comments: number | null }[]) {
  const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
  return {
    likes: avg(list.flatMap((m) => (m.likes === null ? [] : [m.likes]))),
    comments: avg(list.flatMap((m) => (m.comments === null ? [] : [m.comments]))),
  };
}

/**
 * Ranks posts by likes + comments and labels each against the group's own average:
 * 20% or more above = strong, 20% or more below = weak, otherwise average.
 */
export function rankReels(
  posts: { mediaId: string; likes: number | null; comments: number | null }[],
): GuavaReelRank[] {
  const scored = posts
    .filter((p) => p.likes !== null || p.comments !== null)
    .map((p) => ({ mediaId: p.mediaId, score: (p.likes ?? 0) + (p.comments ?? 0) }))
    .sort((a, b) => b.score - a.score);
  if (!scored.length) return [];
  const mean = scored.reduce((n, p) => n + p.score, 0) / scored.length;
  return scored.map((p, i) => {
    const vsAvgPct = mean > 0 ? Math.round(((p.score - mean) / mean) * 100) : null;
    const tier: GuavaReelTier = scored.length < 2 || vsAvgPct === null ? "average" : vsAvgPct >= 20 ? "strong" : vsAvgPct <= -20 ? "weak" : "average";
    return { mediaId: p.mediaId, rank: i + 1, tier, score: p.score, vsAvgPct };
  });
}

/** Engagement numbers for one account, from Instagram's like/comment counts only. */
export function computePerformance(
  followers: number | null,
  posts: { mediaId: string; likes: number | null; comments: number | null }[],
) {
  const avg = engagementAverages(posts);
  const scored = posts
    .filter((p) => p.likes !== null || p.comments !== null)
    .map((p) => ({ id: p.mediaId, score: (p.likes ?? 0) + (p.comments ?? 0) }))
    .sort((a, b) => b.score - a.score);
  const rate =
    followers && followers > 0 && (avg.likes !== null || avg.comments !== null)
      ? Math.round((((avg.likes ?? 0) + (avg.comments ?? 0)) / followers) * 10_000) / 100
      : null;
  return {
    followers,
    postsReviewed: posts.length,
    avgLikes: avg.likes,
    avgComments: avg.comments,
    engagementRatePct: rate,
    bestMediaId: scored[0]?.id ?? null,
    weakestMediaId: scored.length > 1 ? scored[scored.length - 1]!.id : null,
  };
}

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Maps the brand name the model returned onto one of the user's brands; null for "none" or unknown names. */
export function matchBrand<T extends { id: string; name: string }>(answer: string, brands: T[]): T | null {
  const a = squash(answer);
  if (!a || a === "none" || a === "other") return null;
  return brands.find((b) => squash(b.name) === a) ?? null;
}

export const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/* ------------------------------ splits (Petalie-style) ------------------------------ */

/** Likes + comments; null when Instagram hides both. */
export const engagementOf = (p: { likes: number | null; comments: number | null }) =>
  p.likes === null && p.comments === null ? null : (p.likes ?? 0) + (p.comments ?? 0);

/** The middle value: a typical post, so one viral post doesn't drag the number. */
export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : Math.round((s[mid - 1]! + s[mid]!) / 2);
}

/** A post this many times above the typical post of its account is a spike (a one-off, or possibly boosted). */
export const SPIKE_TIMES = 3;

/** Posts far above their account's typical post. Needs 4+ posts to say anything. */
export function findSpikes<T extends { mediaId: string; handle: string; likes: number | null; comments: number | null }>(
  posts: T[],
): { mediaId: string; handle: string; timesTypical: number }[] {
  const out: { mediaId: string; handle: string; timesTypical: number }[] = [];
  for (const handle of new Set(posts.map((p) => p.handle))) {
    const scored = posts.flatMap((p) => {
      const e = engagementOf(p);
      return p.handle === handle && e !== null ? [{ p, e }] : [];
    });
    if (scored.length < 4) continue;
    for (const { p, e } of scored) {
      const others = median(scored.filter((x) => x.p !== p).map((x) => x.e));
      if (others && others > 0 && e >= SPIKE_TIMES * others) {
        out.push({ mediaId: p.mediaId, handle, timesTypical: Math.round((e / others) * 10) / 10 });
      }
    }
  }
  return out;
}

/**
 * Typical engagement of posts with vs without each thing seen in the footage.
 * "sure": 3+ posts on each side and one side at least 1.5x the other.
 * "i_think": 2+ on each side and at least 1.25x. Otherwise "too_close".
 * Spikes are left out so one viral post can't decide a split.
 */
export function signalSplits(
  posts: { mediaId: string; likes: number | null; comments: number | null; signals: GuavaReelSignals | null | undefined }[],
  excludeIds: Set<string> = new Set(),
): GuavaSignalSplit[] {
  const usable = posts.flatMap((p) => {
    const e = engagementOf(p);
    return e !== null && p.signals && !excludeIds.has(p.mediaId) ? [{ e, s: p.signals }] : [];
  });
  const keys = Object.keys(GUAVA_SIGNAL_LABELS) as (GuavaSignalKey | "short")[];
  const out: GuavaSignalSplit[] = [];
  for (const key of keys) {
    const value = (s: GuavaReelSignals): boolean | null =>
      key === "short" ? (s.lengthSec === null ? null : s.lengthSec <= 15) : s[key];
    const yes = usable.filter((u) => value(u.s) === true).map((u) => u.e);
    const no = usable.filter((u) => value(u.s) === false).map((u) => u.e);
    if (!yes.length || !no.length) continue;
    const a = median(yes)!;
    const b = median(no)!;
    const ratio = Math.max(a, b) / Math.max(1, Math.min(a, b));
    const n = Math.min(yes.length, no.length);
    const confidence = n >= 3 && ratio >= 1.5 ? "sure" : n >= 2 && ratio >= 1.25 ? "i_think" : "too_close";
    const labels = GUAVA_SIGNAL_LABELS[key];
    out.push({
      key,
      label: labels.yes,
      withLabel: labels.yes,
      withoutLabel: labels.no,
      withCount: yes.length,
      withoutCount: no.length,
      withTypical: a,
      withoutTypical: b,
      confidence,
    });
  }
  const rank = { sure: 0, i_think: 1, too_close: 2 } as const;
  return out.sort(
    (x, y) =>
      rank[x.confidence] - rank[y.confidence] ||
      Math.max(y.withTypical, y.withoutTypical) / Math.max(1, Math.min(y.withTypical, y.withoutTypical)) -
        Math.max(x.withTypical, x.withoutTypical) / Math.max(1, Math.min(x.withTypical, x.withoutTypical)),
  );
}

/** One line per split for the report prompt. */
export function describeSplit(s: GuavaSignalSplit): string {
  const conf = s.confidence === "sure" ? "SURE" : s.confidence === "i_think" ? "I THINK" : "TOO CLOSE TO CALL";
  return `- ${s.withLabel}: typical ${s.withTypical} likes+comments (${s.withCount} posts) vs ${s.withoutLabel.toLowerCase()}: ${s.withoutTypical} (${s.withoutCount} posts) -> ${conf}`;
}
