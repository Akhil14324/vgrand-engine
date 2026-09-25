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

    try {
      return await this.callApi(client, model, params);
    } catch (err) {
      if (!isSafetyRejection(err)) {
        // callApi already wraps in ProviderError — don't double-prefix it.
        if (err instanceof ProviderError) throw err;
        throw new ProviderError(this.name, describeError(err), err);
      }
      // Self-heal once: the input filter refused a real-person/sensitive
      // likeness. Rewrite the prompt to depict the same intent symbolically
      // and retry — a refused portrait becomes the occasion's objects,
      // colours and motifs instead of a failed job.
      const rewritten = await this.depersonalize(client, params.prompt).catch(
        () => null,
      );
      if (!rewritten || rewritten === params.prompt) throw err;
      try {
        const res = await this.callApi(client, model, {
          ...params,
          prompt: rewritten,
        });
        return {
          ...res,
          metadata: {
            ...res.metadata,
            promptSanitized: true,
            sanitizedPrompt: rewritten,
          },
        };
      } catch (retryErr) {
        // The symbolic rewrite was refused too — surface the friendly message.
        if (retryErr instanceof ProviderError) throw retryErr;
        throw new ProviderError(this.name, describeError(retryErr), retryErr);
      }
    }
  }

  /**
   * A refused prompt usually names a real person or sensitive subject. One
   * cheap chat call rewrites it to symbolic imagery while preserving the
   * occasion, product, offer and exact on-image text.
   */
  private async depersonalize(
    client: OpenAI,
    prompt: string,
  ): Promise<string | null> {
    const res = await client.chat.completions.create({
      model: process.env.CHAT_MODEL?.trim() || "gpt-4o-mini",
      temperature: 0,
      max_tokens: 300,
      messages: [
        {
          role: "system",
          content:
            "You rewrite image-generation prompts that were refused because they could depict a real person or other sensitive subject. Keep the user's intent — the occasion, product, offer, mood, and any on-image text (kept verbatim, in quotes) — but replace every real person, public figure or graphic subject with symbolic or abstract imagery that fits (iconic objects, colours, places, motifs). Return ONLY the rewritten prompt, nothing else.",
        },
        { role: "user", content: prompt.slice(0, 4000) },
      ],
    });
    return res.choices[0]?.message.content?.trim() || null;
  }

  private async callApi(
    client: OpenAI,
    model: string,
    params: GenerateParams,
  ): Promise<GenerateResult> {
    const quality = params.quality ?? "low";
    const size = params.size ?? "auto";

    try {
      const refs =
        params.referenceImageUrls ??
        (params.referenceImageUrl ? [params.referenceImageUrl] : []);
      if (params.mode === "edit" && refs.length > 0) {
        const files = await Promise.all(refs.map(fetchImageFile));
        const image = files.length === 1 ? files[0]! : files;
        const mask = params.maskImageUrl
          ? await fetchImageFile(params.maskImageUrl)
          : undefined;
        const res = await client.images.edit({
          model,
          image,
          ...(mask ? { mask } : {}),
          prompt: params.prompt,
          size: size === "auto" ? undefined : (size as never),
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
            size: size === "auto" ? undefined : (size as never),
            quality,
            stream: true,
            partial_images: 2,
            // Marketing/design studio: the least restrictive documented level
            // cuts false-positive rejections on photorealistic renders and
            // product shots. Input-side prompt checks still apply.
            moderation: "low",
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
        size: size === "auto" ? undefined : (size as never),
        quality,
        moderation: "low",
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
const SAFETY_RE =
  /safety system|content[_ ]?policy|moderation_blocked|declined this prompt/i;

/** Matches the provider's input-filter refusal — through wrapped causes too. */
function isSafetyRejection(err: unknown): boolean {
  let e: unknown = err;
  while (e) {
    const msg =
      (e as { error?: { message?: string } }).error?.message ??
      (e instanceof Error ? e.message : "");
    if (SAFETY_RE.test(msg)) return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

function describeError(err: unknown): string {
  const e = err as {
    error?: { message?: string };
    message?: string;
  } | null;
  const msg = e?.error?.message ?? e?.message ?? "generation request failed";
  // OpenAI's canned rejection tells the user nothing actionable — translate it.
  if (/rejected by the safety system|content[_ ]?policy/i.test(msg)) {
    return "the image model declined this prompt as sensitive — real people, public figures and graphic content are refused. Try describing the scene with symbols, objects or places instead";
  }
  return msg;
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
