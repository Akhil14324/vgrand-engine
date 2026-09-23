import type {
  GenerateParams,
  GenerateResult,
  ImageProvider,
} from "./types.js";
import { ProviderError } from "./types.js";

const DEFAULT_API_URL = "https://api.ideogram.ai/v1/ideogram-v4/generate";

/**
 * Ideogram 4.0 — strongest clean rendered text/typography. Pin it on
 * text-heavy themes (offer posters with prices/headlines) via
 * styleGuide.preferredProvider when Flare's text isn't crisp enough.
 *
 * NOTE: Ideogram's request shape changes between API versions — if your key
 * targets a different version, adjust IDEOGRAM_API_URL and the body below.
 */
export class IdeogramProvider implements ImageProvider {
  name = "ideogram" as const;

  private get apiKey(): string {
    const key = process.env.IDEOGRAM_API_KEY;
    if (!key) {
      throw new ProviderError(this.name, "IDEOGRAM_API_KEY is not configured");
    }
    return key;
  }

  async generate(params: GenerateParams): Promise<GenerateResult> {
    const apiUrl = process.env.IDEOGRAM_API_URL ?? DEFAULT_API_URL;
    const body: Record<string, unknown> = {
      prompt: params.prompt,
      aspect_ratio: toAspectRatio(params.size),
      rendering_speed: params.quality === "high" ? "QUALITY" : "DEFAULT",
      magic_prompt: "OFF",
      num_images: params.n ?? 1,
    };
    if (params.mode === "edit" && params.referenceImageUrl) {
      body.image = params.referenceImageUrl;
    }

    const res = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Api-Key": this.apiKey,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new ProviderError(
        this.name,
        `request failed (${res.status}): ${await res.text()}`,
      );
    }

    const data = (await res.json()) as { data?: Array<{ url?: string }> };
    const images = (data.data ?? [])
      .filter((d): d is { url: string } => Boolean(d.url))
      .map((d) => ({ url: d.url, mimeType: "image/png" }));
    if (images.length === 0) {
      throw new ProviderError(this.name, "no images returned");
    }
    return { images, metadata: { model: "ideogram-4.0" } };
  }
}

function toAspectRatio(size?: string): string {
  switch (size) {
    case "1024x1536":
      return "2x3";
    case "1536x1024":
      return "3x2";
    default:
      return "1x1";
  }
}
