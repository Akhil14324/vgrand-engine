import { writeFile } from "node:fs/promises";
import { env } from "../../env.js";
import { ShortsConfigError } from "./env-check.js";
import { PermanentJobError } from "./jobs.js";
import { wordsFromAlignment, type CharAlignment, type WordTiming } from "./captions-logic.js";

/**
 * ElevenLabs text-to-speech with character timestamps
 * (POST /v1/text-to-speech/{voice_id}/with-timestamps).
 */

export interface VoiceResult {
  words: WordTiming[];
  voiceId: string;
  modelId: string;
}

export function resolveShortsVoice(channelVoiceId: string | null): string {
  const id = channelVoiceId ?? env.ELEVENLABS_DEFAULT_VOICE_ID;
  if (!id) {
    throw new PermanentJobError(
      "No voice for this channel: set an ElevenLabs voice id on the channel (Channels > Edit) or ELEVENLABS_DEFAULT_VOICE_ID",
    );
  }
  return id;
}

export async function synthesizeWithTimestamps(text: string, voiceId: string, destMp3: string): Promise<VoiceResult> {
  if (!env.ELEVENLABS_API_KEY) throw new ShortsConfigError("Not configured: set ELEVENLABS_API_KEY");
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/with-timestamps?output_format=mp3_44100_128`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "xi-api-key": env.ELEVENLABS_API_KEY, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ text, model_id: env.ELEVENLABS_TTS_MODEL }),
    signal: AbortSignal.timeout(120_000),
  });
  if (res.status === 401 || res.status === 403) throw new PermanentJobError(`ElevenLabs rejected the request (${res.status}). Check ELEVENLABS_API_KEY and the voice id.`);
  if (res.status === 404) throw new PermanentJobError(`ElevenLabs voice "${voiceId}" not found`);
  if (!res.ok) throw new Error(`ElevenLabs request failed (${res.status})`);
  const json = (await res.json()) as { audio_base64?: string; alignment?: CharAlignment | null; normalized_alignment?: CharAlignment | null };
  if (!json.audio_base64) throw new Error("ElevenLabs returned no audio");
  const audio = Buffer.from(json.audio_base64, "base64");
  if (audio.byteLength < 1000) throw new Error("ElevenLabs returned empty audio");
  await writeFile(destMp3, audio);
  // `alignment` follows the input text; normalized_alignment follows the spoken (normalised) text.
  const alignment = json.alignment ?? json.normalized_alignment;
  if (!alignment) throw new Error("ElevenLabs returned no timestamps");
  const words = wordsFromAlignment(alignment);
  if (!words.length) throw new Error("ElevenLabs timestamps contained no words");
  return { words, voiceId, modelId: env.ELEVENLABS_TTS_MODEL };
}
