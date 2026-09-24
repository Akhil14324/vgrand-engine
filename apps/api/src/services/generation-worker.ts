import { Worker, type Job } from "bullmq";
import { prisma } from "@catgpt/db";
import {
  generateWithFallback,
  type GenerationMode,
} from "@catgpt/image-providers";
import {
  PROVIDERS,
  type ProviderName,
  type Quality,
  type ImageSize,
} from "@catgpt/types";
import { GENERATION_QUEUE, createRedisConnection } from "./queue.js";
import { publishGenerationEvent } from "./events.js";
import { storeImage } from "./storage.js";
import {
  loadChatHistory,
  runWithCodeInterpreter,
  streamChat,
  stripRunPrefix,
  wantsCodeExecution,
} from "./chat.js";
import { retrieveContext } from "./documents.js";
import { loadLearnedMemories, rememberTurn } from "./learned-memory.js";
import { env } from "../env.js";

interface GenerationMetadata {
  referenceImageUrl?: string;
  referenceImageUrls?: string[];
  quality?: Quality;
  size?: ImageSize;
  [key: string]: unknown;
}

export function startGenerationWorker(): Worker | null {
  if (!env.redisConfigured) {
    // No queue — enqueueGeneration() calls runGeneration() directly. Rows
    // left pending/processing by a previous boot would never resume, so
    // kick them off again here.
    console.log("[worker] no REDIS_URL — processing generations inline");
    void recoverPendingGenerations();
    return null;
  }
  const worker = new Worker(
    GENERATION_QUEUE,
    (job: Job<{ generationId: string }>) => runGeneration(job.data.generationId),
    { connection: createRedisConnection(), concurrency: 3 },
  );
  worker.on("error", (err) => console.error("[worker] error:", err));
  worker.on("failed", (job, err) =>
    console.error(`[worker] job ${job?.id} failed:`, err.message),
  );
  return worker;
}

/** Inline mode: re-run rows a previous process left behind. */
async function recoverPendingGenerations() {
  try {
    await prisma.generation.updateMany({
      where: { status: "processing" },
      data: { status: "pending" },
    });
    const pending = await prisma.generation.findMany({
      where: { status: "pending" },
      select: { id: true },
    });
    for (const g of pending) {
      void runGeneration(g.id).catch((err) =>
        console.error(`[inline] generation ${g.id} failed:`, err),
      );
    }
  } catch (err) {
    console.error("[worker] pending-job recovery failed:", err);
  }
}

export async function runGeneration(generationId: string): Promise<void> {
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
    generation.parentId ||
    meta.referenceImageUrl ||
    meta.referenceImageUrls?.length
      ? "edit"
      : "draft";
  const referenceImageUrls = meta.referenceImageUrls?.length
    ? meta.referenceImageUrls
    : meta.referenceImageUrl
      ? [meta.referenceImageUrl]
      : [];
  const providerName = (PROVIDERS as readonly string[]).includes(
    generation.provider,
  )
    ? (generation.provider as ProviderName)
    : "openai";

  try {
    // Text turns skip the image pipeline entirely — chat completion in,
    // textResponse out, over the same queue + SSE plumbing. Tokens stream
    // through delta events so the client renders as the model writes.
    if (generation.kind === "text") {
      const history = generation.conversationId
        ? await loadChatHistory(generation.conversationId, generation.id)
        : [];
      // RAG + learned memory run in parallel — both are best-effort context.
      const [context, memories] = await Promise.all([
        generation.conversationId
          ? retrieveContext(
              generation.prompt,
              generation.conversationId,
            ).catch(() => [])
          : Promise.resolve([]),
        loadLearnedMemories(generation.userId).catch(() => []),
      ]);

      // "run this" / "/run" → real Python execution in OpenAI's sandbox
      // (non-streaming — runs take seconds; the reply is assembled once).
      const codeRun = wantsCodeExecution(generation.prompt);
      const text = codeRun
        ? await runWithCodeInterpreter(
            stripRunPrefix(generation.prompt) || generation.prompt,
            history,
          )
        : await streamChat(
            generation.prompt,
            history,
            context,
            memories,
            (delta) =>
              publishGenerationEvent({
                generationId,
                status: "processing",
                kind: "text",
                delta,
              }),
          );
      await prisma.generation.update({
        where: { id: generationId },
        data: {
          status: "completed",
          textResponse: text,
          model: codeRun ? env.CODE_MODEL : env.CHAT_MODEL,
          metadata: {
            ...meta,
            ...(codeRun ? { codeRun: true } : {}),
            latencyMs: Date.now() - startedAt,
          },
        },
      });
      publishGenerationEvent({
        generationId,
        status: "completed",
        kind: "text",
        textResponse: text,
      });
      // Fire-and-forget: mine the turn for durable user facts (ChatGPT memory).
      void rememberTurn(
        generation.userId,
        generation.conversationId,
        [
          ...history.slice(-4),
          { prompt: generation.prompt, kind: "text", textResponse: text },
        ],
      );
      return;
    }

    const result = await generateWithFallback(providerName, {
      prompt: generation.finalPrompt,
      mode,
      referenceImageUrl: referenceImageUrls[0],
      referenceImageUrls,
      quality: meta.quality ?? "low",
      size: meta.size ?? "auto",
      // Progressive previews stream through SSE as they arrive from the model.
      onPartialImage: (b64) =>
        publishGenerationEvent({
          generationId,
          status: "processing",
          kind: "image",
          partialImage: `data:image/png;base64,${b64}`,
        }),
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
