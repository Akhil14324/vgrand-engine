import { getVideoModel, type VideoModelId } from "@catgpt/types";
import type { VideoGenProvider } from "./env-check-logic.js";
import { addDays, localDate, zonedToUtc } from "./schedule-logic.js";

/**
 * Path C budget: monthly cap in BUDGET_CURRENCY, per-second clip pricing,
 * and the provider → model mapping.
 */

export const PROVIDER_MODEL: Record<VideoGenProvider, VideoModelId> = {
  veo: "veo-3.1",
  "veo-fast": "veo-3.1-fast",
  "veo-lite": "veo-3.1-lite",
  runway: "runway-gen4-turbo",
  kling: "kling-3-standard",
};

/** Clips are generated at 720p (then scaled/cropped to 1080x1920), the cheaper tier. */
export const PATH_C_RESOLUTION = "720p" as const;

/** First instant of the current calendar month in `tz`. */
export function monthStart(now: Date, tz: string): Date {
  const d = localDate(now, tz);
  return zonedToUtc(`${d.slice(0, 7)}-01`, "00:00", tz);
}

/** First instant of next month in `tz` (when the budget resets). */
export function nextMonthStart(now: Date, tz: string): Date {
  const d = localDate(now, tz);
  const [y, m] = d.split("-").map(Number) as [number, number];
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  return zonedToUtc(next, "00:00", tz);
}
export { addDays };

/**
 * Price per generated second in BUDGET_CURRENCY. The owner's setting wins; with
 * no setting, the built-in USD list price is used only when the budget is in USD
 * (no guessed exchange rates). Null = unknown, so Path C refuses.
 */
export function pricePerSecond(input: { setting: number | null; currency: string | null; model: VideoModelId }): number | null {
  if (input.setting !== null && input.setting !== undefined) return input.setting;
  if (input.currency?.toUpperCase() !== "USD") return null;
  return getVideoModel(input.model)?.pricePerSecondUsd[PATH_C_RESOLUTION] ?? null;
}

/** Shortest clip length the model offers that covers `seconds`; else its longest (the clip is looped). */
export function clipSecondsFor(model: VideoModelId, seconds: number): number {
  const lens = [...(getVideoModel(model)?.clipLengthsSec ?? [5])].sort((a, b) => a - b);
  return lens.find((l) => l >= seconds) ?? lens[lens.length - 1]!;
}

export const round2 = (n: number) => Math.round(n * 100) / 100;

export interface BudgetCheck {
  ok: boolean;
  spent: number;
  remaining: number;
  estimate: number;
}

export function checkBudget(budget: number, spent: number, estimate: number): BudgetCheck {
  const remaining = round2(Math.max(0, budget - spent));
  return { ok: spent + estimate <= budget + 1e-9, spent: round2(spent), remaining, estimate: round2(estimate) };
}

/** Text prompt for one beat: what the camera shows, not the narration itself. */
export function clipPrompt(input: { niche: string; queries: string[]; narration: string }): string {
  const what = input.queries.length ? input.queries.join(", ") : input.niche;
  return (
    `Vertical 9:16 realistic video, ${input.niche}: ${what}. ` +
    `It illustrates: "${input.narration.slice(0, 200)}". ` +
    "Single continuous shot, natural lighting, no on-screen text, no logos, no watermarks, no recognisable real people."
  );
}
