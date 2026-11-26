import { writeFile } from "node:fs/promises";
import { generateWithFallback } from "@catgpt/image-providers";
import { env } from "../../env.js";
import { getClient } from "../chat.js";
import { geminiConfigured, geminiJson } from "../gemini.js";
import { generateJson } from "./anthropic.js";
import { wordsFromAlignment, type CharAlignment, type WordTiming } from "./captions-logic.js";
import { ShortsConfigError } from "./env-check.js";
import { mediaDuration } from "./ffmpeg.js";
import { approxWordTimings, type StockImageCandidate } from "./reel-logic.js";
import { LICENSES, interleave } from "./stock-logic.js";
import { log } from "./log.js";

/**
 * External services used by Reel Studio, each with a clear "not configured"
 * answer instead of a silent failure:
 *  - script JSON: Claude (ANTHROPIC_*), else OpenAI chat (OPENAI_API_KEY), else Gemini (GOOGLE_AI_API_KEY)
 *  - stock photos: Pexels / Pixabay image search (same keys as stock video)
 *  - voice: ElevenLabs with word timestamps, else OpenAI TTS
 *  - AI images: the app's image providers (gpt-image via OPENAI_API_KEY)
 */

/* ---------------------------------- script --------------------------------- */

export function scriptProvider(): "claude" | "openai" | "gemini" | null {
  if (env.ANTHROPIC_API_KEY && env.ANTHROPIC_MODEL) return "claude";
  if (env.OPENAI_API_KEY) return "openai";
  if (geminiConfigured()) return "gemini";
  return null;
}

export interface JsonCallResult {
  provider: string;
  parsed: unknown;
  raw: string;
}

export async function reelJson(input: { system: string; user: string; schema: Record<string, unknown>; temperature?: number }): Promise<JsonCallResult> {
  const p = scriptProvider();
  if (!p) throw new ShortsConfigError("No AI writer configured: set ANTHROPIC_API_KEY + ANTHROPIC_MODEL, or OPENAI_API_KEY, or GOOGLE_AI_API_KEY");
  if (p === "claude") {
    const r = await generateJson({ system: input.system, user: input.user, schema: input.schema, maxTokens: 8000 });
    return { provider: `claude:${env.ANTHROPIC_MODEL}`, parsed: r.parsed, raw: r.text };
  }
  if (p === "openai") {
    const res = await getClient().chat.completions.create({
      model: env.CHAT_MODEL,
      temperature: input.temperature ?? 0.8,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: `${input.system}\nThe JSON must match this JSON Schema:\n${JSON.stringify(input.schema)}` },
        { role: "user", content: input.user },
      ],
    });
    const raw = res.choices[0]?.message?.content ?? "";
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
    return { provider: `openai:${env.CHAT_MODEL}`, parsed, raw };
  }
  const parsed = await geminiJson({
    system: `${input.system}\nThe JSON must match this JSON Schema:\n${JSON.stringify(input.schema)}`,
    parts: [{ text: input.user }],
    temperature: input.temperature ?? 0.8,
    thinking: "low",
    maxOutputTokens: 12000,
  });
  return { provider: `gemini:${env.GEMINI_MODEL}`, parsed, raw: JSON.stringify(parsed) };
}

/* ------------------------------- stock photos ------------------------------ */

const photoCache = new Map<string, { at: number; value: StockImageCandidate[] }>();
const DAY_MS = 86_400_000;

async function cachedPhotos(key: string, fetcher: () => Promise<StockImageCandidate[]>) {
  const hit = photoCache.get(key);
  if (hit && Date.now() - hit.at < DAY_MS) return hit.value;
  const value = await fetcher();
  photoCache.set(key, { at: Date.now(), value });
  if (photoCache.size > 1000) photoCache.clear();
  return value;
}

export const stockImagesConfigured = () => Boolean(env.PEXELS_API_KEY || env.PIXABAY_API_KEY);
export const stockVideoConfigured = () => Boolean(env.PEXELS_API_KEY || env.PIXABAY_API_KEY);

interface PexelsPhoto {
  id?: number;
  url?: string;
  width?: number;
  height?: number;
  photographer?: string;
  src?: { original?: string; large2x?: string; portrait?: string };
}
interface PixabayImage {
  id?: number;
  pageURL?: string;
  imageWidth?: number;
  imageHeight?: number;
  largeImageURL?: string;
  user?: string;
}

async function pexelsPhotos(query: string): Promise<StockImageCandidate[]> {
  if (!env.PEXELS_API_KEY) return [];
  return cachedPhotos(`pexels:${query}`, async () => {
    const u = new URL("https://api.pexels.com/v1/search");
    u.searchParams.set("query", query);
    u.searchParams.set("orientation", "portrait");
    u.searchParams.set("per_page", "20");
    const res = await fetch(u, { headers: { Authorization: env.PEXELS_API_KEY! }, signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`Pexels photo search failed (${res.status})`);
    const json = (await res.json()) as { photos?: PexelsPhoto[] };
    return (json.photos ?? [])
      .filter((p) => p.id && p.url && p.width && p.height && (p.src?.large2x || p.src?.original))
      .map((p) => {
        // large2x is ~1880 px on the long side: enough for 1080x1920 without pulling 20 MB originals.
        const scale = Math.min(1, 1880 / Math.max(p.width!, p.height!));
        return {
          provider: "pexels" as const,
          id: String(p.id),
          pageUrl: p.url!,
          downloadUrl: p.src?.large2x ?? p.src!.original!,
          width: Math.round(p.width! * scale),
          height: Math.round(p.height! * scale),
          author: p.photographer ?? null,
          ...LICENSES.pexels,
        };
      });
  });
}

async function pixabayPhotos(query: string): Promise<StockImageCandidate[]> {
  if (!env.PIXABAY_API_KEY) return [];
  return cachedPhotos(`pixabay:${query}`, async () => {
    const u = new URL("https://pixabay.com/api/");
    u.searchParams.set("key", env.PIXABAY_API_KEY!);
    u.searchParams.set("q", query.slice(0, 100));
    u.searchParams.set("image_type", "photo");
    u.searchParams.set("orientation", "vertical");
    u.searchParams.set("safesearch", "true");
    u.searchParams.set("per_page", "20");
    const res = await fetch(u, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`Pixabay photo search failed (${res.status})`);
    const json = (await res.json()) as { hits?: PixabayImage[] };
    return (json.hits ?? [])
      .filter((h) => h.id && h.pageURL && h.largeImageURL && h.imageWidth && h.imageHeight)
      .map((h) => {
        // largeImageURL is scaled to 1280 px on the long side.
        const scale = Math.min(1, 1280 / Math.max(h.imageWidth!, h.imageHeight!));
        return {
          provider: "pixabay" as const,
          id: String(h.id),
          pageUrl: h.pageURL!,
          downloadUrl: h.largeImageURL!,
          width: Math.round(h.imageWidth! * scale),
          height: Math.round(h.imageHeight! * scale),
          author: h.user ?? null,
          ...LICENSES.pixabay,
        };
      });
  });
}

export async function searchStockImages(query: string): Promise<StockImageCandidate[]> {
  const [a, b] = await Promise.allSettled([pexelsPhotos(query), pixabayPhotos(query)]);
  for (const r of [a, b]) if (r.status === "rejected") log.warn("reel.photo_search_failed", { query, error: String(r.reason) });
  return interleave(a.status === "fulfilled" ? a.value : [], b.status === "fulfilled" ? b.value : []);
}

/* ---------------------------------- voice ---------------------------------- */

export const elevenConfigured = () => Boolean(env.ELEVENLABS_API_KEY);
export const openaiTtsConfigured = () => Boolean(env.OPENAI_API_KEY);

/** ElevenLabs premade voices (multilingual). The owner can override with any voice id. */
const ELEVEN_VOICES = { female: "21m00Tcm4TlvDq8ikWAM", male: "pNInz6obpgDQGcFmaJgB" } as const;
/** OpenAI TTS voices per gender. */
const OPENAI_VOICES = { female: "nova", male: "onyx" } as const;

export interface SpeechResult {
  durationSec: number;
  words: WordTiming[];
  provider: string;
  voice: string;
  exactTimings: boolean;
}

export interface SpeechRequest {
  text: string;
  dest: string;
  gender: "female" | "male";
  provider: "auto" | "elevenlabs" | "openai";
  voiceId: string | null;
  /** Spoken-language description, e.g. "Hindi". */
  speech: string;
  style: string;
}

export function pickVoiceProvider(pref: SpeechRequest["provider"]): "elevenlabs" | "openai" | null {
  if (pref === "elevenlabs") return elevenConfigured() ? "elevenlabs" : null;
  if (pref === "openai") return openaiTtsConfigured() ? "openai" : null;
  return elevenConfigured() ? "elevenlabs" : openaiTtsConfigured() ? "openai" : null;
}

async function elevenSpeech(req: SpeechRequest, voice: string): Promise<SpeechResult> {
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}/with-timestamps?output_format=mp3_44100_128`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "xi-api-key": env.ELEVENLABS_API_KEY!, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ text: req.text, model_id: env.ELEVENLABS_TTS_MODEL }),
    signal: AbortSignal.timeout(120_000),
  });
  if (res.status === 401 || res.status === 403) throw new ShortsConfigError(`ElevenLabs rejected the request (${res.status}). Check ELEVENLABS_API_KEY.`);
  if (res.status === 404) throw new VoiceNotFound(voice);
  if (!res.ok) throw new Error(`ElevenLabs request failed (${res.status})`);
  const json = (await res.json()) as { audio_base64?: string; alignment?: CharAlignment | null; normalized_alignment?: CharAlignment | null };
  if (!json.audio_base64) throw new Error("ElevenLabs returned no audio");
  await writeFile(req.dest, Buffer.from(json.audio_base64, "base64"));
  const durationSec = await mediaDuration(req.dest);
  const alignment = json.alignment ?? json.normalized_alignment;
  const words = alignment ? wordsFromAlignment(alignment) : [];
  return {
    durationSec,
    words: words.length ? words : approxWordTimings(req.text, durationSec),
    provider: "elevenlabs",
    voice,
    exactTimings: words.length > 0,
  };
}

class VoiceNotFound extends Error {
  constructor(voice: string) {
    super(`ElevenLabs voice "${voice}" not found`);
  }
}

async function openaiSpeech(req: SpeechRequest, voice: string): Promise<SpeechResult> {
  const res = await fetch(`${(env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "")}/audio/speech`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: env.VOICE_TTS_MODEL,
      voice,
      input: req.text,
      response_format: "mp3",
      instructions: `Speak in ${req.speech}. Delivery: ${req.style}. Sound like a natural human creator voicing a social media reel, clear pronunciation, lively pacing.`,
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (res.status === 401 || res.status === 403) throw new ShortsConfigError(`OpenAI rejected the speech request (${res.status}). Check OPENAI_API_KEY.`);
  if (!res.ok) throw new Error(`OpenAI speech request failed (${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength < 500) throw new Error("OpenAI returned empty audio");
  await writeFile(req.dest, buf);
  const durationSec = await mediaDuration(req.dest);
  return { durationSec, words: approxWordTimings(req.text, durationSec), provider: "openai", voice, exactTimings: false };
}

export async function synthesizeSpeech(req: SpeechRequest): Promise<SpeechResult> {
  const provider = pickVoiceProvider(req.provider);
  if (!provider) {
    throw new ShortsConfigError(
      req.provider === "auto"
        ? "No voice provider configured: set ELEVENLABS_API_KEY or OPENAI_API_KEY (or turn the voiceover off)"
        : `${req.provider === "elevenlabs" ? "ElevenLabs (ELEVENLABS_API_KEY)" : "OpenAI TTS (OPENAI_API_KEY)"} is not configured`,
    );
  }
  if (provider === "elevenlabs") {
    const voice = req.voiceId || ELEVEN_VOICES[req.gender];
    try {
      return await elevenSpeech(req, voice);
    } catch (err) {
      // A missing premade voice falls back to the server's default voice once.
      if (err instanceof VoiceNotFound && env.ELEVENLABS_DEFAULT_VOICE_ID && voice !== env.ELEVENLABS_DEFAULT_VOICE_ID) {
        return elevenSpeech(req, env.ELEVENLABS_DEFAULT_VOICE_ID);
      }
      throw err;
    }
  }
  const voice = req.voiceId && /^[a-z]+$/.test(req.voiceId) ? req.voiceId : OPENAI_VOICES[req.gender];
  return openaiSpeech(req, voice);
}

/* --------------------------------- AI image -------------------------------- */

export const aiImageConfigured = () => Boolean(env.OPENAI_API_KEY);

/** One portrait AI image saved to `dest`. With references (brand products) it runs as a reference-guided edit. */
export async function generateAiImage(prompt: string, dest: string, referenceUrls: string[] = []): Promise<{ provider: string }> {
  if (!aiImageConfigured()) throw new ShortsConfigError("AI images need OPENAI_API_KEY");
  const result = await generateWithFallback("openai", {
    prompt: `${prompt}\nVertical 9:16 photo for a social media reel. Photorealistic unless the scene says otherwise. No text, captions, letters, watermarks or logos in the image.`,
    mode: referenceUrls.length ? "edit" : "draft",
    ...(referenceUrls.length ? { referenceImageUrl: referenceUrls[0], referenceImageUrls: referenceUrls.slice(0, 2) } : {}),
    size: "1024x1536",
    quality: "medium",
    n: 1,
  });
  const img = result.images[0];
  if (!img) throw new Error("The image model returned no image");
  if (img.b64Json) await writeFile(dest, Buffer.from(img.b64Json, "base64"));
  else if (img.url) {
    const res = await fetch(img.url, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`AI image download failed (${res.status})`);
    await writeFile(dest, Buffer.from(await res.arrayBuffer()));
  } else throw new Error("The image model returned an empty image");
  return { provider: result.providerUsed };
}
