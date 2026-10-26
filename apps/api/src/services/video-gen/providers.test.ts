import { afterEach, describe, expect, it, vi } from "vitest";
import { env } from "../../env.js";
import {
  buildKlingSubmit,
  buildRunwaySubmit,
  buildVeoSubmit,
  ClipProviderUnavailable,
  parseKlingTask,
  parseRunwayTask,
  parseVeoOperation,
  pollClip,
  submitClip,
  veoAspectRatio,
  type ClipRequest,
} from "./providers.js";

const mutableEnv = env as unknown as Record<string, string | undefined>;

const req: ClipRequest = {
  model: "veo-3.1-lite",
  prompt: "Steam over a loaf",
  durationSec: 8,
  width: 720,
  height: 1280,
  resolution: "720p",
};

afterEach(() => {
  vi.unstubAllGlobals();
  mutableEnv.GOOGLE_AI_API_KEY = undefined;
  mutableEnv.RUNWAY_API_KEY = undefined;
  mutableEnv.KLING_API_KEY = undefined;
});

describe("request shapes", () => {
  it("builds a Veo long-running request with the key in a header", () => {
    const { url, init } = buildVeoSubmit(req, "g-key");
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/models/veo-3.1-lite-generate-preview:predictLongRunning");
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("g-key");
    expect(JSON.parse(init.body as string)).toEqual({
      instances: [{ prompt: "Steam over a loaf" }],
      parameters: { aspectRatio: "9:16", durationSeconds: 8, resolution: "720p", sampleCount: 1 },
    });
  });

  it("refuses square frames for Veo rather than changing the shape", () => {
    expect(() => veoAspectRatio(1080, 1080)).toThrow(/9:16 and 16:9 only/);
    expect(veoAspectRatio(1920, 1080)).toBe("16:9");
  });

  it("builds a Runway text-to-video request with the frame as a ratio string", () => {
    const { url, init } = buildRunwaySubmit({ ...req, model: "runway-gen4.5", durationSec: 10 }, "r-key");
    expect(url).toBe("https://api.dev.runwayml.com/v1/text_to_video");
    expect((init.headers as Record<string, string>)["X-Runway-Version"]).toBe("2024-11-06");
    expect(JSON.parse(init.body as string)).toEqual({
      model: "gen4.5",
      promptText: "Steam over a loaf",
      ratio: "720:1280",
      duration: 10,
    });
  });

  it("builds a Kling request with the duration as a string", () => {
    const { url, init } = buildKlingSubmit({ ...req, model: "kling-3-standard", durationSec: 5 }, "k-key");
    expect(url).toBe("https://api.klingai.com/v1/videos/text2video");
    expect(JSON.parse(init.body as string)).toMatchObject({ model_name: "kling-v3", duration: "5", aspect_ratio: "9:16" });
  });
});

describe("response parsing", () => {
  it("reads a Veo operation: running, finished, and failed", () => {
    expect(parseVeoOperation({ done: false }, "k")).toEqual({ state: "running" });
    expect(
      parseVeoOperation(
        { done: true, response: { generateVideoResponse: { generatedSamples: [{ video: { uri: "https://files/x" } }] } } },
        "k",
      ),
    ).toEqual({ state: "done", url: "https://files/x", headers: { "x-goog-api-key": "k" } });
    expect(parseVeoOperation({ done: true, error: { message: "blocked" } }, "k")).toEqual({ state: "failed", message: "blocked" });
  });

  it("reads a Runway task", () => {
    expect(parseRunwayTask({ status: "RUNNING" })).toEqual({ state: "running" });
    expect(parseRunwayTask({ status: "SUCCEEDED", output: ["https://out/a.mp4"] })).toEqual({
      state: "done",
      url: "https://out/a.mp4",
    });
    expect(parseRunwayTask({ status: "FAILED", failure: "content" })).toEqual({ state: "failed", message: "content" });
  });

  it("reads a Kling task", () => {
    expect(parseKlingTask({ data: { task_status: "processing" } })).toEqual({ state: "running" });
    expect(
      parseKlingTask({ data: { task_status: "succeed", task_result: { videos: [{ url: "https://k/v.mp4" }] } } }),
    ).toEqual({ state: "done", url: "https://k/v.mp4" });
    expect(parseKlingTask({ data: { task_status: "failed", task_status_msg: "bad prompt" } })).toEqual({
      state: "failed",
      message: "bad prompt",
    });
  });
});

describe("calls", () => {
  it("refuses to submit when the provider has no key", async () => {
    await expect(submitClip(req)).rejects.toBeInstanceOf(ClipProviderUnavailable);
  });

  it("returns the Veo operation name from submit", async () => {
    mutableEnv.GOOGLE_AI_API_KEY = "g-key";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ name: "models/x/operations/1" }), { status: 200 })));
    await expect(submitClip(req)).resolves.toBe("models/x/operations/1");
  });

  it("doesn't put the provider's error body into the message", async () => {
    mutableEnv.RUNWAY_API_KEY = "r-key";
    vi.stubGlobal("fetch", vi.fn(async () => new Response("key r-key was rejected", { status: 403 })));
    const err = await submitClip({ ...req, model: "runway-gen4.5", durationSec: 10 }).catch((e: Error) => e);
    expect((err as Error).message).toBe("Runway request failed (403)");
  });

  it("polls Kling with the task id", async () => {
    mutableEnv.KLING_API_KEY = "k-key";
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: { task_status: "processing" } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(pollClip("kling-3-standard", "task-9")).resolves.toEqual({ state: "running" });
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe("https://api.klingai.com/v1/videos/text2video/task-9");
  });
});
