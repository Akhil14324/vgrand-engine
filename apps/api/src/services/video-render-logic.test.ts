import { describe, expect, it } from "vitest";
import type { ReelScript } from "@catgpt/types";
import { buildRenderArgs, planFootageSegments, RENDER_SIZES } from "./video-render-logic.js";

const script = (shots: ReelScript["shots"]): ReelScript => ({
  title: "Teaser",
  hook: "Hook",
  cta: "Visit",
  shots,
});

const footage = (id: string, startSec: number, endSec: number, sourceFile: string | null = "a.mp4") => ({
  id,
  startSec,
  endSec,
  kind: "footage" as const,
  description: "Shot",
  voiceover: null,
  onScreenText: null,
  sourceFile,
});

const sources = [
  { fileName: "a.mp4", kind: "video" as const, durationSec: 10 },
  { fileName: "b.mp4", kind: "video" as const, durationSec: 4 },
  { fileName: "photo.png", kind: "image" as const, durationSec: null },
];

describe("planFootageSegments", () => {
  it("cuts shots in order and continues the same file where the last shot stopped", () => {
    const plan = planFootageSegments(
      script([footage("1", 0, 3), footage("2", 3, 7)]),
      sources,
    );
    expect(plan).toEqual({
      ok: true,
      segments: [
        { shotId: "1", fileName: "a.mp4", kind: "video", sourceStartSec: 0, lengthSec: 3 },
        { shotId: "2", fileName: "a.mp4", kind: "video", sourceStartSec: 3, lengthSec: 4 },
      ],
    });
  });

  it("starts the file again from the top when it runs out", () => {
    const plan = planFootageSegments(
      script([footage("1", 0, 8), footage("2", 8, 12)]),
      sources,
    );
    expect(plan.ok && plan.segments[1]!.sourceStartSec).toBe(0);
  });

  it("holds a still image for its full shot length", () => {
    const plan = planFootageSegments(script([footage("1", 0, 5, "photo.png")]), sources);
    expect(plan.ok && plan.segments[0]).toMatchObject({ kind: "image", sourceStartSec: 0, lengthSec: 5 });
  });

  it("refuses a clip that is shorter than its shot", () => {
    const plan = planFootageSegments(script([footage("1", 0, 6, "b.mp4")]), sources);
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.problems[0]).toMatch(/only 4\.0s long/);
  });

  it("refuses a file that isn't in the folder", () => {
    const plan = planFootageSegments(script([footage("1", 0, 3, "missing.mp4")]), sources);
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.problems[0]).toMatch(/not in the folder/);
  });

  it("refuses generated and motion graphic shots until those phases exist", () => {
    const plan = planFootageSegments(
      script([
        footage("1", 0, 3),
        { ...footage("2", 3, 7), kind: "generate", sourceFile: null },
        { ...footage("3", 7, 10), kind: "motion_graphic", sourceFile: null },
      ]),
      sources,
    );
    expect(plan.ok).toBe(false);
    if (!plan.ok) {
      expect(plan.problems).toHaveLength(2);
      expect(plan.problems[0]).toMatch(/Shot 2 is a generate shot/);
    }
  });

  it("refuses a footage shot with no source file", () => {
    const plan = planFootageSegments(script([footage("1", 0, 3, null)]), sources);
    expect(plan.ok).toBe(false);
  });
});

describe("buildRenderArgs", () => {
  const inputs = [
    { shotId: "1", fileName: "a.mp4", kind: "video" as const, sourceStartSec: 0, lengthSec: 3, path: "/tmp/src-0", hasAudio: true },
    { shotId: "2", fileName: "photo.png", kind: "image" as const, sourceStartSec: 0, lengthSec: 2, path: "/tmp/src-1", hasAudio: false },
  ];

  it("uses the requested frame size for 9:16 at 1080p", () => {
    expect(RENDER_SIZES["9:16"]!["1080p"]).toEqual({ w: 1080, h: 1920 });
    const args = buildRenderArgs(inputs, { w: 1080, h: 1920 }, "/tmp/out.mp4").join(" ");
    expect(args).toMatch(/scale=1080:1920:force_original_aspect_ratio=increase/);
  });

  it("gives each shot its own input and joins them with concat", () => {
    const args = buildRenderArgs(inputs, { w: 720, h: 1280 }, "/tmp/out.mp4");
    expect(args.filter((a) => a === "-i")).toHaveLength(2);
    const graph = args[args.indexOf("-filter_complex") + 1]!;
    expect(graph).toMatch(/\[v0\]\[a0\]\[v1\]\[a1\]concat=n=2:v=1:a=1\[vc\]\[ac\]/);
    expect(graph).toMatch(/loudnorm=I=-16/);
  });

  it("replaces missing audio with silence and loops still images", () => {
    const args = buildRenderArgs(inputs, { w: 720, h: 1280 }, "/tmp/out.mp4");
    const graph = args[args.indexOf("-filter_complex") + 1]!;
    expect(graph).toMatch(/anullsrc=channel_layout=stereo:sample_rate=44100:duration=2\.000\[a1\]/);
    expect(args.join(" ")).toMatch(/-loop 1/);
  });
});
