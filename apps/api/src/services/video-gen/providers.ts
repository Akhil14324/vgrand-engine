import type { VideoModelId, VideoResolution } from "@catgpt/types";
import { env } from "../../env.js";

/**
 * Text-to-video adapters for Google Veo (Gemini API), Runway and Kling.
 *
 * Endpoints and field names are from the vendors' public docs and the
 * third-party references available when this was written. They are NOT yet
 * verified against a live key. Before the first paid render, check each one
 * against the vendor's current API reference: Veo model IDs, Runway ratio
 * strings, Kling model_name and auth scheme.
 */

export interface ClipRequest {
  model: VideoModelId;
  prompt: string;
  /** The clip length to request from the model (already rounded up to a length it offers). */
  durationSec: number;
  width: number;
  height: number;
  resolution: VideoResolution;
}

export type ClipStatus =
  | { state: "running" }
  | { state: "done"; url: string; headers?: Record<string, string> }
  | { state: "failed"; message: string };

/** Vendor model names. Lite and Fast IDs for Veo are unconfirmed. */
export const PROVIDER_MODEL_NAME: Record<VideoModelId, string> = {
  "veo-3.1-lite": "veo-3.1-lite-generate-preview",
  "veo-3.1-fast": "veo-3.1-fast-generate-preview",
  "veo-3.1": "veo-3.1-generate-preview",
  "runway-gen4-turbo": "gen4_turbo",
  "runway-gen4.5": "gen4.5",
  "kling-3-standard": "kling-v3",
};

const GOOGLE_BASE = "https://generativelanguage.googleapis.com/v1beta";
const RUNWAY_BASE = "https://api.dev.runwayml.com/v1";
const RUNWAY_VERSION = "2024-11-06";
const KLING_BASE = "https://api.klingai.com/v1";

const REQUEST_TIMEOUT_MS = 60_000;

/* ------------------------------- request shapes ------------------------------ */

/** Veo takes only 16:9 and 9:16 here. Other shapes are refused rather than silently changed. */
export function veoAspectRatio(width: number, height: number): "9:16" | "16:9" {
  if (height > width) return "9:16";
  if (width > height) return "16:9";
  throw new Error("Veo supports 9:16 and 16:9 only. Pick one of those for this reel.");
}

export function buildVeoSubmit(req: ClipRequest, apiKey: string) {
  return {
    url: `${GOOGLE_BASE}/models/${PROVIDER_MODEL_NAME[req.model]}:predictLongRunning`,
    init: {
      method: "POST",
      headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        instances: [{ prompt: req.prompt }],
        parameters: {
          aspectRatio: veoAspectRatio(req.width, req.height),
          durationSeconds: req.durationSec,
          resolution: req.resolution,
          sampleCount: 1,
        },
      }),
    },
  };
}

export function buildRunwaySubmit(req: ClipRequest, apiKey: string) {
  return {
    url: `${RUNWAY_BASE}/text_to_video`,
    init: {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "X-Runway-Version": RUNWAY_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: PROVIDER_MODEL_NAME[req.model],
        promptText: req.prompt,
        ratio: `${req.width}:${req.height}`,
        duration: req.durationSec,
      }),
    },
  };
}

export function buildKlingSubmit(req: ClipRequest, apiKey: string) {
  const aspect = req.width === req.height ? "1:1" : req.height > req.width ? "9:16" : "16:9";
  return {
    url: `${KLING_BASE}/videos/text2video`,
    init: {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model_name: PROVIDER_MODEL_NAME[req.model],
        prompt: req.prompt,
        duration: String(req.durationSec),
        aspect_ratio: aspect,
        mode: "std",
      }),
    },
  };
}

/* ------------------------------- response parsing ---------------------------- */

interface VeoOperation {
  name?: string;
  done?: boolean;
  error?: { message?: string };
  response?: { generateVideoResponse?: { generatedSamples?: { video?: { uri?: string } }[] } };
}

export function parseVeoOperation(op: VeoOperation, apiKey: string): ClipStatus {
  if (op.error) return { state: "failed", message: op.error.message ?? "Veo could not make this clip." };
  if (!op.done) return { state: "running" };
  const uri = op.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
  if (!uri) return { state: "failed", message: "Veo finished without a video." };
  return { state: "done", url: uri, headers: { "x-goog-api-key": apiKey } };
}

interface RunwayTask {
  status?: string;
  output?: string[];
  failure?: string;
}

export function parseRunwayTask(task: RunwayTask): ClipStatus {
  switch (task.status) {
    case "SUCCEEDED":
      return task.output?.[0]
        ? { state: "done", url: task.output[0] }
        : { state: "failed", message: "Runway finished without a video." };
    case "FAILED":
    case "CANCELLED":
      return { state: "failed", message: task.failure ?? "Runway could not make this clip." };
    default:
      return { state: "running" };
  }
}

interface KlingTask {
  data?: {
    task_status?: string;
    task_status_msg?: string;
    task_result?: { videos?: { url?: string }[] };
  };
}

export function parseKlingTask(task: KlingTask): ClipStatus {
  const data = task.data;
  switch (data?.task_status) {
    case "succeed": {
      const url = data.task_result?.videos?.[0]?.url;
      return url ? { state: "done", url } : { state: "failed", message: "Kling finished without a video." };
    }
    case "failed":
      return { state: "failed", message: data.task_status_msg ?? "Kling could not make this clip." };
    default:
      return { state: "running" };
  }
}

/* ------------------------------------ calls ---------------------------------- */

/** Calls a vendor endpoint. Error bodies are dropped on purpose: they can echo keys or prompts. */
async function callJson<T>(url: string, init: RequestInit, label: string): Promise<T> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`${label} request failed (${res.status})`);
  return (await res.json()) as T;
}

function keyFor(model: VideoModelId): string {
  const provider = model.startsWith("veo") ? "google" : model.startsWith("runway") ? "runway" : "kling";
  const key =
    provider === "google" ? env.GOOGLE_AI_API_KEY : provider === "runway" ? env.RUNWAY_API_KEY : env.KLING_API_KEY;
  if (!key) throw new ClipProviderUnavailable(provider);
  return key;
}

/** The chosen provider has no key on this server. Its message is safe to show. */
export class ClipProviderUnavailable extends Error {
  constructor(provider: string) {
    super(`${provider === "google" ? "Google Veo" : provider === "runway" ? "Runway" : "Kling"} is not configured on this server.`);
  }
}

/** Starts a clip. Returns the vendor's task id. */
export async function submitClip(req: ClipRequest): Promise<string> {
  const key = keyFor(req.model);
  if (req.model.startsWith("veo")) {
    const { url, init } = buildVeoSubmit(req, key);
    const op = await callJson<VeoOperation>(url, init, "Veo");
    if (!op.name) throw new Error("Veo did not return an operation");
    return op.name;
  }
  if (req.model.startsWith("runway")) {
    const { url, init } = buildRunwaySubmit(req, key);
    const task = await callJson<{ id?: string }>(url, init, "Runway");
    if (!task.id) throw new Error("Runway did not return a task");
    return task.id;
  }
  const { url, init } = buildKlingSubmit(req, key);
  const res = await callJson<{ data?: { task_id?: string } }>(url, init, "Kling");
  if (!res.data?.task_id) throw new Error("Kling did not return a task");
  return res.data.task_id;
}

/** Checks a clip started with submitClip. */
export async function pollClip(model: VideoModelId, taskId: string): Promise<ClipStatus> {
  const key = keyFor(model);
  if (model.startsWith("veo")) {
    const op = await callJson<VeoOperation>(
      `${GOOGLE_BASE}/${taskId}`,
      { headers: { "x-goog-api-key": key } },
      "Veo",
    );
    return parseVeoOperation(op, key);
  }
  if (model.startsWith("runway")) {
    const task = await callJson<RunwayTask>(
      `${RUNWAY_BASE}/tasks/${taskId}`,
      { headers: { Authorization: `Bearer ${key}`, "X-Runway-Version": RUNWAY_VERSION } },
      "Runway",
    );
    return parseRunwayTask(task);
  }
  const task = await callJson<KlingTask>(
    `${KLING_BASE}/videos/text2video/${taskId}`,
    { headers: { Authorization: `Bearer ${key}` } },
    "Kling",
  );
  return parseKlingTask(task);
}
