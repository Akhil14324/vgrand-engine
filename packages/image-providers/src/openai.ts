import OpenAI, { toFile } from "openai";
import type {
  GenerateParams,
  GenerateResult,
  GeneratedImage,
  ImageProvider,
} from "./types.js";
import { ProviderError } from "./types.js";

/**
 * OpenAI GPT Image 2.5 — default engine.
 *   draft mode -> gpt-image-2.5-flare    (fast, general-purpose first drafts)
 *   edit  mode -> gpt-image-2.5-sunburst (keeps subject/layout, changes one thing)
 *
 * Billing is token-based (image input $8/M, cached input $2/M, image output
 * $30/M, text input $5/M — same for both models), so cost tracks the quality
 * tier. Default to "low" for drafts; let users opt into higher tiers only on
 * the poster they keep.
 */
export const OPENAI_DRAFT_MODEL = "gpt-image-2.5-flare";
export const OPENAI_EDIT_MODEL = "gpt-image-2.5-sunburst";

export class OpenAIImageProvider implements ImageProvider {
  name = "openai" as const;
  private client?: OpenAI;

  private getClient(): OpenAI {
    if (!process.env.OPENAI_API_KEY) {
      throw new ProviderError(this.name, "OPENAI_API_KEY is not configured");
    }
    this.client ??= new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: process.env.OPENAI_BASE_URL || undefined,
    });
    return this.client;
  }

  async generate(params: GenerateParams): Promise<GenerateResult> {
    const client = this.getClient();
    const model =
      params.mode === "edit" ? OPENAI_EDIT_MODEL : OPENAI_DRAFT_MODEL;
    const quality = params.quality ?? "low";
    const size = params.size ?? "auto";

    try {
      if (params.mode === "edit" && params.referenceImageUrl) {
        const image = await fetchImageFile(params.referenceImageUrl);
        const res = await client.images.edit({
          model,
          image,
          prompt: params.prompt,
          size: size === "auto" ? undefined : size,
          quality,
        });
        return {
          images: mapImages(res.data ?? []),
          metadata: { model, quality, size, usage: res.usage },
        };
      }

      const res = await client.images.generate({
        model,
        prompt: params.prompt,
        n: params.n ?? 1,
        size: size === "auto" ? undefined : size,
        quality,
      });
      return {
        images: mapImages(res.data ?? []),
        metadata: { model, quality, size, usage: res.usage },
      };
    } catch (err) {
      throw new ProviderError(this.name, describeError(err), err);
    }
  }
}

/** Unwrap the SDK's APIError to the provider's own message (quota, model, etc). */
function describeError(err: unknown): string {
  const e = err as {
    error?: { message?: string };
    message?: string;
  } | null;
  return e?.error?.message ?? e?.message ?? "generation request failed";
}

function mapImages(
  data: Array<{ b64_json?: string | null; url?: string | null }>,
): GeneratedImage[] {
  return data
    .map((d) => ({
      b64Json: d.b64_json ?? undefined,
      url: d.url ?? undefined,
      mimeType: "image/png",
    }))
    .filter((d) => d.b64Json || d.url);
}

async function fetchImageFile(url: string): Promise<File> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new ProviderError(
      "openai",
      `failed to fetch reference image (${res.status})`,
    );
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const name = url.split("/").pop()?.split("?")[0] || "reference.png";
  return toFile(buf, name);
}
