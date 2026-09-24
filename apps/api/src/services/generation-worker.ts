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
import {
  GENERATION_QUEUE,
  createRedisConnection,
  type GenerationJob,
  type IngestJob,
} from "./queue.js";
import { publishGenerationEvent } from "./events.js";
import { storeImage } from "./storage.js";
import {
  loadChatHistory,
  runWithCodeInterpreter,
  streamChat,
  streamChatWithSearch,
  stripRunPrefix,
  stripSearchPrefix,
  wantsCodeExecution,
  wantsWebSearch,
} from "./chat.js";
import type { WebSource } from "@catgpt/types";
import { retrieveContext, runDocumentIngestion } from "./documents.js";
import { loadLearnedMemories, rememberTurn } from "./learned-memory.js";
import { refundImageUsage } from "../lib/usage.js";
import { loadBrandContext } from "../lib/brand.js";
import {
  isCampaignConversation,
  isCampaignPrompt,
  spawnCreatives,
  streamCampaign,
  stripCampaignPrefix,
} from "./campaign.js";
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
    (job: Job<GenerationJob | IngestJob>) =>
      job.name === "ingest-document"
        ? runDocumentIngestion(
            (job.data as IngestJob).documentId,
            (job.data as IngestJob).mimeType,
          )
        : runGeneration((job.data as GenerationJob).generationId),
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
      // One lookup serves both the RAG scope and the chat mode below —
      // a workspace conversation pulls every workspace doc and switches
      // to the grounded "analyze the workspace" system prompt.
      const [history, conversation] = await Promise.all([
        generation.conversationId
          ? loadChatHistory(generation.conversationId, generation.id)
          : Promise.resolve([]),
        generation.conversationId
          ? prisma.conversation.findUnique({
              where: { id: generation.conversationId },
              select: { workspaceId: true },
            })
          : Promise.resolve(null),
      ]);
      const workspaceId = conversation?.workspaceId ?? null;
      // Brand mode (toggle on): the compact digest goes into the prompt and the
      // brand's documents join retrieval. Toggle off = brandId absent = common answer.
      const brandId = typeof meta.brandId === "string" ? meta.brandId : null;
      const brand = brandId
        ? await loadBrandContext(brandId, generation.userId)
        : null;
      const brandSummary = brand?.summary?.trim() || null;
      // Pictures to look at (vision turn): the model answers about them.
      const visionImages = Array.isArray(meta.visionImageUrls)
        ? (meta.visionImageUrls as unknown[]).filter(
            (u): u is string => typeof u === "string",
          )
        : [];
      // RAG + learned memory run in parallel — both are best-effort context.
      const [context, memories] = await Promise.all([
        generation.conversationId
          ? retrieveContext(generation.prompt, {
              conversationId: generation.conversationId,
              workspaceId,
              brandId: brand?.id ?? null,
            }).catch(() => [])
          : Promise.resolve([]),
        loadLearnedMemories(generation.userId).catch(() => []),
      ]);

      // "run this" / "/run" → real Python execution in OpenAI's sandbox
      // (non-streaming — runs take seconds; the reply is assembled once).
      const codeRun = wantsCodeExecution(generation.prompt);
      const onDelta = (delta: string) =>
        publishGenerationEvent({
          generationId,
          status: "processing",
          kind: "text",
          delta,
        });

      // Live web search only when asked for or clearly time-sensitive - the
      // normal path stays untouched (no added latency). If the search path
      // fails before answering, fall back to a plain reply instead of erroring.
      let text = "";
      let sources: WebSource[] = [];
      let searched = false;
      let searchError: string | null = null;
      let campaign = false;
      let creativesRequested = 0;
      if (!codeRun) {
        campaign =
          isCampaignPrompt(generation.prompt) ||
          (generation.conversationId
            ? await isCampaignConversation(generation.conversationId)
            : false);
      }
      if (campaign) {
        // Campaign mode: interview -> full sales plan -> image creatives.
        const userPrompt = stripCampaignPrefix(generation.prompt);
        const reply = await streamCampaign(
          userPrompt,
          history,
          context,
          memories,
          onDelta,
          brandSummary,
        );
        text = reply.text;
        creativesRequested = reply.creativeCount;
        // Creatives are queued BEFORE this turn is marked completed, so the
        // client's refetch on completion already sees them and keeps polling.
        if (reply.creativeCount > 0 && generation.conversationId) {
          try {
            const note = await spawnCreatives({
              userId: generation.userId,
              conversationId: generation.conversationId,
              history,
              userPrompt,
              reply: reply.text,
              requested: reply.creativeCount,
              brandId: brand?.id ?? null,
            });
            if (note) {
              text += note;
              onDelta(note);
            }
          } catch (err) {
            console.error("[worker] campaign creatives failed:", err);
            const note =
              "\n\n> The image creatives could not be started. Ask me to generate them again.";
            text += note;
            onDelta(note);
          }
        }
      } else if (codeRun) {
        text = await runWithCodeInterpreter(
          stripRunPrefix(generation.prompt) || generation.prompt,
          history,
        );
      } else {
        const useSearch =
          visionImages.length === 0 &&
          wantsWebSearch(generation.prompt, {
            forced: meta.webSearch === true,
            hasDocuments: context.length > 0,
          });
        if (useSearch) {
          let streamed = false;
          try {
            const reply = await streamChatWithSearch(
              stripSearchPrefix(generation.prompt) || generation.prompt,
              history,
              context,
              memories,
              (d) => {
                streamed = true;
                onDelta(d);
              },
              () =>
                publishGenerationEvent({
                  generationId,
                  status: "processing",
                  kind: "text",
                  searching: true,
                }),
              brandSummary,
            );
            text = reply.text;
            sources = reply.sources;
            searched = true;
          } catch (err) {
            // Tokens already reached the client, so we cannot restart cleanly.
            if (streamed) throw err;
            searchError = err instanceof Error ? err.message : String(err);
            console.error("[worker] web search failed, answering without it:", err);
          }
        }
        if (!searched) {
          text = await streamChat(
            generation.prompt,
            history,
            context,
            memories,
            workspaceId ? "workspace" : "chat",
            onDelta,
            brandSummary,
            visionImages,
          );
        }
      }
      await prisma.generation.update({
        where: { id: generationId },
        data: {
          status: "completed",
          textResponse: text,
          model: codeRun
            ? env.CODE_MODEL
            : campaign
              ? env.CAMPAIGN_MODEL
              : env.CHAT_MODEL,
          metadata: {
            ...meta,
            ...(codeRun ? { codeRun: true } : {}),
            ...(campaign ? { campaign: true, creativesRequested } : {}),
            ...(searchError ? { searchError: searchError.slice(0, 300) } : {}),
            ...(searched
              ? {
                  webSearched: true,
                  sources: sources.map((s) => ({ title: s.title, url: s.url })),
                }
              : {}),
            latencyMs: Date.now() - startedAt,
          },
        },
      });
      publishGenerationEvent({
        generationId,
        status: "completed",
        kind: "text",
        textResponse: text,
        ...(searched ? { sources } : {}),
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
    await refundImageUsage(generationId).catch(() => {});
    publishGenerationEvent({ generationId, status: "failed", error: message });
    throw err;
  }
}
