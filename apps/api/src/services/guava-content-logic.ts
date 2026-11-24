/**
 * Pure helpers for Guava's Instagram content review (no network, no DB), so
 * they can be unit tested. The Graph calls live in guava-content.ts.
 */

import type { GuavaReelRank, GuavaReelTier } from "@catgpt/types";

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

/** Shortens text to n characters. Never cuts an emoji (a surrogate pair) in half: a lone surrogate makes Postgres reject the JSON it is saved in. */
export function clip(s: string, n: number): string {
  if (s.length <= n) return s;
  let end = n - 1;
  const last = s.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return `${s.slice(0, end)}…`;
}

/** Replaces lone surrogates and drops NUL characters, which Postgres JSON columns reject. */
export function wellFormed(s: string): string {
  return s.replace(/\u0000/g, "").replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, "\ufffd");
}

/** A copy of `v` safe to store in a JSON column: every string is made well-formed. */
export function cleanForJson<T>(v: T): T {
  return JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "string" ? wellFormed(x) : x))) as T;
}
