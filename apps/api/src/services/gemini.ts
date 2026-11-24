import { env } from "../env.js";

/**
 * Minimal Gemini (Google AI Studio) REST client: JSON generation over text,
 * images and videos. Videos go through the Files API (upload -> wait until
 * ACTIVE -> reference by uri), which handles reels too big to inline.
 * The API key is sent as a header, never in a URL, and never logged.
 */

const BASE = "https://generativelanguage.googleapis.com/v1beta";
const UPLOAD_BASE = "https://generativelanguage.googleapis.com/upload/v1beta";
const REQUEST_TIMEOUT_MS = 180_000;
const FILE_READY_MAX_MS = 3 * 60_000;
const FILE_POLL_MS = 3_000;
/** Waits before retrying a busy (503) or rate-limited (429) answer. */
const BUSY_RETRY_DELAYS_MS = [4_000, 10_000, 20_000];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class GeminiError extends Error {}

export const geminiConfigured = () => Boolean(env.GOOGLE_AI_API_KEY);

function key(): string {
  if (!env.GOOGLE_AI_API_KEY) throw new GeminiError("Gemini is not configured on this server (GOOGLE_AI_API_KEY).");
  return env.GOOGLE_AI_API_KEY;
}

export type GeminiPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } }
  | { fileData: { mimeType: string; fileUri: string } };

async function readError(res: Response): Promise<string> {
  try {
    const j = (await res.json()) as { error?: { message?: string } };
    return j.error?.message ?? `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

/** One generateContent call that must return a JSON object. */
export async function geminiJson(opts: {
  system: string;
  parts: GeminiPart[];
  model?: string;
  temperature?: number;
  /** "low" asks the model to think briefly: classification and note-taking don't need long reasoning, which is what makes calls slow. */
  thinking?: "low" | "medium";
}): Promise<Record<string, unknown>> {
  const model = opts.model ?? env.GEMINI_MODEL;
  const send = (withThinking: boolean) =>
    fetch(`${BASE}/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": key(), "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: opts.system }] },
        contents: [{ role: "user", parts: opts.parts }],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: opts.temperature ?? 0.4,
          ...(withThinking ? { thinkingConfig: { thinkingLevel: opts.thinking } } : {}),
        },
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  let thinking: "low" | "medium" | null = opts.thinking ?? null;
  let res = await send(thinking !== null);
  // A model that doesn't know the thinking setting answers 400: run the same request without it.
  if (res.status === 400 && thinking) {
    thinking = null;
    res = await send(false);
  }
  // "High demand" (503) and rate limits (429) are temporary on Google's side: wait and try again.
  for (const waitMs of BUSY_RETRY_DELAYS_MS) {
    if (res.status !== 503 && res.status !== 429) break;
    await sleep(waitMs);
    res = await send(thinking !== null);
  }
  if (!res.ok) throw new GeminiError(`Gemini request failed: ${await readError(res)}`);
  const json = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
    promptFeedback?: { blockReason?: string };
  };
  if (json.promptFeedback?.blockReason) throw new GeminiError(`Gemini blocked the request (${json.promptFeedback.blockReason})`);
  const raw = (json.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("").trim();
  if (!raw) throw new GeminiError("Gemini returned an empty response");
  return parseJsonObject(raw);
}

/** Gemini sometimes wraps JSON in a code fence even in JSON mode; accept both. */
export function parseJsonObject(raw: string): Record<string, unknown> {
  const unfenced = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const parsed: unknown = JSON.parse(unfenced);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new GeminiError("Gemini did not return a JSON object");
  return parsed as Record<string, unknown>;
}

export interface GeminiFile {
  name: string;
  uri: string;
  mimeType: string;
}

/** Uploads bytes to the Files API and waits until Gemini can use them. Files expire on their own after 48h. */
export async function uploadGeminiFile(bytes: Uint8Array, mimeType: string, displayName: string): Promise<GeminiFile> {
  const start = await fetch(`${UPLOAD_BASE}/files`, {
    method: "POST",
    headers: {
      "x-goog-api-key": key(),
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(bytes.byteLength),
      "X-Goog-Upload-Header-Content-Type": mimeType,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ file: { display_name: displayName.slice(0, 120) } }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const uploadUrl = start.headers.get("x-goog-upload-url");
  if (!start.ok || !uploadUrl) throw new GeminiError(`Gemini upload could not start: ${await readError(start)}`);

  const done = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      "Content-Length": String(bytes.byteLength),
      "X-Goog-Upload-Offset": "0",
      "X-Goog-Upload-Command": "upload, finalize",
    },
    body: bytes,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!done.ok) throw new GeminiError(`Gemini upload failed: ${await readError(done)}`);
  let file = ((await done.json()) as { file?: { name?: string; uri?: string; mimeType?: string; state?: string } }).file;
  if (!file?.name || !file.uri) throw new GeminiError("Gemini upload returned no file");

  const deadline = Date.now() + FILE_READY_MAX_MS;
  while (file.state === "PROCESSING") {
    if (Date.now() > deadline) throw new GeminiError("Gemini took too long to process the video");
    await sleep(FILE_POLL_MS);
    const res = await fetch(`${BASE}/${file.name}`, {
      headers: { "x-goog-api-key": key() },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) throw new GeminiError(`Gemini file check failed: ${await readError(res)}`);
    file = { ...file, ...((await res.json()) as typeof file) };
  }
  if (file.state && file.state !== "ACTIVE") throw new GeminiError(`Gemini could not process the video (${file.state})`);
  return { name: file.name!, uri: file.uri!, mimeType: file.mimeType ?? mimeType };
}

/** Best effort: the file would expire anyway. */
export async function deleteGeminiFile(name: string): Promise<void> {
  await fetch(`${BASE}/${name}`, {
    method: "DELETE",
    headers: { "x-goog-api-key": key() },
    signal: AbortSignal.timeout(30_000),
  }).catch(() => {});
}
