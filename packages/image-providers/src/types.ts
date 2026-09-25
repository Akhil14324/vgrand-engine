import type {
  ImageEditOperation,
  ImageSize,
  ProviderName,
  Quality,
} from "@catgpt/types";

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
  /** Structured edit request metadata; masked operations require a provider
   * that accepts an explicit mask. */
  operation?: ImageEditOperation;
  /** Optional uploaded PNG mask; transparent pixels mark the editable area. */
  maskImageUrl?: string;
  quality?: Quality;
  size?: ImageSize;
  n?: number;
  /** Progressive preview hook — providers that stream partials call it with
   * base64 payloads as they render; others never invoke it. */
  onPartialImage?: (b64: string, index: number) => void;
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

/**
 * Thrown from an `onPartialImage` callback to abort a streaming generation
 * early (e.g. the user hit Stop). Providers must let it propagate — it is
 * not a stream failure to retry, so fallback logic rethrows it untouched.
 */
export class ImageGenerationAborted extends Error {
  constructor(message = "image generation aborted") {
    super(message);
    this.name = "ImageGenerationAborted";
  }
}
