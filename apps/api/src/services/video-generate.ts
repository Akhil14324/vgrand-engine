import { writeFile } from "node:fs/promises";
import path from "node:path";
import { clipLengthFor, estimateReelCostMicroUsd, type VideoModelId, type VideoResolution } from "@catgpt/types";
import { assertVideoBudget, recordVideoUsage } from "../lib/video-usage.js";
import { pollClip, submitClip, type ClipStatus } from "./video-gen/providers.js";

/** Largest clip we'll download from a vendor. */
const MAX_CLIP_BYTES = 200 * 1024 * 1024;
/** A clip that takes longer than this is treated as failed, not left running forever. */
const DEFAULT_TIMEOUT_MS = 15 * 60_000;
const DEFAULT_POLL_MS = 10_000;

/** A clip the vendor couldn't make. Its message is safe to show. */
export class ClipGenerationError extends Error {}

export interface GenerateClipOptions {
  userId: string;
  projectId: string;
  model: VideoModelId;
  prompt: string;
  /** Seconds the shot needs. The clip requested may be longer; the render trims it. */
  lengthSec: number;
  width: number;
  height: number;
  resolution: VideoResolution;
  workDir: string;
  fileName: string;
  /** Test hooks. Production uses the defaults. */
  pollMs?: number;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Makes one clip: budget check, submit, poll until done, download, record the
 * spend. Spend is recorded only after a clip is downloaded, so a failed
 * generation is not charged in this ledger.
 */
export async function generateClip(opts: GenerateClipOptions): Promise<string> {
  const requestedSec = clipLengthFor(opts.model, opts.lengthSec);
  if (requestedSec === null) {
    throw new ClipGenerationError(`${opts.lengthSec}s is longer than ${opts.model} can make in one clip.`);
  }
  const cost = estimateReelCostMicroUsd(opts.model, opts.resolution, requestedSec);
  await assertVideoBudget(opts.userId, cost);

  const taskId = await submitClip({
    model: opts.model,
    prompt: opts.prompt,
    durationSec: requestedSec,
    width: opts.width,
    height: opts.height,
    resolution: opts.resolution,
  });

  const status = await waitForClip(opts.model, taskId, opts);
  if (status.state !== "done") throw new ClipGenerationError("The video model could not make this clip.");

  const buffer = await download(status.url, status.headers);
  const filePath = path.join(opts.workDir, opts.fileName);
  await writeFile(filePath, buffer);
  await recordVideoUsage(opts.userId, opts.projectId, cost, requestedSec);
  return filePath;
}

async function waitForClip(
  model: VideoModelId,
  taskId: string,
  opts: Pick<GenerateClipOptions, "pollMs" | "timeoutMs" | "sleep">,
): Promise<Extract<ClipStatus, { state: "done" }>> {
  const pollMs = opts.pollMs ?? DEFAULT_POLL_MS;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const sleep = opts.sleep ?? wait;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const status = await pollClip(model, taskId);
    if (status.state === "done") return status;
    if (status.state === "failed") throw new ClipGenerationError(`The video model could not make this clip: ${status.message}`);
    if (Date.now() >= deadline) throw new ClipGenerationError("The video model took too long to make this clip.");
    await sleep(pollMs);
  }
}

/** Downloads a finished clip. Refuses oversized bodies before reading them. */
async function download(url: string, headers?: Record<string, string>): Promise<Buffer> {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(5 * 60_000) });
  if (!res.ok) throw new ClipGenerationError(`Downloading the generated clip failed (${res.status}).`);
  if (Number(res.headers.get("content-length") ?? 0) > MAX_CLIP_BYTES) {
    throw new ClipGenerationError("The generated clip is too large.");
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.byteLength === 0) throw new ClipGenerationError("The generated clip was empty.");
  if (buffer.byteLength > MAX_CLIP_BYTES) throw new ClipGenerationError("The generated clip is too large.");
  return buffer;
}
