import { prisma } from "@catgpt/db";
import type { BrandProfile } from "@catgpt/types";
import { env } from "../env.js";
import { buildFinalPrompt } from "../lib/prompt.js";
import {
  brandImageGuidance,
  loadBrandContext,
} from "../lib/brand.js";
import { recordImageUsage, refundImageUsage } from "../lib/usage.js";
import { enqueueGeneration } from "./queue.js";
import { publishGenerationEvent } from "./events.js";
import { getClient, toMessages, type HistoryTurn } from "./chat.js";

/**
 * A single message can describe several distinct images — "make the Day 10
 * to 14 posters, each with its own Telugu text". Without this split, the
 * chat model (which cannot actually call the image tool more than once) used
 * to narrate the request back with sample code instead of ever producing an
 * image. splitImageBatch turns that one message into N stand-alone briefs;
 * spawnImageBatch turns the extra ones (beyond the first, which the caller
 * generates as the normal single image job) into real generations.
 */

const MAX_BATCH_IMAGES = 12;

export interface ImageBrief {
  label: string;
  prompt: string;
}

const BATCH_SYSTEM = `You split a single chat message into separate image-generation briefs when it clearly describes more than one distinct image - for example one image per day, item, product, or variant. Return JSON only: {"images":[{"label":"...","prompt":"..."}]}, in the order the user listed them.

Each "prompt" must be complete and stand-alone (the image model sees nothing else): describe the scene/subject, and if the message specifies exact on-image text (a greeting, a day label, a heading), spell it out in quotes, letter-perfect, in the language the user used. "label" is a short 2-6 word tag for this one image (e.g. "Day 10"). If the message only describes ONE image, return exactly one entry whose prompt restates that single request stand-alone. Never invent extra images the user did not ask for.`;

/**
 * Splits a prompt into image briefs. Always returns at least one entry (the
 * original prompt, unsplit) — callers only treat this as a batch when more
 * than one comes back, so a classifier failure or a genuinely single request
 * both fall through to the existing single-image path unchanged.
 */
export async function splitImageBatch(
  prompt: string,
  history: HistoryTurn[],
): Promise<ImageBrief[]> {
  try {
    const res = await getClient().chat.completions.create({
      model: env.CHAT_MODEL,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: BATCH_SYSTEM },
        ...toMessages(history.slice(-6)),
        { role: "user", content: prompt },
      ],
    });
    const parsed = JSON.parse(res.choices[0]?.message.content ?? "{}") as {
      images?: Partial<ImageBrief>[];
    };
    const items = (parsed.images ?? [])
      .filter((i): i is ImageBrief => Boolean(i.prompt?.trim()))
      .map((i) => ({ label: i.label?.trim() ?? "", prompt: i.prompt!.trim() }))
      .slice(0, MAX_BATCH_IMAGES);
    return items.length ? items : [{ label: "", prompt }];
  } catch (err) {
    console.warn(
      "[image-batch] split failed, treating as a single image:",
      (err as Error).message,
    );
    return [{ label: "", prompt }];
  }
}

/**
 * Turns the briefs BEYOND the first (the caller already made that one the
 * normal, returned generation) into real image generations in the same chat.
 * Fire-and-forget from the route: it must never delay or fail the response
 * for the first image, and each one counts toward the daily quota same as
 * any other image job — spawning stops as soon as the user runs out.
 */
export async function spawnImageBatch(params: {
  userId: string;
  conversationId: string;
  briefs: ImageBrief[];
  theme: Parameters<typeof buildFinalPrompt>[0];
  brandId: string | null;
  provider: string;
  referenceImageUrls: string[];
  productImage?: { id: string; label: string; url: string };
  quality: string;
  size: string;
}): Promise<void> {
  const { userId, conversationId, briefs } = params;
  if (briefs.length === 0) return;
  const brand = params.brandId
    ? await loadBrandContext(params.brandId, userId).catch(() => null)
    : null;
  const guidance = brand
    ? brandImageGuidance(
        brand.name,
        (brand.profile ?? {}) as BrandProfile,
        brand.assets.some((a) => a.kind === "logo"),
        brand.mascot,
        brand.assets.some((a) => a.kind === "product"),
      )
    : "";

  for (const brief of briefs) {
    const generation = await prisma.generation.create({
      data: {
        userId,
        conversationId,
        brandId: params.brandId,
        kind: "image",
        prompt: brief.prompt,
        finalPrompt:
          buildFinalPrompt(params.theme, brief.prompt) +
          (params.productImage
            ? `\nUse the exact saved Product Image ${JSON.stringify(params.productImage.label)} from the active Brand. This selected image is supplied first as a reference. Do not substitute or reinterpret it as a different product.`
            : "") +
          guidance,
        provider: params.provider,
        metadata: {
          quality: params.quality,
          size: params.size,
          referenceImageUrl: params.referenceImageUrls[0],
          referenceImageUrls: params.referenceImageUrls,
          ...(params.brandId ? { brandId: params.brandId } : {}),
          ...(params.productImage
            ? { selectedProductAssetId: params.productImage.id }
            : {}),
          imageBatch: { label: brief.label },
        },
      },
    });
    // Reserve atomically — a stale "remaining" count from before this loop
    // started must never let it overspend the limit.
    const reserved = await recordImageUsage(userId, generation.id);
    if (!reserved) {
      await prisma.generation.update({
        where: { id: generation.id },
        data: { status: "failed", error: "Daily image limit reached" },
      });
      publishGenerationEvent({
        generationId: generation.id,
        status: "failed",
        error: "Daily image limit reached",
      });
      break;
    }
    try {
      await enqueueGeneration(generation.id, { background: true });
    } catch (err) {
      await refundImageUsage(generation.id).catch(() => {});
      await prisma.generation
        .update({
          where: { id: generation.id },
          data: { status: "failed", error: "Could not start the job" },
        })
        .catch(() => {});
      publishGenerationEvent({
        generationId: generation.id,
        status: "failed",
        error: "Could not start the job",
      });
      console.error("[image-batch] enqueue failed:", err);
      break;
    }
  }
}
