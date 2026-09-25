import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "@catgpt/db";
import { BRAND_VOICE_CONSENT_TYPES, type BrandVoiceDto } from "@catgpt/types";
import { HttpError, badRequest, notFound } from "../lib/errors.js";
import { env } from "../env.js";
import {
  BRAND_VOICE_SCRIPTS,
  findManageableBrand,
} from "../lib/brand.js";
import {
  deleteBrandVoiceCache,
  deletePrivateObject,
  newVoiceObjectKey,
  putPrivateObject,
  readPrivateObject,
} from "../services/storage.js";

/** Browsers can't emit WAV via MediaRecorder; the UI decodes to PCM WAV.
 *  WAV keeps server-side validation dependency-free (RIFF header below) and
 *  guarantees the model service can decode it with soundfile. */
const VOICE_MIMES = new Set(["audio/wav", "audio/x-wav", "audio/wave"]);
const MAX_SAMPLE_BYTES = 12 * 1024 * 1024;
/** Bake-off evidence: the adapter conditions on ~6–15 s of speech and our
 *  enrollment scripts read ~20–30 s; outside this window we reject. */
const MIN_SAMPLE_SECONDS = 6;
const MAX_SAMPLE_SECONDS = 90;
const SPEAK_LANGUAGES = new Set([...Object.keys(BRAND_VOICE_SCRIPTS), "en"]);
const MAX_SPEAK_CHARS = 1500;
/** One synthesis at a time — the service is CPU-bound and serial anyway. */
const MAX_INFLIGHT = 1;
const SYNTH_TIMEOUT_MS = 240_000;

let inflight = 0;
const pendingSynthesis = new Map<string, Promise<Buffer>>();
const MAX_QUEUED_SYNTHESIS = 4;
const synthesisQueue: Array<{
  resolve: () => void;
  reject: (error: HttpError) => void;
  timer: ReturnType<typeof setTimeout> | null;
}> = [];

function acquireSynthesisSlot(): Promise<void> {
  if (inflight < MAX_INFLIGHT) {
    inflight += 1;
    return Promise.resolve();
  }
  if (synthesisQueue.length >= MAX_QUEUED_SYNTHESIS) {
    return Promise.reject(new HttpError(429, "Voice synthesis queue is busy — try again"));
  }
  return new Promise((resolve, reject) => {
    const entry: (typeof synthesisQueue)[number] = { resolve, reject, timer: null };
    entry.timer = setTimeout(() => {
      const index = synthesisQueue.indexOf(entry);
      if (index >= 0) {
        synthesisQueue.splice(index, 1);
        reject(new HttpError(503, "Voice synthesis timed out while waiting — try again"));
      }
    }, SYNTH_TIMEOUT_MS);
    synthesisQueue.push(entry);
  });
}

function releaseSynthesisSlot() {
  const next = synthesisQueue.shift();
  if (next) {
    if (next.timer) clearTimeout(next.timer);
    next.resolve();
  } else {
    inflight -= 1;
  }
}

const speakSchema = z.object({
  text: z.string().min(1).max(MAX_SPEAK_CHARS),
  language: z.string().min(2).max(12).optional(),
});

function isWavBuffer(buffer: Buffer | null): buffer is Buffer {
  return Boolean(
    buffer &&
      buffer.length > 44 &&
      buffer.toString("ascii", 0, 4) === "RIFF" &&
      buffer.toString("ascii", 8, 12) === "WAVE",
  );
}

/** RIFF duration probe — bounds-checked, returns null on anything non-WAV. */
function wavDurationSeconds(buf: Buffer): number | null {
  if (buf.length < 44) return null;
  if (buf.toString("ascii", 0, 4) !== "RIFF") return null;
  if (buf.toString("ascii", 8, 12) !== "WAVE") return null;
  let byteRate = 0;
  let dataSize = 0;
  for (let off = 12; off + 8 <= buf.length; ) {
    const id = buf.toString("ascii", off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    const body = off + 8;
    // `data` is the last chunk; streaming writers (OpenAI, ffmpeg pipes) legit-
    // imately declare its size as 0xFFFFFFFF/0x7FFFFFFF, so clamp it to EOF.
    // Other chunks keep the corrupt-header guard since a bad size misaligns
    // the walk.
    if (id === "data") {
      dataSize = Math.min(size, buf.length - body);
      break;
    }
    if (body + size > buf.length + 1024) return null; // corrupt header
    if (id === "fmt " && size >= 16 && body + 12 <= buf.length) {
      byteRate = buf.readUInt32LE(body + 8);
    }
    off = body + size + (size % 2);
  }
  if (!byteRate || !dataSize) return null;
  return dataSize / byteRate;
}

export function toBrandVoiceDto(v: {
  id: string;
  brandId: string;
  sampleLanguage: string;
  scriptText: string;
  consentType: string;
  consentedAt: Date;
  attestedById: string | null;
  status: string;
  enrolledAt: Date | null;
  lastSynthesisError: string | null;
  lastSynthesisErrorAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): BrandVoiceDto {
  return {
    id: v.id,
    brandId: v.brandId,
    sampleLanguage: v.sampleLanguage,
    scriptText: v.scriptText,
    status: v.status as BrandVoiceDto["status"],
    enrolledAt: v.enrolledAt ? v.enrolledAt.toISOString() : null,
    lastSynthesisError: v.lastSynthesisError,
    lastSynthesisErrorAt: v.lastSynthesisErrorAt
      ? v.lastSynthesisErrorAt.toISOString()
      : null,
    createdAt: v.createdAt.toISOString(),
    updatedAt: v.updatedAt.toISOString(),
  };
}

async function recordSynthesisFailure(voiceId: string, message: string) {
  await prisma.brandVoice
    .update({
      where: { id: voiceId },
      data: { lastSynthesisError: message, lastSynthesisErrorAt: new Date() },
    })
    .catch(() => {});
}

async function callVoiceService(
  path: string,
  form: FormData,
): Promise<Response> {
  const base = env.VOICE_MODEL_URL;
  if (!base) {
    throw new HttpError(503, "Voice synthesis service is not configured");
  }
  return fetch(new URL(path, base), {
    method: "POST",
    headers: env.VOICE_SERVICE_TOKEN
      ? { "x-voice-key": env.VOICE_SERVICE_TOKEN }
      : undefined,
    body: form,
    signal: AbortSignal.timeout(SYNTH_TIMEOUT_MS),
  });
}

/**
 * Per-brand cloned voice: enrollment (script → consented WAV upload → private
 * storage) and owner-only playback/synthesis against the internal model
 * service. Every route requires findManageableBrand — workspace members who
 * can merely read a brand get a 404, same as a missing brand.
 */
export async function brandVoiceRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  /** Owner-only view of the saved voice metadata (never the storage key). */
  app.get("/brands/:id/voice", async (req) => {
    const { id } = req.params as { id: string };
    await findManageableBrand(req.userId, id);
    const voice = await prisma.brandVoice.findUnique({
      where: { brandId: id },
    });
    return {
      voice: voice ? toBrandVoiceDto(voice) : null,
      // Verified sets only — the UI must not hard-code a broader list.
      languages: Object.keys(BRAND_VOICE_SCRIPTS),
      speakLanguages: [...SPEAK_LANGUAGES],
    };
  });

  /** The fixed script the speaker must read, per verified language. */
  app.get("/brands/:id/voice/script", async (req) => {
    const { id } = req.params as { id: string };
    await findManageableBrand(req.userId, id);
    const language = (req.query as { language?: string }).language ?? "";
    const text = BRAND_VOICE_SCRIPTS[language];
    if (!text) throw badRequest("unsupported voice language");
    return { language, text };
  });

  /**
   * Save (or replace) the brand's voice sample. Multipart fields are read in
   * arrival order, so metadata may appear before or after the file.
   * Replacement is failure-safe: the new object is stored first and removed
   * again if the row update fails; the old object is deleted only after the
   * new row commits.
   */
  app.post(
    "/brands/:id/voice",
    { config: { rateLimit: { max: 6, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      await findManageableBrand(req.userId, id);

      const fields: Record<string, string> = {};
      let audio: Buffer | null = null;
      let mimetype = "";
      for await (const part of req.parts()) {
        if (part.type === "file") {
          if (part.fieldname !== "file") {
            await part.toBuffer().catch(() => {});
            continue;
          }
          mimetype = (part.mimetype ?? "").toLowerCase();
          audio = await part.toBuffer();
        } else if (typeof part.value === "string") {
          fields[part.fieldname] = part.value;
        }
      }

      const language = fields.language ?? "";
      if (!BRAND_VOICE_SCRIPTS[language]) {
        throw badRequest("unsupported voice language");
      }
      if (fields.consent !== "true") {
        throw badRequest("explicit consent is required to save a voice");
      }
      const consentType = fields.consentType ?? "";
      if (
        !(BRAND_VOICE_CONSENT_TYPES as readonly string[]).includes(consentType)
      ) {
        throw badRequest("invalid consent type");
      }
      if (!audio) throw badRequest("multipart field 'file' is required");
      if (!VOICE_MIMES.has(mimetype)) {
        throw badRequest("voice samples must be WAV audio");
      }
      if (audio.length === 0) throw badRequest("the recording is empty");
      if (audio.length > MAX_SAMPLE_BYTES) {
        throw badRequest("recording too large");
      }
      const seconds = wavDurationSeconds(audio);
      if (
        seconds === null ||
        seconds < MIN_SAMPLE_SECONDS ||
        seconds > MAX_SAMPLE_SECONDS
      ) {
        throw badRequest(
          `the recording must be ${MIN_SAMPLE_SECONDS}–${MAX_SAMPLE_SECONDS} seconds of clear speech`,
        );
      }

      const existing = await prisma.brandVoice.findUnique({
        where: { brandId: id },
      });
      const storageKey = newVoiceObjectKey(id, "wav");
      await putPrivateObject(storageKey, audio, "audio/wav");
      if (existing) {
        try {
          await deleteBrandVoiceCache(id);
        } catch {
          await deletePrivateObject(storageKey).catch(() => {});
          throw new HttpError(502, "saved voice audio could not be refreshed");
        }
      }

      let voice;
      try {
        voice = await prisma.brandVoice.upsert({
          where: { brandId: id },
          create: {
            brandId: id,
            storageKey,
            sampleLanguage: language,
            scriptText: BRAND_VOICE_SCRIPTS[language],
            consentType,
            consentedAt: new Date(),
            attestedById: req.userId,
            status: "ready",
            enrolledAt: new Date(),
            lastSynthesisError: null,
            lastSynthesisErrorAt: null,
          },
          update: {
            storageKey,
            sampleLanguage: language,
            scriptText: BRAND_VOICE_SCRIPTS[language],
            consentType,
            consentedAt: new Date(),
            attestedById: req.userId,
            status: "ready",
            enrolledAt: new Date(),
            lastSynthesisError: null,
            lastSynthesisErrorAt: null,
          },
        });
      } catch (err) {
        await deletePrivateObject(storageKey).catch(() => {});
        throw err;
      }
      if (existing && existing.storageKey !== storageKey) {
        await deletePrivateObject(existing.storageKey).catch(() => {});
      }
      return reply.code(existing ? 200 : 201).send(toBrandVoiceDto(voice));
    },
  );

  /** Owner-only playback of the saved sample — buffered stream, no URL. */
  app.get("/brands/:id/voice/sample", async (req, reply) => {
    const { id } = req.params as { id: string };
    await findManageableBrand(req.userId, id);
    const voice = await prisma.brandVoice.findUnique({
      where: { brandId: id },
    });
    if (!voice) throw notFound("No saved voice");
    const audio = await readPrivateObject(voice.storageKey).catch(() => {
      throw new HttpError(502, "voice sample could not be read");
    });
    return reply
      .header("Content-Type", "audio/wav")
      .header("Cache-Control", "private, no-store")
      .send(audio);
  });

  /** Remove the row and the private object. Object deletion runs first so a
   *  storage failure aborts the whole request and the key stays retrievable
   *  on the row for the next attempt. */
  app.delete("/brands/:id/voice", async (req, reply) => {
    const { id } = req.params as { id: string };
    await findManageableBrand(req.userId, id);
    const voice = await prisma.brandVoice.findUnique({
      where: { brandId: id },
    });
    if (!voice) throw notFound("No saved voice");
    await deleteBrandVoiceCache(id).catch(() => {
      throw new HttpError(502, "voice audio could not be removed");
    });
    await deletePrivateObject(voice.storageKey).catch(() => {
      throw new HttpError(502, "voice recording could not be removed");
    });
    await prisma.brandVoice.delete({ where: { id: voice.id } });
    return reply.code(204).send();
  });

  /**
   * Synthesize text in the saved voice via the internal model service. The
   * private sample is read server-side and POSTed as multipart; the client
   * only ever receives generated audio. Errors are generic client-side and a
   * sanitized diagnostic is stored on the row for Brand settings.
   */
  app.post("/brands/:id/voice/speak", async (req, reply) => {
      const { id } = req.params as { id: string };
      await findManageableBrand(req.userId, id);
      const body = speakSchema.safeParse(req.body);
      if (!body.success) throw badRequest("invalid speak request");
      const voice = await prisma.brandVoice.findUnique({
        where: { brandId: id },
      });
      if (!voice || voice.status !== "ready") {
        throw notFound("No usable saved voice for this brand");
      }
      const language = body.data.language ?? voice.sampleLanguage;
      if (!SPEAK_LANGUAGES.has(language)) {
        throw badRequest("unsupported voice language");
      }
      const text = body.data.text.trim();
      if (!text) throw badRequest("invalid speak request");
      const cacheDigest = createHash("sha256")
        .update(JSON.stringify([voice.id, voice.storageKey, language, text]))
        .digest("hex");
      const cacheKey = `brand-voice-cache/${id}/${cacheDigest}.wav`;
      const cached = await readPrivateObject(cacheKey).catch(() => null);
      if (isWavBuffer(cached)) {
        await prisma.brandVoice
          .update({
            where: { id: voice.id },
            data: { lastSynthesisError: null, lastSynthesisErrorAt: null },
          })
          .catch(() => {});
        return reply
          .header("Content-Type", "audio/wav")
          .header("Cache-Control", "private, no-store")
          .header("X-Voice-Cache", "HIT")
          .send(cached);
      }
      const pending = pendingSynthesis.get(cacheKey);
      if (pending) {
        const wav = await pending;
        return reply
          .header("Content-Type", "audio/wav")
          .header("Cache-Control", "private, no-store")
          .header("X-Voice-Cache", "COALESCED")
          .send(wav);
      }
      await acquireSynthesisSlot();
      let synthesis: Promise<Buffer> | undefined;
      try {
        const queuedPending = pendingSynthesis.get(cacheKey);
        if (queuedPending) {
          const wav = await queuedPending;
          return reply
            .header("Content-Type", "audio/wav")
            .header("Cache-Control", "private, no-store")
            .header("X-Voice-Cache", "COALESCED")
            .send(wav);
        }
        const queuedCache = await readPrivateObject(cacheKey).catch(() => null);
        if (isWavBuffer(queuedCache)) {
          await prisma.brandVoice
            .update({
              where: { id: voice.id },
              data: { lastSynthesisError: null, lastSynthesisErrorAt: null },
            })
            .catch(() => {});
          return reply
            .header("Content-Type", "audio/wav")
            .header("Cache-Control", "private, no-store")
            .header("X-Voice-Cache", "HIT")
            .send(queuedCache);
        }
        synthesis = (async () => {
          const sample = await readPrivateObject(voice.storageKey).catch(() => {
            throw new HttpError(502, "voice sample could not be read");
          });
          const form = new FormData();
          form.set("text", text);
          form.set("language", language);
          form.set(
            "file",
            new Blob([new Uint8Array(sample)], { type: "audio/wav" }),
            "reference.wav",
          );
          const res = await callVoiceService("/synthesize", form);
          if (!res.ok) {
            await recordSynthesisFailure(
              voice.id,
              res.status === 503
                ? "voice service unavailable"
                : "synthesis failed",
            );
            throw new HttpError(
              res.status === 503 ? 503 : 502,
              "voice synthesis failed",
            );
          }
          const wav = Buffer.from(await res.arrayBuffer());
          if (!isWavBuffer(wav)) {
            await recordSynthesisFailure(voice.id, "synthesis returned invalid audio");
            throw new HttpError(502, "voice synthesis failed");
          }
          await putPrivateObject(cacheKey, wav, "audio/wav", true).catch(() => {
            throw new HttpError(503, "generated voice audio could not be saved");
          });
          await prisma.brandVoice
            .update({
              where: { id: voice.id },
              data: { lastSynthesisError: null, lastSynthesisErrorAt: null },
            })
            .catch(() => {});
          return wav;
        })();
        pendingSynthesis.set(cacheKey, synthesis);
        const wav = await synthesis;
        return reply
          .header("Content-Type", "audio/wav")
          .header("Cache-Control", "private, no-store")
          .header("X-Voice-Cache", "MISS")
          .send(wav);
      } catch (err) {
        if (err instanceof HttpError) throw err;
        await recordSynthesisFailure(voice.id, "voice service unavailable");
        throw new HttpError(503, "voice synthesis failed");
      } finally {
        if (pendingSynthesis.get(cacheKey) === synthesis) {
          pendingSynthesis.delete(cacheKey);
        }
        releaseSynthesisSlot();
      }
    },
  );
}
