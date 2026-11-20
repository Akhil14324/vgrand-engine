import { generateJson, type LlmCall } from "./anthropic.js";
import { SCRIPT_JSON_SCHEMA } from "./script-logic.js";
import { downloadStock, searchStock } from "./stock.js";
import type { StockCandidate } from "./stock-logic.js";
import { synthesizeWithTimestamps, type VoiceResult } from "./tts.js";
import { offlineProviders } from "./offline.js";

/**
 * External services the Path B pipeline calls. `live` hits the real APIs.
 * `offline` (dry runs and tests only) generates local test fixtures with
 * ffmpeg and never touches the network; videos made that way are tagged
 * source="dry_run" and can never be uploaded.
 */
export interface ShortsProviders {
  name: "live" | "offline";
  script(prompt: { system: string; user: string }): Promise<LlmCall<unknown>>;
  searchStock(query: string): Promise<StockCandidate[]>;
  downloadStock(c: StockCandidate, dest: string): Promise<void>;
  voice(text: string, voiceId: string, destMp3: string): Promise<VoiceResult>;
}

export const liveProviders: ShortsProviders = {
  name: "live",
  script: (p) => generateJson({ ...p, schema: SCRIPT_JSON_SCHEMA as unknown as Record<string, unknown> }),
  searchStock,
  downloadStock: (c, dest) => downloadStock(c.downloadUrl, dest),
  voice: synthesizeWithTimestamps,
};

export function providersFor(video: { source: string }): ShortsProviders {
  return video.source === "dry_run" ? offlineProviders : liveProviders;
}
