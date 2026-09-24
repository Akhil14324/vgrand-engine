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
  INGEST_QUEUE,
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
import {
  findScopeDocuments,
  retrievePassages,
  runDocumentIngestion,
} from "./documents.js";
import { evaluateSafe } from "./jev.js";
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

/** Thrown mid-stream when the user hit Stop (row flipped to "cancelled"). */
class GenerationCancelled extends Error {}

export function startGenerationWorker(): Worker | null {
  if (!env.redisConfigured) {
    // No queue — enqueueGeneration() calls runGeneration() directly. Rows
    // left pending/processing by a previous boot would never resume, so
    // kick them off again here.
    console.log("[worker] no REDIS_URL — processing generations inline");
    void recoverPendingGenerations();
    return null;
  }
  void failInterruptedGenerations();
  const worker = new Worker(
    GENERATION_QUEUE,
    (job: Job<GenerationJob>) => runGeneration(job.data.generationId),
    { connection: createRedisConnection(), concurrency: env.WORKER_CONCURRENCY },
  );
  // Ingestion has its own queue and slots; it shuts down with the main worker.
  const ingestWorker = new Worker(
    INGEST_QUEUE,
    (job: Job<IngestJob>) =>
      runDocumentIngestion(job.data.documentId, job.data.mimeType),
    { connection: createRedisConnection(), concurrency: 2 },
  );
  worker.on("closing", () => void ingestWorker.close());
  for (const [name, w] of [
    ["worker", worker],
    ["ingest", ingestWorker],
  ] as const) {
    w.on("error", (err) => console.error(`[${name}] error:`, err));
    w.on("failed", (job, err) =>
      console.error(`[${name}] job ${job?.id} failed:`, err.message),
    );
  }
  return worker;
}

/**
 * A process that dies mid-job leaves its row "processing" forever — a stalled
 * BullMQ job is retried but runGeneration only picks up "pending" rows. Fail
 * (and refund) anything stuck longer than any job could legitimately run.
 */
async function failInterruptedGenerations() {
  try {
    const cutoff = new Date(Date.now() - 30 * 60_000);
    const stuck = await prisma.generation.findMany({
      where: { status: "processing", createdAt: { lt: cutoff } },
      select: { id: true },
    });
    for (const { id } of stuck) {
      await prisma.generation.update({
        where: { id },
        data: { status: "failed", error: "Interrupted - please try again" },
      });
      await refundImageUsage(id).catch(() => {});
    }
  } catch (err) {
    console.error("[worker] interrupted-job sweep failed:", err);
  }
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

  // Cooperative cancel: POST /generations/:id/cancel flips the row to
  // "cancelled". The token stream polls it at most once per 700ms and the
  // final writes are guarded by status:"processing", so a cancel can never
  // be overwritten by a late "completed".
  let cancelFlag = false;
  let lastCancelCheck = 0;
  const pollCancelled = () => {
    const now = Date.now();
    if (now - lastCancelCheck < 700) return;
    lastCancelCheck = now;
    void prisma.generation
      .findUnique({ where: { id: generationId }, select: { status: true } })
      .then((g) => {
        if (g?.status === "cancelled") cancelFlag = true;
      })
      .catch(() => {});
  };
  // Tokens already streamed — persisted if the turn is stopped, so the
  // partial reply survives instead of disappearing on the next refetch.
  let partialText = "";

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
      // Voice replies stay short and spoken: no campaign builder, no search.
      const voice = meta.voice === true;
      // One Jev call answers this turn's fuzzy routing questions — code
      // execution, live-web need, doc need — replacing three regex guesses.
      // It runs in parallel with the DB loads below, so it costs ~0ms of
      // added latency; a null result (no key / API down) leaves every
      // existing regex path untouched.
      const turnEval = voice
        ? Promise.resolve(null)
        : evaluateSafe(generation.prompt.slice(0, 2000), {
            wants_code: {
              type: "noul",
              instructions:
                "The user wants code actually executed or run — producing real output — not just written, explained or reviewed.",
            },
            needs_web: {
              type: "noul",
              instructions:
                "Answering well requires current or live information from the web — news, prices, scores, recent releases, current office-holders, today's weather or date.",
            },
            needs_docs: {
              type: "noul",
              instructions:
                "Answering requires the user's own attached documents or files rather than general knowledge or casual conversation.",
            },
          });
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
      const jev = await turnEval;

      // Retrieval gate: casual turns in a doc-heavy chat ("thanks!", "make it
      // blue") shouldn't pay for an embeddings call + vector query. Workspace
      // and brand turns always retrieve — documents are their primary source.
      // No Jev verdict = retrieve, exactly as before.
      const scopeDocs = generation.conversationId
        ? await findScopeDocuments({
            conversationId: generation.conversationId,
            workspaceId,
            brandId: brand?.id ?? null,
          }).catch(() => [])
        : [];
      const needsDocs =
        workspaceId !== null ||
        brand !== null ||
        jev?.needs_docs == null ||
        (jev.needs_docs.noul ?? 1) >= 0.3;

      // RAG + learned memory run in parallel — both are best-effort context.
      const [context, memories] = await Promise.all([
        scopeDocs.length && needsDocs
          ? retrievePassages(
              generation.prompt,
              scopeDocs.map((d) => d.id),
            ).catch(() => [])
          : Promise.resolve([]),
        loadLearnedMemories(generation.userId).catch(() => []),
      ]);

      // "run this" / "/run" → real Python execution in OpenAI's sandbox
      // (non-streaming — runs take seconds; the reply is assembled once).
      const codeRun = wantsCodeExecution(
        generation.prompt,
        jev?.wants_code == null ? null : (jev.wants_code.noul ?? 0) > 0.5,
      );
      const onDelta = (delta: string) => {
        partialText += delta;
        publishGenerationEvent({
          generationId,
          status: "processing",
          kind: "text",
          delta,
        });
        pollCancelled();
        if (cancelFlag) throw new GenerationCancelled();
      };

      // Live web search only when asked for or clearly time-sensitive - the
      // normal path stays untouched (no added latency). If the search path
      // fails before answering, fall back to a plain reply instead of erroring.
      let text = "";
      let sources: WebSource[] = [];
      let searched = false;
      let searchError: string | null = null;
      let campaign = false;
      let creativesRequested = 0;
      if (!codeRun && !voice) {
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
          !voice &&
          visionImages.length === 0 &&
          wantsWebSearch(generation.prompt, {
            forced: meta.webSearch === true,
            hasDocuments: context.length > 0,
            jevSays:
              jev?.needs_web == null
                ? null
                : (jev.needs_web.noul ?? 0) > 0.5,
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
            voice ? "voice" : workspaceId ? "workspace" : "chat",
            onDelta,
            brandSummary,
            visionImages,
          );
        }
      }
      const finished = await prisma.generation.updateMany({
        where: { id: generationId, status: "processing" },
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
            // The Jev verdicts that routed this turn — handy for debugging
            // "why did/didn't it search?" from the feed's metadata.
            ...(jev
              ? {
                  jev: {
                    code: jev.wants_code?.noul ?? null,
                    web: jev.needs_web?.noul ?? null,
                    docs: jev.needs_docs?.noul ?? null,
                  },
                }
              : {}),
            latencyMs: Date.now() - startedAt,
          },
        },
      });
      if (finished.count === 0) {
        // Cancelled after the last token — keep the partial reply, stay cancelled.
        await prisma.generation
          .update({
            where: { id: generationId },
            data: { textResponse: partialText || null },
          })
          .catch(() => {});
        publishGenerationEvent({ generationId, status: "cancelled" });
        return;
      }
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

    // Pre-flight: refuse clearly disallowed requests in ~200ms instead of
    // waiting out a full provider call to be rejected. The threshold is
    // deliberately high — photo edits and bold creative prompts must never
    // false-positive. No verdict = proceed, same as before.
    const screen = await evaluateSafe(generation.prompt.slice(0, 2000), {
      disallowed: {
        type: "noul",
        instructions:
          "This image request is for clearly unsafe or policy-violating content — explicit sexual material, graphic gore, hateful or extremist imagery, or instructions for illegal activity.",
      },
    });
    if ((screen?.disallowed?.noul ?? 0) >= 0.85) {
      throw new Error(
        "this request looks like disallowed content, so no image was generated",
      );
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

    const finished = await prisma.generation.updateMany({
      where: { id: generationId, status: "processing" },
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
    if (finished.count === 0) {
      // Cancelled while the provider was rendering — refund and stop quietly.
      await refundImageUsage(generationId).catch(() => {});
      publishGenerationEvent({ generationId, status: "cancelled" });
      return;
    }

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
    if (err instanceof GenerationCancelled) {
      // Stop hit mid-stream — keep the tokens already sent, stay cancelled.
      await prisma.generation
        .update({
          where: { id: generationId },
          data: {
            status: "cancelled",
            error: "Stopped",
            ...(partialText ? { textResponse: partialText } : {}),
          },
        })
        .catch(() => {});
      await refundImageUsage(generationId).catch(() => {});
      publishGenerationEvent({ generationId, status: "cancelled" });
      return;
    }
    const message = err instanceof Error ? err.message : "generation failed";
    // The row may be gone (chat deleted mid-job) — don't let that mask the error.
    await prisma.generation
      .update({
        where: { id: generationId },
        data: { status: "failed", error: message },
      })
      .catch(() => {});
    await refundImageUsage(generationId).catch(() => {});
    publishGenerationEvent({ generationId, status: "failed", error: message });
    throw err;
  }
}
