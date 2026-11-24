import type { IgDemographicRow, IgInsightsAccount, IgInsightsDto, IgInsightsReel } from "@catgpt/types";

/**
 * Pure helpers for Instagram Insights (no network, no DB): reading Meta's
 * response shapes and turning the numbers into text for the strategy prompt.
 * Metric names follow Meta's docs (read 2026-11-24).
 */

/** Reel metrics asked for first; if Meta refuses any of them the shorter list is used. */
export const REEL_METRICS_FULL = [
  "views",
  "reach",
  "likes",
  "comments",
  "shares",
  "saved",
  "total_interactions",
  "ig_reels_avg_watch_time",
  "reels_skip_rate",
] as const;
export const REEL_METRICS_BASIC = ["views", "reach", "likes", "comments", "shares", "saved", "total_interactions"] as const;

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** { name: value } from either the `total_value` or the `values[0]` shape Meta uses. */
export function readMetrics(json: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  const data = ((json as { data?: unknown[] } | null)?.data ?? []) as Record<string, unknown>[];
  for (const m of data) {
    if (!m || typeof m !== "object") continue;
    const name = typeof m.name === "string" ? m.name : null;
    if (!name) continue;
    const total = num((m.total_value as { value?: unknown } | undefined)?.value);
    const first = num((m.values as { value?: unknown }[] | undefined)?.[0]?.value);
    const v = total ?? first;
    if (v !== null) out[name] = v;
  }
  return out;
}

/** Rows of a breakdown, e.g. reach split by follow_type: [{ label: "FOLLOWER", value: 120 }]. */
export function readBreakdown(json: unknown): IgDemographicRow[] {
  const data = ((json as { data?: unknown[] } | null)?.data ?? []) as Record<string, unknown>[];
  const rows: IgDemographicRow[] = [];
  for (const m of data) {
    if (!m || typeof m !== "object") continue;
    const breakdowns = ((m.total_value as { breakdowns?: unknown[] } | undefined)?.breakdowns ?? []) as { results?: unknown[] }[];
    for (const b of breakdowns) {
      for (const r of (b.results ?? []) as { dimension_values?: unknown[]; value?: unknown }[]) {
        const value = num(r.value);
        const label = (r.dimension_values ?? []).filter((d): d is string => typeof d === "string").join(" ");
        if (value !== null && label) rows.push({ label, value });
      }
    }
  }
  return rows.sort((a, b) => b.value - a.value);
}

/** Skip rate may come as a ratio (0.35) or a percentage (35): show it as a percentage. */
export function toPercent(v: number | null): number | null {
  if (v === null) return null;
  const p = v <= 1 ? v * 100 : v;
  return Math.round(p * 10) / 10;
}

export function toReel(
  media: { id: string; caption?: string; permalink?: string; thumbnail_url?: string; media_url?: string; timestamp?: string },
  metrics: Record<string, number>,
): IgInsightsReel {
  const ms = metrics.ig_reels_avg_watch_time;
  return {
    mediaId: media.id,
    permalink: media.permalink ?? null,
    thumbnailUrl: media.thumbnail_url ?? null,
    caption: (media.caption ?? "").slice(0, 300),
    timestamp: media.timestamp ?? null,
    views: metrics.views ?? null,
    reach: metrics.reach ?? null,
    likes: metrics.likes ?? null,
    comments: metrics.comments ?? null,
    shares: metrics.shares ?? null,
    saves: metrics.saved ?? null,
    interactions: metrics.total_interactions ?? null,
    // Meta reports watch time in milliseconds.
    avgWatchSec: ms === undefined ? null : Math.round(ms / 100) / 10,
    skipRatePct: toPercent(metrics.reels_skip_rate ?? null),
  };
}

/** Whether an error from the Graph API means "this connection lacks the insights permission". */
export function isPermissionError(message: string, code: number | null): boolean {
  if (code === 10 || code === 3 || (code !== null && code >= 200 && code < 300)) return true;
  return /permission|not authorized|insufficient|manage_insights/i.test(message);
}

/** The reel's engagement per 100 views, for judging reels of very different reach fairly. */
export function interactionsPer100Views(r: Pick<IgInsightsReel, "views" | "interactions" | "likes" | "comments" | "shares" | "saves">): number | null {
  if (!r.views || r.views <= 0) return null;
  const i = r.interactions ?? (r.likes ?? 0) + (r.comments ?? 0) + (r.shares ?? 0) + (r.saves ?? 0);
  return Math.round((i / r.views) * 1000) / 10;
}

const show = (v: number | null) => (v === null ? "n/a" : String(v));

/** The insights as plain text for Gemini. */
export function insightsText(dto: Pick<IgInsightsDto, "account" | "reels" | "demographics" | "days" | "handle">): string {
  const a: IgInsightsAccount | null = dto.account;
  const lines: string[] = [];
  if (a) {
    lines.push(
      `## @${a.handle} - last ${dto.days} days (Instagram's own numbers)`,
      `Followers: ${show(a.followers)}; views: ${show(a.views)}; accounts reached: ${show(a.reach)}; interactions: ${show(a.interactions)} (likes ${show(a.likes)}, comments ${show(a.comments)}, shares ${show(a.shares)}, saves ${show(a.saves)})`,
      `Reach from followers: ${show(a.reachFollowers)}; reach from non-followers: ${show(a.reachNonFollowers)}`,
    );
  }
  if (dto.demographics) {
    const d = dto.demographics;
    const fmt = (rows: IgDemographicRow[]) => rows.slice(0, 5).map((r) => `${r.label} ${r.value}`).join(", ");
    if (d.gender.length) lines.push(`Audience gender: ${fmt(d.gender)}`);
    if (d.age.length) lines.push(`Audience age: ${fmt(d.age)}`);
    if (d.city.length) lines.push(`Audience top cities: ${fmt(d.city)}`);
  }
  lines.push("\n## Reels (newest first)");
  for (const r of dto.reels) {
    lines.push(
      `- Reel ${r.mediaId}${r.timestamp ? ` (${r.timestamp.slice(0, 10)})` : ""}: views ${show(r.views)}, reach ${show(r.reach)}, likes ${show(r.likes)}, comments ${show(r.comments)}, shares ${show(r.shares)}, saves ${show(r.saves)}, avg watch ${r.avgWatchSec === null ? "n/a" : `${r.avgWatchSec}s`}, skip rate ${r.skipRatePct === null ? "n/a" : `${r.skipRatePct}%`}, interactions per 100 views ${show(interactionsPer100Views(r))}\n  Caption: ${r.caption.replace(/\s+/g, " ").slice(0, 160) || "(none)"}`,
    );
  }
  return lines.join("\n");
}
