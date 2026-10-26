import { describe, expect, it } from "vitest";
import type { ReelScript } from "@catgpt/types";
import { buildRenderArgs, planFootageSegments, RENDER_SIZES, type RenderInput } from "./video-render-logic.js";

const script = (shots: ReelScript["shots"]): ReelScript => ({
  title: "Teaser",
  hook: "Hook",
  cta: "Visit",
  shots,
});

const footage = (id: string, startSec: number, endSec: number, sourceFile: string | null = "a.mp4", onScreenText: string | null = null) => ({
  id,
  startSec,
  endSec,
  kind: "footage" as const,
  description: "Shot",
  voiceover: null,
  onScreenText,
  sourceFile,
});

const sources = [
  { fileName: "a.mp4", kind: "video" as const, durationSec: 10 },
  { fileName: "b.mp4", kind: "video" as const, durationSec: 4 },
  { fileName: "photo.png", kind: "image" as const, durationSec: null },
];

describe("planFootageSegments", () => {
  it("cuts shots in order and continues the same file where the last shot stopped", () => {
    const plan = planFootageSegments(script([footage("1", 0, 3), footage("2", 3, 7)]), sources);
    expect(plan).toEqual({
      ok: true,
      segments: [
        { shotId: "1", fileName: "a.mp4", kind: "video", sourceStartSec: 0, lengthSec: 3, caption: null, motionText: null, prompt: null },
        { shotId: "2", fileName: "a.mp4", kind: "video", sourceStartSec: 3, lengthSec: 4, caption: null, motionText: null, prompt: null },
      ],
    });
  });

  it("starts the file again from the top when it runs out", () => {
    const plan = planFootageSegments(script([footage("1", 0, 8), footage("2", 8, 12)]), sources);
    expect(plan.ok && plan.segments[1]!.sourceStartSec).toBe(0);
  });

  it("holds a still image for its full shot length", () => {
    const plan = planFootageSegments(script([footage("1", 0, 5, "photo.png")]), sources);
    expect(plan.ok && plan.segments[0]).toMatchObject({ kind: "image", sourceStartSec: 0, lengthSec: 5 });
  });

  it("carries the on-screen text as a caption", () => {
    const plan = planFootageSegments(script([footage("1", 0, 3, "a.mp4", "Fresh daily")]), sources);
    expect(plan.ok && plan.segments[0]!.caption).toBe("Fresh daily");
  });

  it("plans a motion-graphic shot with its text and no source file", () => {
    const plan = planFootageSegments(
      script([footage("1", 0, 3), { ...footage("2", 3, 6, null), kind: "motion_graphic", onScreenText: "Visit us today" }]),
      sources,
    );
    expect(plan.ok && plan.segments[1]).toEqual({
      shotId: "2",
      fileName: null,
      kind: "motion",
      sourceStartSec: 0,
      lengthSec: 3,
      caption: null,
      motionText: "Visit us today",
      prompt: null,
    });
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

  it("plans a generated shot with its prompt and no source file", () => {
    const plan = planFootageSegments(
      script([footage("1", 0, 3), { ...footage("2", 3, 7, null), kind: "generate", description: "Steam over a loaf" }]),
      sources,
    );
    expect(plan.ok && plan.segments[1]).toEqual({
      shotId: "2",
      fileName: null,
      kind: "generated",
      sourceStartSec: 0,
      lengthSec: 4,
      caption: null,
      motionText: null,
      prompt: "Steam over a loaf",
    });
  });

  it("refuses a footage shot with no source file", () => {
    const plan = planFootageSegments(script([footage("1", 0, 3, null)]), sources);
    expect(plan.ok).toBe(false);
  });
});

describe("buildRenderArgs", () => {
  const inputs: RenderInput[] = [
    { shotId: "1", kind: "video", sourceStartSec: 0, lengthSec: 3, path: "/tmp/src-0", hasAudio: true },
    { shotId: "2", kind: "image", sourceStartSec: 0, lengthSec: 2, path: "/tmp/src-1", hasAudio: false },
  ];

  it("uses the requested frame size", () => {
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

  it("overlays a caption clip on its segment before joining", () => {
    const captioned: RenderInput[] = [{ ...inputs[0]!, captionPath: "/tmp/cap-1.webm" }];
    const args = buildRenderArgs(captioned, { w: 720, h: 1280 }, "/tmp/out.mp4");
    expect(args.filter((a) => a === "-i")).toHaveLength(2);
    expect(args).toContain("libvpx-vp9");
    const graph = args[args.indexOf("-filter_complex") + 1]!;
    expect(graph).toMatch(/\[v0\]\[1:v\]overlay=0:0:shortest=1,format=yuv420p\[v0c\]/);
    expect(graph).toMatch(/\[v0c\]\[a0\]concat=n=1/);
  });

  it("places each voice clip at its shot start and mixes it over the program audio", () => {
    const args = buildRenderArgs(inputs, { w: 720, h: 1280 }, "/tmp/out.mp4", [
      { path: "/tmp/vo-1.mp3", startSec: 0, durationSec: 2 },
      { path: "/tmp/vo-2.mp3", startSec: 3, durationSec: 1.5 },
    ]);
    expect(args.filter((a) => a === "-i")).toHaveLength(4);
    const graph = args[args.indexOf("-filter_complex") + 1]!;
    expect(graph).toMatch(/\[2:a\]adelay=0\|0,/);
    expect(graph).toMatch(/\[3:a\]adelay=3000\|3000,/);
    expect(graph).toMatch(/\[ac\]volume=0\.3\[bg\]/);
    expect(graph).toMatch(/\[bg\]\[vo0\]\[vo1\]amix=inputs=3:duration=first:normalize=0/);
  });

  it("keeps voice inputs after caption inputs", () => {
    const captioned: RenderInput[] = [{ ...inputs[0]!, captionPath: "/tmp/cap-1.webm" }];
    const args = buildRenderArgs(captioned, { w: 720, h: 1280 }, "/tmp/out.mp4", [
      { path: "/tmp/vo-1.mp3", startSec: 0, durationSec: 2 },
    ]);
    const graph = args[args.indexOf("-filter_complex") + 1]!;
    // inputs: 0 = footage, 1 = caption, 2 = voice
    expect(graph).toMatch(/\[2:a\]adelay=0\|0,/);
  });
});
