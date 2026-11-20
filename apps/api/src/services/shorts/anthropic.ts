import Anthropic from "@anthropic-ai/sdk";
import { env } from "../../env.js";
import { ShortsConfigError } from "./env-check.js";
import { PermanentJobError } from "./jobs.js";

/**
 * Claude API client for scripts and the weekly report. Model comes from
 * ANTHROPIC_MODEL. The SDK retries 408/409/429/5xx itself (maxRetries);
 * anything it gives up on is rethrown so the job queue backs off and retries.
 */

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!env.ANTHROPIC_API_KEY || !env.ANTHROPIC_MODEL) {
    throw new ShortsConfigError("Not configured: set ANTHROPIC_API_KEY and ANTHROPIC_MODEL");
  }
  client ??= new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 3, timeout: 120_000 });
  return client;
}

export interface LlmCall<T> {
  /** Exact request body sent (no API key), stored on the video. */
  request: Record<string, unknown>;
  /** Raw response message as returned by the API. */
  response: unknown;
  text: string;
  parsed: T | null;
}

function textOf(msg: Anthropic.Message): string {
  return msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

/** Extracts the first JSON object in a text reply (used when structured output isn't available). */
export function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * One JSON-producing call. Uses structured outputs (`output_config.format`);
 * if the configured model rejects that parameter, retries once with the schema
 * in the prompt instead. Refusals and truncation are surfaced as errors.
 */
export async function generateJson<T = unknown>(input: {
  system: string;
  user: string;
  schema: Record<string, unknown>;
  maxTokens?: number;
}): Promise<LlmCall<T>> {
  const c = getClient();
  const base = {
    model: env.ANTHROPIC_MODEL!,
    max_tokens: input.maxTokens ?? 16000,
    system: input.system,
    messages: [{ role: "user" as const, content: input.user }],
  };
  const structured = { ...base, output_config: { format: { type: "json_schema" as const, schema: input.schema } } };
  let request: Record<string, unknown> = structured;
  let msg: Anthropic.Message;
  try {
    msg = await c.messages.create(structured);
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
      throw new PermanentJobError(`Claude API rejected the key (${err.status}). Check ANTHROPIC_API_KEY.`);
    }
    if (err instanceof Anthropic.NotFoundError) {
      throw new PermanentJobError(`Claude API: model "${env.ANTHROPIC_MODEL}" not found. Check ANTHROPIC_MODEL.`);
    }
    if (err instanceof Anthropic.BadRequestError && /output_config|format|json_schema/i.test(err.message)) {
      const fallback = {
        ...base,
        messages: [
          {
            role: "user" as const,
            content: `${input.user}\n\nReply with only a JSON object matching this JSON Schema, no prose:\n${JSON.stringify(input.schema)}`,
          },
        ],
      };
      request = fallback;
      msg = await c.messages.create(fallback);
    } else {
      throw err;
    }
  }
  if (msg.stop_reason === "refusal") {
    throw new Error("Claude declined to write this script (refusal). It will be retried with a new idea.");
  }
  if (msg.stop_reason === "max_tokens") throw new Error("Claude's reply was cut off (max_tokens)");
  const text = textOf(msg);
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = extractJson(text);
  }
  return { request, response: msg, text, parsed: parsed as T | null };
}

/** Plain text call (weekly report). */
export async function generateText(input: { system: string; user: string; maxTokens?: number }): Promise<LlmCall<never>> {
  const c = getClient();
  const request = {
    model: env.ANTHROPIC_MODEL!,
    max_tokens: input.maxTokens ?? 8000,
    system: input.system,
    messages: [{ role: "user" as const, content: input.user }],
  };
  const msg = await c.messages.create(request);
  if (msg.stop_reason === "refusal") throw new Error("Claude declined to write the report (refusal)");
  return { request, response: msg, text: textOf(msg), parsed: null };
}
