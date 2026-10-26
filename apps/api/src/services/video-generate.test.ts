import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const submitClip = vi.fn();
const pollClip = vi.fn();
vi.mock("./video-gen/providers.js", () => ({
  submitClip: (...a: unknown[]) => submitClip(...a),
  pollClip: (...a: unknown[]) => pollClip(...a),
}));

const assertVideoBudget = vi.fn();
const recordVideoUsage = vi.fn();
vi.mock("../lib/video-usage.js", () => ({
  assertVideoBudget: (...a: unknown[]) => assertVideoBudget(...a),
  recordVideoUsage: (...a: unknown[]) => recordVideoUsage(...a),
}));

const { generateClip, ClipGenerationError } = await import("./video-generate.js");

let dir: string;
const base = {
  userId: "u1",
  projectId: "p1",
  model: "veo-3.1-lite" as const,
  prompt: "Steam",
  lengthSec: 5,
  width: 720,
  height: 1280,
  resolution: "720p" as const,
  fileName: "gen-1.mp4",
  pollMs: 0,
  sleep: async () => {},
};

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "gen-test-"));
  submitClip.mockReset();
  pollClip.mockReset();
  assertVideoBudget.mockReset().mockResolvedValue(undefined);
  recordVideoUsage.mockReset().mockResolvedValue(undefined);
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await rm(dir, { recursive: true, force: true });
});

describe("generateClip", () => {
  it("submits, waits, downloads, saves the clip and records the spend", async () => {
    submitClip.mockResolvedValue("op-1");
    pollClip
      .mockResolvedValueOnce({ state: "running" })
      .mockResolvedValueOnce({ state: "done", url: "https://files/clip", headers: { "x-goog-api-key": "k" } });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array([7, 7, 7]), { status: 200 })));

    const filePath = await generateClip({ ...base, workDir: dir });

    expect(submitClip).toHaveBeenCalledWith(expect.objectContaining({ model: "veo-3.1-lite", durationSec: 6 }));
    expect(pollClip).toHaveBeenCalledTimes(2);
    expect(Array.from(await readFile(filePath))).toEqual([7, 7, 7]);
    // Veo 3.1 Lite at 720p: 6 requested seconds x $0.05 = $0.30.
    expect(recordVideoUsage).toHaveBeenCalledWith("u1", "p1", 300_000, 6);
  });

  it("checks the budget before submitting anything", async () => {
    assertVideoBudget.mockRejectedValue(new Error("over budget"));
    await expect(generateClip({ ...base, workDir: dir })).rejects.toThrow("over budget");
    expect(submitClip).not.toHaveBeenCalled();
  });

  it("reports a clip the model failed to make", async () => {
    submitClip.mockResolvedValue("op-1");
    pollClip.mockResolvedValue({ state: "failed", message: "blocked by safety filter" });
    const err = await generateClip({ ...base, workDir: dir }).catch((e: Error) => e);
    expect(err).toBeInstanceOf(ClipGenerationError);
    expect((err as Error).message).toMatch(/blocked by safety filter/);
    expect(recordVideoUsage).not.toHaveBeenCalled();
  });

  it("gives up after the timeout instead of polling forever", async () => {
    submitClip.mockResolvedValue("op-1");
    pollClip.mockResolvedValue({ state: "running" });
    await expect(generateClip({ ...base, workDir: dir, timeoutMs: -1 })).rejects.toThrow(/took too long/);
  });

  it("refuses a download that fails", async () => {
    submitClip.mockResolvedValue("op-1");
    pollClip.mockResolvedValue({ state: "done", url: "https://files/clip" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 404 })));
    await expect(generateClip({ ...base, workDir: dir })).rejects.toThrow(/Downloading the generated clip failed \(404\)/);
  });

  it("refuses a shot longer than the model can make", async () => {
    await expect(generateClip({ ...base, lengthSec: 9, workDir: dir })).rejects.toThrow(/longer than/);
  });
});
