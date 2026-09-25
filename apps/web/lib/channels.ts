import type { ImageSize } from "@catgpt/types";

/**
 * Named output canvases for image generation. Users think in channels, not
 * pixels — each preset maps to one of the API's three real aspect ratios
 * (the providers only offer square / portrait / landscape).
 */
export interface ChannelPreset {
  id: ImageSize;
  label: string;
  /** What this aspect ratio is typically used for. */
  hint: string;
}

export const CHANNEL_PRESETS: ChannelPreset[] = [
  { id: "auto", label: "Auto", hint: "Model picks the best fit" },
  { id: "1024x1024", label: "Square", hint: "Instagram & Facebook posts" },
  { id: "1024x1536", label: "Portrait", hint: "Stories, Reels, WhatsApp status" },
  { id: "1536x1024", label: "Landscape", hint: "LinkedIn, YouTube, banners" },
];

export const channelLabel = (size: ImageSize) =>
  CHANNEL_PRESETS.find((p) => p.id === size)?.label ?? "Auto";
