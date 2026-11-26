import { z } from "zod";

/* -------------------------------------------------------------------------- */
/*  Shorts Factory: Reel Studio (brand-based and general-topic AI reels).     */
/*  Shared constants, request schemas, DTOs and the pure timing rules used by */
/*  both the API and the web editor.                                          */
/* -------------------------------------------------------------------------- */

export const REEL_MODES = ["brand", "general"] as const;
export type ReelMode = (typeof REEL_MODES)[number];

export const REEL_TYPES = [
  "product_promo",
  "product_ad",
  "product_launch",
  "offer",
  "brand_awareness",
  "product_demo",
  "engagement",
  "festival",
] as const;
export type ReelType = (typeof REEL_TYPES)[number];

export const REEL_TYPE_LABELS: Record<ReelType, { label: string; brief: string }> = {
  product_promo: { label: "Product promotion", brief: "Promote one product: what it is, why it is great, and where to get it." },
  product_ad: { label: "Product advertisement", brief: "A punchy ad: problem, product as the answer, proof from real features, strong CTA." },
  product_launch: { label: "New product launch", brief: "Announce something new: build curiosity, reveal it, show what is new, tell people how to get it." },
  offer: { label: "Offer / discount", brief: "Promote the brand's current offer exactly as stated. Never invent a discount, price or deadline." },
  brand_awareness: { label: "Brand awareness", brief: "Who the brand is, what it stands for and why people love it. Emotional, memorable." },
  product_demo: { label: "Product demonstration", brief: "Show how the product is used, step by step, highlighting real features and benefits." },
  engagement: { label: "Customer engagement", brief: "Invite the audience to react: a question, poll-style choice, relatable moment, or tip. End asking them to comment." },
  festival: { label: "Festival / seasonal", brief: "Celebrate the festival or season named in the brief and connect it naturally to the brand." },
};

export const REEL_DURATIONS = [15, 30, 45, 60] as const;
export type ReelDuration = (typeof REEL_DURATIONS)[number];

/** Languages offered for script, voiceover and subtitles. `speech` is the name sent to the model/TTS. */
export const REEL_LANGUAGES = [
  { code: "en", label: "English", speech: "English" },
  { code: "en-IN", label: "English (Indian)", speech: "English with a natural Indian accent" },
  { code: "hinglish", label: "Hinglish", speech: "Hinglish (Hindi and English mixed, written in Latin script)" },
  { code: "hi", label: "Hindi", speech: "Hindi" },
  { code: "ta", label: "Tamil", speech: "Tamil" },
  { code: "te", label: "Telugu", speech: "Telugu" },
  { code: "kn", label: "Kannada", speech: "Kannada" },
  { code: "ml", label: "Malayalam", speech: "Malayalam" },
  { code: "mr", label: "Marathi", speech: "Marathi" },
  { code: "bn", label: "Bengali", speech: "Bengali" },
  { code: "gu", label: "Gujarati", speech: "Gujarati" },
  { code: "pa", label: "Punjabi", speech: "Punjabi" },
] as const;
export type ReelLanguage = (typeof REEL_LANGUAGES)[number]["code"];
export const REEL_LANGUAGE_CODES = REEL_LANGUAGES.map((l) => l.code) as unknown as [ReelLanguage, ...ReelLanguage[]];
export const reelLanguage = (code: string) => REEL_LANGUAGES.find((l) => l.code === code) ?? REEL_LANGUAGES[0];

export const REEL_VISUAL_SOURCES = ["auto", "brand_image", "stock_video", "stock_image", "ai_image", "ai_video", "upload", "graphic"] as const;
export type ReelVisualSource = (typeof REEL_VISUAL_SOURCES)[number];
export const REEL_VISUAL_SOURCE_LABELS: Record<ReelVisualSource, string> = {
  auto: "Auto (best match)",
  brand_image: "Brand product image",
  stock_video: "Stock video",
  stock_image: "Stock photo",
  ai_image: "AI image",
  ai_video: "AI video clip",
  upload: "My upload",
  graphic: "Brand graphic card",
};

export const REEL_SUBTITLE_PRESETS = ["bold", "clean", "karaoke", "minimal", "boxed", "neon"] as const;
export const REEL_SUBTITLE_PRESET_LABELS: Record<ReelSubtitlePreset, string> = {
  bold: "Bold pop (word by word)",
  karaoke: "Karaoke (fills as spoken)",
  clean: "Clean box",
  minimal: "Minimal",
  boxed: "Boxed word highlight",
  neon: "Neon glow",
};
export type ReelSubtitlePreset = (typeof REEL_SUBTITLE_PRESETS)[number];
export const REEL_SUBTITLE_POSITIONS = ["bottom", "middle", "top"] as const;

/** Reel templates: how scenes cut into each other and how hard the motion is. */
export const REEL_TEMPLATES = {
  smooth: { label: "Smooth (fades)", transition: "fade", transitionSec: 0.45, zoom: 0.08 },
  dynamic: { label: "Dynamic (slides)", transition: "slideleft", transitionSec: 0.35, zoom: 0.12 },
  bold: { label: "Bold (zoom punches)", transition: "zoomin", transitionSec: 0.3, zoom: 0.16 },
  cinematic: { label: "Cinematic (soft wipes)", transition: "smoothup", transitionSec: 0.6, zoom: 0.06 },
  minimal: { label: "Minimal (hard cuts)", transition: "cut", transitionSec: 0, zoom: 0.04 },
} as const;
export type ReelTemplate = keyof typeof REEL_TEMPLATES;
export const REEL_TEMPLATE_KEYS = Object.keys(REEL_TEMPLATES) as [ReelTemplate, ...ReelTemplate[]];

/** Visual style picked in the generator: "auto" lets the AI choose a template for the topic. */
export const REEL_STYLES = ["auto", ...REEL_TEMPLATE_KEYS] as const;
export type ReelStyle = (typeof REEL_STYLES)[number];

/** Background-music moods the AI can pick; each maps to a built-in bed and library-name keywords. */
export const REEL_MUSIC_MOODS = ["calm", "upbeat", "warm", "energetic", "emotional"] as const;
export type ReelMusicMood = (typeof REEL_MUSIC_MOODS)[number];

export const REEL_STATUSES = ["draft", "script_ready", "queued", "rendering", "completed", "failed"] as const;
export type ReelStatus = (typeof REEL_STATUSES)[number];
export const REEL_BUSY_STATUSES: readonly ReelStatus[] = ["queued", "rendering"];

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "use #RRGGBB");

/* --------------------------------- scenes --------------------------------- */

export const reelVisualSchema = z.object({
  source: z.enum(REEL_VISUAL_SOURCES).default("auto"),
  /** Stock search terms (English). */
  query: z.string().max(120).default(""),
  /** Prompt for AI images / clips (English). */
  prompt: z.string().max(800).default(""),
  /** Brand asset URL when source = brand_image. */
  assetUrl: z.string().url().max(1000).nullable().default(null),
  /** File name inside the reel folder when source = upload (set by the upload endpoint). */
  uploadFile: z.string().max(200).nullable().default(null),
  /** Stock ids already tried for this scene, skipped on "new visual". */
  exclude: z.array(z.string().max(80)).max(40).default([]),
});
export type ReelVisual = z.infer<typeof reelVisualSchema>;

/** What the renderer actually used for a scene (written by the server, read-only for the client). */
export interface ReelResolvedVisual {
  key: string;
  source: Exclude<ReelVisualSource, "auto">;
  kind: "image" | "video";
  file: string;
  provider: string;
  providerId: string | null;
  sourceUrl: string | null;
  license: string | null;
  author: string | null;
  note: string | null;
}

export const reelSceneSchema = z.object({
  id: z.string().min(1).max(40),
  /** Spoken line. Empty = silent scene (music + on-screen text only). */
  narration: z.string().max(600).default(""),
  /** Short headline shown on screen (animated). */
  onScreenText: z.string().max(90).default(""),
  /** Planned length; the render stretches it when the voiceover needs longer. */
  durationSec: z.number().min(1.5).max(15),
  visual: reelVisualSchema.default({}),
  /** Subtitle text override. Null = the narration (timed by the voice). */
  captionText: z.string().max(600).nullable().default(null),
  /** Shifts this scene's subtitles earlier (-) or later (+), seconds. */
  captionOffsetSec: z.number().min(-2).max(2).default(0),
});
export type ReelScene = z.infer<typeof reelSceneSchema>;

export const reelStudioScriptSchema = z.object({
  title: z.string().min(1).max(120),
  hook: z.string().max(300).default(""),
  cta: z.string().max(160).default(""),
  /** Caption for the Instagram post itself. */
  caption: z.string().max(2200).default(""),
  hashtags: z.array(z.string().max(60)).max(30).default([]),
  scenes: z.array(reelSceneSchema).min(1).max(14),
});
export type ReelStudioScript = z.infer<typeof reelStudioScriptSchema>;

/* -------------------------------- settings -------------------------------- */

export const reelSettingsSchema = z.object({
  voiceEnabled: z.boolean().default(true),
  voiceGender: z.enum(["female", "male"]).default("female"),
  /** "auto" = ElevenLabs when configured, else OpenAI TTS. */
  voiceProvider: z.enum(["auto", "elevenlabs", "openai"]).default("auto"),
  /** Optional provider voice id (ElevenLabs voice id, or an OpenAI voice name). */
  voiceId: z.string().max(100).nullable().default(null),
  voiceStyle: z.string().max(200).default("warm, energetic and natural"),
  voiceVolume: z.number().min(0).max(2).default(1),
  musicTrack: z.string().max(200).nullable().default(null),
  /** "auto" picks the least recently used library track. */
  musicMode: z.enum(["auto", "track", "none"]).default("auto"),
  musicVolume: z.number().min(0).max(1).default(0.25),
  subtitles: z
    .object({
      enabled: z.boolean().default(true),
      preset: z.enum(REEL_SUBTITLE_PRESETS).default("bold"),
      position: z.enum(REEL_SUBTITLE_POSITIONS).default("bottom"),
      size: z.number().min(0.6).max(1.6).default(1),
      textColor: hex.default("#FFFFFF"),
      highlightColor: hex.nullable().default(null),
      /** Colour and enlarge important words (numbers, key terms, the scene headline's words). */
      emphasis: z.boolean().default(true),
      /** Shifts all subtitles earlier (-) or later (+), seconds. */
      offsetSec: z.number().min(-1.5).max(1.5).default(0),
    })
    .default({}),
  template: z.enum(REEL_TEMPLATE_KEYS).default("smooth"),
  /** Whoosh on every transition and a soft hit on the intro/outro (synthesised locally, no licence needed). */
  sfx: z.boolean().default(true),
  sfxVolume: z.number().min(0).max(1).default(0.45),
  showLogo: z.boolean().default(true),
  intro: z.boolean().default(true),
  outro: z.boolean().default(true),
  /** Allow AI-generated images when stock/brand visuals don't fit (paid image generation). */
  allowAiImages: z.boolean().default(true),
  /** Allow AI-generated video clips (metered against the Path C monthly budget). */
  allowAiVideo: z.boolean().default(false),
  /** Prefer AI images over stock footage in "auto". */
  preferAi: z.boolean().default(false),
  resolution: z.enum(["1080p", "720p"]).default("1080p"),
  /** The AI picks the template (transitions/motion) when the script is written. */
  autoTemplate: z.boolean().default(false),
  /** The AI picks the voice gender and delivery when the script is written. */
  autoVoice: z.boolean().default(false),
  /** Music mood chosen by the AI; guides "auto" music. */
  musicMood: z.enum(REEL_MUSIC_MOODS).nullable().default(null),
});
export type ReelSettings = z.infer<typeof reelSettingsSchema>;
export const defaultReelSettings = (): ReelSettings => reelSettingsSchema.parse({});

/* -------------------------------- requests -------------------------------- */

export const createReelSchema = z
  .object({
    mode: z.enum(REEL_MODES),
    brandId: z.string().uuid().nullable().optional(),
    reelType: z.enum(REEL_TYPES).nullable().optional(),
    /** Topic (general) or extra direction (brand: product, offer, festival, angle...). */
    topic: z.string().max(1000).default(""),
    durationSec: z.union([z.literal(15), z.literal(30), z.literal(45), z.literal(60)]).default(30),
    language: z.enum(REEL_LANGUAGE_CODES).default("en"),
    /** Brand product image URL to feature (brand mode). */
    productUrl: z.string().url().max(1000).nullable().optional(),
    settings: reelSettingsSchema.partial().optional(),
    /** Visual style: a template, or "auto" for the AI to choose. */
    style: z.enum(REEL_STYLES).default("auto"),
    /** Voice preference: "auto" lets the AI choose gender and delivery for the topic. */
    voice: z.enum(["auto", "female", "male"]).default("auto"),
    /**
     * One click: the whole reel (script, scene plan, visuals, voice, subtitles,
     * music, editing, render) runs as one background job.
     */
    autoRender: z.boolean().default(false),
  })
  .refine((v) => v.mode === "general" || !!v.brandId, { message: "Pick a brand", path: ["brandId"] })
  .refine((v) => v.mode === "brand" || v.topic.trim().length >= 2, { message: "Enter a topic", path: ["topic"] });
export type CreateReelRequest = z.infer<typeof createReelSchema>;

export const updateReelSchema = z.object({
  title: z.string().min(1).max(120).optional(),
  durationSec: z.union([z.literal(15), z.literal(30), z.literal(45), z.literal(60)]).optional(),
  language: z.enum(REEL_LANGUAGE_CODES).optional(),
  script: reelStudioScriptSchema.optional(),
  settings: reelSettingsSchema.optional(),
});
export type UpdateReelRequest = z.infer<typeof updateReelSchema>;

export const regenerateReelScriptSchema = z.object({
  instructions: z.string().max(600).default(""),
});

/** "Regenerate": a fresh take on the same brief (new script, visuals and render), optionally steered. */
export const regenerateReelSchema = z.object({
  instructions: z.string().max(600).default(""),
});

export const regenerateSceneSchema = z.object({
  instructions: z.string().max(600).default(""),
  /** "text" rewrites the scene; "visual" picks a new visual on the next render. */
  part: z.enum(["text", "visual", "both"]).default("text"),
});

/* ----------------------------------- DTOs ---------------------------------- */

export interface ReelSceneDto extends ReelScene {
  resolved: (Omit<ReelResolvedVisual, "file"> & { previewUrl: string | null }) | null;
  /** Length the scene got in the last render (voice may stretch it). */
  renderedSec: number | null;
}

export interface ReelDto {
  id: string;
  mode: ReelMode;
  reelType: ReelType | null;
  brandId: string | null;
  brandName: string | null;
  topic: string;
  title: string;
  durationSec: number;
  language: ReelLanguage;
  status: ReelStatus;
  stage: string | null;
  progress: number;
  error: string | null;
  warnings: string[];
  videoDurationSec: number | null;
  fileSizeBytes: number | null;
  width: number | null;
  height: number | null;
  fileUrl: string | null;
  downloadUrl: string | null;
  thumbUrl: string | null;
  renderCount: number;
  /** Tracked spend on paid AI calls for this reel so far (all runs), USD. */
  costUsd: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

/** One paid call recorded while generating a reel. */
export interface ReelCostEntry {
  at: string;
  run: number;
  label: string;
  usd: number;
}

export interface ReelDetailDto extends ReelDto {
  productUrl: string | null;
  /** What the next render is expected to cost (only work that isn't cached yet). */
  estimate: ReelCostEstimate;
  script: (Omit<ReelStudioScript, "scenes"> & { scenes: ReelSceneDto[] }) | null;
  settings: ReelSettings;
  /** Paid calls made for this reel, newest last. */
  costLog: ReelCostEntry[];
}

export interface ReelOptionsDto {
  languages: { code: string; label: string }[];
  durations: number[];
  reelTypes: { key: ReelType; label: string }[];
  templates: { key: ReelTemplate; label: string }[];
  /** `key` is stored in settings.musicTrack: "lib:<file>" (shared library) or "mine:<file>" (your uploads). */
  music: { key: string; label: string; mine: boolean; url: string }[];
  features: {
    script: boolean;
    scriptProvider: string | null;
    voice: { elevenlabs: boolean; openai: boolean };
    stockVideo: boolean;
    stockImage: boolean;
    aiImage: boolean;
    aiVideo: boolean;
    ffmpeg: boolean;
  };
  /** USD per second of AI video, when known. */
  aiVideoPerSecUsd: number | null;
}

/* ------------------------------ pure timing ------------------------------- */

/** Rough speaking rate per language family, words per second. Indic scripts carry more per word. */
export function wordsPerSecond(language: string): number {
  if (language === "en" || language === "en-IN" || language === "hinglish") return 2.5;
  return 1.9;
}

/** How many scenes a reel of this length should have (hook + body + CTA). */
export function sceneCountFor(durationSec: number): number {
  if (durationSec <= 15) return 4;
  if (durationSec <= 30) return 6;
  if (durationSec <= 45) return 8;
  return 10;
}

/**
 * Scales scene durations so they add up to the target (each at least 1.5 s,
 * at most 15 s), rounded to 0.1 s. Keeps the relative pacing the model chose.
 */
export function fitSceneDurations(durations: number[], targetSec: number): number[] {
  if (!durations.length) return [];
  const MIN = 1.5;
  const MAX = 15;
  const w = durations.map((d) => (Number.isFinite(d) && d > 0 ? d : targetSec / durations.length));
  const out: (number | null)[] = w.map(() => null);
  // Scale the free scenes to the remaining time; pin any that hit a bound and repeat.
  for (let round = 0; round < durations.length + 1; round++) {
    const free = out.map((v, i) => (v === null ? i : -1)).filter((i) => i >= 0);
    if (!free.length) break;
    const pinned = out.reduce<number>((a, v) => a + (v ?? 0), 0);
    const weight = free.reduce((a, i) => a + w[i]!, 0);
    const left = targetSec - pinned;
    let changed = false;
    for (const i of free) {
      const v = (w[i]! / weight) * left;
      if (v < MIN) { out[i] = MIN; changed = true; }
      else if (v > MAX) { out[i] = MAX; changed = true; }
    }
    if (!changed) {
      for (const i of free) out[i] = (w[i]! / weight) * left;
      break;
    }
  }
  const rounded = out.map((v) => Math.round((v ?? MIN) * 10) / 10);
  // Put the rounding remainder on a scene that has room, so the total is exact when possible.
  let diff = Math.round((targetSec - rounded.reduce((a, b) => a + b, 0)) * 10) / 10;
  for (let i = 0; i < rounded.length && diff !== 0; i++) {
    const next = Math.min(MAX, Math.max(MIN, Math.round((rounded[i]! + diff) * 10) / 10));
    diff = Math.round((diff - (next - rounded[i]!)) * 10) / 10;
    rounded[i] = next;
  }
  return rounded;
}

/* ------------------------------ pipeline steps ----------------------------- */

/**
 * The render job's steps, in order, with the slice of the 0-100 progress bar
 * each one owns. The server reports progress inside these bands, so the
 * dashboard can show every step's state from `progress` alone.
 */
export const REEL_PIPELINE = [
  { key: "understand", label: "Understanding prompt", from: 0, to: 3 },
  { key: "script", label: "Creating script", from: 3, to: 10 },
  { key: "plan", label: "Planning scenes", from: 10, to: 12 },
  { key: "voice", label: "Creating voiceover", from: 12, to: 30 },
  { key: "stock", label: "Collecting visuals", from: 30, to: 46 },
  { key: "ai", label: "Generating AI images", from: 46, to: 62 },
  { key: "subtitles", label: "Synchronizing subtitles", from: 62, to: 66 },
  { key: "editing", label: "Editing video", from: 66, to: 90 },
  { key: "render", label: "Rendering final video", from: 90, to: 100 },
] as const;

/** Steps that produce the script; done whenever a script exists. */
const SCRIPT_STEPS: readonly string[] = ["understand", "script", "plan"];
export type ReelPipelineStepKey = (typeof REEL_PIPELINE)[number]["key"];

/** Progress value for item `i` of `n` inside a step's band. */
export function reelStepProgress(step: ReelPipelineStepKey, i: number, n: number): number {
  const b = REEL_PIPELINE.find((s) => s.key === step)!;
  return b.from + (b.to - b.from) * Math.min(1, Math.max(0, n > 0 ? i / n : 1));
}

export type ReelStepState = "pending" | "active" | "done" | "skipped" | "failed";
export interface ReelStepView {
  key: ReelPipelineStepKey;
  label: string;
  state: ReelStepState;
  /** 0-100 within the step. */
  pct: number;
  note: string | null;
}

/** Per-step state for the dashboard, derived from the reel's status, progress and settings. */
export function reelPipelineSteps(r: Pick<ReelDetailDto, "status" | "progress" | "stage" | "settings" | "script">): ReelStepView[] {
  const scenes = r.script?.scenes ?? [];
  const usedAi = scenes.some((s) => s.resolved?.source === "ai_image" || s.resolved?.source === "ai_video");
  const skipped = (key: ReelPipelineStepKey): string | null => {
    if (key === "voice" && !r.settings.voiceEnabled) return "Voiceover off";
    if (key === "subtitles" && !r.settings.subtitles.enabled) return "Subtitles off";
    if (key === "ai" && !r.settings.allowAiImages && !r.settings.allowAiVideo) return "AI visuals off";
    if (key === "ai" && r.status === "completed" && !usedAi) return "Not needed: stock/brand visuals fit";
    return null;
  };
  const busy = r.status === "queued" || r.status === "rendering";
  return REEL_PIPELINE.map((b): ReelStepView => {
    const base = { key: b.key, label: b.label };
    // The job writes the script only when there is none, so a stored script means these steps are done.
    if (SCRIPT_STEPS.includes(b.key) && r.script) {
      return { ...base, state: "done", pct: 100, note: b.key === "plan" ? `${scenes.length} scenes` : b.key === "script" ? r.script.title : null };
    }
    const skip = skipped(b.key);
    if (r.status === "completed") return { ...base, state: skip ? "skipped" : "done", pct: 100, note: skip };
    if (!busy && r.status !== "failed") return { ...base, state: skip ? "skipped" : "pending", pct: 0, note: skip };
    if (r.progress >= b.to) return { ...base, state: skip ? "skipped" : "done", pct: 100, note: skip };
    if (r.progress >= b.from && r.progress > 0 && r.status !== "queued") {
      const within = Math.round(((r.progress - b.from) / (b.to - b.from)) * 100);
      return { ...base, state: r.status === "failed" ? "failed" : "active", pct: Math.max(0, Math.min(99, within)), note: r.stage };
    }
    return { ...base, state: "pending", pct: 0, note: skip };
  });
}

/* ------------------------------ cost estimate ------------------------------ */

/**
 * Approximate list prices in USD for the pre-render estimate. Rounded up and
 * only for paid AI calls: stock media, FFmpeg editing, subtitles, sound
 * effects and music are free.
 */
export const REEL_COST_RATES = {
  scriptUsd: 0.02,
  elevenlabsPerCharUsd: 0.0003,
  openaiTtsPerCharUsd: 0.000015,
  aiImageUsd: 0.07,
  aiVideoPerSecUsdDefault: 0.05,
} as const;

export interface ReelCostSceneInput {
  narrationChars: number;
  source: ReelVisualSource;
  durationSec: number;
  /** The visual from the last render is reused (no new call). */
  cachedVisual: boolean;
  /** The voiceover from the last render is reused. */
  cachedVoice: boolean;
}

export interface ReelCostInput {
  scenes: ReelCostSceneInput[];
  settings: Pick<ReelSettings, "voiceEnabled" | "voiceProvider" | "allowAiImages" | "allowAiVideo" | "preferAi">;
  features: { stockVideo: boolean; stockImage: boolean; aiImage: boolean; aiVideo: boolean; elevenlabs: boolean; openai: boolean };
  includeScript: boolean;
  aiVideoPerSecUsd: number | null;
}

export interface ReelCostLine {
  label: string;
  minUsd: number;
  maxUsd: number;
  note: string;
}

export interface ReelCostEstimate {
  minUsd: number;
  maxUsd: number;
  lines: ReelCostLine[];
  free: string[];
}

const r4 = (x: number) => Math.round(x * 10000) / 10000;

/** Estimated cost of the next render: only uncached paid calls, as a min-max range (AI only runs where stock doesn't fit). */
export function estimateReelCost(input: ReelCostInput): ReelCostEstimate {
  const { settings: s, features: f } = input;
  const lines: ReelCostLine[] = [];
  if (input.includeScript) lines.push({ label: "AI script", minUsd: REEL_COST_RATES.scriptUsd / 2, maxUsd: REEL_COST_RATES.scriptUsd, note: "One language-model call" });

  if (s.voiceEnabled) {
    const chars = input.scenes.filter((x) => !x.cachedVoice).reduce((a, x) => a + x.narrationChars, 0);
    const eleven = s.voiceProvider === "elevenlabs" || (s.voiceProvider === "auto" && f.elevenlabs);
    const rate = eleven ? REEL_COST_RATES.elevenlabsPerCharUsd : REEL_COST_RATES.openaiTtsPerCharUsd;
    if (chars > 0) lines.push({ label: `Voiceover (${eleven ? "ElevenLabs" : "OpenAI TTS"})`, minUsd: chars * rate * 0.6, maxUsd: chars * rate, note: `${chars} characters to speak` });
  }

  const aiImgOk = f.aiImage && s.allowAiImages;
  const aiVidOk = f.aiVideo && s.allowAiVideo;
  const stockOk = f.stockVideo || f.stockImage;
  const vidRate = input.aiVideoPerSecUsd ?? REEL_COST_RATES.aiVideoPerSecUsdDefault;
  let imgMin = 0;
  let imgMax = 0;
  let vidMinSec = 0;
  let vidMaxSec = 0;
  for (const sc of input.scenes) {
    if (sc.cachedVisual) continue;
    const src = sc.source;
    if (src === "brand_image" || src === "upload" || src === "graphic") continue;
    if (aiVidOk && (src === "ai_video" || src === "auto")) {
      // Auto tries an AI clip first when AI video is switched on.
      vidMinSec += sc.durationSec;
      vidMaxSec += sc.durationSec;
      continue;
    }
    if (!aiImgOk) continue;
    // Certain when AI is asked for or preferred, or when there's no stock to try first.
    const certain = src === "ai_image" || src === "ai_video" || (src === "auto" && (s.preferAi || !stockOk));
    if (certain) imgMin += 1;
    imgMax += 1;
  }
  if (imgMax > 0) {
    lines.push({
      label: "AI images",
      minUsd: imgMin * REEL_COST_RATES.aiImageUsd,
      maxUsd: imgMax * REEL_COST_RATES.aiImageUsd,
      note: imgMin === imgMax ? `${imgMax} image${imgMax === 1 ? "" : "s"}` : `${imgMin}-${imgMax} images, only where stock doesn't fit`,
    });
  }
  if (vidMaxSec > 0) {
    lines.push({ label: "AI video clips", minUsd: vidMinSec * vidRate, maxUsd: vidMaxSec * vidRate, note: `Up to ${Math.round(vidMaxSec)} s, metered against your AI clip budget` });
  }
  const free = ["FFmpeg editing & rendering", "Subtitles", "Transitions & sound effects", "Background music"];
  if (stockOk) free.unshift("Pexels / Pixabay stock (cached)");
  const out = lines.map((l) => ({ ...l, minUsd: r4(l.minUsd), maxUsd: r4(l.maxUsd) }));
  return { minUsd: r4(out.reduce((a, l) => a + l.minUsd, 0)), maxUsd: r4(out.reduce((a, l) => a + l.maxUsd, 0)), lines: out, free };
}

/** Scene inputs for a reel whose script isn't written yet (the pre-generate estimate). */
export function plannedReelCostInput(durationSec: number, language: string): ReelCostSceneInput[] {
  const n = sceneCountFor(durationSec);
  const chars = Math.round(durationSec * wordsPerSecond(language) * 6);
  return Array.from({ length: n }, () => ({ narrationChars: Math.round(chars / n), source: "auto" as const, durationSec: durationSec / n, cachedVisual: false, cachedVoice: false }));
}
