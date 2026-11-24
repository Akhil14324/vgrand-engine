import { describe, expect, it } from "vitest";
import {
  insightsText,
  interactionsPer100Views,
  isPermissionError,
  readBreakdown,
  readMetrics,
  toPercent,
  toReel,
} from "./ig-insights-logic.js";

describe("reading Meta insights responses", () => {
  it("reads total_value and values[0] shapes", () => {
    const m = readMetrics({
      data: [
        { name: "views", period: "day", total_value: { value: 1632 } },
        { name: "reach", values: [{ value: 982 }] },
        { name: "bad", total_value: {} },
        null,
      ],
    });
    expect(m).toEqual({ views: 1632, reach: 982 });
    expect(readMetrics(null)).toEqual({});
  });

  it("reads breakdown rows sorted by value", () => {
    const rows = readBreakdown({
      data: [
        {
          name: "reach",
          total_value: {
            value: 100,
            breakdowns: [
              {
                dimension_keys: ["follow_type"],
                results: [
                  { dimension_values: ["FOLLOWER"], value: 30 },
                  { dimension_values: ["NON_FOLLOWER"], value: 70 },
                ],
              },
            ],
          },
        },
      ],
    });
    expect(rows).toEqual([
      { label: "NON_FOLLOWER", value: 70 },
      { label: "FOLLOWER", value: 30 },
    ]);
  });

  it("turns skip rate into a percentage whether it is a ratio or already a percent", () => {
    expect(toPercent(0.352)).toBe(35.2);
    expect(toPercent(41)).toBe(41);
    expect(toPercent(null)).toBeNull();
  });
});

describe("a reel's numbers", () => {
  it("converts watch time from milliseconds and keeps missing metrics null", () => {
    const r = toReel({ id: "1", caption: "hello", permalink: "https://x" }, { views: 500, reach: 300, saved: 12, ig_reels_avg_watch_time: 4250 });
    expect(r.views).toBe(500);
    expect(r.saves).toBe(12);
    expect(r.avgWatchSec).toBe(4.3);
    expect(r.likes).toBeNull();
    expect(r.skipRatePct).toBeNull();
  });

  it("works out interactions per 100 views", () => {
    expect(interactionsPer100Views({ views: 200, interactions: 20, likes: null, comments: null, shares: null, saves: null })).toBe(10);
    expect(interactionsPer100Views({ views: 100, interactions: null, likes: 5, comments: 1, shares: 2, saves: 2 })).toBe(10);
    expect(interactionsPer100Views({ views: 0, interactions: 5, likes: null, comments: null, shares: null, saves: null })).toBeNull();
  });
});

describe("permission errors", () => {
  it("recognises a missing insights permission", () => {
    expect(isPermissionError("(#10) Application does not have permission for this action", 10)).toBe(true);
    expect(isPermissionError("(#200) Requires instagram_manage_insights permission", 200)).toBe(true);
    expect(isPermissionError("Some metric is not supported", 100)).toBe(false);
  });
});

describe("insights text for the strategy prompt", () => {
  it("lists the account and each reel, using n/a for missing numbers", () => {
    const text = insightsText({
      days: 30,
      handle: "vgrandinfra",
      account: {
        handle: "vgrandinfra",
        followers: 940,
        views: 1632,
        reach: 982,
        interactions: null,
        likes: 10,
        comments: 2,
        shares: null,
        saves: 4,
        reachFollowers: 200,
        reachNonFollowers: 782,
      },
      demographics: { gender: [{ label: "M", value: 60 }], age: [], city: [{ label: "Ongole", value: 40 }] },
      reels: [toReel({ id: "r1", caption: "Villa tour", timestamp: "2026-11-01T00:00:00+0000" }, { views: 900, reach: 500 })],
    });
    expect(text).toContain("views: 1632");
    expect(text).toContain("interactions: n/a");
    expect(text).toContain("reach from non-followers: 782");
    expect(text).toContain("Audience top cities: Ongole 40");
    expect(text).toContain("Reel r1");
    expect(text).toContain("avg watch n/a");
  });
});
