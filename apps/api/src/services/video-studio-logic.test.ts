import { describe, expect, it } from "vitest";
import {
  canTransitionVideoProject,
  DEFAULT_VIDEO_MODEL,
  estimateReelCostMicroUsd,
  isOverVideoBudget,
  reelBriefSchema,
  VIDEO_MODEL_IDS,
  VIDEO_PROJECT_BUSY_STATUSES,
} from "@catgpt/types";

describe("video project transitions", () => {
  it.each([
    ["draft", "scripting"],
    ["scripting", "scripted"],
    ["scripted", "scripting"], // regenerate the script
    ["scripted", "generating"],
    ["scripted", "editing"], // footage-only reels skip generation
    ["generating", "editing"],
    ["editing", "review"],
    ["review", "approved"],
    ["review", "editing"], // requested change
    ["failed", "scripting"], // retry
  ])("allows %s -> %s", (from, to) => {
    expect(canTransitionVideoProject(from, to as never)).toBe(true);
  });

  it.each([
    ["draft", "approved"], // can't skip the render and review
    ["editing", "approved"],
    ["approved", "draft"], // approved is terminal
    ["cancelled", "draft"],
    ["review", "generating"], // no going back into generation
    ["draft", "scripted"], // a script can only come from a scripting run
    ["scripting", "generating"], // the script must be reviewed first
    ["scripting", "editing"],
    ["unknown", "draft"],
  ])("rejects %s -> %s", (from, to) => {
    expect(canTransitionVideoProject(from, to as never)).toBe(false);
  });

  it("treats the in-flight stages as busy", () => {
    expect(VIDEO_PROJECT_BUSY_STATUSES).toEqual(["scripting", "generating", "editing"]);
  });
});

describe("reel cost estimate", () => {
  it("prices a 15s Veo 3.1 Lite reel at 720p as $0.75 in micro-dollars", () => {
    expect(estimateReelCostMicroUsd("veo-3.1-lite", "720p", 15)).toBe(750_000);
  });

  it("charges more at 1080p for the same model", () => {
    expect(estimateReelCostMicroUsd("veo-3.1-lite", "1080p", 15)).toBe(1_200_000);
  });

  it("keeps Veo 3.1 Lite as the default and the cheapest model", () => {
    expect(DEFAULT_VIDEO_MODEL).toBe("veo-3.1-lite");
    const costs = VIDEO_MODEL_IDS.map((id) => estimateReelCostMicroUsd(id, "720p", 15));
    expect(Math.min(...costs)).toBe(estimateReelCostMicroUsd("veo-3.1-lite", "720p", 15));
  });

  it("throws for an unknown model", () => {
    expect(() => estimateReelCostMicroUsd("nope" as never, "720p", 15)).toThrow(/unknown video model/);
  });
});

describe("monthly video budget", () => {
  it("never blocks when no cap is set", () => {
    expect(isOverVideoBudget(999_000_000, 999_000_000, undefined)).toBe(false);
  });

  it("allows spending up to the cap", () => {
    // $10 cap, $9.25 spent, a $0.75 reel brings it to exactly the cap.
    expect(isOverVideoBudget(9_250_000, 750_000, 10)).toBe(false);
  });

  it("blocks the reel that would pass the cap", () => {
    expect(isOverVideoBudget(9_250_000, 750_001, 10)).toBe(true);
  });
});

describe("reel brief schema", () => {
  it("fills in the defaults: 15s, 9:16, 720p, Veo 3.1 Lite, no voice", () => {
    const brief = reelBriefSchema.parse({ goal: "Launch week teaser" });
    expect(brief).toEqual({
      goal: "Launch week teaser",
      durationSec: 15,
      aspectRatio: "9:16",
      resolution: "720p",
      videoModel: "veo-3.1-lite",
      voiceProvider: "none",
    });
  });

  it.each([4, 61, 15.5])("rejects a duration of %s seconds", (durationSec) => {
    expect(reelBriefSchema.safeParse({ goal: "Teaser", durationSec }).success).toBe(false);
  });

  it("rejects a model outside the catalog", () => {
    expect(reelBriefSchema.safeParse({ goal: "Teaser", videoModel: "sora" }).success).toBe(false);
  });
});
