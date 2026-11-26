import { randomUUID } from "node:crypto";
import { copyFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Prisma, prisma } from "@catgpt/db";
import {
  brandProfileSchema,
  defaultReelSettings,
  estimateReelCost,
  REEL_BUSY_STATUSES,
  REEL_COST_RATES,
  type ReelCostEntry,
  reelStepProgress,
  REEL_TEMPLATES,
  REEL_TYPES,
  REEL_LANGUAGES,
  REEL_DURATIONS,
  REEL_TYPE_LABELS,
  reelLanguage,
  reelSettingsSchema,
  reelStudioScriptSchema,
  type BrandProfile,
  type CreateReelRequest,
  type ReelCostEstimate,
  type ReelDetailDto,
  type ReelDto,
  type ReelMode,
  type ReelOptionsDto,
  type ReelResolvedVisual,
  type ReelScene,
  type ReelSettings,
  type ReelStatus,
  type ReelStudioScript,
  type ReelType,
  type UpdateReelRequest,
} from "@catgpt/types";
import { HttpError, notFound } from "../../lib/errors.js";
import { findAccessibleBrand } from "../../lib/brand.js";
import { fetchOwnBytes, loadBrandKit } from "../brand-compose.js";
import { ShortsConfigError, shortsHealth } from "./env-check.js";
import { ffmpeg, probeOutput, videoInfo } from "./ffmpeg.js";
import { enqueueJob, PermanentJobError, registerJobHandler, type ShortsJobRow } from "./jobs.js";
import { log } from "./log.js";
import { listMusic } from "./music.js";
import { aiClipsConfigured, generateReelClip, reelClipPriceUsd } from "./pathc.js";
import { cardTheme, graphicCard, headlineOverlay, introCard, logoPng, outroCard, type CardTheme } from "./reel-cards.js";
import {
  ambientMusicArgs,
  approxWordTimings,
  BUILTIN_MUSIC,
  builtinForMood,
  buildFinalArgs,
  buildReelAss,
  buildReelScriptPrompt,
  buildScenePrompt,
  buildSegmentArgs,
  buildTimeline,
  forbiddenHits,
  importantWordFlags,
  INTRO_SEC,
  logoPosition,
  normalizeScene,
  normalizeScript,
  OUTRO_SEC,
  pickMusicTrack,
  pickStockImage,
  pickStockVideo,
  REEL_SCENE_JSON_SCHEMA,
  REEL_SCRIPT_JSON_SCHEMA,
  reelSize,
  sfxSynthArgs,
  templateOf,
  visualKey,
  visualPlan,
  VOICE_LEAD_SEC,
  VOICE_TAIL_SEC,
  whooshTimes,
  type BuiltinMusic,
  type ConcreteSource,
  type ReelBrandContext,
  type ReelDecisions,
  type SegmentInput,
} from "./reel-logic.js";
import {
  aiImageConfigured,
  elevenConfigured,
  generateAiImage,
  openaiTtsConfigured,
  pickVoiceProvider,
  reelJson,
  scriptProvider,
  searchStockImages,
  stockImagesConfigured,
  stockVideoConfigured,
  synthesizeSpeech,
} from "./reel-providers.js";
import { downloadStock, searchStock } from "./stock.js";
import { keyOf } from "./stock-logic.js";
import { ensureDir, insideStorage, paths, signedMusicUrl, signedReelFileUrl, storageRoot } from "./storage.js";
import type { WordTiming } from "./captions-logic.js";

/**
 * Shorts Factory Reel Studio: brand-based and general-topic AI reels.
 * Script -> (owner edits) -> render job on the Shorts Postgres queue:
 * voiceover per scene, visuals per scene, headline/intro/outro cards,
 * per-scene segments with motion, then transitions + logo + subtitles +
 * ducked music into one 9:16 MP4. Every external piece is cached per scene,
 * so a retry or a single-scene change never pays for the rest again.
 */

const FONTS_DIR = fileURLToPath(new URL("../../../assets/fonts", import.meta.url));
const JOB_TYPE = "reel_render";
const newId = () => randomUUID().slice(0, 8);

type ReelRow = Prisma.ShortsReelGetPayload<{ include: { brand: { select: { name: true } } } }>;
type StoredScene = ReelScene & { resolved?: ReelResolvedVisual | null };
type StoredScript = Omit<ReelStudioScript, "scenes"> & { scenes: StoredScene[] };
interface RenderScene {
  id: string;
  sec: number;
  voiceFile: string | null;
  voiceKey: string | null;
  voiceSec: number | null;
  words: WordTiming[] | null;
}

const exists = (p: string) =>
  stat(p).then(
    () => true,
    () => false,
  );

const isBusy = (s: string) => (REEL_BUSY_STATUSES as readonly string[]).includes(s);

/* -------------------------------- loading -------------------------------- */

async function getOwnedReel(userId: string, id: string): Promise<ReelRow> {
  const r = await prisma.shortsReel.findFirst({ where: { id, userId }, include: { brand: { select: { name: true } } } });
  if (!r) throw notFound("Reel not found");
  return r;
}

function storedScript(r: { script: Prisma.JsonValue | null }): StoredScript | null {
  if (!r.script) return null;
  const parsed = reelStudioScriptSchema.safeParse(r.script);
  if (!parsed.success) return null;
  // zod strips `resolved`; put it back from the raw JSON.
  const raw = (r.script as { scenes?: { id?: string; resolved?: ReelResolvedVisual | null }[] }).scenes ?? [];
  const byId = new Map(raw.map((s) => [s.id, s.resolved ?? null]));
  return { ...parsed.data, scenes: parsed.data.scenes.map((s) => ({ ...s, resolved: byId.get(s.id) ?? null })) };
}

function settingsOf(r: { settings: Prisma.JsonValue }): ReelSettings {
  const p = reelSettingsSchema.safeParse(r.settings ?? {});
  return p.success ? p.data : defaultReelSettings();
}

interface BrandBundle {
  context: ReelBrandContext;
  profile: BrandProfile;
  products: { url: string; label: string }[];
  logoUrl: string | null;
  headingFontUrl: string | null;
  bodyFontUrl: string | null;
}

async function loadBrandBundle(userId: string, brandId: string, productUrl: string | null): Promise<BrandBundle> {
  const brand = await findAccessibleBrand(userId, brandId);
  const parsed = brandProfileSchema.safeParse(brand.profile ?? {});
  const profile: BrandProfile = parsed.success ? parsed.data : {};
  const kit = await loadBrandKit(brand.id);
  const products = brand.assets.filter((a) => a.kind === "product").map((a, i) => ({ url: a.url, label: a.label?.trim() || `Product photo ${i + 1}` }));
  const featured = productUrl ? products.findIndex((p) => p.url === productUrl) : -1;
  return {
    profile,
    products,
    logoUrl: kit?.logoUrl ?? brand.assets.find((a) => a.kind === "logo")?.url ?? null,
    headingFontUrl: kit?.headingFontUrl ?? null,
    bodyFontUrl: kit?.bodyFontUrl ?? null,
    context: {
      name: brand.name,
      category: brand.category,
      summary: (brand.summary || profile.description || "").slice(0, 2500),
      tagline: profile.tagline,
      tone: [profile.tone, profile.brandPersonality].filter(Boolean).join(". ") || undefined,
      offer: profile.offer,
      defaultCta: profile.defaultCta,
      customers: profile.customers,
      differentiator: profile.differentiator ?? profile.competitiveAdvantage,
      visualStyle: [profile.visualStyle, profile.photographyStyle].filter(Boolean).join(". ") || undefined,
      colors: profile.colors ?? [],
      requiredPhrases: profile.requiredPhrases ?? [],
      forbiddenWords: profile.forbiddenWords ?? [],
      forbiddenClaims: profile.forbiddenClaims ?? [],
      products: products.map((p, index) => ({ index, label: p.label })),
      featuredProduct: featured >= 0 ? featured : null,
    },
  };
}

/* --------------------------------- script -------------------------------- */

interface LlmLogEntry {
  at: string;
  kind: string;
  provider: string;
  problems: string[];
  raw: string;
}

function configToHttp(err: unknown): never {
  if (err instanceof ShortsConfigError) throw new HttpError(503, err.message, "NOT_CONFIGURED");
  if (err instanceof PermanentJobError) throw new HttpError(502, err.message, "AI_FAILED");
  throw err;
}

async function writeScript(input: {
  mode: ReelMode;
  reelType: ReelType | null;
  topic: string;
  durationSec: number;
  language: string;
  brand: BrandBundle | null;
  instructions?: string;
  /** Called after every model call (for cost tracking). */
  onCall?: (provider: string) => Promise<void>;
}): Promise<{ script: ReelStudioScript; decisions: ReelDecisions; log: LlmLogEntry[] }> {
  const logEntries: LlmLogEntry[] = [];
  let problems: string[] | undefined;
  const productUrls = input.brand?.products.map((p) => p.url) ?? [];
  for (let attempt = 1; attempt <= 3; attempt++) {
    const prompt = buildReelScriptPrompt({ ...input, brand: input.brand?.context ?? null, problems });
    const r = await reelJson({ ...prompt, schema: REEL_SCRIPT_JSON_SCHEMA as unknown as Record<string, unknown> });
    await input.onCall?.(r.provider);
    const n = normalizeScript(r.parsed, input.durationSec, productUrls, newId);
    let found = n.ok ? [] : n.problems;
    if (n.ok && input.brand) found = forbiddenHits(n.script, input.brand.context.forbiddenWords, input.brand.context.forbiddenClaims);
    logEntries.push({ at: new Date().toISOString(), kind: "script", provider: r.provider, problems: found, raw: r.raw.slice(0, 6000) });
    if (n.ok && !found.length) return { script: n.script, decisions: n.decisions, log: logEntries };
    problems = found;
  }
  throw new HttpError(502, `The AI could not write a usable script: ${problems?.join("; ")}`, "AI_FAILED");
}

/* ------------------------------ cost tracking ------------------------------ */

const COST_LOG_CAP = 200;

/**
 * Records one paid call against the reel (list price x actual usage), right
 * away, so spend is tracked even when a later step fails.
 */
async function recordCost(reelId: string, run: number, label: string, usd: number): Promise<void> {
  if (!(usd > 0)) return;
  const amount = Math.round(usd * 10000) / 10000;
  try {
    const row = await prisma.shortsReel.findUnique({ where: { id: reelId }, select: { costLog: true } });
    if (!row) return;
    const prev = Array.isArray(row.costLog) ? (row.costLog as unknown as ReelCostEntry[]) : [];
    const entry: ReelCostEntry = { at: new Date().toISOString(), run, label, usd: amount };
    await prisma.shortsReel.update({
      where: { id: reelId },
      data: { costUsd: { increment: amount }, costLog: [...prev, entry].slice(-COST_LOG_CAP) as unknown as Prisma.InputJsonValue },
    });
  } catch (err) {
    log.warn("reel.cost_record_failed", { reelId, label, error: String(err).slice(0, 200) });
  }
}

const scriptCallLabel = (provider: string) => `AI script (${provider.split(":")[0]})`;

/** Applies the model's production decisions to the settings the owner left on "auto". */
function applyDecisions(settings: ReelSettings, d: ReelDecisions): ReelSettings {
  const next = { ...settings };
  if (settings.autoTemplate && d.style) next.template = d.style;
  if (settings.autoVoice) {
    if (d.voiceGender) next.voiceGender = d.voiceGender;
    if (d.voiceTone) next.voiceStyle = d.voiceTone.slice(0, 200);
  }
  if (d.musicMood) next.musicMood = d.musicMood;
  return next;
}

export async function createReel(userId: string, body: CreateReelRequest): Promise<ReelDetailDto> {
  let brand: BrandBundle | null = null;
  if (body.mode === "brand") {
    brand = await loadBrandBundle(userId, body.brandId!, body.productUrl ?? null);
    if (body.productUrl && brand.context.featuredProduct === null) throw new HttpError(400, "That product photo doesn't belong to this brand");
  }
  // An explicit voice in the settings (older clients) counts as a choice, not "auto".
  const voicePref = body.voice === "auto" && body.settings?.voiceGender ? body.settings.voiceGender : body.voice;
  const settings = reelSettingsSchema.parse({
    ...defaultReelSettings(),
    // Brand reels open with the logo; general reels start straight on the hook.
    intro: body.mode === "brand",
    showLogo: body.mode === "brand",
    ...(body.settings ?? {}),
    ...(body.style === "auto" ? { autoTemplate: true } : { template: body.style, autoTemplate: false }),
    ...(voicePref === "auto" ? { autoVoice: true } : { voiceGender: voicePref, autoVoice: false }),
  });
  // Brand reels without a chosen type: the AI picks the type from the brief.
  const reelType = body.mode === "brand" ? (body.reelType ?? null) : null;
  const base = {
    userId,
    mode: body.mode,
    brandId: body.mode === "brand" ? body.brandId! : null,
    reelType,
    topic: body.topic,
    durationSec: body.durationSec,
    language: body.language,
    productUrl: body.productUrl ?? null,
  };

  if (body.autoRender) {
    // One click: everything (script, scene plan, visuals, voice, subtitles, music, edit, render)
    // runs as one background job; the page follows its real progress.
    await assertCanRender(settings, true);
    const row = await prisma.shortsReel.create({
      data: {
        ...base,
        title: placeholderTitle(body.topic, brand?.context.name ?? null),
        settings: settings as unknown as Prisma.InputJsonValue,
        status: "draft",
        stage: "Understanding your prompt",
      },
    });
    return startRender(userId, row.id);
  }

  // "Script only" (API): write the script now and stop for editing.
  const calls: string[] = [];
  let result: Awaited<ReturnType<typeof writeScript>>;
  try {
    result = await writeScript({
      mode: body.mode,
      reelType,
      topic: body.topic,
      durationSec: body.durationSec,
      language: body.language,
      brand,
      onCall: async (p) => void calls.push(p),
    });
  } catch (err) {
    configToHttp(err);
  }
  const row = await prisma.shortsReel.create({
    data: {
      ...base,
      reelType: reelType ?? (body.mode === "brand" ? (result.decisions.reelType ?? "product_promo") : null),
      title: result.script.title,
      script: result.script as unknown as Prisma.InputJsonValue,
      settings: applyDecisions(settings, result.decisions) as unknown as Prisma.InputJsonValue,
      status: "script_ready",
      llmLog: result.log as unknown as Prisma.InputJsonValue,
    },
  });
  for (const p of calls) await recordCost(row.id, 0, scriptCallLabel(p), REEL_COST_RATES.scriptUsd);
  return getReelDetail(userId, row.id);
}

function placeholderTitle(topic: string, brandName: string | null): string {
  const t = topic.trim().replace(/\s+/g, " ");
  if (t) return t.length > 80 ? `${t.slice(0, 77)}…` : t;
  return brandName ? `${brandName} reel` : "New reel";
}

/** Fails fast (before anything is queued or spent) when the server can't produce a reel. */
async function assertCanRender(settings: ReelSettings, needScript: boolean): Promise<void> {
  if (needScript && !scriptProvider()) {
    throw new HttpError(503, "No AI writer configured (ANTHROPIC_API_KEY + ANTHROPIC_MODEL, OPENAI_API_KEY or GOOGLE_AI_API_KEY)", "NOT_CONFIGURED");
  }
  const health = await shortsHealth();
  if (!health.features.ffmpeg) throw new HttpError(503, "ffmpeg/ffprobe are not installed on the server", "NOT_CONFIGURED");
  if (settings.voiceEnabled && !pickVoiceProvider(settings.voiceProvider)) {
    throw new HttpError(503, "No voice provider configured (ELEVENLABS_API_KEY or OPENAI_API_KEY). Turn the voiceover off or configure one.", "NOT_CONFIGURED");
  }
}

/**
 * "Regenerate": a fresh take on the same brief. The script is dropped and the
 * background job writes a new one (optionally steered), then visuals, voice,
 * subtitles and the edit are redone. Shared stock downloads stay cached.
 */
export async function regenerateReel(userId: string, id: string, instructions: string): Promise<ReelDetailDto> {
  const r = await getOwnedReel(userId, id);
  if (isBusy(r.status)) throw new HttpError(409, "This reel is already generating", "BUSY");
  if (r.mode === "brand" && !r.brandId) throw new HttpError(409, "The brand of this reel was deleted");
  await assertCanRender(settingsOf(r), true);
  await prisma.shortsReel.update({ where: { id }, data: { script: Prisma.DbNull, renderInfo: Prisma.DbNull } });
  return startRender(userId, id, { instructions });
}

/** "Regenerate script": a fresh script for the same brief (optionally with extra instructions). Visual uploads are dropped. */
export async function regenerateScript(userId: string, id: string, instructions: string): Promise<ReelDetailDto> {
  const r = await getOwnedReel(userId, id);
  if (isBusy(r.status)) throw new HttpError(409, "This reel is rendering; wait for it to finish", "BUSY");
  const brand = r.mode === "brand" && r.brandId ? await loadBrandBundle(userId, r.brandId, r.productUrl) : null;
  if (r.mode === "brand" && !brand) throw new HttpError(409, "The brand of this reel was deleted");
  let result: Awaited<ReturnType<typeof writeScript>>;
  try {
    result = await writeScript({
      mode: r.mode as ReelMode,
      reelType: r.reelType as ReelType | null,
      topic: r.topic,
      durationSec: r.durationSec,
      language: r.language,
      brand,
      instructions,
      onCall: (p) => recordCost(id, r.renderCount, scriptCallLabel(p), REEL_COST_RATES.scriptUsd),
    });
  } catch (err) {
    configToHttp(err);
  }
  await prisma.shortsReel.update({
    where: { id },
    data: {
      script: result.script as unknown as Prisma.InputJsonValue,
      title: result.script.title,
      status: r.status === "completed" ? "completed" : "script_ready",
      error: null,
      llmLog: [...((r.llmLog as unknown as LlmLogEntry[] | null) ?? []), ...result.log].slice(-12) as unknown as Prisma.InputJsonValue,
    },
  });
  return getReelDetail(userId, id);
}

/** Rewrites one scene's text and/or asks for a new visual on the next render. */
export async function regenerateScene(userId: string, id: string, sceneId: string, input: { instructions: string; part: "text" | "visual" | "both" }): Promise<ReelDetailDto> {
  const r = await getOwnedReel(userId, id);
  if (isBusy(r.status)) throw new HttpError(409, "This reel is rendering; wait for it to finish", "BUSY");
  const script = storedScript(r);
  if (!script) throw new HttpError(409, "This reel has no script yet");
  const idx = script.scenes.findIndex((s) => s.id === sceneId);
  if (idx < 0) throw notFound("Scene not found");
  const scene = script.scenes[idx]!;

  if (input.part === "text" || input.part === "both") {
    const brand = r.mode === "brand" && r.brandId ? await loadBrandBundle(userId, r.brandId, r.productUrl) : null;
    const prompt = buildScenePrompt({
      mode: r.mode as ReelMode,
      reelType: r.reelType as ReelType | null,
      topic: r.topic,
      durationSec: r.durationSec,
      language: r.language,
      brand: brand?.context ?? null,
      instructions: input.instructions,
      script,
      sceneIndex: idx,
    });
    let raw: unknown;
    try {
      const res = await reelJson({ ...prompt, schema: REEL_SCENE_JSON_SCHEMA as unknown as Record<string, unknown>, temperature: 0.9 });
      await recordCost(id, r.renderCount, `AI scene rewrite (${res.provider.split(":")[0]})`, REEL_COST_RATES.scriptUsd / 2);
      raw = res.parsed;
    } catch (err) {
      configToHttp(err);
    }
    const sceneRaw = (raw as { scene?: unknown } | null)?.scene ?? raw;
    if (!sceneRaw || typeof sceneRaw !== "object") throw new HttpError(502, "The AI returned no scene; try again", "AI_FAILED");
    const fresh = normalizeScene(sceneRaw as never, scene.id, scene.durationSec, brand?.products.map((p) => p.url) ?? []);
    if (!fresh.narration && !fresh.onScreenText) throw new HttpError(502, "The AI returned an empty scene; try again", "AI_FAILED");
    // New words make an old subtitle override stale, so it is dropped.
    script.scenes[idx] = input.part === "both" ? { ...fresh, resolved: null } : { ...scene, narration: fresh.narration, onScreenText: fresh.onScreenText, captionText: null };
  }
  if (input.part === "visual" || input.part === "both") {
    const s = script.scenes[idx]!;
    const prev = scene.resolved;
    const exclude = new Set(s.visual.exclude);
    if (prev?.providerId) exclude.add(`${prev.provider}:${prev.providerId}`);
    // A new key forces a new pick; AI sources get a fresh generation.
    exclude.add(`regen:${Date.now().toString(36)}`);
    script.scenes[idx] = { ...s, visual: { ...s.visual, exclude: [...exclude].slice(-40) } };
  }
  await saveScript(id, script);
  return getReelDetail(userId, id);
}

async function saveScript(id: string, script: StoredScript, extra: Prisma.ShortsReelUpdateInput = {}) {
  await prisma.shortsReel.update({ where: { id }, data: { script: script as unknown as Prisma.InputJsonValue, ...extra } });
}

export async function updateReel(userId: string, id: string, body: UpdateReelRequest): Promise<ReelDetailDto> {
  const r = await getOwnedReel(userId, id);
  if (isBusy(r.status)) throw new HttpError(409, "This reel is rendering; wait for it to finish", "BUSY");
  const data: Prisma.ShortsReelUpdateInput = {};
  if (body.title) data.title = body.title;
  if (body.durationSec) data.durationSec = body.durationSec;
  if (body.language) data.language = body.language;
  if (body.settings) data.settings = body.settings as unknown as Prisma.InputJsonValue;
  if (body.script) {
    const old = storedScript(r);
    const resolvedById = new Map((old?.scenes ?? []).map((s) => [s.id, s.resolved ?? null]));
    const ids = new Set<string>();
    const scenes: StoredScene[] = body.script.scenes.map((s) => {
      const sid = ids.has(s.id) ? newId() : s.id;
      ids.add(sid);
      // Uploads can only be set by the upload endpoint (a client can't point at arbitrary files).
      const oldScene = old?.scenes.find((o) => o.id === sid);
      const uploadFile = oldScene?.visual.uploadFile ?? null;
      return { ...s, id: sid, visual: { ...s.visual, uploadFile }, resolved: resolvedById.get(sid) ?? null };
    });
    data.script = { ...body.script, scenes } as unknown as Prisma.InputJsonValue;
    if (!body.title) data.title = body.script.title;
  }
  if (r.status === "failed" || r.status === "draft") data.status = "script_ready";
  await prisma.shortsReel.update({ where: { id }, data });
  return getReelDetail(userId, id);
}

const UPLOAD_IMAGE = /\.(jpe?g|png|webp)$/i;
const UPLOAD_VIDEO = /\.(mp4|mov|webm|m4v)$/i;

/** Saves an uploaded image/video as a scene's visual. The caller streams the file to `tmpPath` first. */
export async function setSceneUpload(userId: string, id: string, sceneId: string, tmpPath: string, originalName: string): Promise<ReelDetailDto> {
  const r = await getOwnedReel(userId, id);
  if (isBusy(r.status)) throw new HttpError(409, "This reel is rendering; wait for it to finish", "BUSY");
  const script = storedScript(r);
  const idx = script?.scenes.findIndex((s) => s.id === sceneId) ?? -1;
  if (!script || idx < 0) throw notFound("Scene not found");
  const ext = path.extname(originalName).toLowerCase();
  if (!UPLOAD_IMAGE.test(ext) && !UPLOAD_VIDEO.test(ext)) throw new HttpError(400, "Upload a JPG, PNG, WebP image or an MP4/MOV/WebM video");
  const dir = await ensureDir(path.join(paths.reelDir(id), "uploads"));
  const name = `${sceneId}-${newId()}${ext}`;
  const dest = path.join(dir, name);
  await copyFile(tmpPath, dest);
  try {
    // Probe the file: images and videos both open in ffprobe; garbage doesn't.
    if (UPLOAD_VIDEO.test(ext)) await videoInfo(dest);
    else {
      const p = await ffmpeg(["-v", "error", "-i", dest, "-frames:v", "1", "-f", "null", "-"]);
      if (p.code !== 0) throw new Error("not an image");
    }
  } catch {
    await rm(dest, { force: true });
    throw new HttpError(400, "That file could not be read as an image or video");
  }
  const s = script.scenes[idx]!;
  script.scenes[idx] = { ...s, visual: { ...s.visual, source: "upload", uploadFile: `uploads/${name}` } };
  await saveScript(id, script, r.status === "failed" ? { status: "script_ready" } : {});
  return getReelDetail(userId, id);
}

/**
 * Queues the one background job that produces the reel. Without a script
 * (one-click generate, regenerate, or a failure before the script) the job
 * writes it first; with one, it renders what the owner edited.
 */
export async function startRender(userId: string, id: string, opts: { instructions?: string } = {}): Promise<ReelDetailDto> {
  const r = await getOwnedReel(userId, id);
  if (isBusy(r.status)) throw new HttpError(409, "This reel is already rendering", "BUSY");
  const hasScript = !!storedScript(r);
  await assertCanRender(settingsOf(r), !hasScript);
  const round = r.renderCount + 1;
  const moved = await prisma.shortsReel.updateMany({
    where: { id, status: { notIn: [...REEL_BUSY_STATUSES] } },
    data: { status: "queued", stage: hasScript ? "Waiting for a worker" : "Understanding your prompt", progress: 0, error: null, warnings: [], renderCount: round },
  });
  if (!moved.count) throw new HttpError(409, "This reel is already rendering", "BUSY");
  await enqueueJob({
    type: JOB_TYPE,
    key: `${JOB_TYPE}:${id}:${round}`,
    payload: { reelId: id, ...(opts.instructions?.trim() ? { instructions: opts.instructions.trim().slice(0, 600) } : {}) },
    maxAttempts: 2,
  });
  return getReelDetail(userId, id);
}

export async function deleteReel(userId: string, id: string): Promise<void> {
  const r = await getOwnedReel(userId, id);
  await prisma.shortsReel.delete({ where: { id: r.id } });
  await rm(paths.reelDir(r.id), { recursive: true, force: true });
}

/* ---------------------------------- DTOs ---------------------------------- */

function fileName(p: string | null): string | null {
  return p ? path.basename(p) : null;
}

function toDto(r: ReelRow): ReelDto {
  const done = r.status === "completed" && r.filePath;
  const vid = fileName(r.filePath);
  const thumb = fileName(r.thumbPath);
  return {
    id: r.id,
    mode: r.mode as ReelMode,
    reelType: (REEL_TYPES as readonly string[]).includes(r.reelType ?? "") ? (r.reelType as ReelType) : null,
    brandId: r.brandId,
    brandName: r.brand?.name ?? null,
    topic: r.topic,
    title: r.title,
    durationSec: r.durationSec,
    language: r.language as ReelDto["language"],
    status: r.status as ReelStatus,
    stage: r.stage,
    progress: r.progress,
    error: r.error,
    warnings: Array.isArray(r.warnings) ? (r.warnings as string[]) : [],
    videoDurationSec: r.videoDurationSec,
    fileSizeBytes: r.fileSizeBytes,
    width: r.width,
    height: r.height,
    fileUrl: done && vid ? signedReelFileUrl(r.id, vid) : null,
    downloadUrl: done && vid ? signedReelFileUrl(r.id, vid, { download: true }) : null,
    thumbUrl: thumb ? signedReelFileUrl(r.id, thumb) : null,
    renderCount: r.renderCount,
    costUsd: Math.round((r.costUsd ?? 0) * 10000) / 10000,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    completedAt: r.completedAt?.toISOString() ?? null,
  };
}

/** What the next render will cost: only scenes whose voice or visual isn't cached from the last render. */
async function reelEstimate(r: ReelRow, script: StoredScript | null, settings: ReelSettings): Promise<ReelCostEstimate> {
  const info = new Map(((r.renderInfo as unknown as RenderScene[] | null) ?? []).map((x) => [x.id, x]));
  const size = reelSize(settings.resolution);
  return estimateReelCost({
    scenes: (script?.scenes ?? []).map((sc) => {
      const text = sc.narration.trim();
      const prev = info.get(sc.id);
      return {
        narrationChars: text.length,
        source: sc.visual.source,
        durationSec: sc.durationSec,
        cachedVisual: !!sc.resolved && sc.resolved.key === sceneVisualKey(sc, settings, size),
        cachedVoice: !text || (!!prev?.voiceKey && prev.voiceKey === voiceKeyOf(text, settings, r.language)),
      };
    }),
    settings,
    features: {
      stockVideo: stockVideoConfigured(),
      stockImage: stockImagesConfigured(),
      aiImage: aiImageConfigured(),
      aiVideo: aiClipsConfigured(),
      elevenlabs: elevenConfigured(),
      openai: openaiTtsConfigured(),
    },
    includeScript: false,
    aiVideoPerSecUsd: settings.allowAiVideo ? await reelClipPriceUsd(r.userId) : null,
  });
}

export async function getReelDetail(userId: string, id: string): Promise<ReelDetailDto> {
  const r = await getOwnedReel(userId, id);
  const script = storedScript(r);
  const settings = settingsOf(r);
  const info = (r.renderInfo as unknown as RenderScene[] | null) ?? [];
  const secs = new Map(info.map((x) => [x.id, x.sec]));
  return {
    ...toDto(r),
    productUrl: r.productUrl,
    settings,
    costLog: Array.isArray(r.costLog) ? (r.costLog as unknown as ReelCostEntry[]) : [],
    estimate: await reelEstimate(r, script, settings),
    script: script
      ? {
          ...script,
          scenes: script.scenes.map(({ resolved, ...s }) => ({
            ...s,
            resolved: resolved
              ? (({ file, ...rest }) => ({ ...rest, previewUrl: signedReelFileUrl(r.id, file) }))(resolved)
              : null,
            renderedSec: secs.get(s.id) ?? null,
          })),
        }
      : null,
  };
}

export async function listReels(userId: string, q: { mode?: ReelMode; status?: string }): Promise<ReelDto[]> {
  const statusFilter =
    q.status === "processing" ? { in: ["queued", "rendering"] } : q.status === "completed" ? "completed" : q.status === "failed" ? "failed" : q.status === "draft" ? { in: ["draft", "script_ready"] } : undefined;
  const rows = await prisma.shortsReel.findMany({
    where: { userId, ...(q.mode ? { mode: q.mode } : {}), ...(statusFilter ? { status: statusFilter } : {}) },
    include: { brand: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return rows.map(toDto);
}

export async function reelOptions(userId: string): Promise<ReelOptionsDto> {
  const health = await shortsHealth();
  return {
    languages: REEL_LANGUAGES.map((l) => ({ code: l.code, label: l.label })),
    durations: [...REEL_DURATIONS],
    reelTypes: REEL_TYPES.map((k) => ({ key: k, label: REEL_TYPE_LABELS[k].label })),
    templates: (Object.keys(REEL_TEMPLATES) as (keyof typeof REEL_TEMPLATES)[]).map((k) => ({ key: k, label: REEL_TEMPLATES[k].label })),
    music: (await listReelMusic(userId)).map((m) => ({ ...m, url: signedMusicUrl(userId, m.key) })),
    features: {
      script: scriptProvider() !== null,
      scriptProvider: scriptProvider(),
      voice: { elevenlabs: elevenConfigured(), openai: openaiTtsConfigured() },
      stockVideo: stockVideoConfigured(),
      stockImage: stockImagesConfigured(),
      aiImage: aiImageConfigured(),
      aiVideo: aiClipsConfigured(),
      ffmpeg: health.features.ffmpeg,
    },
    aiVideoPerSecUsd: await reelClipPriceUsd(userId),
  };
}

/* --------------------------------- render --------------------------------- */

async function setProgress(id: string, stage: string, progress: number) {
  await prisma.shortsReel.update({ where: { id }, data: { stage, progress: Math.max(0, Math.min(100, Math.round(progress))) } }).catch(() => {});
}

interface RenderCtx {
  reel: ReelRow;
  dir: string;
  settings: ReelSettings;
  brand: BrandBundle | null;
  theme: CardTheme;
  size: { w: number; h: number };
  warnings: string[];
  usedStock: Set<string>;
}

/**
 * Stock files are kept in a shared cache by provider + id, so a clip or photo
 * used by several reels (or re-renders) is downloaded once.
 */
async function cachedStock(provider: string, id: string, url: string, ext: string, dest: string): Promise<void> {
  const dir = await ensureDir(path.join(storageRoot(), "_stock-cache"));
  const cached = path.join(dir, `${provider}-${id.replace(/[^\w-]/g, "")}${ext}`);
  if (!(await exists(cached))) {
    const tmp = `${cached}.${newId()}.dl`;
    try {
      await downloadStock(url, tmp);
      await rename(tmp, cached);
    } finally {
      await rm(tmp, { force: true });
    }
  }
  await copyFile(cached, dest);
}

async function downloadOwn(url: string, dest: string): Promise<void> {
  await writeFile(dest, await fetchOwnBytes(url));
}

const extOf = (url: string, fallback: string) => {
  const e = path.extname(new URL(url).pathname).toLowerCase();
  return /^\.(jpe?g|png|webp)$/.test(e) ? e : fallback;
};

/** Makes one concrete source for a scene; throws when it can't (the caller tries the next). */
async function makeVisual(ctx: RenderCtx, scene: StoredScene, idx: number, src: ConcreteSource, key: string, sceneSec: number): Promise<ReelResolvedVisual> {
  const base = { key, source: src, providerId: null, sourceUrl: null, license: null, author: null, note: null } as const;
  const stem = `vis-${scene.id}-${key}`;
  const v = scene.visual;
  const query = v.query || v.prompt.split(/\s+/).slice(0, 5).join(" ");
  switch (src) {
    case "brand_image": {
      // Only the product this scene is about (chosen by the script), or the reel's featured product.
      // Never an arbitrary photo from the brand's library: every visual must match its scene.
      const url = v.assetUrl ?? ctx.reel.productUrl;
      if (!url) throw new Error("no product photo chosen for this scene");
      const file = `${stem}${extOf(url, ".jpg")}`;
      await downloadOwn(url, path.join(ctx.dir, file));
      return { ...base, kind: "image", file, provider: "brand", sourceUrl: null, note: "Brand product photo" };
    }
    case "stock_video": {
      const exclude = new Set([...v.exclude, ...ctx.usedStock]);
      const queries = [...new Set([query, query.split(/\s+/).slice(0, 2).join(" ")].filter(Boolean))];
      for (const q of queries) {
        const pick = pickStockVideo(await searchStock(q), sceneSec, exclude);
        if (!pick) continue;
        const file = `${stem}.mp4`;
        await cachedStock(pick.provider, pick.id, pick.downloadUrl, ".mp4", path.join(ctx.dir, file));
        ctx.usedStock.add(keyOf(pick));
        return { ...base, kind: "video", file, provider: pick.provider, providerId: pick.id, sourceUrl: pick.pageUrl, license: pick.license, author: pick.author, note: `Stock video for "${q}"` };
      }
      throw new Error(`no fitting stock video for "${query}"`);
    }
    case "stock_image": {
      const exclude = new Set([...v.exclude, ...ctx.usedStock]);
      const queries = [...new Set([query, query.split(/\s+/).slice(0, 2).join(" ")].filter(Boolean))];
      for (const q of queries) {
        const pick = pickStockImage(await searchStockImages(q), exclude);
        if (!pick) continue;
        const file = `${stem}.jpg`;
        await cachedStock(pick.provider, `img-${pick.id}`, pick.downloadUrl, ".jpg", path.join(ctx.dir, file));
        ctx.usedStock.add(`${pick.provider}:${pick.id}`);
        return { ...base, kind: "image", file, provider: pick.provider, providerId: pick.id, sourceUrl: pick.pageUrl, license: pick.license, author: pick.author, note: `Stock photo for "${q}"` };
      }
      throw new Error(`no fitting stock photo for "${query}"`);
    }
    case "ai_image": {
      const file = `${stem}.png`;
      const brandStyle = ctx.brand
        ? ` Style for the brand ${ctx.brand.context.name}${ctx.brand.context.visualStyle ? `: ${ctx.brand.context.visualStyle}` : ""}${ctx.brand.context.colors.length ? `; colour accents ${ctx.brand.context.colors.join(", ")}` : ""}.`
        : "";
      const prompt = `${v.prompt || query}.${brandStyle}`;
      // The featured product goes in as a reference when the scene is about it, so the AI keeps it accurate.
      const refs =
        ctx.reel.productUrl && /product|bottle|pack|box|item|device|dish|outfit|shoe|bag/i.test(prompt) ? [ctx.reel.productUrl] : [];
      const r = await generateAiImage(prompt, path.join(ctx.dir, file), refs);
      await recordCost(ctx.reel.id, ctx.reel.renderCount, `AI image (scene ${idx + 1})`, REEL_COST_RATES.aiImageUsd);
      return { ...base, kind: "image", file, provider: r.provider, license: "AI-generated image", note: "AI image" };
    }
    case "ai_video": {
      const file = `${stem}.mp4`;
      const r = await generateReelClip({ userId: ctx.reel.userId, reelId: ctx.reel.id, sceneId: scene.id, prompt: v.prompt || query, seconds: sceneSec, dest: path.join(ctx.dir, file) });
      const perSec = (await reelClipPriceUsd(ctx.reel.userId)) ?? REEL_COST_RATES.aiVideoPerSecUsdDefault;
      await recordCost(ctx.reel.id, ctx.reel.renderCount, `AI video clip (scene ${idx + 1}, ${Math.round(sceneSec)} s)`, perSec * sceneSec);
      return { ...base, kind: "video", file, provider: r.provider, license: r.license, note: `AI clip (${r.model})` };
    }
    case "upload": {
      if (!v.uploadFile) throw new Error("no upload");
      const kind = UPLOAD_VIDEO.test(v.uploadFile) ? "video" : "image";
      return { ...base, kind, file: v.uploadFile, provider: "upload", note: "Your upload" };
    }
    case "graphic": {
      const file = `${stem}.png`;
      // With the logo watermark on, the card leaves the logo out (it would show twice).
      const theme = ctx.settings.showLogo ? { ...ctx.theme, logo: null } : ctx.theme;
      await graphicCard(scene.onScreenText, scene.onScreenText ? "" : scene.narration.slice(0, 140), theme, ctx.size, path.join(ctx.dir, file));
      return { ...base, kind: "image", file, provider: "graphic", note: "Brand graphic card" };
    }
  }
}

function sceneVisualKey(scene: StoredScene, s: ReelSettings, size: { w: number }): string {
  const extra = scene.visual.source === "auto" ? `${s.allowAiImages}${s.allowAiVideo}${s.preferAi}` : "";
  return visualKey(scene.visual, `${extra}${size.w}`);
}

/** A scene's visual search in progress: its fallback plan and how far down it we got. */
interface VisualJob {
  scene: StoredScene;
  idx: number;
  sec: number;
  key: string;
  plan: ConcreteSource[];
  next: number;
  failures: string[];
}

const isAi = (s: ConcreteSource) => s === "ai_image" || s === "ai_video";

function planVisual(ctx: RenderCtx, scene: StoredScene, idx: number, sec: number): VisualJob {
  const plan = visualPlan(
    scene.visual,
    ctx.settings,
    {
      stockVideo: stockVideoConfigured(),
      stockImage: stockImagesConfigured(),
      aiImage: aiImageConfigured(),
      aiVideo: aiClipsConfigured(),
      // A scene falls back to a brand photo only when the reel features a product.
      hasProducts: !!ctx.reel.productUrl,
    },
    ctx.reel.mode as ReelMode,
  );
  return { scene, idx, sec, key: sceneVisualKey(scene, ctx.settings, ctx.size), plan, next: 0, failures: [] };
}

/**
 * Walks a scene's plan from where it stopped. With `allowAi` false it stops
 * (returns null) at the first AI source, so free sources are tried for every
 * scene before any paid generation runs.
 */
async function advanceVisual(ctx: RenderCtx, job: VisualJob, allowAi: boolean): Promise<ReelResolvedVisual | null> {
  const { scene, idx } = job;
  for (; job.next < job.plan.length; job.next++) {
    const src = job.plan[job.next]!;
    if (!allowAi && isAi(src)) return null;
    try {
      const r = await makeVisual(ctx, scene, idx, src, job.key, job.sec);
      if (scene.visual.source !== "auto" && src !== scene.visual.source) {
        ctx.warnings.push(`Scene ${idx + 1}: ${scene.visual.source.replace("_", " ")} wasn't available (${job.failures[0] ?? "not configured"}), used ${src.replace("_", " ")} instead.`);
      } else if (src === "graphic" && job.failures.length) {
        ctx.warnings.push(`Scene ${idx + 1}: no matching photo or footage (${job.failures.join("; ")}), used a brand graphic card.`);
      }
      return r;
    } catch (err) {
      if (err instanceof ShortsConfigError && src === scene.visual.source) job.failures.push(err.message);
      else job.failures.push(err instanceof Error ? err.message.slice(0, 160) : String(err));
      log.warn("reel.visual_failed", { reelId: ctx.reel.id, scene: scene.id, source: src, error: job.failures[job.failures.length - 1] });
    }
  }
  throw new Error(`Scene ${idx + 1}: no visual could be made (${job.failures.join("; ")})`);
}

function voiceKeyOf(text: string, s: ReelSettings, language: string): string {
  return visualKey({ source: "auto", query: text, prompt: `${s.voiceGender}|${s.voiceProvider}|${s.voiceId}|${s.voiceStyle}|${language}`, assetUrl: null, uploadFile: null, exclude: [] });
}

/**
 * Steps 1-3 of the autonomous job: understand the brief (brand identity or
 * topic), write the script, and plan the scenes plus the production decisions
 * (reel type, edit style, voice, music mood). Saved before anything else runs,
 * so a retry of a later step doesn't pay for a new script.
 */
async function writeScriptInJob(reel: ReelRow, instructions: string): Promise<ReelRow> {
  const id = reel.id;
  await prisma.shortsReel.update({ where: { id }, data: { status: "rendering", stage: reel.mode === "brand" ? "Reading the brand: identity, products, colours, offer" : "Understanding the topic", progress: 1 } });
  let brand: BrandBundle | null = null;
  if (reel.mode === "brand") {
    if (!reel.brandId) throw new PermanentJobError("The brand of this reel was deleted");
    try {
      brand = await loadBrandBundle(reel.userId, reel.brandId, reel.productUrl);
    } catch {
      throw new PermanentJobError("The brand of this reel could not be loaded");
    }
  }
  await setProgress(id, "Writing the hook, scenes, captions and call to action", reelStepProgress("script", 0, 1));
  let result: Awaited<ReturnType<typeof writeScript>>;
  try {
    result = await writeScript({
      mode: reel.mode as ReelMode,
      reelType: reel.reelType as ReelType | null,
      topic: reel.topic,
      durationSec: reel.durationSec,
      language: reel.language,
      brand,
      instructions,
      onCall: (p) => recordCost(id, reel.renderCount, scriptCallLabel(p), REEL_COST_RATES.scriptUsd),
    });
  } catch (err) {
    // A script the model can't get right after 3 tries won't improve on a job retry.
    if (err instanceof HttpError) throw new PermanentJobError(err.message);
    throw err;
  }
  await setProgress(id, `Planning ${result.script.scenes.length} scenes, visuals, voice and music`, reelStepProgress("plan", 0, 1));
  const settings = applyDecisions(settingsOf(reel), result.decisions);
  const reelType = reel.mode === "brand" ? ((reel.reelType as ReelType | null) ?? result.decisions.reelType ?? "product_promo") : null;
  return prisma.shortsReel.update({
    where: { id },
    data: {
      script: result.script as unknown as Prisma.InputJsonValue,
      title: result.script.title,
      reelType,
      settings: settings as unknown as Prisma.InputJsonValue,
      renderInfo: Prisma.DbNull,
      llmLog: [...((reel.llmLog as unknown as LlmLogEntry[] | null) ?? []), ...result.log].slice(-12) as unknown as Prisma.InputJsonValue,
      progress: Math.round(reelStepProgress("plan", 1, 1)),
    },
    include: { brand: { select: { name: true } } },
  });
}

export async function runReelRender(reelId: string, opts: { instructions?: string } = {}): Promise<void> {
  let reel = await prisma.shortsReel.findUnique({ where: { id: reelId }, include: { brand: { select: { name: true } } } });
  if (!reel || !isBusy(reel.status)) return;
  if (!storedScript(reel)) reel = await writeScriptInJob(reel, opts.instructions ?? "");
  const script = storedScript(reel);
  if (!script) throw new PermanentJobError("The reel has no valid script");
  await prisma.shortsReel.update({ where: { id: reelId }, data: { status: "rendering", stage: "Preparing", progress: Math.round(reelStepProgress("plan", 1, 1)) } });

  const settings = settingsOf(reel);
  const tpl = templateOf(settings.template);
  const size = reelSize(settings.resolution);
  const dir = await ensureDir(paths.reelDir(reelId));
  const brand = reel.mode === "brand" && reel.brandId ? await loadBrandBundle(reel.userId, reel.brandId, reel.productUrl).catch(() => null) : null;
  const warnings: string[] = [];
  if (reel.mode === "brand" && !brand) warnings.push("The brand could not be loaded; rendered without brand assets.");
  let logo: Buffer | null = null;
  if (brand?.logoUrl) logo = await fetchOwnBytes(brand.logoUrl).catch(() => null);
  const theme = await cardTheme({
    colors: brand?.context.colors ?? [],
    headingFontUrl: brand?.headingFontUrl ?? null,
    bodyFontUrl: brand?.bodyFontUrl ?? null,
    logo,
    brandName: brand?.context.name ?? null,
    seed: reel.topic || reel.id,
  });
  const ctx: RenderCtx = { reel, dir, settings, brand, theme, size, warnings, usedStock: new Set() };
  const lang = reelLanguage(reel.language);
  const T = tpl.transition === "cut" ? 0 : tpl.transitionSec;
  const voiceOffset = Math.max(VOICE_LEAD_SEC, T * 0.6);

  // 1. Voiceover per scene (cached by text + voice settings).
  const prevInfo = new Map(((reel.renderInfo as unknown as RenderScene[] | null) ?? []).map((x) => [x.id, x]));
  const info: RenderScene[] = [];
  const n = script.scenes.length;
  for (let i = 0; i < n; i++) {
    const sc = script.scenes[i]!;
    await setProgress(reelId, settings.voiceEnabled ? `Voiceover ${i + 1}/${n}` : "Voiceover off", reelStepProgress("voice", i, n));
    const text = sc.narration.trim();
    if (!settings.voiceEnabled || !text) {
      info.push({ id: sc.id, sec: sc.durationSec, voiceFile: null, voiceKey: null, voiceSec: null, words: null });
      continue;
    }
    const key = voiceKeyOf(text, settings, reel.language);
    const prev = prevInfo.get(sc.id);
    if (prev?.voiceKey === key && prev.voiceFile && prev.voiceSec && prev.words && (await exists(path.join(dir, prev.voiceFile)))) {
      info.push({ ...prev, sec: sc.durationSec });
      continue;
    }
    const voiceFile = `voice-${sc.id}-${key}.mp3`;
    const r = await synthesizeSpeech({
      text,
      dest: path.join(dir, voiceFile),
      gender: settings.voiceGender,
      provider: settings.voiceProvider,
      voiceId: settings.voiceId,
      speech: lang.speech,
      style: settings.voiceStyle,
    });
    info.push({ id: sc.id, sec: sc.durationSec, voiceFile, voiceKey: key, voiceSec: r.durationSec, words: r.words });
    const rate = r.provider === "elevenlabs" ? REEL_COST_RATES.elevenlabsPerCharUsd : REEL_COST_RATES.openaiTtsPerCharUsd;
    await recordCost(reelId, reel.renderCount, `Voiceover (${r.provider === "elevenlabs" ? "ElevenLabs" : "OpenAI TTS"}, scene ${i + 1})`, text.length * rate);
  }
  // Scene lengths: planned, stretched so the voice fits before the next transition.
  for (const x of info) {
    const need = x.voiceSec ? voiceOffset + x.voiceSec + VOICE_TAIL_SEC + T : 0;
    x.sec = +Math.max(x.sec, need, 1.5).toFixed(3);
  }

  // 2. Visuals, free sources first for every scene (brand photos, uploads, stock video, stock photos),
  //    then AI generation only for the scenes still without a fitting visual.
  const jobs: (VisualJob | null)[] = [];
  for (let i = 0; i < n; i++) {
    await setProgress(reelId, `Collecting stock visuals ${i + 1}/${n}`, reelStepProgress("stock", i, n));
    const sc = script.scenes[i]!;
    const key = sceneVisualKey(sc, settings, size);
    if (sc.resolved?.key === key && (await exists(path.join(dir, sc.resolved.file)))) {
      if (sc.resolved.providerId) ctx.usedStock.add(`${sc.resolved.provider}:${sc.resolved.providerId}`);
      jobs.push(null);
      continue;
    }
    const job = planVisual(ctx, sc, i, info[i]!.sec);
    const got = await advanceVisual(ctx, job, false);
    if (got) {
      sc.resolved = got;
      await saveScript(reelId, script); // keep progress: a retry reuses what was found
      jobs.push(null);
    } else jobs.push(job);
  }
  const aiJobs = jobs.filter((j): j is VisualJob => j !== null);
  if (!aiJobs.length) await setProgress(reelId, "No AI images needed", reelStepProgress("ai", 1, 1));
  for (let k = 0; k < aiJobs.length; k++) {
    const job = aiJobs[k]!;
    await setProgress(reelId, `Generating AI image ${k + 1}/${aiJobs.length} (scene ${job.idx + 1})`, reelStepProgress("ai", k, aiJobs.length));
    script.scenes[job.idx]!.resolved = (await advanceVisual(ctx, job, true))!;
    await saveScript(reelId, script);
  }

  // 3. Timeline: intro card, scenes, outro card.
  interface Seg { input: Omit<SegmentInput, "out" | "size" | "zoom">; sceneIdx: number | null }
  const segs: Seg[] = [];
  if (settings.intro) segs.push({ input: { kind: "image", file: "intro.png", lengthSec: INTRO_SEC, fit: false, overlay: null, motion: 1 }, sceneIdx: null });
  for (let i = 0; i < n; i++) {
    const res = script.scenes[i]!.resolved!;
    const fit = res.source === "brand_image" || (res.source === "upload" && res.kind === "image");
    segs.push({ input: { kind: res.kind, file: res.file, lengthSec: info[i]!.sec, fit, overlay: null, motion: i }, sceneIdx: i });
  }
  if (settings.outro) segs.push({ input: { kind: "image", file: "outro.png", lengthSec: OUTRO_SEC, fit: false, overlay: null, motion: 0 }, sceneIdx: null });
  const timeline = buildTimeline(segs.map((s) => s.input.lengthSec), T);

  // 4. Voice placement and subtitles (word-synced; per-scene text overrides and timing shifts).
  await setProgress(reelId, settings.subtitles.enabled ? "Timing subtitles" : "Subtitles off", reelStepProgress("subtitles", 0, 1));
  const voices: { file: string; atSec: number }[] = [];
  const words: (WordTiming & { em?: boolean })[] = [];
  segs.forEach((seg, si) => {
    if (seg.sceneIdx === null) return;
    const x = info[seg.sceneIdx]!;
    const sc = script.scenes[seg.sceneIdx]!;
    const at = timeline.starts[si]! + (si === 0 ? VOICE_LEAD_SEC : voiceOffset);
    if (x.voiceFile && x.words) voices.push({ file: x.voiceFile, atSec: at });
    if (!settings.subtitles.enabled) return;
    const shift = settings.subtitles.offsetSec + sc.captionOffsetSec;
    const override = sc.captionText?.trim();
    let local: WordTiming[];
    if (override) local = approxWordTimings(override, x.voiceSec ?? Math.max(1, x.sec - T - 0.3));
    else if (x.words) local = x.words;
    else local = approxWordTimings(sc.narration, Math.max(1, x.sec - T - 0.3)); // no voice: subtitles carry the narration
    const flags = settings.subtitles.emphasis ? importantWordFlags(local.map((w) => w.word), sc.onScreenText) : [];
    const sceneEnd = timeline.starts[si]! + seg.input.lengthSec;
    local.forEach((w, wi) => {
      const start = Math.max(0, w.start + at + shift);
      const end = Math.min(sceneEnd, w.end + at + shift);
      if (end - start > 0.02) words.push({ word: w.word, start: +start.toFixed(3), end: +end.toFixed(3), em: flags[wi] ?? false });
    });
  });
  let assFile: string | null = null;
  if (settings.subtitles.enabled && words.length) {
    const { ass } = buildReelAss(
      words,
      {
        preset: settings.subtitles.preset,
        position: settings.subtitles.position,
        size: settings.subtitles.size,
        textColor: settings.subtitles.textColor,
        highlightColor: settings.subtitles.highlightColor ?? brightBrandColor(brand?.context.colors ?? []) ?? "#FFD400",
        font: "Noto Sans",
      },
      size,
    );
    await writeFile(path.join(dir, "captions.ass"), ass);
    assFile = "captions.ass";
  }
  const fontsOut = await ensureDir(path.join(dir, "fonts"));
  for (const f of await readdir(FONTS_DIR)) if (/\.(ttf|otf)$/i.test(f)) await copyFile(path.join(FONTS_DIR, f), path.join(fontsOut, f));

  // 5. Editing: intro/outro cards, animated headlines, then one motion segment per scene.
  await setProgress(reelId, "Designing cards and headlines", reelStepProgress("editing", 0, 1));
  if (settings.intro) await introCard(script.title, theme, size, path.join(dir, "intro.png"));
  for (const seg of segs) {
    if (seg.sceneIdx === null) continue;
    const sc = script.scenes[seg.sceneIdx]!;
    if (sc.onScreenText.trim() && sc.resolved!.source !== "graphic") {
      seg.input.overlay = `head-${sc.id}.png`;
      await headlineOverlay(sc.onScreenText.trim(), theme, size, path.join(dir, seg.input.overlay), settings.subtitles.position === "top" ? "center" : "top");
    }
  }
  if (settings.outro) {
    const cta = script.cta || brand?.context.defaultCta || "Follow for more";
    await outroCard(cta, brand?.context.tagline ?? (brand ? "" : script.hashtags.slice(0, 3).map((h) => `#${h}`).join("  ")), theme, size, path.join(dir, "outro.png"));
  }
  const segFiles: string[] = [];
  for (let i = 0; i < segs.length; i++) {
    await setProgress(reelId, `Editing scene ${i + 1}/${segs.length}`, reelStepProgress("editing", i + 0.5, segs.length + 0.5));
    const out = `seg-${i}.mp4`;
    const r = await ffmpeg(buildSegmentArgs({ ...segs[i]!.input, size, zoom: tpl.zoom, out }), { cwd: dir, timeoutMs: 10 * 60_000 });
    if (r.code !== 0) throw new Error(`ffmpeg failed on segment ${i + 1}: ${r.stderr.slice(-800)}`);
    segFiles.push(out);
  }

  // 6. Final render: transitions, logo, subtitles, voice + ducked music + sound effects.
  await setProgress(reelId, "Rendering: transitions, logo, subtitles, music", reelStepProgress("render", 0, 1));

  let logoArg: Parameters<typeof buildFinalArgs>[0]["logo"] = null;
  if (settings.showLogo && logo) {
    try {
      await logoPng(logo, path.join(dir, "logo.png"));
      // Top corner on reels: the bottom is covered by captions and the app's own UI.
      const corner = (brand?.profile.logoPlacement?.corner ?? "top-right").endsWith("left") ? "top-left" : "top-right";
      const pos = logoPosition(corner, size.w * 0.045);
      const firstScene = segs.findIndex((s) => s.sceneIdx !== null);
      const lastScene = segs.length - 1 - [...segs].reverse().findIndex((s) => s.sceneIdx !== null);
      logoArg = {
        file: "logo.png",
        ...pos,
        widthPx: Math.round(size.w * Math.min(0.24, Math.max(0.12, (brand?.profile.logoPlacement?.sizePct ?? 16) / 100))),
        fromSec: timeline.starts[firstScene] ?? 0,
        toSec: (timeline.starts[lastScene] ?? 0) + segs[lastScene]!.input.lengthSec,
      };
    } catch (err) {
      warnings.push(`Logo could not be placed: ${err instanceof Error ? err.message : err}`);
    }
  } else if (settings.showLogo && reel.mode === "brand" && !logo) {
    warnings.push("This brand has no logo uploaded; add one in Brand settings to show it on reels.");
  }

  let musicFile: string | null = null;
  if (settings.musicMode !== "none") {
    const tracks = await listReelMusic(reel.userId);
    let track: string | null = null;
    if (settings.musicMode === "track" && settings.musicTrack) {
      track = tracks.some((t) => t.key === settings.musicTrack) ? settings.musicTrack : null;
      if (!track) warnings.push("The chosen music track is no longer available; rendered without it.");
    } else {
      // Auto: your uploads and the library first (matching the mood the AI chose when the
      // track names allow it); the built-in beds only when there's nothing else.
      const real = tracks.filter((t) => !t.key.startsWith("builtin:"));
      track = pickMusicTrack(real, settings.musicMood, `${reel.id}:${reel.renderCount}`) ?? `builtin:${builtinForMood(settings.musicMood, reel.reelType)}`;
    }
    const src = track ? await musicPath(reel.userId, track) : null;
    if (src) {
      musicFile = `music${path.extname(src)}`;
      await copyFile(src, path.join(dir, musicFile));
      if (settings.musicMode === "auto") settings.musicTrack = track;
    }
  }

  let sfxArg: Parameters<typeof buildFinalArgs>[0]["sfx"] = null;
  if (settings.sfx && settings.sfxVolume > 0) {
    try {
      const [whoosh, hit] = await Promise.all([sfxFile("whoosh"), sfxFile("hit")]);
      await copyFile(whoosh, path.join(dir, "sfx-whoosh.wav"));
      await copyFile(hit, path.join(dir, "sfx-hit.wav"));
      const hitAt: number[] = [];
      if (settings.intro) hitAt.push(0);
      if (settings.outro) hitAt.push(+(timeline.starts[segs.length - 1]! + T * 0.5).toFixed(3));
      sfxArg = { whoosh: "sfx-whoosh.wav", hit: "sfx-hit.wav", whooshAt: whooshTimes(timeline), hitAt, volume: settings.sfxVolume };
    } catch (err) {
      warnings.push(`Sound effects were skipped: ${err instanceof Error ? err.message : err}`);
    }
  }

  const tmpOut = "reel.tmp.mp4";
  const r = await ffmpeg(
    buildFinalArgs({
      segments: segFiles,
      timeline,
      transition: tpl.transition,
      voices,
      voiceVolume: settings.voiceVolume,
      musicFile,
      musicVolume: settings.musicVolume,
      logo: logoArg,
      assFile,
      fontsDir: "fonts",
      size,
      out: tmpOut,
      sfx: sfxArg,
    }),
    { cwd: dir, timeoutMs: 15 * 60_000 },
  );
  if (r.code !== 0) throw new Error(`ffmpeg failed on the final mix: ${r.stderr.slice(-1200)}`);

  await setProgress(reelId, "Checking the video", 98);
  const probe = await probeOutput(path.join(dir, tmpOut));
  if (probe.width !== size.w || probe.height !== size.h || !probe.durationSec || probe.durationSec < 3 || !probe.audioCodec) {
    throw new PermanentJobError(`Rendered file failed checks (${probe.width}x${probe.height}, ${probe.durationSec}s, audio ${probe.audioCodec ?? "none"})`);
  }
  const finalName = `reel-${reel.renderCount}.mp4`;
  // Old renders are replaced; the newest is the only one kept.
  for (const f of await readdir(dir)) if (/^(reel-\d+\.mp4|thumb-\d+\.jpg)$/.test(f)) await rm(path.join(dir, f), { force: true });
  await rename(path.join(dir, tmpOut), path.join(dir, finalName));
  const thumbName = `thumb-${reel.renderCount}.jpg`;
  await ffmpeg(["-y", "-hide_banner", "-loglevel", "error", "-ss", String(Math.min(2.5, probe.durationSec / 3)), "-i", finalName, "-frames:v", "1", "-vf", "scale=540:-2", thumbName], { cwd: dir });
  for (const f of segFiles) await rm(path.join(dir, f), { force: true });

  await prisma.shortsReel.update({
    where: { id: reelId },
    data: {
      status: "completed",
      stage: null,
      progress: 100,
      error: null,
      warnings: [...new Set(warnings)].slice(0, 30) as unknown as Prisma.InputJsonValue,
      renderInfo: info as unknown as Prisma.InputJsonValue,
      settings: settings as unknown as Prisma.InputJsonValue,
      filePath: path.join(dir, finalName),
      thumbPath: (await exists(path.join(dir, thumbName))) ? path.join(dir, thumbName) : null,
      videoDurationSec: probe.durationSec,
      width: probe.width,
      height: probe.height,
      fileSizeBytes: probe.sizeBytes,
      completedAt: new Date(),
    },
  });
  log.info("reel.done", { reelId, durationSec: probe.durationSec, bytes: probe.sizeBytes, warnings: warnings.length });
}

/** A brand colour bright and saturated enough to read as a subtitle highlight on dark outlines, or null. */
function brightBrandColor(colors: string[]): string | null {
  for (const c of colors) {
    const n = parseInt(c.slice(1), 16);
    const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const sat = Math.max(r, g, b) - Math.min(r, g, b);
    if (lum > 110 && lum < 235 && sat > 60) return c;
  }
  return null;
}

async function markReelFailed(job: ShortsJobRow, message: string) {
  const reelId = (job.payload as { reelId?: string }).reelId;
  if (!reelId) return;
  await prisma.shortsReel.updateMany({
    where: { id: reelId, status: { in: ["queued", "rendering"] } },
    data: { status: "failed", stage: null, error: message.slice(0, 4000) },
  });
}

export function registerReelHandlers(): void {
  registerJobHandler(
    JOB_TYPE,
    async (job) => {
      const reelId = (job.payload as { reelId?: string }).reelId;
      if (!reelId) throw new PermanentJobError("reel job without reelId");
      const instructions = (job.payload as { instructions?: unknown }).instructions;
      try {
        await runReelRender(reelId, { instructions: typeof instructions === "string" ? instructions : "" });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!(err instanceof PermanentJobError || err instanceof ShortsConfigError) && job.attempts < job.maxAttempts) {
          // Keep the progress: the retry resumes from cached work (script, voice, visuals).
          await prisma.shortsReel.update({ where: { id: reelId }, data: { stage: `Retrying after an error: ${msg.slice(0, 160)}` } }).catch(() => {});
        }
        throw err;
      }
    },
    markReelFailed,
  );
}

/* ---------------------------------- music ---------------------------------- */

const AUDIO_RE = /\.(mp3|m4a|aac|wav|ogg|flac)$/i;

const synthLocks = new Map<string, Promise<string>>();

/** Makes (once) a locally synthesised audio file in the shared cache and returns its path. */
async function synthOnce(name: string, args: (out: string) => string[]): Promise<string> {
  const dir = await ensureDir(path.join(storageRoot(), "_synth-audio"));
  const out = path.join(dir, name);
  if (await exists(out)) return out;
  let p = synthLocks.get(out);
  if (!p) {
    p = (async () => {
      const tmp = path.join(dir, `.${newId()}-${name}`);
      const r = await ffmpeg(args(tmp), { timeoutMs: 120_000 });
      if (r.code !== 0) {
        await rm(tmp, { force: true });
        throw new Error(`could not synthesise ${name}: ${r.stderr.slice(-300)}`);
      }
      await rename(tmp, out);
      return out;
    })().finally(() => synthLocks.delete(out));
    synthLocks.set(out, p);
  }
  return p;
}

const sfxFile = (kind: "whoosh" | "hit") => synthOnce(`sfx-${kind}-v1.wav`, (out) => sfxSynthArgs(kind, out));

/** Shared owner-cleared library tracks, this user's own uploads, and the built-in synthesised beds. */
export async function listReelMusic(userId: string): Promise<{ key: string; label: string; mine: boolean }[]> {
  const lib = (await listMusic()).map((f) => ({ key: `lib:${f}`, label: f.replace(AUDIO_RE, ""), mine: false }));
  const mineDir = paths.userMusic(userId);
  const mine = (await readdir(mineDir).catch(() => [] as string[]))
    .filter((f) => AUDIO_RE.test(f) && !f.startsWith("."))
    .sort()
    .map((f) => ({ key: `mine:${f}`, label: f.replace(AUDIO_RE, ""), mine: true }));
  const builtin = (Object.keys(BUILTIN_MUSIC) as BuiltinMusic[]).map((k) => ({ key: `builtin:${k}`, label: BUILTIN_MUSIC[k].label, mine: false }));
  return [...mine, ...lib, ...builtin];
}

/** File path of a music key the user may use, or null. */
export async function musicPath(userId: string, key: string): Promise<string | null> {
  const b = /^builtin:([\w-]+)$/.exec(key);
  if (b) {
    if (!(b[1]! in BUILTIN_MUSIC)) return null;
    const kind = b[1] as BuiltinMusic;
    // 64 s loop: long enough that the -stream_loop seam is rare in a 60 s reel.
    return synthOnce(`music-${kind}-v1.wav`, (out) => ambientMusicArgs(kind, 64, out)).catch(() => null);
  }
  const m = /^(lib|mine):([\w .()-]+\.[a-z0-9]+)$/i.exec(key);
  if (!m || m[2]!.includes("..")) return null;
  const p = m[1] === "lib" ? path.join(paths.musicLibrary(), m[2]!) : path.join(paths.userMusic(userId), m[2]!);
  return insideStorage(p) && (await exists(p)) ? p : null;
}

/** Saves an uploaded track to the user's own music. Returns its key. */
export async function addMusicTrack(userId: string, tmpPath: string, originalName: string): Promise<string> {
  const ext = path.extname(originalName).toLowerCase();
  if (!/^\.(mp3|m4a|aac|wav|ogg)$/.test(ext)) throw new HttpError(400, "Upload an MP3, M4A, AAC, WAV or OGG file");
  const base = path.basename(originalName, ext).replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "track";
  const dir = await ensureDir(paths.userMusic(userId));
  let name = `${base}${ext}`;
  if (await exists(path.join(dir, name))) name = `${base}-${newId()}${ext}`;
  const dest = path.join(dir, name);
  await copyFile(tmpPath, dest);
  const p = await ffmpeg(["-v", "error", "-i", dest, "-t", "1", "-f", "null", "-"]);
  if (p.code !== 0) {
    await rm(dest, { force: true });
    throw new HttpError(400, "That file could not be read as audio");
  }
  return `mine:${name}`;
}

/** Resolves a reel file for the signed public route. Null when it isn't a file of that reel. */
export async function reelFilePath(reelId: string, name: string): Promise<string | null> {
  if (!/^[\w./-]+$/.test(name) || name.includes("..")) return null;
  const p = path.join(paths.reelDir(reelId), name);
  if (!insideStorage(p) || !(await exists(p))) return null;
  return p;
}

