import { Prisma, prisma } from "@catgpt/db";
import { generateText } from "./anthropic.js";
import {
  channelOverview,
  costRows,
  FORMAT_DIMENSIONS,
  formatAnalysis,
  MIN_GROUP_SIZE,
  MIN_VIDEOS_TO_RANK,
  outliers,
  perVideo,
  weeklyTrend,
  type Metric,
  type VideoFacts,
} from "./analytics-logic.js";
import { enqueueJob, registerJobHandler } from "./jobs.js";
import { log, recordEvent } from "./log.js";
import { monthSpend, pathCBudgetStatus } from "./pathc.js";
import { accessToken, google, ManualFallback } from "./youtube.js";
import { chunk } from "./youtube-logic.js";

const POSTED = ["posted", "manual_posted"];

/* ------------------------------ facts per video ------------------------------ */

/** One row per posted (non-dry-run) video with its latest public and analytics numbers. */
export async function loadVideoFacts(userId: string): Promise<VideoFacts[]> {
  const vids = await prisma.shortsVideo.findMany({
    where: { userId, status: { in: POSTED }, source: { not: "dry_run" }, postedAt: { not: null } },
    include: { channel: { select: { slug: true, displayName: true, niche: true } }, snapshots: { orderBy: { capturedAt: "desc" } } },
  });
  return vids.map((v) => {
    const pub = v.snapshots.find((s) => s.source === "public");
    const ana = v.snapshots.find((s) => s.source === "analytics");
    const seven = v.snapshots.find((s) => s.source === "public" && s.checkpoint === "7d");
    return {
      id: v.id,
      title: v.title,
      channelId: v.channelId,
      channelSlug: v.channel.slug,
      channelName: v.channel.displayName,
      niche: v.channel.niche,
      path: v.path,
      postedAt: v.postedAt!,
      dims: (v.dims ?? {}) as VideoFacts["dims"],
      // Public counts are near real time; analytics lags 1-3 days, so public wins when both exist.
      views: pub?.views ?? ana?.views ?? null,
      views7d: seven?.views ?? null,
      likes: pub?.likes ?? ana?.likes ?? null,
      comments: pub?.comments ?? ana?.comments ?? null,
      shares: ana?.shares ?? null,
      subscribersGained: ana?.subscribersGained ?? null,
      averageViewPercentage: ana?.averageViewPercentage ?? null,
      averageViewDuration: ana?.averageViewDuration ?? null,
      manualViewedPct: v.manualViewedPct,
      youtubeUrl: v.youtubeUrl,
    };
  });
}

export async function buildDashboard(userId: string, metric: Metric) {
  const [channels, facts] = await Promise.all([
    prisma.shortsChannel.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
    loadVideoFacts(userId),
  ]);
  const ch = channels.map((c) => ({ id: c.id, slug: c.slug, name: c.displayName, niche: c.niche, path: c.path }));
  const overview = channelOverview(ch, facts, metric);

  // Costs: real (non-dry-run) spend per channel this month and all time.
  const [spendRows, madeRows, budget] = await Promise.all([
    prisma.shortsCost.groupBy({ by: ["channelId"], where: { status: "spent", provider: { not: "offline_clipgen" }, channelId: { in: ch.map((c) => c.id) } }, _sum: { cost: true } }),
    prisma.shortsVideo.groupBy({ by: ["channelId"], where: { userId, source: { not: "dry_run" }, filePath: { not: null } }, _count: { _all: true } }),
    pathCBudgetStatus(userId),
  ]);
  const costs = costRows(
    ch,
    new Map(spendRows.map((r) => [r.channelId, r._sum.cost ?? 0])),
    new Map(madeRows.map((r) => [r.channelId, r._count._all])),
    new Map(overview.map((r) => [r.channelId, r.totalViews])),
  );

  return {
    metric,
    thresholds: { minVideosToRank: MIN_VIDEOS_TO_RANK, minGroupSize: MIN_GROUP_SIZE },
    totals: {
      videosPosted: facts.length,
      totalViews: facts.reduce((a, v) => a + (v.views ?? 0), 0),
      channelsRanked: overview.filter((r) => r.rank !== null).length,
    },
    overview,
    niche: { perVideo: perVideo(overview), trend: weeklyTrend(facts, metric) },
    formats: Object.fromEntries(FORMAT_DIMENSIONS.map((d) => [d, formatAnalysis(facts, d, metric)])),
    outliers: outliers(facts, metric).slice(0, 50),
    costs: { rows: costs, budget, monthSpend: await monthSpend() },
  };
}
export type ShortsDashboard = Awaited<ReturnType<typeof buildDashboard>>;

/* --------------------------- YouTube Analytics (OAuth) ------------------------ */

const ANALYTICS_METRICS = [
  "views",
  "engagedViews",
  "estimatedMinutesWatched",
  "averageViewDuration",
  "averageViewPercentage",
  "likes",
  "comments",
  "shares",
  "subscribersGained",
] as const;

/** Parses a YouTube Analytics report with dimension `video` into per-video metric maps. */
export function parseAnalyticsReport(json: unknown): Map<string, Record<string, number>> {
  const j = json as { columnHeaders?: { name: string }[]; rows?: (string | number)[][] };
  const headers = (j.columnHeaders ?? []).map((h) => h.name);
  const out = new Map<string, Record<string, number>>();
  for (const row of j.rows ?? []) {
    const rec: Record<string, number> = {};
    let id = "";
    headers.forEach((h, i) => {
      if (h === "video") id = String(row[i]);
      else rec[h] = Number(row[i]);
    });
    if (id) out.set(id, rec);
  }
  return out;
}

/** Per-channel private stats for its posted videos (lifetime to date). */
export async function syncChannelAnalytics(channelId: string): Promise<number> {
  const channel = await prisma.shortsChannel.findUniqueOrThrow({ where: { id: channelId } });
  const vids = await prisma.shortsVideo.findMany({
    where: { channelId, status: { in: POSTED }, youtubeVideoId: { not: null }, source: { not: "dry_run" } },
    select: { id: true, youtubeVideoId: true, postedAt: true },
  });
  if (!vids.length) return 0;
  let token: string;
  try {
    token = await accessToken(channel);
  } catch (err) {
    if (err instanceof ManualFallback) return 0; // not connected: public stats only
    throw err;
  }
  const start = new Date(Math.min(...vids.map((v) => (v.postedAt ?? new Date()).getTime())) - 86_400_000).toISOString().slice(0, 10);
  const end = new Date().toISOString().slice(0, 10);
  let stored = 0;
  for (const part of chunk(vids, 200)) {
    const u = new URL(google.analytics);
    u.searchParams.set("ids", "channel==MINE");
    u.searchParams.set("startDate", start);
    u.searchParams.set("endDate", end);
    u.searchParams.set("metrics", ANALYTICS_METRICS.join(","));
    u.searchParams.set("dimensions", "video");
    u.searchParams.set("filters", `video==${part.map((v) => v.youtubeVideoId).join(",")}`);
    u.searchParams.set("sort", "-views");
    u.searchParams.set("maxResults", "200");
    const res = await fetch(u, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`YouTube Analytics failed (${res.status}): ${body.slice(0, 300)}`);
    }
    const map = parseAnalyticsReport(await res.json());
    for (const v of part) {
      const m = map.get(v.youtubeVideoId!);
      if (!m) continue; // no data yet: store nothing rather than zeros
      await prisma.shortsMetricSnapshot.create({
        data: {
          videoId: v.id,
          source: "analytics",
          checkpoint: "daily",
          views: m.views ?? null,
          engagedViews: m.engagedViews ?? null,
          likes: m.likes ?? null,
          comments: m.comments ?? null,
          shares: m.shares ?? null,
          estimatedMinutesWatched: m.estimatedMinutesWatched ?? null,
          averageViewDuration: m.averageViewDuration ?? null,
          averageViewPercentage: m.averageViewPercentage ?? null,
          subscribersGained: m.subscribersGained ?? null,
          raw: m as Prisma.InputJsonValue,
        },
      });
      stored++;
    }
  }
  log.info("sync.analytics", { channelId, videos: vids.length, stored });
  return stored;
}

/* -------------------------------- weekly report ------------------------------- */

const REPORT_SYSTEM = [
  "You analyse a YouTube Shorts experiment: 10 channels, each a niche, run to learn which formats work.",
  "Write a concise weekly report in Markdown with sections: Summary, Winners, Losers, Suggested format changes, Data caveats.",
  "Use ONLY numbers present in the JSON. Never estimate or invent a number. If a value is null, say there is no data.",
  "Channels marked confidence=too_early (fewer than 30 posted videos) must not be ranked or called winners/losers; mention them only as 'too early'.",
  "Tag groups with enough=false have too few videos: do not draw conclusions from them.",
  "Views are not revenue or subscribers; don't conflate them. Suggestions must be concrete format changes (hook type, length, posting hour, path) tied to the data.",
].join("\n");

export async function generateWeeklyReport(userId: string, weekOf: string, force = false): Promise<{ id: string; created: boolean }> {
  const weekStart = new Date(`${weekOf}T00:00:00Z`);
  const existing = await prisma.shortsReport.findUnique({ where: { userId_weekStart: { userId, weekStart } } });
  if (existing && !force) return { id: existing.id, created: false };
  if (existing) await prisma.shortsReport.delete({ where: { id: existing.id } });
  const dash = await buildDashboard(userId, "views7d");
  const latest = await buildDashboard(userId, "views");
  const data = {
    weekOf,
    totals: latest.totals,
    channels: latest.overview.map((r) => ({ ...r, medianViews7d: dash.overview.find((d) => d.slug === r.slug)?.medianViews7d ?? null })),
    formats7d: dash.formats,
    outliers7d: dash.outliers.slice(0, 15).map((o) => ({ title: o.title, channel: o.channelSlug, views7d: o.value, channelMedian: o.channelMedian, dims: o.dims })),
    costs: latest.costs.rows,
    budget: latest.costs.budget,
  };
  let content: string;
  let prompt: unknown = null;
  if (data.totals.videosPosted === 0) {
    content = "## Summary\n\nNo videos have been posted yet, so there is nothing to compare this week.";
  } else {
    const call = await generateText({ system: REPORT_SYSTEM, user: `Data (JSON):\n${JSON.stringify(data)}`, maxTokens: 6000 });
    content = call.text.trim();
    prompt = { request: call.request, response: call.response };
  }
  const row = await prisma.shortsReport.create({
    data: { userId, weekStart, content, data: data as unknown as Prisma.InputJsonValue, prompt: (prompt ?? undefined) as Prisma.InputJsonValue | undefined },
  });
  await recordEvent({ type: "report.created", message: `Weekly report for ${weekOf}` });
  return { id: row.id, created: true };
}

export async function requestReportNow(userId: string): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  await enqueueJob({ type: "weekly_report", key: `report:${userId}:manual:${Date.now()}`, payload: { userId, weekOf: today, force: true }, maxAttempts: 2 });
}

export function registerAnalyticsHandlers(): void {
  registerJobHandler("channel_analytics", async (j) => {
    await syncChannelAnalytics(j.channelId!);
  });
  registerJobHandler("weekly_report", async (j) => {
    const p = j.payload as { userId: string; weekOf: string; force?: boolean };
    await generateWeeklyReport(p.userId, p.weekOf, p.force ?? false);
  });
}
