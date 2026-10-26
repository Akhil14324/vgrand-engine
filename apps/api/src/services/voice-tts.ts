import { env } from "../env.js";

/**
 * Voiceover text-to-speech for reels (phase 4). Stock voices only; voice
 * cloning needs the consent flow and isn't wired here.
 *
 * Endpoints follow the providers' public docs as of this writing. Confirm them
 * against docs.elevenlabs.io and docs.fish.audio before the first paid render.
 */

export type VoiceProviderName = "elevenlabs" | "fish";

const TIMEOUT_MS = 60_000;
const MAX_AUDIO_BYTES = 10 * 1024 * 1024;

/** Thrown when a provider isn't configured. Its message is safe to show the user. */
export class VoiceConfigError extends Error {}

/** Picks the voice: the brief's own id, else the server default for the provider. */
export function resolveVoiceId(provider: VoiceProviderName, voiceId: string | null): string {
  const fallback = provider === "elevenlabs" ? env.ELEVENLABS_DEFAULT_VOICE_ID : env.FISH_DEFAULT_VOICE_ID;
  const id = voiceId ?? fallback;
  if (!id) throw new VoiceConfigError("No voice is set for this voiceover. Pick a voice or set a default on the server.");
  return id;
}

async function fetchAudio(url: string, init: RequestInit, label: string): Promise<Buffer> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) {
    // Keep the provider's body out of the error: it can echo request details.
    throw new Error(`${label} voice request failed (${res.status})`);
  }
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > MAX_AUDIO_BYTES) throw new Error(`${label} audio is too large`);
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.byteLength === 0) throw new Error(`${label} returned empty audio`);
  if (buffer.byteLength > MAX_AUDIO_BYTES) throw new Error(`${label} audio is too large`);
  return buffer;
}

/** One voiceover line as MP3 bytes. */
export async function synthesizeLine(input: {
  provider: VoiceProviderName;
  text: string;
  voiceId: string | null;
}): Promise<Buffer> {
  const voice = resolveVoiceId(input.provider, input.voiceId);

  if (input.provider === "elevenlabs") {
    if (!env.ELEVENLABS_API_KEY) throw new VoiceConfigError("ElevenLabs is not configured on this server.");
    return fetchAudio(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: {
          "xi-api-key": env.ELEVENLABS_API_KEY,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        body: JSON.stringify({ text: input.text, model_id: env.ELEVENLABS_TTS_MODEL }),
      },
      "ElevenLabs",
    );
  }

  if (!env.FISH_API_KEY) throw new VoiceConfigError("Fish Audio is not configured on this server.");
  return fetchAudio(
    "https://api.fish.audio/v1/tts",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.FISH_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text: input.text, reference_id: voice, format: "mp3" }),
    },
    "Fish Audio",
  );
}

/** Parses the length of an audio file from `ffmpeg -i` output (seconds), or null. */
export function parseAudioDuration(stderr: string): number | null {
  const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr);
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}
