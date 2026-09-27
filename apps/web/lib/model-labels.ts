/**
 * Internal model/provider identifiers (e.g. "gpt-image-2.5-flare",
 * "gpt-image-2.5-sunburst", "openai", "flux", "ideogram") should never be
 * shown to end users — they're implementation details that can change at
 * any time and reveal which third-party vendors we route to. Anywhere the
 * UI wants to display "what generated this", route the raw value through
 * `friendlyEngineLabel` first.
 */
const IMAGE_ENGINE_LABEL = "CatGPT Image";
const CHAT_ENGINE_LABEL = "CatGPT";

const IMAGE_HINTS = ["gpt-image", "flare", "sunburst", "flux", "ideogram", "dall-e"];

export function friendlyEngineLabel(raw: string | null | undefined): string {
  if (!raw) return CHAT_ENGINE_LABEL;
  const lower = raw.toLowerCase();
  if (IMAGE_HINTS.some((hint) => lower.includes(hint))) return IMAGE_ENGINE_LABEL;
  return CHAT_ENGINE_LABEL;
}
