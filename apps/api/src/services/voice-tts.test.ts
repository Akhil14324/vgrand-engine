import { afterEach, describe, expect, it, vi } from "vitest";
import { env } from "../env.js";
import { parseAudioDuration, resolveVoiceId, synthesizeLine, VoiceConfigError } from "./voice-tts.js";

const mutableEnv = env as unknown as Record<string, string | undefined>;

afterEach(() => {
  vi.unstubAllGlobals();
  mutableEnv.ELEVENLABS_API_KEY = undefined;
  mutableEnv.FISH_API_KEY = undefined;
  mutableEnv.ELEVENLABS_DEFAULT_VOICE_ID = undefined;
  mutableEnv.FISH_DEFAULT_VOICE_ID = undefined;
});

function stubFetch(response: Response) {
  const fn = vi.fn(async () => response);
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("resolveVoiceId", () => {
  it("prefers the brief's voice over the server default", () => {
    mutableEnv.ELEVENLABS_DEFAULT_VOICE_ID = "default-voice";
    expect(resolveVoiceId("elevenlabs", "chosen-voice")).toBe("chosen-voice");
  });

  it("falls back to the server default", () => {
    mutableEnv.FISH_DEFAULT_VOICE_ID = "fish-default";
    expect(resolveVoiceId("fish", null)).toBe("fish-default");
  });

  it("explains what to set when there's no voice at all", () => {
    expect(() => resolveVoiceId("elevenlabs", null)).toThrow(VoiceConfigError);
  });
});

describe("synthesizeLine", () => {
  it("refuses to run without the provider key", async () => {
    await expect(
      synthesizeLine({ provider: "elevenlabs", text: "Hello", voiceId: "v1" }),
    ).rejects.toThrow(/ElevenLabs is not configured/);
  });

  it("calls ElevenLabs with the voice in the path and the key in a header", async () => {
    mutableEnv.ELEVENLABS_API_KEY = "test-key";
    const fetchMock = stubFetch(new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
    const audio = await synthesizeLine({ provider: "elevenlabs", text: "Fresh every morning", voiceId: "voice/1" });
    expect(audio.byteLength).toBe(3);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/^https:\/\/api\.elevenlabs\.io\/v1\/text-to-speech\/voice%2F1\?output_format=mp3/);
    expect((init.headers as Record<string, string>)["xi-api-key"]).toBe("test-key");
    expect(JSON.parse(init.body as string).text).toBe("Fresh every morning");
  });

  it("calls Fish Audio with a bearer token and the reference id", async () => {
    mutableEnv.FISH_API_KEY = "fish-key";
    const fetchMock = stubFetch(new Response(new Uint8Array([9]), { status: 200 }));
    await synthesizeLine({ provider: "fish", text: "Hi", voiceId: "ref-7" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.fish.audio/v1/tts");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer fish-key");
    expect(JSON.parse(init.body as string)).toMatchObject({ text: "Hi", reference_id: "ref-7", format: "mp3" });
  });

  it("doesn't leak the provider's error body into the message", async () => {
    mutableEnv.ELEVENLABS_API_KEY = "test-key";
    stubFetch(new Response("secret echo of the request", { status: 401 }));
    const err = await synthesizeLine({ provider: "elevenlabs", text: "Hi", voiceId: "v" }).catch((e: Error) => e);
    expect((err as Error).message).toBe("ElevenLabs voice request failed (401)");
  });
});

describe("parseAudioDuration", () => {
  it("reads the Duration line from ffmpeg's output", () => {
    expect(parseAudioDuration("  Duration: 00:00:03.52, start: 0.025000, bitrate: 128 kb/s")).toBeCloseTo(3.52);
  });

  it("returns null when there's no duration", () => {
    expect(parseAudioDuration("no info here")).toBeNull();
  });
});
