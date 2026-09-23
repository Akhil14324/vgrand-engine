import { Worker, type Job } from "bullmq";
import { prisma } from "@prompthub/db";
import {
  generateWithFallback,
  type GenerationMode,
} from "@prompthub/image-providers";
import {
  PROVIDERS,
  type ProviderName,
  type Quality,
  type ImageSize,
} from "@prompthub/types";
import { GENERATION_QUEUE, createRedisConnection } from "./queue.js";
import { publishGenerationEvent } from "./events.js";
import { storeImage } from "./storage.js";

interface GenerationMetadata {
  referenceImageUrl?: string;
  quality?: Quality;
  size?: ImageSize;
  [key: string]: unknown;
}

export function startGenerationWorker(): Worker {
  const worker = new Worker(
    GENERATION_QUEUE,
    processGeneration,
    { connection: createRedisConnection(), concurrency: 3 },
  );
  worker.on("error", (err) => console.error("[worker] error:", err));
  worker.on("failed", (job, err) =>
    console.error(`[worker] job ${job?.id} failed:`, err.message),
  );
  return worker;
}

async function processGeneration(
  job: Job<{ generationId: string }>,
): Promise<void> {
  const { generationId } = job.data;
  const generation = await prisma.generation.findUnique({
    where: { id: generationId },
    include: { theme: true },
  });
  if (!generation || generation.status !== "pending") return;

  await prisma.generation.update({
    where: { id: generationId },
    data: { status: "processing" },
  });
  publishGenerationEvent({ generationId, status: "processing" });

  const startedAt = Date.now();
  const meta = (generation.metadata ?? {}) as GenerationMetadata;
  const mode: GenerationMode =
    generation.parentId || meta.referenceImageUrl ? "edit" : "draft";
  const providerName = (PROVIDERS as readonly string[]).includes(
    generation.provider,
  )
    ? (generation.provider as ProviderName)
    : "openai";

  try {
    const result = await generateWithFallback(providerName, {
      prompt: generation.finalPrompt,
      mode,
      referenceImageUrl: meta.referenceImageUrl,
      quality: meta.quality ?? "low",
      size: meta.size ?? "auto",
    });

    const imageUrls = await Promise.all(
      result.images.map((img, i) =>
        storeImage({
          buffer: img.b64Json ? Buffer.from(img.b64Json, "base64") : undefined,
          sourceUrl: img.url,
          mimeType: img.mimeType,
          keyPrefix: `generations/${generationId}/${i}`,
        }),
      ),
    );

    await prisma.generation.update({
      where: { id: generationId },
      data: {
        status: "completed",
        imageUrls,
        provider: result.providerUsed,
        model: (result.metadata.model as string | undefined) ?? null,
        metadata: {
          ...meta,
          ...result.metadata,
          latencyMs: Date.now() - startedAt,
        },
      },
    });

    // Persistent memory snapshot — everything needed to recall or reproduce
    // this generation later, not just the image.
    await prisma.memory.create({
      data: {
        userId: generation.userId,
        type: "fact",
        content: `Generated "${generation.prompt.slice(0, 120)}"${
          generation.theme ? ` with /${generation.theme.slug}` : ""
        } (${result.providerUsed}${result.fellBack ? ", fallback" : ""})`,
        sourceGenId: generationId,
        metadata: {
          prompt: generation.prompt,
          finalPrompt: generation.finalPrompt,
          themeSlug: generation.theme?.slug ?? null,
          provider: result.providerUsed,
          model: result.metadata.model ?? null,
          quality: meta.quality ?? "low",
          size: meta.size ?? "auto",
          imageUrls,
          latencyMs: Date.now() - startedAt,
          conversationId: generation.conversationId,
        },
      },
    });

    publishGenerationEvent({ generationId, status: "completed", imageUrls });
  } catch (err) {
    const message = err instanceof Error ? err.message : "generation failed";
    await prisma.generation.update({
      where: { id: generationId },
      data: { status: "failed", error: message },
    });
    publishGenerationEvent({ generationId, status: "failed", error: message });
    throw err;
  }
}
