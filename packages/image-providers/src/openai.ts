import OpenAI, { toFile } from "openai";
import type {
  GenerateParams,
  GenerateResult,
  GeneratedImage,
  ImageProvider,
} from "./types.js";
import { ImageGenerationAborted, ProviderError } from "./types.js";

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
      const refs =
        params.referenceImageUrls ??
        (params.referenceImageUrl ? [params.referenceImageUrl] : []);
      if (params.mode === "edit" && refs.length > 0) {
        const files = await Promise.all(refs.map(fetchImageFile));
        const image = files.length === 1 ? files[0]! : files;
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

      // Draft mode can stream progressive previews — partial images arrive
      // while the final render completes. Any stream failure falls back to a
      // plain generate call so the request never dies on a preview hiccup.
      if (params.onPartialImage) {
        try {
          const stream = await client.images.generate({
            model,
            prompt: params.prompt,
            n: params.n ?? 1,
            size: size === "auto" ? undefined : size,
            quality,
            stream: true,
            partial_images: 2,
          });
          let lastB64: string | undefined;
          for await (const evt of stream) {
            if (evt.type === "image_generation.partial_image") {
              lastB64 = evt.b64_json;
              params.onPartialImage(evt.b64_json, evt.partial_image_index);
            } else if (evt.type === "image_generation.completed") {
              lastB64 = evt.b64_json;
            }
          }
          if (lastB64) {
            return {
              images: [{ b64Json: lastB64, mimeType: "image/png" }],
              metadata: { model, quality, size },
            };
          }
        } catch (err) {
          // A throw from onPartialImage is a deliberate abort — never
          // retry it as a plain generate call.
          if (err instanceof ImageGenerationAborted) throw err;
          // fall through to the non-streaming call
        }
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

const SUPPORTED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

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
  // OpenAI rejects octet-stream, so set the type explicitly: prefer the
  // response header when it's an image, else infer from the file extension.
  const headerType = res.headers.get("content-type")?.split(";")[0]?.trim();
  const ext = name.split(".").pop()?.toLowerCase();
  const type =
    headerType && SUPPORTED_IMAGE_TYPES.has(headerType)
      ? headerType
      : ext === "jpg" || ext === "jpeg"
        ? "image/jpeg"
        : ext === "webp"
          ? "image/webp"
          : "image/png";
  return toFile(buf, name, { type });
}
