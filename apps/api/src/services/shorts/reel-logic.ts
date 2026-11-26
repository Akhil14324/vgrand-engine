import { createHash } from "node:crypto";
import {
  fitSceneDurations,
  REEL_MUSIC_MOODS,
  REEL_TEMPLATE_KEYS,
  REEL_TEMPLATES,
  REEL_TYPES,
  REEL_TYPE_LABELS,
  type ReelMusicMood,
  reelLanguage,
  reelStudioScriptSchema,
  sceneCountFor,
  wordsPerSecond,
  type ReelMode,
  type ReelSettings,
  type ReelStudioScript,
  type ReelTemplate,
  type ReelType,
  type ReelVisual,
} from "@catgpt/types";
import { assEscape, groupWords, type WordTiming } from "./captions-logic.js";
import { isUsable, keyOf, score, type StockCandidate } from "./stock-logic.js";

/**
 * Pure Reel Studio logic (no I/O): script prompts and normalisation, scene
 * timeline, subtitle styling (ASS), and the ffmpeg arguments for each scene
 * segment and the final mix. Kept pure so it is unit-tested.
 */

/* ---------------------------------- script --------------------------------- */

export interface ReelBrandContext {
  name: string;
  category: string | null;
  summary: string;
  tagline?: string;
  tone?: string;
  offer?: string;
  defaultCta?: string;
  customers?: string;
  differentiator?: string;
  visualStyle?: string;
  colors: string[];
  requiredPhrases: string[];
  forbiddenWords: string[];
  forbiddenClaims: string[];
  /** Product photos by index, with the label the owner gave them. */
  products: { index: number; label: string }[];
  /** Index of the product the owner picked to feature, if any. */
  featuredProduct: number | null;
}

export interface ReelPromptInput {
  mode: ReelMode;
  reelType: ReelType | null;
  topic: string;
  durationSec: number;
  language: string;
  brand: ReelBrandContext | null;
  instructions?: string;
  /** Problems with the previous attempt, so the model can fix them. */
  problems?: string[];
}

/** JSON schema the model must follow (structured output). */
export const REEL_SCRIPT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "hook", "cta", "caption", "hashtags", "reelType", "style", "musicMood", "voiceGender", "voiceTone", "scenes"],
  properties: {
    title: { type: "string" },
    // Production decisions the generator applies when the owner left them on "auto".
    reelType: { type: "string", enum: [...REEL_TYPES, "none"] },
    style: { type: "string", enum: [...REEL_TEMPLATE_KEYS] },
    musicMood: { type: "string", enum: [...REEL_MUSIC_MOODS] },
    voiceGender: { type: "string", enum: ["female", "male"] },
    voiceTone: { type: "string" },
    hook: { type: "string" },
    cta: { type: "string" },
    caption: { type: "string" },
    hashtags: { type: "array", items: { type: "string" } },
    scenes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["narration", "onScreenText", "visualQuery", "visualPrompt", "visualType", "productIndex", "durationSec"],
        properties: {
          narration: { type: "string" },
          onScreenText: { type: "string" },
          visualQuery: { type: "string" },
          visualPrompt: { type: "string" },
          visualType: { type: "string", enum: ["product", "stock_video", "stock_image", "ai_image"] },
          productIndex: { type: "integer" },
          durationSec: { type: "number" },
        },
      },
    },
  },
} as const;

export const REEL_SCENE_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["scene"],
  properties: { scene: REEL_SCRIPT_JSON_SCHEMA.properties.scenes.items },
} as const;

const list = (xs: string[]) => (xs.length ? xs.join(", ") : "none");

function brandBlock(b: ReelBrandContext): string {
  const lines = [
    `Brand: ${b.name}${b.category ? ` (${b.category})` : ""}`,
    b.summary ? `About the brand:\n${b.summary}` : null,
    b.tagline ? `Tagline: ${b.tagline}` : null,
    b.tone ? `Brand voice / tone: ${b.tone}` : null,
    b.customers ? `Customers: ${b.customers}` : null,
    b.differentiator ? `What makes it different: ${b.differentiator}` : null,
    b.offer ? `Current offer (use exactly as written, never change numbers): ${b.offer}` : "Current offer: none on file. Do not invent any discount, price or deadline.",
    b.defaultCta ? `Preferred call to action: ${b.defaultCta}` : null,
    b.visualStyle ? `Visual style: ${b.visualStyle}` : null,
    b.colors.length ? `Brand colours: ${b.colors.join(", ")}` : null,
    b.requiredPhrases.length ? `Phrases to include somewhere: ${b.requiredPhrases.join("; ")}` : null,
    `Forbidden words: ${list(b.forbiddenWords)}`,
    `Forbidden claims: ${list(b.forbiddenClaims)}`,
    b.products.length
      ? `Product photos available (use visualType "product" with this productIndex to show the real product):\n${b.products.map((p) => `  ${p.index}: ${p.label}`).join("\n")}`
      : "No product photos on file: never use visualType \"product\".",
    b.featuredProduct !== null ? `Feature product ${b.featuredProduct} in this reel.` : null,
  ];
  return lines.filter(Boolean).join("\n");
}

export function buildReelScriptPrompt(input: ReelPromptInput): { system: string; user: string } {
  const lang = reelLanguage(input.language);
  const scenes = sceneCountFor(input.durationSec);
  const words = Math.round(input.durationSec * wordsPerSecond(input.language) * 0.9);
  const system = [
    "You are a senior short-form video producer who writes viral Instagram Reels and YouTube Shorts.",
    "You return one JSON object only, following the given schema.",
    "Structure: scene 1 is the hook (stops the scroll in under 2 seconds), the middle scenes deliver value or the story, the last scene is a strong call to action.",
    `Write narration, onScreenText, hook, cta and caption in ${lang.speech}. visualQuery and visualPrompt are ALWAYS in English.`,
    "narration: what the voiceover says in that scene, natural spoken language, no emojis, no hashtags, no stage directions.",
    "onScreenText: a punchy 2 to 6 word headline for the scene (can be empty for a pure footage moment).",
    "visualQuery: 2 to 5 concrete English words to search stock footage that literally shows the scene (subjects, action, setting). Never abstract words.",
    "visualPrompt: one detailed English sentence describing a vertical photo for this scene (subject, setting, lighting, mood, composition). No text in the image.",
    "visualType: 'product' to show one of the brand's real product photos, 'stock_video' for real-world footage, 'stock_image' for a photo, 'ai_image' for anything stock can't show (concepts, impossible scenes, stylised art).",
    "productIndex: the product photo index for visualType 'product', otherwise -1.",
    "durationSec: how long the scene stays on screen; it must fit its narration at a natural pace.",
    "Never invent prices, discounts, statistics, awards, testimonials, medical or financial claims. Facts must come from the brief or be common knowledge.",
    "caption: an engaging post caption (2 to 4 short lines) that ends with the call to action. hashtags: 5 to 12 relevant hashtags without the # sign.",
    "You also make the production decisions, like a professional editor would:",
    `- style: the edit style that suits the content. ${REEL_TEMPLATE_KEYS.map((k) => `'${k}' = ${REEL_TEMPLATES[k].label}`).join("; ")}. Energetic tips/ads suit dynamic or bold, emotional stories and luxury brands suit cinematic or smooth, calm/educational suits smooth or minimal.`,
    "- musicMood: the background music mood: calm, upbeat, warm, energetic or emotional.",
    "- voiceGender and voiceTone: the narrator that fits the audience and topic; voiceTone is 3 to 8 words describing the delivery (e.g. 'confident, upbeat and friendly').",
    "- reelType: for brand reels the reel type that best fits the brief, otherwise 'none'.",
  ].join("\n");

  const parts: string[] = [];
  if (input.mode === "brand" && input.brand) {
    const t = input.reelType ? REEL_TYPE_LABELS[input.reelType] : null;
    parts.push(brandBlock(input.brand));
    if (t) parts.push(`Reel type: ${t.label}. ${t.brief} (return reelType '${input.reelType}')`);
    else {
      parts.push(
        `Reel type: choose the one that best fits the direction and return it as reelType:\n${REEL_TYPES.map((k) => `  ${k}: ${REEL_TYPE_LABELS[k].label}. ${REEL_TYPE_LABELS[k].brief}`).join("\n")}`,
      );
    }
    if (input.topic.trim()) parts.push(`Direction from the brand owner: ${input.topic.trim()}`);
    parts.push("Keep the brand's identity, tone and colours throughout. Mention the brand name at least once and in the call to action.");
  } else {
    parts.push(`Topic: ${input.topic.trim()}`);
    parts.push("Understand the topic, pick the most engaging angle (surprising facts, story, tips, or motivation as fits), and make it valuable and accurate.");
  }
  parts.push(
    `Length: ${input.durationSec} seconds in ${scenes} scenes (you may use ${Math.max(3, scenes - 1)} to ${scenes + 1}). Scene durations must add up to ${input.durationSec}.`,
    `Total narration: about ${words} words in ${lang.speech}.`,
  );
  if (input.instructions?.trim()) parts.push(`Extra instructions: ${input.instructions.trim()}`);
  if (input.problems?.length) parts.push(`Your previous answer had problems. Fix them:\n${input.problems.map((p) => `- ${p}`).join("\n")}`);
  parts.push("Return the JSON now.");
  return { system, user: parts.join("\n\n") };
}

export function buildScenePrompt(input: ReelPromptInput & { script: ReelStudioScript; sceneIndex: number }): { system: string; user: string } {
  const base = buildReelScriptPrompt(input);
  const s = input.script;
  const outline = s.scenes
    .map((sc, i) => `${i + 1}. ${i === input.sceneIndex ? "[REWRITE THIS ONE] " : ""}(${sc.durationSec}s) "${sc.narration}" | on screen: "${sc.onScreenText}"`)
    .join("\n");
  return {
    system: `${base.system}\nNow you rewrite exactly one scene of an existing reel. Return {"scene": {...}} with the same fields as a scene.`,
    user: [
      base.user.replace(/\n\nReturn the JSON now\.$/, ""),
      `Current reel "${s.title}"\nHook: ${s.hook}\nCTA: ${s.cta}\nScenes:\n${outline}`,
      `Rewrite scene ${input.sceneIndex + 1} so it is fresher and stronger while fitting between its neighbours. Keep about ${input.script.scenes[input.sceneIndex]!.durationSec} seconds.`,
      "Return the JSON now.",
    ].join("\n\n"),
  };
}

interface RawScene {
  narration?: unknown;
  onScreenText?: unknown;
  visualQuery?: unknown;
  visualPrompt?: unknown;
  visualType?: unknown;
  productIndex?: unknown;
  durationSec?: unknown;
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Turns one raw model scene into a scene of our schema. */
export function normalizeScene(raw: RawScene, id: string, durationSec: number, productUrls: string[]): ReelStudioScript["scenes"][number] {
  const type = str(raw.visualType, 20);
  const idx = typeof raw.productIndex === "number" ? Math.trunc(raw.productIndex) : -1;
  const productUrl = type === "product" ? (productUrls[idx] ?? null) : null;
  const visual: ReelVisual = {
    // The model's own judgement: real product photo, or an AI image for what stock can't show.
    // Anything else starts on "auto"; the renderer falls back when a source is unavailable.
    source: productUrl ? "brand_image" : type === "ai_image" ? "ai_image" : "auto",
    query: str(raw.visualQuery, 120),
    prompt: str(raw.visualPrompt, 800),
    assetUrl: productUrl,
    uploadFile: null,
    exclude: [],
  };
  return {
    id,
    narration: str(raw.narration, 600),
    onScreenText: str(raw.onScreenText, 90),
    durationSec,
    visual,
    captionText: null,
    captionOffsetSec: 0,
  };
}

/** Production choices the model made alongside the script. Null = it gave nothing usable. */
export interface ReelDecisions {
  reelType: ReelType | null;
  style: ReelTemplate | null;
  musicMood: ReelMusicMood | null;
  voiceGender: "female" | "male" | null;
  voiceTone: string | null;
}

const oneOf = <T extends string>(v: unknown, xs: readonly T[]): T | null => (typeof v === "string" && (xs as readonly string[]).includes(v) ? (v as T) : null);

/** Reads the decision fields from the model's reply; anything missing or invalid is null (the caller keeps its default). */
export function normalizeDecisions(raw: unknown): ReelDecisions {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const tone = str(r.voiceTone, 200);
  return {
    reelType: oneOf(r.reelType, REEL_TYPES),
    style: oneOf(r.style, REEL_TEMPLATE_KEYS),
    musicMood: oneOf(r.musicMood, REEL_MUSIC_MOODS),
    voiceGender: oneOf(r.voiceGender, ["female", "male"] as const),
    voiceTone: tone || null,
  };
}

/** Built-in synthesised bed for a mood (used when there is no library or uploaded music). */
export function builtinForMood(mood: ReelMusicMood | null, reelType: string | null): BuiltinMusic {
  if (mood === "calm" || mood === "emotional") return "calm-pad";
  if (mood === "upbeat" || mood === "energetic") return "upbeat-pulse";
  if (mood === "warm") return "warm-lofi";
  if (reelType === "brand_awareness" || reelType === "festival") return "warm-lofi";
  if (reelType && reelType !== "engagement") return "upbeat-pulse";
  return "warm-lofi";
}

const MOOD_WORDS: Record<ReelMusicMood, string[]> = {
  calm: ["calm", "ambient", "chill", "relax", "soft", "piano", "peace"],
  upbeat: ["upbeat", "happy", "pop", "fun", "bright", "groove"],
  warm: ["warm", "lofi", "lo-fi", "acoustic", "cozy", "folk"],
  energetic: ["energetic", "energy", "edm", "hype", "rock", "drive", "beat", "power"],
  emotional: ["emotional", "cinematic", "epic", "inspir", "piano", "strings", "sad"],
};

/**
 * Picks a music track for "auto": among tracks whose name matches the mood,
 * else among all; the seed rotates between reels so they don't all share one track.
 */
export function pickMusicTrack(tracks: { key: string; label: string }[], mood: ReelMusicMood | null, seed: string): string | null {
  if (!tracks.length) return null;
  const words = mood ? MOOD_WORDS[mood] : [];
  const matching = words.length ? tracks.filter((t) => words.some((w) => t.label.toLowerCase().includes(w))) : [];
  const pool = matching.length ? matching : tracks;
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return pool[h % pool.length]!.key;
}

export type ScriptNormalizeResult = { ok: true; script: ReelStudioScript; decisions: ReelDecisions } | { ok: false; problems: string[] };

/** Validates and normalises the model's whole-script JSON. Durations are fitted to the target length. */
export function normalizeScript(raw: unknown, durationSec: number, productUrls: string[], newId: () => string): ScriptNormalizeResult {
  if (!raw || typeof raw !== "object") return { ok: false, problems: ["The reply was not a JSON object."] };
  const r = raw as { title?: unknown; hook?: unknown; cta?: unknown; caption?: unknown; hashtags?: unknown; scenes?: unknown };
  const problems: string[] = [];
  const scenesRaw = Array.isArray(r.scenes) ? (r.scenes as RawScene[]) : [];
  if (scenesRaw.length < 2) problems.push("A reel needs at least 2 scenes.");
  if (scenesRaw.length > 14) problems.push("Use at most 14 scenes.");
  const empty = scenesRaw.filter((s) => !str(s.narration, 600) && !str(s.onScreenText, 90)).length;
  if (empty > 0) problems.push(`${empty} scene(s) have neither narration nor on-screen text.`);
  const noQuery = scenesRaw.filter((s) => !str(s.visualQuery, 120) && !str(s.visualPrompt, 800)).length;
  if (noQuery > 0) problems.push(`${noQuery} scene(s) have no visualQuery/visualPrompt.`);
  if (!str(r.title, 120)) problems.push("Missing title.");
  if (problems.length) return { ok: false, problems };

  const fitted = fitSceneDurations(
    scenesRaw.slice(0, 14).map((s) => (typeof s.durationSec === "number" ? s.durationSec : NaN)),
    durationSec,
  );
  const script = {
    title: str(r.title, 120),
    hook: str(r.hook, 300),
    cta: str(r.cta, 160),
    caption: str(r.caption, 2200),
    hashtags: (Array.isArray(r.hashtags) ? r.hashtags : [])
      .map((h) => str(h, 60).replace(/^#+/, "").replace(/\s+/g, ""))
      .filter(Boolean)
      .slice(0, 30),
    scenes: scenesRaw.slice(0, 14).map((s, i) => normalizeScene(s, newId(), fitted[i]!, productUrls)),
  };
  const parsed = reelStudioScriptSchema.safeParse(script);
  if (!parsed.success) return { ok: false, problems: parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`) };
  return { ok: true, script: parsed.data, decisions: normalizeDecisions(raw) };
}

/** Brand words/claims that slipped into spoken or on-screen text. */
export function forbiddenHits(script: ReelStudioScript, words: string[], claims: string[]): string[] {
  const text = [script.title, script.hook, script.cta, script.caption, ...script.scenes.flatMap((s) => [s.narration, s.onScreenText])].join("\n").toLowerCase();
  const hits: string[] = [];
  for (const w of words) if (w.trim() && new RegExp(`\\b${w.trim().toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "u").test(text)) hits.push(`uses the forbidden word "${w}"`);
  for (const c of claims) if (c.trim() && text.includes(c.trim().toLowerCase())) hits.push(`makes the forbidden claim "${c}"`);
  return hits;
}

/* ------------------------------ visual identity ----------------------------- */

/** Cache key of a scene's visual choice: same inputs, same resolved file. */
export function visualKey(v: ReelVisual, extra = ""): string {
  return createHash("sha1")
    .update(JSON.stringify([v.source, v.query, v.prompt, v.assetUrl, v.uploadFile, [...v.exclude].sort(), extra]))
    .digest("hex")
    .slice(0, 16);
}

export type ConcreteSource = "brand_image" | "stock_video" | "stock_image" | "ai_image" | "ai_video" | "upload" | "graphic";

export interface SourceAvailability {
  stockVideo: boolean;
  stockImage: boolean;
  aiImage: boolean;
  aiVideo: boolean;
  hasProducts: boolean;
}

/** Sources to try, in order, for a scene. The brand graphic card is always the last resort. */
export function visualPlan(v: ReelVisual, settings: Pick<ReelSettings, "allowAiImages" | "allowAiVideo" | "preferAi">, avail: SourceAvailability, mode: ReelMode): ConcreteSource[] {
  const can = (s: ConcreteSource) =>
    s === "graphic" ||
    (s === "stock_video" && avail.stockVideo) ||
    (s === "stock_image" && avail.stockImage) ||
    (s === "ai_image" && avail.aiImage && settings.allowAiImages) ||
    (s === "ai_video" && avail.aiVideo && settings.allowAiVideo) ||
    (s === "brand_image" && !!v.assetUrl) ||
    (s === "upload" && !!v.uploadFile);
  let order: ConcreteSource[];
  if (v.source !== "auto") {
    // An explicit choice comes first; if it can't be made, fall back to auto so the reel still renders.
    order = [v.source, ...autoOrder(settings, mode, avail)];
  } else {
    order = autoOrder(settings, mode, avail);
  }
  if (mode === "brand" && avail.hasProducts) order.push("brand_image");
  order.push("graphic");
  return [...new Set(order)].filter((s) => s === "brand_image" ? avail.hasProducts || !!v.assetUrl : can(s));
}

function autoOrder(settings: Pick<ReelSettings, "allowAiVideo" | "preferAi">, _mode: ReelMode, _avail: SourceAvailability): ConcreteSource[] {
  const base: ConcreteSource[] = settings.preferAi ? ["ai_image", "stock_video", "stock_image"] : ["stock_video", "stock_image", "ai_image"];
  return settings.allowAiVideo ? ["ai_video", ...base] : base;
}

/** Best stock video for a scene: usable, not excluded, not already used in this reel. */
export function pickStockVideo(candidates: StockCandidate[], neededSec: number, exclude: Set<string>): StockCandidate | null {
  const ranked = candidates
    .filter((c) => isUsable(c) && !exclude.has(keyOf(c)))
    .map((c) => ({ c, s: score(c, neededSec) }))
    .sort((a, b) => b.s - a.s);
  return ranked[0]?.c ?? null;
}

export interface StockImageCandidate {
  provider: "pexels" | "pixabay";
  id: string;
  pageUrl: string;
  downloadUrl: string;
  width: number;
  height: number;
  author: string | null;
  license: string;
  licenseUrl: string;
}

/** Portrait first, then resolution; images under 900 px tall are skipped (they would look soft at 1920). */
export function pickStockImage(candidates: StockImageCandidate[], exclude: Set<string>): StockImageCandidate | null {
  const ranked = candidates
    .filter((c) => c.height >= 900 && !exclude.has(`${c.provider}:${c.id}`))
    .map((c) => ({ c, s: (c.height > c.width ? 50 : 0) + Math.min(c.height, 3000) / 100 }))
    .sort((a, b) => b.s - a.s);
  return ranked[0]?.c ?? null;
}

/* --------------------------------- timeline -------------------------------- */

export const REEL_FPS = 30;
export const VOICE_LEAD_SEC = 0.15;
export const VOICE_TAIL_SEC = 0.35;
export const INTRO_SEC = 1.6;
export const OUTRO_SEC = 2.6;

export function reelSize(resolution: "1080p" | "720p"): { w: number; h: number } {
  return resolution === "720p" ? { w: 720, h: 1280 } : { w: 1080, h: 1920 };
}

/** Scene length: the planned time, stretched so the voiceover always fits with a short tail. */
export function sceneLength(plannedSec: number, voiceSec: number | null): number {
  const need = voiceSec ? voiceSec + VOICE_LEAD_SEC + VOICE_TAIL_SEC : 0;
  return +Math.max(plannedSec, need, 1.5).toFixed(3);
}

export interface Timeline {
  /** Start of each segment on the final timeline. */
  starts: number[];
  total: number;
  transitionSec: number;
}

/**
 * Segment start times when consecutive segments overlap by the transition.
 * The transition can never be longer than 40% of the shortest segment.
 */
export function buildTimeline(lengths: number[], transitionSec: number): Timeline {
  const shortest = lengths.length ? Math.min(...lengths) : 0;
  const t = lengths.length > 1 ? Math.max(0, Math.min(transitionSec, shortest * 0.4)) : 0;
  const starts: number[] = [];
  let at = 0;
  lengths.forEach((len, i) => {
    starts.push(+at.toFixed(3));
    at += len - (i < lengths.length - 1 ? t : 0);
  });
  return { starts, total: +at.toFixed(3), transitionSec: +t.toFixed(3) };
}

/** Approximate word timings across a clip when the TTS gives none: proportional to word length. */
export function approxWordTimings(text: string, durationSec: number, leadSec = 0.05, tailSec = 0.15): WordTiming[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const span = Math.max(0.3, durationSec - leadSec - tailSec);
  const weights = words.map((w) => Math.max(2, [...w].length) + (/[.!?,;:]$/.test(w) ? 2 : 0));
  const total = weights.reduce((a, b) => a + b, 0);
  let at = leadSec;
  return words.map((w, i) => {
    const d = (weights[i]! / total) * span;
    const out = { word: w, start: +at.toFixed(3), end: +(at + d - 0.02).toFixed(3) };
    at += d;
    return out;
  });
}

/* --------------------------------- subtitles -------------------------------- */

/** #RRGGBB -> ASS &H00BBGGRR& (alpha in front). */
export function assColor(hex: string, alpha = 0): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex) ?? ["", "ff", "ff", "ff"];
  const a = alpha.toString(16).padStart(2, "0").toUpperCase();
  return `&H${a}${m[3]!.toUpperCase()}${m[2]!.toUpperCase()}${m[1]!.toUpperCase()}&`;
}

const assTime = (sec: number) => {
  const cs = Math.max(0, Math.round(sec * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`;
};

export interface SubtitleStyle {
  preset: ReelSettings["subtitles"]["preset"];
  position: ReelSettings["subtitles"]["position"];
  size: number;
  textColor: string;
  highlightColor: string;
  font: string;
}

interface AssPreset {
  fontSize: number;
  maxWords: number;
  maxChars: number;
  upper: boolean;
  /** ASS BorderStyle: 1 outline + shadow, 3 opaque box. */
  border: number;
  outline: number;
  shadow: number;
  highlight: "word" | "progressive" | "none";
  /** Outline drawn in the highlight colour and blurred (glow). */
  glow?: boolean;
}

const PRESETS: Record<SubtitleStyle["preset"], AssPreset> = {
  bold: { fontSize: 92, maxWords: 3, maxChars: 18, upper: true, border: 1, outline: 6, shadow: 2, highlight: "word" },
  karaoke: { fontSize: 80, maxWords: 5, maxChars: 28, upper: false, border: 1, outline: 5, shadow: 1, highlight: "progressive" },
  clean: { fontSize: 72, maxWords: 6, maxChars: 34, upper: false, border: 3, outline: 14, shadow: 0, highlight: "none" },
  minimal: { fontSize: 64, maxWords: 5, maxChars: 30, upper: false, border: 1, outline: 2, shadow: 1, highlight: "none" },
  boxed: { fontSize: 84, maxWords: 3, maxChars: 20, upper: true, border: 3, outline: 16, shadow: 0, highlight: "word" },
  neon: { fontSize: 86, maxWords: 4, maxChars: 22, upper: true, border: 1, outline: 5, shadow: 0, highlight: "word", glow: true },
};

const STOPWORDS = new Set(
  "the a an and or but of to in on at for with from by is are was were be been it its this that these those you your we our they their he she his her i me my as so if then than into out up down over just very can will not no yes do does did have has had what when where who why how all any more most some such only own same too also about".split(" "),
);

/**
 * Marks the words worth emphasising in subtitles: numbers and prices, words
 * from the scene headline, ALL-CAPS words and exclamations. Capped so that at
 * most about a third of the words are emphasised (otherwise nothing stands out).
 */
export function importantWordFlags(words: string[], headline = ""): boolean[] {
  const norm = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}%]+/gu, "");
  const head = new Set(headline.split(/\s+/).map(norm).filter((w) => w.length >= 4 && !STOPWORDS.has(w)));
  const scored = words.map((w, i) => {
    const n = norm(w);
    if (!n || STOPWORDS.has(n)) return { i, score: 0 };
    let score = 0;
    if (/\d/.test(n) || /[₹$€£%]/.test(w)) score += 3;
    if (head.has(n)) score += 2;
    if (n.length >= 2 && w.replace(/[^\p{L}]/gu, "") === w.replace(/[^\p{L}]/gu, "").toUpperCase() && /\p{Lu}/u.test(w)) score += 2;
    if (/!$/.test(w)) score += 1;
    return { i, score };
  });
  const cap = Math.max(1, Math.floor(words.length / 3));
  const pick = new Set(scored.filter((x) => x.score >= 2).sort((a, b) => b.score - a.score || a.i - b.i).slice(0, cap).map((x) => x.i));
  return words.map((_, i) => pick.has(i));
}

/**
 * ASS subtitles for the whole reel. `lines` are word timings already shifted to
 * the final timeline. One Dialogue per word for highlight presets, one per
 * group otherwise. Positioned clear of the Reels/Shorts UI.
 */
export function buildReelAss(words: (WordTiming & { em?: boolean })[], style: SubtitleStyle, size: { w: number; h: number }): { ass: string; events: number } {
  const p = PRESETS[style.preset];
  const scale = size.h / 1920;
  const fontSize = Math.round(p.fontSize * style.size * scale);
  const align = style.position === "top" ? 8 : style.position === "middle" ? 5 : 2;
  const marginV = Math.round((style.position === "top" ? 300 : style.position === "middle" ? 0 : 560) * scale);
  const primary = assColor(style.textColor);
  const hi = assColor(style.highlightColor);
  const back = style.preset === "clean" ? assColor("#000000", 0x60) : assColor("#000000", 0x80);
  const outlineCol =
    style.preset === "clean" ? assColor("#000000", 0x60) : style.preset === "boxed" ? assColor("#111111") : p.glow ? assColor(style.highlightColor, 0x40) : assColor("#000000");
  const header = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${size.w}`,
    `PlayResY: ${size.h}`,
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Sub,${style.font},${fontSize},${primary},${primary},${outlineCol},${back},1,0,0,0,100,100,0,0,${p.border},${Math.round(p.outline * scale)},${Math.round(p.shadow * scale)},${align},${Math.round(70 * scale)},${Math.round(70 * scale)},${marginV},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];
  const fmt = (w: string) => assEscape(p.upper ? w.toUpperCase() : w);
  const glow = p.glow ? `{\\blur${Math.max(2, Math.round(6 * scale))}}` : "";
  // Emphasised words: highlight colour and a little larger, whatever the preset.
  // Boxed: colour only (a larger word would make its box overlap its neighbours).
  const em = (x: { word: string; em?: boolean }, txt: string) =>
    !x.em ? txt : style.preset === "boxed" ? `{\\c${hi}}${txt}{\\c${primary}}` : `{\\c${hi}\\fscx112\\fscy112}${txt}{\\c${primary}\\fscx100\\fscy100}`;
  const lines: string[] = [];
  for (const g of groupWords(words, p.maxWords, p.maxChars)) {
    if (p.highlight === "none") {
      if (g.end - g.start <= 0.01) continue;
      lines.push(`Dialogue: 0,${assTime(g.start)},${assTime(g.end)},Sub,,0,0,0,,{\\fad(60,40)}${glow}${g.words.map((x) => em(x, fmt(x.word))).join(" ")}`);
      continue;
    }
    g.words.forEach((w, i) => {
      const start = i === 0 ? g.start : w.start;
      const end = i === g.words.length - 1 ? g.end : g.words[i + 1]!.start;
      if (end - start <= 0.01) return;
      const pop = i === 0 && p.highlight === "word" ? "{\\fscx88\\fscy88\\t(0,90,\\fscx100\\fscy100)}" : "";
      const text = g.words
        .map((x, j) => {
          const lit = p.highlight === "word" ? j === i : j <= i;
          if (lit && style.preset === "boxed") return `{\\3c${hi}\\c&H00000000&}${fmt(x.word)}{\\3c${outlineCol}\\c${primary}}`;
          return lit ? `{\\c${hi}}${fmt(x.word)}{\\c${primary}}` : em(x, fmt(x.word));
        })
        .join(" ");
      lines.push(`Dialogue: 0,${assTime(start)},${assTime(end)},Sub,,0,0,0,,${pop}${glow}${text}`);
    });
  }
  return { ass: [...header, ...lines, ""].join("\n"), events: lines.length };
}

/* ------------------------------ ffmpeg commands ----------------------------- */

const n3 = (x: number) => x.toFixed(3);

export interface SegmentInput {
  kind: "image" | "video";
  /** File name relative to the working directory. */
  file: string;
  lengthSec: number;
  /** Fit the whole picture over a blurred copy instead of cropping (product photos, logos). */
  fit: boolean;
  /** Transparent PNG with the animated headline, or null. */
  overlay: string | null;
  /** 0..5: which Ken Burns move to use. */
  motion: number;
  zoom: number;
  size: { w: number; h: number };
  out: string;
}

/** One normalised scene clip: W x H, 30 fps, no audio, exactly `lengthSec` long. */
export function buildSegmentArgs(s: SegmentInput): string[] {
  const { w: W, h: H } = s.size;
  const frames = Math.max(1, Math.round(s.lengthSec * REEL_FPS));
  const args = ["-y", "-hide_banner", "-loglevel", "error"];
  // A still is read once; zoompan then produces every frame from it (no per-frame scaling/blur).
  if (s.kind === "image") args.push("-i", s.file);
  else args.push("-stream_loop", "-1", "-t", n3(s.lengthSec), "-i", s.file);
  if (s.overlay) args.push("-loop", "1", "-framerate", String(REEL_FPS), "-t", n3(s.lengthSec), "-i", s.overlay);

  const f: string[] = [];
  // 1. Fill the frame: crop-to-cover, or fit over a blurred, darkened copy.
  if (s.fit) {
    f.push(`[0:v]split=2[bga][fga]`);
    f.push(`[bga]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=28:2,eq=brightness=-0.12:saturation=1.1[bg]`);
    f.push(`[fga]scale=${Math.round(W * 0.9)}:${Math.round(H * 0.72)}:force_original_aspect_ratio=decrease[fg]`);
    f.push(`[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1[filled]`);
  } else {
    f.push(`[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1[filled]`);
  }
  // 2. Motion: Ken Burns on stills (rendered at 1.5x to avoid zoompan jitter), slow push-in on video.
  const z = s.zoom;
  if (s.kind === "image") {
    const BW = Math.round(W * 1.5 / 2) * 2;
    const BH = Math.round(H * 1.5 / 2) * 2;
    // 0 push in, 1 pull out, 2 pan left->right, 3 pan right->left, 4 tilt down, 5 tilt up (with a slow push).
    const m = s.motion % 6;
    const zoomExpr = m === 1 ? `${1 + z}-${z}*on/${frames}` : m >= 2 ? `${1 + z * 0.6}+${z * 0.4}*on/${frames}` : `1+${z}*on/${frames}`;
    const xExpr = m === 2 ? `(iw-iw/zoom)*on/${frames}` : m === 3 ? `(iw-iw/zoom)*(1-on/${frames})` : `iw/2-(iw/zoom/2)`;
    const yExpr = m === 4 ? `(ih-ih/zoom)*on/${frames}` : m === 5 ? `(ih-ih/zoom)*(1-on/${frames})` : `ih/2-(ih/zoom/2)`;
    f.push(`[filled]scale=${BW}:${BH},zoompan=z='${zoomExpr}':x='${xExpr}':y='${yExpr}':d=${frames}:s=${W}x${H}:fps=${REEL_FPS},trim=end_frame=${frames},setpts=PTS-STARTPTS[moved]`);
  } else {
    const zw = `trunc(${W}*(1+${z}*t/${n3(s.lengthSec)})/2)*2`;
    const zh = `trunc(${H}*(1+${z}*t/${n3(s.lengthSec)})/2)*2`;
    f.push(`[filled]fps=${REEL_FPS},scale=w='${zw}':h='${zh}':eval=frame,crop=${W}:${H}[moved]`);
  }
  // 3. Animated headline: fades in and slides up, fades out before the cut.
  if (s.overlay) {
    const outAt = Math.max(0.6, s.lengthSec - 0.45);
    f.push(`[1:v]format=rgba,fade=t=in:st=0.15:d=0.45:alpha=1,fade=t=out:st=${n3(outAt)}:d=0.35:alpha=1[ov]`);
    f.push(`[moved][ov]overlay=x=0:y='if(lt(t,0.15),70,max(0,70-(t-0.15)*160))':eval=frame:shortest=1,format=yuv420p[vout]`);
  } else {
    f.push(`[moved]format=yuv420p[vout]`);
  }
  args.push(
    "-filter_complex", f.join(";"),
    "-map", "[vout]",
    "-t", n3(s.lengthSec),
    "-r", String(REEL_FPS),
    // Intermediate file (re-encoded in the final pass): fastest preset, near-lossless quality.
    "-c:v", "libx264", "-preset", "ultrafast", "-crf", "14", "-pix_fmt", "yuv420p", "-an",
    s.out,
  );
  return args;
}

export interface VoiceInput {
  file: string;
  /** Second on the final timeline where this clip starts. */
  atSec: number;
}

export interface FinalInput {
  segments: string[];
  timeline: Timeline;
  transition: string;
  voices: VoiceInput[];
  voiceVolume: number;
  musicFile: string | null;
  musicVolume: number;
  logo: { file: string; x: string; y: string; widthPx: number; fromSec: number; toSec: number } | null;
  assFile: string | null;
  fontsDir: string;
  size: { w: number; h: number };
  out: string;
  /** Transition whooshes and intro/outro hits (files made by `sfxSynthArgs`). */
  sfx?: { whoosh: string | null; hit: string | null; whooshAt: number[]; hitAt: number[]; volume: number } | null;
}

/** Joins the segments with transitions, burns in logo + subtitles, and mixes voice and ducked music. */
export function buildFinalArgs(input: FinalInput): string[] {
  const args = ["-y", "-hide_banner", "-loglevel", "error"];
  input.segments.forEach((s) => args.push("-i", s));
  let idx = input.segments.length;
  let logoIdx = -1;
  if (input.logo) {
    logoIdx = idx++;
    args.push("-loop", "1", "-i", input.logo.file);
  }
  const voiceIdx: number[] = [];
  for (const v of input.voices) {
    voiceIdx.push(idx++);
    args.push("-i", v.file);
  }
  let musicIdx = -1;
  if (input.musicFile) {
    musicIdx = idx++;
    args.push("-stream_loop", "-1", "-i", input.musicFile);
  }
  const sfx = input.sfx && input.sfx.volume > 0 ? input.sfx : null;
  const whooshAt = sfx?.whoosh ? sfx.whooshAt.filter((t) => t >= 0) : [];
  const hitAt = sfx?.hit ? sfx.hitAt.filter((t) => t >= 0) : [];
  let whooshIdx = -1;
  let hitIdx = -1;
  if (whooshAt.length) {
    whooshIdx = idx++;
    args.push("-i", sfx!.whoosh!);
  }
  if (hitAt.length) {
    hitIdx = idx++;
    args.push("-i", sfx!.hit!);
  }
  let silenceIdx = -1;
  if (!input.voices.length && !input.musicFile) {
    silenceIdx = idx++;
    args.push("-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo");
  }

  const f: string[] = [];
  const n = input.segments.length;
  const T = input.timeline.transitionSec;
  input.segments.forEach((_, i) => f.push(`[${i}:v]settb=AVTB,fps=${REEL_FPS},format=yuv420p[s${i}]`));
  let last = "s0";
  if (n > 1 && T > 0 && input.transition !== "cut") {
    for (let i = 1; i < n; i++) {
      const outLabel = `x${i}`;
      f.push(`[${last}][s${i}]xfade=transition=${input.transition}:duration=${n3(T)}:offset=${n3(input.timeline.starts[i]!)}[${outLabel}]`);
      last = outLabel;
    }
  } else if (n > 1) {
    f.push(`${input.segments.map((_, i) => `[s${i}]`).join("")}concat=n=${n}:v=1:a=0[xc]`);
    last = "xc";
  }
  if (input.logo) {
    const l = input.logo;
    f.push(`[${logoIdx}:v]scale=${l.widthPx}:-1,format=rgba,colorchannelmixer=aa=0.92[lg]`);
    f.push(`[${last}][lg]overlay=x=${l.x}:y=${l.y}:shortest=1:enable='between(t,${n3(l.fromSec)},${n3(l.toSec)})'[vl]`);
    last = "vl";
  }
  if (input.assFile) {
    f.push(`[${last}]subtitles=filename=${input.assFile}:fontsdir=${input.fontsDir}[vs]`);
    last = "vs";
  }
  f.push(`[${last}]format=yuv420p[vout]`);

  const total = input.timeline.total;
  const fmt = "aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo";
  if (input.voices.length) {
    input.voices.forEach((v, i) => {
      const ms = Math.max(0, Math.round(v.atSec * 1000));
      f.push(`[${voiceIdx[i]}:a]${fmt},adelay=${ms}|${ms},volume=${input.voiceVolume.toFixed(2)}[va${i}]`);
    });
    const vin = input.voices.map((_, i) => `[va${i}]`).join("");
    f.push(input.voices.length > 1 ? `${vin}amix=inputs=${input.voices.length}:normalize=0:duration=longest,apad[vo]` : `[va0]apad[vo]`);
  }
  if (musicIdx >= 0) {
    const fadeAt = Math.max(0, total - 1.6);
    f.push(`[${musicIdx}:a]${fmt},volume=${input.musicVolume.toFixed(2)},afade=t=in:d=0.8,afade=t=out:st=${n3(fadeAt)}:d=1.5[mus]`);
  }
  if (input.voices.length && musicIdx >= 0) {
    f.push(`[vo]asplit=2[vo1][vo2]`);
    f.push(`[mus][vo1]sidechaincompress=threshold=0.04:ratio=8:attack=20:release=400[duck]`);
    f.push(`[vo2][duck]amix=inputs=2:normalize=0:duration=first[amain]`);
  } else if (input.voices.length) {
    f.push(`[vo]anull[amain]`);
  } else if (musicIdx >= 0) {
    f.push(`[mus]anull[amain]`);
  } else {
    f.push(`[${silenceIdx}:a]${fmt}[amain]`);
  }
  const fx: string[] = [];
  const place = (inIdx: number, at: number[], tag: string) => {
    if (!at.length) return;
    const outs = at.map((_, i) => `[${tag}${i}]`);
    f.push(`[${inIdx}:a]${fmt},volume=${sfx!.volume.toFixed(2)}${at.length > 1 ? `,asplit=${at.length}${outs.map((o) => o.replace("[", "[r")).join("")}` : `[r${tag}0]`}`);
    at.forEach((t, i) => {
      const ms = Math.max(0, Math.round(t * 1000));
      f.push(`[r${tag}${i}]adelay=${ms}|${ms}[${tag}${i}]`);
      fx.push(`[${tag}${i}]`);
    });
  };
  if (sfx) {
    place(whooshIdx, whooshAt, "wh");
    place(hitIdx, hitAt, "ht");
  }
  if (fx.length) {
    f.push(`[amain]${fx.join("")}amix=inputs=${fx.length + 1}:normalize=0:duration=first,alimiter=limit=0.95[aout]`);
  } else {
    f.push(`[amain]alimiter=limit=0.95[aout]`);
  }

  args.push(
    "-filter_complex", f.join(";"),
    "-map", "[vout]",
    "-map", "[aout]",
    "-t", n3(total),
    "-r", String(REEL_FPS),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-profile:v", "high", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
    "-movflags", "+faststart",
    input.out,
  );
  return args;
}

/** Template transition and motion strength. */
export function templateOf(t: ReelTemplate) {
  return REEL_TEMPLATES[t] ?? REEL_TEMPLATES.smooth;
}

/** Logo position expression for ffmpeg overlay from a corner and margin. */
export function logoPosition(corner: string, marginPx: number): { x: string; y: string } {
  const m = String(Math.round(marginPx));
  return {
    x: corner.endsWith("left") ? m : `W-w-${m}`,
    y: corner.startsWith("bottom") ? `H-h-${m}` : m,
  };
}

/* ------------------------- synthesised audio assets ------------------------ */

/**
 * ffmpeg args that synthesise a sound effect (no licence, no network):
 * "whoosh" = filtered pink-noise swell for transitions, "hit" = soft low boom.
 */
export function sfxSynthArgs(kind: "whoosh" | "hit", out: string): string[] {
  const src =
    kind === "whoosh"
      ? "anoisesrc=d=0.7:c=pink:r=48000:a=0.9,highpass=f=350,lowpass=f=5200,afade=t=in:st=0:d=0.38:curve=exp,afade=t=out:st=0.38:d=0.32:curve=exp,volume=0.8"
      : "aevalsrc='0.9*sin(2*PI*(70-35*t)*t)*exp(-4.5*t)':d=1.1:s=48000,lowpass=f=900,volume=1.2";
  return ["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", src, "-ac", "2", "-ar", "48000", out];
}

/** Length of the whoosh in seconds (centred on the middle of each transition). */
export const WHOOSH_SEC = 0.7;

/** Where the transition whooshes go: centred on each cut/crossfade between segments. */
export function whooshTimes(timeline: Timeline): number[] {
  const T = timeline.transitionSec;
  return timeline.starts.slice(1).map((s) => +Math.max(0, s + T / 2 - WHOOSH_SEC / 2).toFixed(3));
}

export const BUILTIN_MUSIC = {
  "calm-pad": { label: "Built-in: calm pad", pulse: 0, bpm: 0 },
  "upbeat-pulse": { label: "Built-in: upbeat pulse", pulse: 0.35, bpm: 112 },
  "warm-lofi": { label: "Built-in: warm lo-fi", pulse: 0.2, bpm: 84 },
} as const;
export type BuiltinMusic = keyof typeof BUILTIN_MUSIC;

/**
 * ffmpeg args that synthesise a royalty-free music bed: an Am-F-C-G chord
 * progression (4 s per chord) of soft detuned sines, with an optional rhythmic
 * pulse, reverb-ish echo and a gentle low-pass. Used when no library or
 * uploaded track exists, so every reel still gets music.
 */
export function ambientMusicArgs(kind: BuiltinMusic, seconds: number, out: string): string[] {
  const cfg = BUILTIN_MUSIC[kind];
  const c = "floor(mod(t,16)/4)";
  const root = `if(eq(${c},0),220,if(eq(${c},1),174.61,if(eq(${c},2),261.63,196)))`;
  const third = `if(eq(${c},0),1.1892,1.2599)`;
  const env = "(1-exp(-2.5*mod(t,4)))*(0.75+0.25*exp(-1.2*mod(t,4)))";
  const beat = cfg.bpm ? `(${1 - cfg.pulse}+${cfg.pulse}*exp(-9*mod(t,${(60 / cfg.bpm).toFixed(4)})))` : "1";
  const voice = (mul: string, amp: number) => `${amp}*(sin(2*PI*${root}*${mul}*t)+0.6*sin(2*PI*${root}*${mul}*1.003*t))`;
  const expr = `${env}*${beat}*(${voice("1", 0.16)}+${voice(third, 0.12)}+${voice("1.4983", 0.11)}+${voice("0.5", 0.14)})`;
  return [
    "-y", "-hide_banner", "-loglevel", "error",
    "-f", "lavfi", "-i", `aevalsrc='${expr}':d=${seconds}:s=48000`,
    "-af", "aecho=0.8:0.6:90|170:0.32|0.22,lowpass=f=2600,highpass=f=60,afade=t=in:d=1.5,volume=1.6",
    "-ac", "2", "-ar", "48000", out,
  ];
}
