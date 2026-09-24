import { env } from "../env.js";

/**
 * Jev (TypeSafe AI) — a System One evaluation model. One endpoint,
 * POST /v1/systemone: send a `state` plus a map of typed questions and get
 * back structured answers with probabilities — `noul` (yes/no 0..1),
 * `choice` (pick an option) and `score` (rubric grade). It never generates
 * prose, so it can't write replies; it exists for the classification and
 * gating decisions that would otherwise spend a chat-model call or rely on
 * a brittle regex.
 *
 * No TYPESAFE_API_KEY = feature off; every caller keeps its old code path.
 */

export const jevConfigured = (): boolean => Boolean(env.TYPESAFE_API_KEY);

export type JevQuestion =
  | { type: "noul"; instructions: string }
  | {
      type: "choice";
      instructions: string;
      criteria: Record<string, string | null>;
    }
  | { type: "score"; instructions: string; criteria: string[] };

/** Answer fields are read defensively — the API adds fields per type. */
export interface JevAnswer {
  type?: string;
  /** noul: yes/no probability, 0..1. */
  noul?: number;
  /** choice: winning option key. */
  choice?: string;
  /** choice/score: per-option probabilities. */
  probabilities?: Record<string, number>;
  /** choice/score only — noul answers carry no separate confidence. */
  confidence?: number;
  /** score: probability-weighted level, can land between integers. */
  score?: number;
}

export type JevState = string | string[] | Record<string, unknown>;

export async function evaluate(
  state: JevState,
  questions: Record<string, JevQuestion>,
): Promise<Record<string, JevAnswer>> {
  if (!env.TYPESAFE_API_KEY) {
    throw new Error("TYPESAFE_API_KEY is not configured");
  }
  const res = await fetch(`${env.TYPESAFE_BASE_URL}/v1/systemone`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.TYPESAFE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: env.JEV_MODEL, state, questions }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    throw new Error(`jev evaluation failed (${res.status})`);
  }
  const body = (await res.json()) as {
    answers?: Record<string, JevAnswer>;
  };
  return body.answers ?? {};
}

/**
 * evaluate() that never throws: null when Jev is unconfigured or the call
 * fails. Callers treat null as "no opinion" and keep their existing path —
 * every Jev feature is additive, never a hard dependency.
 */
export async function evaluateSafe(
  state: JevState,
  questions: Record<string, JevQuestion>,
): Promise<Record<string, JevAnswer> | null> {
  if (!jevConfigured()) return null;
  try {
    return await evaluate(state, questions);
  } catch (err) {
    console.warn("[jev] evaluation failed:", (err as Error).message);
    return null;
  }
}
