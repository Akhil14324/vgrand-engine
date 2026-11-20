import { describe, expect, it } from "vitest";
import {
  channelOverview,
  costRows,
  formatAnalysis,
  median,
  outliers,
  percentile,
  weekOf,
  weeklyTrend,
  type VideoFacts,
} from "./analytics-logic.js";
import { parseAnalyticsReport } from "./analytics.js";

let n = 0;
const vid = (channel: string, views: number | null, extra: Partial<VideoFacts> = {}): VideoFacts => ({
  id: `v${n++}`,
  title: `t${n}`,
  channelId: channel,
  channelSlug: channel,
  channelName: channel,
  niche: channel,
  path: "B",
  postedAt: new Date("2026-11-18T10:00:00Z"),
  dims: { hookType: "question", lengthBucket: "25-34s", postingHour: 9, path: "B", voice: "v1", synthetic: false },
  views,
  views7d: views,
  likes: views === null ? null : Math.round(views / 10),
  comments: views === null ? null : Math.round(views / 100),
  shares: null,
  subscribersGained: 1,
  averageViewPercentage: 60,
  averageViewDuration: 20,
  manualViewedPct: null,
  youtubeUrl: null,
  ...extra,
});
const many = (channel: string, count: number, f: (i: number) => number) => Array.from({ length: count }, (_, i) => vid(channel, f(i)));
const CH = (slug: string) => ({ id: slug, slug, name: slug, niche: slug, path: "B" });

describe("stats helpers", () => {
  it("median and nearest-rank percentile", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeNull();
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90)).toBe(9);
  });
  it("weeks start on Monday", () => {
    expect(weekOf(new Date("2026-11-22T12:00:00Z"))).toBe("2026-11-16"); // Sunday
    expect(weekOf(new Date("2026-11-16T00:00:00Z"))).toBe("2026-11-16");
  });
});

describe("overview", () => {
  it("labels channels under 30 posted videos 'too early' and never ranks them", () => {
    const videos = [...many("cats", 30, (i) => 1000 + i), ...many("dogs", 31, (i) => 2000 + i), ...many("food", 29, () => 99999)];
    const rows = channelOverview([CH("cats"), CH("dogs"), CH("food")], videos, "views7d");
    const by = Object.fromEntries(rows.map((r) => [r.slug, r]));
    expect(by.food!.confidence).toBe("too_early");
    expect(by.food!.rank).toBeNull();
    expect(by.dogs!.rank).toBe(1);
    expect(by.cats!.rank).toBe(2);
    expect(by.cats!.videosPosted).toBe(30);
    expect(by.cats!.medianViews).toBe(1014.5);
    expect(by.cats!.subscribersGained).toBe(30);
  });
  it("7-day metric ignores videos without a 7-day snapshot; missing data stays null", () => {
    const rows = channelOverview([CH("a"), CH("b")], [vid("a", 500, { views7d: null }), vid("a", 100)], "views7d");
    expect(rows[0]!.medianViews7d).toBe(100);
    expect(rows[0]!.videosWith7d).toBe(1);
    expect(rows[1]!.totalViews).toBeNull();
    expect(rows[1]!.medianViews).toBeNull();
  });
});

describe("formats, trend, outliers, costs", () => {
  it("groups by tag and marks small groups as not comparable", () => {
    const videos = [...many("a", 12, () => 100), vid("a", 5000, { dims: { hookType: "pov" } })];
    const g = formatAnalysis(videos, "hookType", "views7d");
    expect(g.map((x) => [x.value, x.videos, x.enough])).toEqual([
      ["pov", 1, false],
      ["question", 12, true],
    ]);
    expect(g[1]!.engagementRate).toBeCloseTo(0.11);
    expect(formatAnalysis([vid("a", 1, { dims: { postingHour: 8 } })], "postingHour", "views")[0]!.value).toBe("08:00");
  });
  it("weekly trend per channel by posting week", () => {
    const t = weeklyTrend([vid("a", 10), vid("a", 30), vid("a", 50, { postedAt: new Date("2026-11-25T00:00:00Z") })], "views");
    expect(t[0]!.points).toEqual([
      { week: "2026-11-16", median: 20, n: 2 },
      { week: "2026-11-23", median: 50, n: 1 },
    ]);
  });
  it("outliers: top 10% of a channel with enough videos, with their tags", () => {
    const videos = many("a", 20, (i) => (i === 19 ? 10_000 : i === 18 ? 9_000 : 100 + i));
    const o = outliers(videos, "views7d");
    expect(o.map((x) => x.value)).toEqual([10_000, 9_000]);
    expect(o[0]!.dims.hookType).toBe("question");
    expect(outliers(many("b", 5, (i) => i * 100), "views7d")).toEqual([]);
  });
  it("cost per video and per 1,000 views", () => {
    const r = costRows([{ id: "c", slug: "fails", name: "Fails" }], new Map([["c", 12]]), new Map([["c", 4]]), new Map([["c", 6000]]));
    expect(r[0]).toMatchObject({ spend: 12, videosMade: 4, costPerVideo: 3, costPer1kViews: 2 });
    expect(costRows([{ id: "d", slug: "x", name: "x" }], new Map(), new Map(), new Map())[0]).toMatchObject({ spend: 0, costPerVideo: null, costPer1kViews: null });
  });
});

describe("YouTube Analytics report parsing", () => {
  it("maps rows by video id using column headers", () => {
    const m = parseAnalyticsReport({
      columnHeaders: [{ name: "video" }, { name: "views" }, { name: "averageViewPercentage" }, { name: "subscribersGained" }],
      rows: [["abc", 120, 71.5, 3]],
    });
    expect(m.get("abc")).toEqual({ views: 120, averageViewPercentage: 71.5, subscribersGained: 3 });
  });
});
