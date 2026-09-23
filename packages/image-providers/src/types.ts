import type { ImageSize, ProviderName, Quality } from "@prompthub/types";

/** "draft" = fresh generation (flare), "edit" = iterate on a reference (sunburst). */
export type GenerationMode = "draft" | "edit";

export interface GenerateParams {
  prompt: string;
  mode: GenerationMode;
  /** Required for edit mode — the image being iterated on. */
  referenceImageUrl?: string;
  /** All reference images (first == referenceImageUrl). Providers that only
   * accept one image use the first. */
  referenceImageUrls?: string[];
  quality?: Quality;
  size?: ImageSize;
  n?: number;
}

export interface GeneratedImage {
  /** Provider-hosted URL (may expire — the worker persists it to storage). */
  url?: string;
  /** Base64 payload, no data: prefix (gpt-image models return this). */
  b64Json?: string;
  mimeType?: string;
}

export interface GenerateResult {
  images: GeneratedImage[];
  metadata: Record<string, unknown>;
}

export interface ImageProvider {
  name: ProviderName;
  generate(params: GenerateParams): Promise<GenerateResult>;
}

export class ProviderError extends Error {
  constructor(
    public readonly provider: string,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(`[${provider}] ${message}`);
    this.name = "ProviderError";
  }
}
