import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../env.js", () => ({ env: { GOOGLE_AI_API_KEY: "test-key", GEMINI_MODEL: "gemini-test" } }));
const { geminiJson, GeminiError } = await import("./gemini.js");

const answer = (text: string, finishReason = "STOP") =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, finishReason }] }), { status: 200 });

describe("geminiJson failures are GeminiErrors with a reason", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it("parses a good answer", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(answer('{"ok":true}'));
    await expect(geminiJson({ system: "s", parts: [{ text: "x" }] })).resolves.toEqual({ ok: true });
  });

  it("cut-off JSON", async () => {
    // A cut-off answer is retried once (main's behaviour), so both calls get the same cut-off answer.
    vi.mocked(fetch).mockImplementation(async () => answer('{"summary":"half', "MAX_TOKENS"));
    const err = await geminiJson({ system: "s", parts: [{ text: "x" }] }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GeminiError);
    expect((err as Error).message).toBe("Gemini's answer was cut off or unreadable (MAX_TOKENS)");
  });

  it("dropped connection", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError("fetch failed"));
    const err = await geminiJson({ system: "s", parts: [{ text: "x" }] }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GeminiError);
    expect((err as Error).message).toBe("Could not reach Gemini (fetch failed)");
  });

  it("empty answer names the finish reason", async () => {
    vi.mocked(fetch).mockImplementation(async () => answer("", "SAFETY"));
    await expect(geminiJson({ system: "s", parts: [{ text: "x" }] })).rejects.toThrow("Gemini returned an empty response (SAFETY)");
  });
});
