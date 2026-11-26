import { describe, expect, it } from "vitest";
import {
  createReelSchema,
  estimateReelCost,
  fitSceneDurations,
  plannedReelCostInput,
  reelPipelineSteps,
  reelSettingsSchema,
  reelStepProgress,
  sceneCountFor,
} from "@catgpt/types";
import {
  importantWordFlags,
  whooshTimes,
  approxWordTimings,
  assColor,
  buildFinalArgs,
  buildReelAss,
  buildReelScriptPrompt,
  buildSegmentArgs,
  buildTimeline,
  builtinForMood,
  forbiddenHits,
  normalizeDecisions,
  normalizeScript,
  pickMusicTrack,
  pickStockImage,
  pickStockVideo,
  visualKey,
  visualPlan,
} from "./reel-logic.js";
import type { StockCandidate } from "./stock-logic.js";

let n = 0;
const id = () => `s${++n}`;

const rawScript = (scenes: number) => ({
  title: "Five facts about honey",
  hook: "Honey never spoils.",
  cta: "Follow for more",
  caption: "Did you know?",
  hashtags: ["#honey", "facts", "bee keeping"],
  scenes: Array.from({ length: scenes }, (_, i) => ({
    narration: `Scene ${i} narration about honey and bees.`,
    onScreenText: `Fact ${i}`,
    visualQuery: "honey jar close up",
    visualPrompt: "A jar of golden honey on a wooden table, morning light",
    visualType: i === 1 ? "product" : i === 2 ? "ai_image" : "stock_video",
    productIndex: i === 1 ? 0 : -1,
    durationSec: 4 + i,
  })),
});

describe("scene durations", () => {
  it("fits durations to the exact target and keeps bounds", () => {
    for (const target of [15, 30, 45, 60]) {
      const out = fitSceneDurations([3, 9, 2, 20, 4, 1], target);
      expect(out.reduce((a, b) => a + b, 0)).toBeCloseTo(target, 5);
      for (const d of out) {
        expect(d).toBeGreaterThanOrEqual(1.5);
        expect(d).toBeLessThanOrEqual(15);
      }
    }
  });
  it("scene count grows with length", () => {
    expect(sceneCountFor(15)).toBeLessThan(sceneCountFor(60));
  });
});

describe("normalizeScript", () => {
  it("maps product and AI scenes, strips # from hashtags, fits durations", () => {
    const r = normalizeScript(rawScript(5), 30, ["https://x.test/p0.jpg"], id);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.script.scenes[1]!.visual.source).toBe("brand_image");
    expect(r.script.scenes[1]!.visual.assetUrl).toBe("https://x.test/p0.jpg");
    expect(r.script.scenes[2]!.visual.source).toBe("ai_image");
    expect(r.script.scenes[0]!.visual.source).toBe("auto");
    expect(r.script.hashtags).toEqual(["honey", "facts", "beekeeping"]);
    expect(r.script.scenes.reduce((a, s) => a + s.durationSec, 0)).toBeCloseTo(30, 5);
    expect(new Set(r.script.scenes.map((s) => s.id)).size).toBe(5);
  });
  it("a product index that doesn't exist falls back to auto", () => {
    const r = normalizeScript(rawScript(3), 15, [], id);
    expect(r.ok && r.script.scenes[1]!.visual.source).toBe("auto");
  });
  it("reports problems instead of accepting a broken reply", () => {
    expect(normalizeScript({ title: "x", scenes: [] }, 30, [], id).ok).toBe(false);
    expect(normalizeScript("nope", 30, [], id).ok).toBe(false);
    const empty = rawScript(3);
    empty.scenes[0]!.narration = "";
    empty.scenes[0]!.onScreenText = "";
    const r = normalizeScript(empty, 30, [], id);
    expect(r.ok).toBe(false);
  });
});

describe("prompts", () => {
  it("brand prompt carries offer rules, products and forbidden words", () => {
    const p = buildReelScriptPrompt({
      mode: "brand",
      reelType: "offer",
      topic: "Diwali sale",
      durationSec: 30,
      language: "hi",
      brand: {
        name: "Chai Co",
        category: "Tea",
        summary: "Masala chai from Assam",
        offer: "20% off all blends until 5 Nov",
        colors: ["#AA3300"],
        requiredPhrases: [],
        forbiddenWords: ["cheap"],
        forbiddenClaims: [],
        products: [{ index: 0, label: "Masala blend 250g" }],
        featuredProduct: 0,
      },
    });
    expect(p.user).toContain("20% off all blends until 5 Nov");
    expect(p.user).toContain("0: Masala blend 250g");
    expect(p.user).toContain("cheap");
    expect(p.system).toContain("Hindi");
    expect(p.user).toContain("Feature product 0");
  });
  it("general prompt uses the topic and never invents a brand", () => {
    const p = buildReelScriptPrompt({ mode: "general", reelType: null, topic: "Morning motivation", durationSec: 15, language: "en", brand: null });
    expect(p.user).toContain("Morning motivation");
    expect(p.user).not.toContain("Brand:");
  });
  it("forbidden words are caught as whole words", () => {
    const r = normalizeScript(rawScript(3), 15, [], id);
    if (!r.ok) throw new Error("bad fixture");
    r.script.scenes[0]!.narration = "So cheap and good";
    expect(forbiddenHits(r.script, ["cheap"], [])).toHaveLength(1);
    expect(forbiddenHits(r.script, ["chea"], [])).toHaveLength(0);
  });
});

describe("visual planning", () => {
  const base = { source: "auto" as const, query: "q", prompt: "p", assetUrl: null, uploadFile: null, exclude: [] };
  const allOn = { stockVideo: true, stockImage: true, aiImage: true, aiVideo: true, hasProducts: true };
  const s = reelSettingsSchema.parse({});
  it("auto prefers stock footage, ends with the graphic card", () => {
    const plan = visualPlan(base, s, allOn, "general");
    expect(plan[0]).toBe("stock_video");
    expect(plan[plan.length - 1]).toBe("graphic");
    expect(plan).not.toContain("ai_video");
  });
  it("respects AI switches and missing keys", () => {
    const noAi = visualPlan(base, { ...s, allowAiImages: false }, allOn, "general");
    expect(noAi).not.toContain("ai_image");
    const nothing = visualPlan(base, s, { stockVideo: false, stockImage: false, aiImage: false, aiVideo: false, hasProducts: false }, "general");
    expect(nothing).toEqual(["graphic"]);
    const prefer = visualPlan(base, { ...s, preferAi: true, allowAiVideo: true }, allOn, "general");
    expect(prefer.slice(0, 2)).toEqual(["ai_video", "ai_image"]);
  });
  it("explicit choice first, brand products before the graphic for brand reels", () => {
    const plan = visualPlan({ ...base, source: "stock_image" }, s, allOn, "brand");
    expect(plan[0]).toBe("stock_image");
    expect(plan.indexOf("brand_image")).toBeLessThan(plan.indexOf("graphic"));
  });
  it("visual key changes with the choice", () => {
    expect(visualKey(base)).toBe(visualKey({ ...base }));
    expect(visualKey(base)).not.toBe(visualKey({ ...base, exclude: ["pexels:1"] }));
  });
});

describe("stock picking", () => {
  const vid = (id: string, w: number, h: number, d: number): StockCandidate => ({
    provider: "pexels", id, pageUrl: "", downloadUrl: "", width: w, height: h, durationSec: d, author: null, authorUrl: null, license: "", licenseUrl: "",
  });
  it("prefers vertical clips and skips excluded ones", () => {
    const c = [vid("1", 1920, 1080, 20), vid("2", 1080, 1920, 20), vid("3", 1080, 1920, 20)];
    expect(pickStockVideo(c, 5, new Set())!.id).toBe("2");
    expect(pickStockVideo(c, 5, new Set(["pexels:2"]))!.id).toBe("3");
    expect(pickStockVideo([vid("4", 640, 360, 10)], 5, new Set())).toBeNull();
  });
  it("skips small stock images", () => {
    const img = (id: string, w: number, h: number) => ({ provider: "pexels" as const, id, pageUrl: "", downloadUrl: "", width: w, height: h, author: null, license: "", licenseUrl: "" });
    expect(pickStockImage([img("a", 400, 600), img("b", 1200, 1800)], new Set())!.id).toBe("b");
  });
});

describe("timeline and subtitles", () => {
  it("overlaps segments by the transition", () => {
    const t = buildTimeline([4, 5, 3], 0.5);
    expect(t.starts).toEqual([0, 3.5, 8]);
    expect(t.total).toBe(11);
    expect(buildTimeline([4], 0.5).transitionSec).toBe(0);
    expect(buildTimeline([1.5, 5], 2).transitionSec).toBeCloseTo(0.6, 5);
  });
  it("approximate word timings stay inside the clip and in order", () => {
    const w = approxWordTimings("one two three, four five.", 3);
    expect(w).toHaveLength(5);
    expect(w[0]!.start).toBeGreaterThanOrEqual(0);
    expect(w[4]!.end).toBeLessThanOrEqual(3);
    for (let i = 1; i < w.length; i++) expect(w[i]!.start).toBeGreaterThanOrEqual(w[i - 1]!.start);
  });
  it("ASS colours are BGR and presets change the output", () => {
    expect(assColor("#FF8800")).toBe("&H000088FF&");
    const words = approxWordTimings("hello there my friend how are you", 3);
    const style = { preset: "bold" as const, position: "bottom" as const, size: 1, textColor: "#FFFFFF", highlightColor: "#FFD400", font: "Noto Sans" };
    const bold = buildReelAss(words, style, { w: 1080, h: 1920 });
    const clean = buildReelAss(words, { ...style, preset: "clean", position: "top" }, { w: 1080, h: 1920 });
    expect(bold.events).toBe(words.length);
    expect(bold.ass).toContain("HELLO");
    expect(clean.events).toBeLessThan(bold.events);
    expect(clean.ass).toMatch(/Style: Sub,Noto Sans,\d+,.*,3,\d+,0,8,/);
  });
});

describe("ffmpeg args", () => {
  it("segment args crop/fit, animate and add the headline overlay", () => {
    const a = buildSegmentArgs({ kind: "image", file: "a.jpg", lengthSec: 4, fit: true, overlay: "h.png", motion: 2, zoom: 0.1, size: { w: 1080, h: 1920 }, out: "seg.mp4" });
    const fc = a[a.indexOf("-filter_complex") + 1]!;
    expect(fc).toContain("boxblur");
    expect(fc).toContain("zoompan");
    expect(fc).toContain("overlay=x=0");
    expect(a).toContain("-an");
  });
  it("final args chain xfades at the timeline offsets and duck music under voice", () => {
    const timeline = buildTimeline([3, 4, 5], 0.4);
    const a = buildFinalArgs({
      segments: ["s0.mp4", "s1.mp4", "s2.mp4"],
      timeline,
      transition: "fade",
      voices: [{ file: "v0.mp3", atSec: 0.15 }, { file: "v1.mp3", atSec: 2.9 }],
      voiceVolume: 1,
      musicFile: "m.mp3",
      musicVolume: 0.3,
      logo: { file: "logo.png", x: "W-w-40", y: "40", widthPx: 160, fromSec: 0, toSec: 11.2 },
      assFile: "captions.ass",
      fontsDir: "fonts",
      size: { w: 1080, h: 1920 },
      out: "out.mp4",
    });
    const fc = a[a.indexOf("-filter_complex") + 1]!;
    expect(fc).toContain("xfade=transition=fade:duration=0.400:offset=2.600");
    expect(fc).toContain("offset=6.200");
    expect(fc).toContain("sidechaincompress");
    expect(fc).toContain("adelay=2900|2900");
    expect(a[a.indexOf("-t") + 1]).toBe(timeline.total.toFixed(3));
  });
  it("cut template concatenates; silence when no audio at all", () => {
    const a = buildFinalArgs({
      segments: ["s0.mp4", "s1.mp4"], timeline: buildTimeline([3, 3], 0), transition: "cut", voices: [], voiceVolume: 1, musicFile: null, musicVolume: 0,
      logo: null, assFile: null, fontsDir: "fonts", size: { w: 720, h: 1280 }, out: "o.mp4",
    });
    const fc = a[a.indexOf("-filter_complex") + 1]!;
    expect(fc).toContain("concat=n=2");
    expect(a).toContain("anullsrc=r=48000:cl=stereo");
  });
});

describe("request schema", () => {
  it("brand reels need a brand, general reels need a topic", () => {
    expect(createReelSchema.safeParse({ mode: "brand", topic: "" }).success).toBe(false);
    expect(createReelSchema.safeParse({ mode: "general", topic: "" }).success).toBe(false);
    expect(createReelSchema.safeParse({ mode: "general", topic: "space facts", durationSec: 45, language: "ta" }).success).toBe(true);
    expect(createReelSchema.safeParse({ mode: "general", topic: "x y", durationSec: 20 }).success).toBe(false);
  });
});

describe("reel studio additions", () => {
  it("flags numbers, headline words and caps as important, at most a third", () => {
    const words = "Get 20% off our fresh MANGO juice this summer".split(" ");
    const f = importantWordFlags(words, "Fresh mango juice");
    expect(f[1]).toBe(true); // 20%
    expect(f[0]).toBe(false); // "Get"
    expect(f.filter(Boolean).length).toBeLessThanOrEqual(Math.floor(words.length / 3));
    expect(importantWordFlags([], "x")).toEqual([]);
  });

  it("emphasised words get the highlight colour in the ASS", () => {
    const words = [
      { word: "only", start: 0, end: 0.4 },
      { word: "₹99", start: 0.4, end: 0.9, em: true },
    ];
    const { ass } = buildReelAss(words, { preset: "clean", position: "bottom", size: 1, textColor: "#FFFFFF", highlightColor: "#FF0000", font: "Noto Sans" }, { w: 1080, h: 1920 });
    expect(ass).toContain("\\fscx112");
    expect(ass).toContain("&H000000FF&");
  });

  it("places whooshes at each transition and mixes sfx into the audio", () => {
    const timeline = buildTimeline([2, 3, 2], 0.4);
    const at = whooshTimes(timeline);
    expect(at).toHaveLength(2);
    expect(at[0]).toBeCloseTo(timeline.starts[1]! + 0.2 - 0.35, 3);
    const a = buildFinalArgs({
      segments: ["a.mp4", "b.mp4", "c.mp4"],
      timeline,
      transition: "fade",
      voices: [{ file: "v.mp3", atSec: 0.2 }],
      voiceVolume: 1,
      musicFile: null,
      musicVolume: 0.2,
      logo: null,
      assFile: null,
      fontsDir: "fonts",
      size: { w: 1080, h: 1920 },
      out: "o.mp4",
      sfx: { whoosh: "w.wav", hit: "h.wav", whooshAt: at, hitAt: [0], volume: 0.5 },
    });
    const graph = a[a.indexOf("-filter_complex") + 1]!;
    expect(a).toContain("w.wav");
    expect(a).toContain("h.wav");
    expect(graph).toContain("asplit=2");
    expect(graph).toMatch(/amix=inputs=4:normalize=0:duration=first,alimiter/);
  });

  it("without sfx the mix ends in a single limiter", () => {
    const a = buildFinalArgs({
      segments: ["a.mp4"],
      timeline: buildTimeline([2], 0),
      transition: "cut",
      voices: [],
      voiceVolume: 1,
      musicFile: "m.mp3",
      musicVolume: 0.2,
      logo: null,
      assFile: null,
      fontsDir: "fonts",
      size: { w: 1080, h: 1920 },
      out: "o.mp4",
    });
    expect(a[a.indexOf("-filter_complex") + 1]).toContain("[amain]alimiter=limit=0.95[aout]");
  });
});

describe("pipeline steps and cost estimate", () => {
  const settings = reelSettingsSchema.parse({});
  const features = { stockVideo: true, stockImage: true, aiImage: true, aiVideo: false, elevenlabs: false, openai: true };

  it("AI images are a range when stock is tried first, certain when preferred", () => {
    const scenes = plannedReelCostInput(30, "en");
    const e = estimateReelCost({ scenes, settings, features, includeScript: true, aiVideoPerSecUsd: null });
    const ai = e.lines.find((l) => l.label === "AI images")!;
    expect(ai.minUsd).toBe(0);
    expect(ai.maxUsd).toBeGreaterThan(0);
    expect(e.maxUsd).toBeGreaterThanOrEqual(e.minUsd);
    const pref = estimateReelCost({ scenes, settings: { ...settings, preferAi: true }, features, includeScript: false, aiVideoPerSecUsd: null });
    expect(pref.lines.find((l) => l.label === "AI images")!.minUsd).toBeGreaterThan(0);
  });

  it("cached scenes cost nothing", () => {
    const scenes = plannedReelCostInput(15, "en").map((s) => ({ ...s, cachedVisual: true, cachedVoice: true }));
    expect(estimateReelCost({ scenes, settings, features, includeScript: false, aiVideoPerSecUsd: null }).maxUsd).toBe(0);
  });

  it("derives step states from progress bands", () => {
    const base = { stage: "Editing scene 2/6", settings, script: { title: "t", hook: "", cta: "", caption: "", hashtags: [], scenes: [] } };
    const mid = reelPipelineSteps({ ...base, status: "rendering", progress: reelStepProgress("editing", 1, 2) });
    expect(mid.find((s) => s.key === "voice")!.state).toBe("done");
    expect(mid.find((s) => s.key === "editing")!.state).toBe("active");
    expect(mid.find((s) => s.key === "render")!.state).toBe("pending");
    const done = reelPipelineSteps({ ...base, status: "completed", progress: 100 });
    expect(done.find((s) => s.key === "ai")!.state).toBe("skipped");
    const failed = reelPipelineSteps({ ...base, status: "failed", progress: 50 });
    expect(failed.find((s) => s.key === "ai")!.state).toBe("failed");
  });
});

describe("autonomous decisions", () => {
  it("reads valid decisions and nulls invalid ones", () => {
    const d = normalizeDecisions({ reelType: "offer", style: "cinematic", musicMood: "warm", voiceGender: "male", voiceTone: "  calm and confident " });
    expect(d).toEqual({ reelType: "offer", style: "cinematic", musicMood: "warm", voiceGender: "male", voiceTone: "calm and confident" });
    const bad = normalizeDecisions({ reelType: "none", style: "wobbly", musicMood: 3, voiceGender: "robot", voiceTone: "" });
    expect(bad).toEqual({ reelType: null, style: null, musicMood: null, voiceGender: null, voiceTone: null });
    expect(normalizeDecisions(null).style).toBeNull();
  });
  it("normalizeScript returns the decisions with the script", () => {
    const r = normalizeScript({ ...rawScript(4), style: "bold", musicMood: "energetic" }, 30, [], id);
    expect(r.ok && r.decisions.style).toBe("bold");
    expect(r.ok && r.decisions.musicMood).toBe("energetic");
  });
  it("brand prompt asks the AI to choose a reel type when none is set", () => {
    const brand = { name: "B", category: null, summary: "", colors: [], requiredPhrases: [], forbiddenWords: [], forbiddenClaims: [], products: [], featuredProduct: null };
    const p = buildReelScriptPrompt({ mode: "brand", reelType: null, topic: "", durationSec: 30, language: "en", brand });
    expect(p.user).toContain("choose the one that best fits");
    const fixed = buildReelScriptPrompt({ mode: "brand", reelType: "offer", topic: "", durationSec: 30, language: "en", brand });
    expect(fixed.user).toContain("return reelType 'offer'");
  });
  it("music follows the mood: matching names first, built-in bed otherwise", () => {
    const tracks = [
      { key: "lib:a.mp3", label: "Sunny upbeat pop" },
      { key: "lib:b.mp3", label: "Calm piano" },
      { key: "lib:c.mp3", label: "Track 3" },
    ];
    expect(pickMusicTrack(tracks, "calm", "x")).toBe("lib:b.mp3");
    expect(pickMusicTrack(tracks, "upbeat", "y")).toBe("lib:a.mp3");
    expect(tracks.map((t) => t.key)).toContain(pickMusicTrack(tracks, null, "z"));
    expect(pickMusicTrack([], "calm", "x")).toBeNull();
    expect(builtinForMood("calm", null)).toBe("calm-pad");
    expect(builtinForMood("energetic", null)).toBe("upbeat-pulse");
    expect(builtinForMood(null, "festival")).toBe("warm-lofi");
  });
  it("create request: style and voice default to auto", () => {
    const b = createReelSchema.parse({ mode: "general", topic: "Space facts", autoRender: true });
    expect(b.style).toBe("auto");
    expect(b.voice).toBe("auto");
  });
});

describe("generation progress steps", () => {
  const settings = reelSettingsSchema.parse({});
  const script = { title: "T", hook: "", cta: "", caption: "", hashtags: [], scenes: [] };
  it("one-click job: script steps run inside the job before the render steps", () => {
    const writing = reelPipelineSteps({ status: "rendering", progress: Math.round(reelStepProgress("script", 0.5, 1)), stage: "Writing", settings, script: null });
    expect(writing.find((s) => s.key === "understand")!.state).toBe("done");
    expect(writing.find((s) => s.key === "script")!.state).toBe("active");
    expect(writing.find((s) => s.key === "voice")!.state).toBe("pending");
  });
  it("re-render of an edited script shows the script steps as done", () => {
    const steps = reelPipelineSteps({ status: "queued", progress: 0, stage: null, settings, script });
    expect(steps.filter((s) => ["understand", "script", "plan"].includes(s.key)).every((s) => s.state === "done")).toBe(true);
  });
  it("a failure while writing the script marks that step failed", () => {
    const steps = reelPipelineSteps({ status: "failed", progress: 5, stage: null, settings, script: null });
    expect(steps.find((s) => s.key === "script")!.state).toBe("failed");
  });
});
