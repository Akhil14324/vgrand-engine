import type { Theme } from "@prompthub/db";
import {
  PROVIDERS,
  type ProviderName,
  type ThemeStyleGuide,
} from "@prompthub/types";

/**
 * Used when no theme is armed — any free-form prompt should still produce a
 * good image, so the fallback template stays generic.
 */
export const DEFAULT_PROMPT_TEMPLATE = `Create a high-quality, polished image based on the following description. Compose it like a professional designer or photographer would: clear subject, intentional lighting, clean composition. If the request includes text, render it crisply and spell it exactly as given.`;

export function buildFinalPrompt(
  theme: Pick<Theme, "promptTemplate" | "styleGuide"> | null,
  prompt: string,
): string {
  const template = theme?.promptTemplate?.trim() || DEFAULT_PROMPT_TEMPLATE;
  const parts = [template, `\nUser request: ${prompt.trim()}`];

  const guide = (theme?.styleGuide ?? null) as ThemeStyleGuide | null;
  if (guide?.palette?.length) {
    parts.push(`\nPreferred color palette: ${guide.palette.join(", ")}.`);
  }
  if (guide?.layoutHints) {
    parts.push(`\nLayout guidance: ${guide.layoutHints}.`);
  }
  if (guide?.negativePrompt) {
    parts.push(`\nAvoid: ${guide.negativePrompt}.`);
  }
  return parts.join("");
}

export function resolveProvider(
  theme: Pick<Theme, "styleGuide"> | null,
  override?: string,
): ProviderName {
  if (override && (PROVIDERS as readonly string[]).includes(override)) {
    return override as ProviderName;
  }
  const pinned = (theme?.styleGuide as ThemeStyleGuide | null)
    ?.preferredProvider;
  if (pinned && (PROVIDERS as readonly string[]).includes(pinned)) {
    return pinned;
  }
  return "openai";
}
