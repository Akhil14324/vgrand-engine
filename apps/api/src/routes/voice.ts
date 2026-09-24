import type { FastifyInstance } from "fastify";
import { toFile } from "openai";
import { z } from "zod";
import { badRequest, parseBody } from "../lib/errors.js";
import { getClient } from "../services/chat.js";
import { env } from "../env.js";

const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
const speakSchema = z.object({ text: z.string().min(1).max(1500) });

/** Models that do not exist on an account come back as 400/404 - try the classic ones. */
const isModelError = (err: unknown) => {
  const s = (err as { status?: number })?.status;
  return s === 400 || s === 404;
};

/**
 * Voice ("Kill Bill" mode): speech in, speech out, both through the OpenAI API
 * so it works in every browser. The conversation itself is a normal chat turn
 * (POST /generations with voice: true) so it lands in the user's history.
 */
export async function voiceRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  /** Audio -> text. */
  app.post(
    "/voice/transcribe",
    { config: { rateLimit: { max: 40, timeWindow: "1 minute" } } },
    async (req) => {
      const file = await req.file();
      if (!file) throw badRequest("multipart field 'file' is required");
      if (!file.mimetype.startsWith("audio/") && file.mimetype !== "video/webm") {
        throw badRequest("only audio recordings are supported");
      }
      const buffer = await file.toBuffer();
      if (buffer.length === 0) throw badRequest("the recording is empty");
      if (buffer.length > MAX_AUDIO_BYTES) throw badRequest("recording too long");

      const ext = file.mimetype.includes("mp4")
        ? "m4a"
        : file.mimetype.includes("ogg")
          ? "ogg"
          : "webm";
      const client = getClient();
      const run = async (model: string) =>
        client.audio.transcriptions.create({
          model,
          file: await toFile(buffer, `speech.${ext}`, { type: file.mimetype }),
        });
      let res;
      try {
        res = await run(env.VOICE_STT_MODEL);
      } catch (err) {
        if (!isModelError(err) || env.VOICE_STT_MODEL === "whisper-1") throw err;
        res = await run("whisper-1");
      }
      return { text: res.text.trim() };
    },
  );

  /** Text -> speech (mp3). */
  app.post(
    "/voice/speak",
    { config: { rateLimit: { max: 90, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const { text } = parseBody(speakSchema, req.body);
      const client = getClient();
      const run = (model: string) =>
        client.audio.speech.create({
          model,
          voice: env.VOICE_TTS_VOICE as "alloy",
          input: text,
          response_format: "mp3",
        });
      let res;
      try {
        res = await run(env.VOICE_TTS_MODEL);
      } catch (err) {
        if (!isModelError(err) || env.VOICE_TTS_MODEL === "tts-1") throw err;
        res = await run("tts-1");
      }
      const audio = Buffer.from(await res.arrayBuffer());
      return reply
        .header("Content-Type", "audio/mpeg")
        .header("Cache-Control", "private, no-store")
        .send(audio);
    },
  );
}
