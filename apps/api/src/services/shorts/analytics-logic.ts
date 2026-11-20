/**
 * Shorts analytics math. Pure: takes per-video facts, returns dashboard data.
 * Nothing here invents a number: a metric with no source is null, and a group
 * too small to compare is labelled instead of ranked.
 */

/** A channel needs this many posted videos before it is ranked (spec: "too early" below 30). */
export const MIN_VIDEOS_TO_RANK = 30;
/** A tag group needs this many videos before its numbers are shown as comparable. */
export const MIN_GROUP_SIZE = 10;
/** Outliers need enough videos in the channel for a 90th percentile to mean anything. */
export const MIN_VIDEOS_FOR_OUTLIERS = 10;

export interface VideoFacts {
  id: string;
  title: string | null;
  channelId: string;
  channelSlug: string;
  channelName: string;
  niche: string;
  path: string;
  postedAt: Date;
  dims: Record<string, string | number | boolean | null>;
  /** Latest public/analytics views. */
  views: number | null;
  /** Views at the 7-day checkpoint (comparable across videos), when the video is old enough. */
  views7d: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  subscribersGained: number | null;
  averageViewPercentage: number | null;
  averageViewDuration: number | null;
  manualViewedPct: number | null;
  youtubeUrl: string | null;
}

export type Metric = "views7d" | "views";

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

export function mean(xs: number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

/** Nearest-rank percentile (p in 0..100). */
export function percentile(xs: number[], p: number): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * s.length);
  return s[Math.min(s.length - 1, Math.max(0, rank - 1))]!;
}

const nums = (xs: (number | null)[]) => xs.filter((x): x is number => x !== null && Number.isFinite(x));
const sum = (xs: (number | null)[]) => {
  const n = nums(xs);
  return n.length ? n.reduce((a, b) => a + b, 0) : null;
};

/* --------------------------------- overview --------------------------------- */

export interface ChannelRow {
  channelId: string;
  slug: string;
  name: string;
  niche: string;
  path: string;
  videosPosted: number;
  totalViews: number | null;
  medianViews: number | null;
  medianViews7d: number | null;
  videosWith7d: number;
  subscribersGained: number | null;
  avgViewPercentage: number | null;
  /** Mean of the owner's manual "viewed vs swiped" entries, when any. */
  avgViewedPct: number | null;
  confidence: "too_early" | "ok";
  /** 1 = best, by the chosen metric; null when too early or no data. */
  rank: number | null;
}

export function channelOverview(
  channels: { id: string; slug: string; name: string; niche: string; path: string }[],
  videos: VideoFacts[],
  metric: Metric,
): ChannelRow[] {
  const rows: ChannelRow[] = channels.map((c) => {
    const vs = videos.filter((v) => v.channelId === c.id);
    const v7 = nums(vs.map((v) => v.views7d));
    return {
      channelId: c.id,
      slug: c.slug,
      name: c.name,
      niche: c.niche,
      path: c.path,
      videosPosted: vs.length,
      totalViews: sum(vs.map((v) => v.views)),
      medianViews: median(nums(vs.map((v) => v.views))),
      medianViews7d: median(v7),
      videosWith7d: v7.length,
      subscribersGained: sum(vs.map((v) => v.subscribersGained)),
      avgViewPercentage: mean(nums(vs.map((v) => v.averageViewPercentage))),
      avgViewedPct: mean(nums(vs.map((v) => v.manualViewedPct))),
      confidence: vs.length < MIN_VIDEOS_TO_RANK ? "too_early" : "ok",
      rank: null,
    };
  });
  const key = (r: ChannelRow) => (metric === "views7d" ? r.medianViews7d : r.medianViews);
  const ranked = rows.filter((r) => r.confidence === "ok" && key(r) !== null).sort((a, b) => key(b)! - key(a)!);
  ranked.forEach((r, i) => (r.rank = i + 1));
  return rows;
}

/* ------------------------------ niche comparison ----------------------------- */

/** Per-channel normalised numbers (per video posted). */
export function perVideo(rows: ChannelRow[]) {
  return rows.map((r) => ({
    slug: r.slug,
    name: r.name,
    niche: r.niche,
    videosPosted: r.videosPosted,
    viewsPerVideo: r.totalViews !== null && r.videosPosted ? r.totalViews / r.videosPosted : null,
    subsPerVideo: r.subscribersGained !== null && r.videosPosted ? r.subscribersGained / r.videosPosted : null,
    confidence: r.confidence,
  }));
}

/** Monday (UTC date string) of the week containing `d`. */
export function weekOf(d: Date): string {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = (x.getUTCDay() + 6) % 7;
  x.setUTCDate(x.getUTCDate() - dow);
  return x.toISOString().slice(0, 10);
}

/** Weekly median of the metric per channel, by posting week. */
export function weeklyTrend(videos: VideoFacts[], metric: Metric): { slug: string; points: { week: string; median: number; n: number }[] }[] {
  const by = new Map<string, Map<string, number[]>>();
  for (const v of videos) {
    const val = metric === "views7d" ? v.views7d : v.views;
    if (val === null) continue;
    const w = weekOf(v.postedAt);
    const m = by.get(v.channelSlug) ?? new Map<string, number[]>();
    m.set(w, [...(m.get(w) ?? []), val]);
    by.set(v.channelSlug, m);
  }
  return [...by.entries()].map(([slug, weeks]) => ({
    slug,
    points: [...weeks.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([week, xs]) => ({ week, median: median(xs)!, n: xs.length })),
  }));
}

/* ------------------------------- format analysis ----------------------------- */

export const FORMAT_DIMENSIONS = ["hookType", "lengthBucket", "postingHour", "path", "voice", "synthetic", "niche"] as const;
export type FormatDimension = (typeof FORMAT_DIMENSIONS)[number];

export interface FormatGroup {
  value: string;
  videos: number;
  withMetric: number;
  medianMetric: number | null;
  avgViewPercentage: number | null;
  /** (likes + comments) / views, mean over videos with views > 0. */
  engagementRate: number | null;
  enough: boolean;
}

export function formatAnalysis(videos: VideoFacts[], dim: FormatDimension, metric: Metric): FormatGroup[] {
  const groups = new Map<string, VideoFacts[]>();
  for (const v of videos) {
    const raw = dim === "niche" ? v.niche : v.dims[dim];
    const key = raw === null || raw === undefined ? "(unknown)" : dim === "postingHour" ? `${String(raw).padStart(2, "0")}:00` : String(raw);
    groups.set(key, [...(groups.get(key) ?? []), v]);
  }
  return [...groups.entries()]
    .map(([value, vs]) => {
      const vals = nums(vs.map((v) => (metric === "views7d" ? v.views7d : v.views)));
      const eng = vs
        .filter((v) => v.views && v.views > 0)
        .map((v) => ((v.likes ?? 0) + (v.comments ?? 0)) / v.views!);
      return {
        value,
        videos: vs.length,
        withMetric: vals.length,
        medianMetric: median(vals),
        avgViewPercentage: mean(nums(vs.map((v) => v.averageViewPercentage))),
        engagementRate: mean(eng),
        enough: vals.length >= MIN_GROUP_SIZE,
      };
    })
    .sort((a, b) => a.value.localeCompare(b.value, undefined, { numeric: true }));
}

/* ---------------------------------- outliers -------------------------------- */

export interface Outlier {
  id: string;
  title: string | null;
  channelSlug: string;
  value: number;
  channelP90: number;
  channelMedian: number;
  dims: VideoFacts["dims"];
  youtubeUrl: string | null;
}

/** The top 10% of each channel's videos (top ceil(n/10), ties included); channels with enough data only. */
export function outliers(videos: VideoFacts[], metric: Metric): Outlier[] {
  const out: Outlier[] = [];
  const byChannel = new Map<string, VideoFacts[]>();
  for (const v of videos) byChannel.set(v.channelSlug, [...(byChannel.get(v.channelSlug) ?? []), v]);
  for (const [slug, vs] of byChannel) {
    const withVal = vs.map((v) => ({ v, val: metric === "views7d" ? v.views7d : v.views })).filter((x): x is { v: VideoFacts; val: number } => x.val !== null);
    if (withVal.length < MIN_VIDEOS_FOR_OUTLIERS) continue;
    const vals = withVal.map((x) => x.val);
    const desc = [...vals].sort((a, b) => b - a);
    const p90 = desc[Math.max(1, Math.ceil(vals.length * 0.1)) - 1]!;
    const med = median(vals)!;
    for (const x of withVal) {
      if (x.val >= p90 && x.val > med) {
        out.push({ id: x.v.id, title: x.v.title, channelSlug: slug, value: x.val, channelP90: p90, channelMedian: med, dims: x.v.dims, youtubeUrl: x.v.youtubeUrl });
      }
    }
  }
  return out.sort((a, b) => b.value / Math.max(1, b.channelMedian) - a.value / Math.max(1, a.channelMedian));
}

/* ----------------------------------- costs ---------------------------------- */

export function costRows(
  channels: { id: string; slug: string; name: string }[],
  spendByChannel: Map<string, number>,
  videosMadeByChannel: Map<string, number>,
  viewsByChannel: Map<string, number | null>,
) {
  return channels.map((c) => {
    const spend = spendByChannel.get(c.id) ?? 0;
    const made = videosMadeByChannel.get(c.id) ?? 0;
    const views = viewsByChannel.get(c.id) ?? null;
    return {
      slug: c.slug,
      name: c.name,
      spend: Math.round(spend * 100) / 100,
      videosMade: made,
      costPerVideo: made ? Math.round((spend / made) * 100) / 100 : null,
      costPer1kViews: views && views > 0 ? Math.round((spend / views) * 1000 * 100) / 100 : null,
    };
  });
}
