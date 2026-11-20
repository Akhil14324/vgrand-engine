import type { ShortsChannelRow } from "./channels.js";
import type { ShortsVideoRow } from "./videos.js";

/** Path C could not run (no provider, budget cap, generation failed): the caller falls back to Path B. */
export class PathCFallback extends Error {
  constructor(
    public reason: "not_configured" | "budget_cap" | "price_unset" | "generation_failed",
    message: string,
  ) {
    super(message);
  }
}

/** Phase 7 replaces this with budget-checked generation. Until then Path C always falls back. */
export async function generateClipsForVideo(
  _video: ShortsVideoRow,
  _channel: ShortsChannelRow,
  _beats: { narration: string; startSec: number; endSec: number }[],
  _dir: string,
): Promise<void> {
  throw new PathCFallback("not_configured", "Path C clip generation is not available yet");
}
