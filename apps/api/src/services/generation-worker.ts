import { Worker, type Job } from "bullmq";
import { prisma } from "@catgpt/db";
import {
  generateWithFallback,
  ImageGenerationAborted,
  type GenerationMode,
} from "@catgpt/image-providers";
import {
  IMAGE_STYLES,
  PROVIDERS,
  SOCIAL_MAX_CAROUSEL_IMAGES,
  type ImageStyle,
  type ProviderName,
  type VisualBrief,
  type Quality,
  type ImageSize,
  type ImageEditOperation,
} from "@catgpt/types";
import {
  GENERATION_QUEUE,
  INGEST_QUEUE,
  SOCIAL_QUEUE,
  createRedisConnection,
  type GenerationJob,
  type IngestJob,
  type SocialPostJob,
} from "./queue.js";
import { recoverSocialPosts, runSocialPost } from "./social/publish.js";
import { publishGenerationEvent } from "./events.js";
import { storeImage } from "./storage.js";
import { composeBrandKit, loadAutoStampKit } from "./brand-compose.js";
import { startRetentionScheduler } from "./workspace-privacy.js";
import {
  getClient,
  loadChatHistory,
  runWithCodeInterpreter,
  streamChat,
  streamChatWithSearch,
  stripRunPrefix,
  stripSearchPrefix,
  wantsCodeExecution,
  wantsDocumentConvert,
  wantsDocumentEdit,
  wantsDocumentSummary,
  wantsWebSearch,
} from "./chat.js";
import { convertDocument, editDocument, type EditOutcome } from "./document-edit.js";
import { summarizeDocuments } from "./summarize.js";
import type { WebSource } from "@catgpt/types";
import {
  findScopeDocuments,
  retrievePassages,
  runDocumentIngestion,
  waitForScopeIngestion,
} from "./documents.js";
import { evaluateSafe } from "./jev.js";
import { loadLearnedMemories, rememberTurn } from "./learned-memory.js";
import { refundImageUsage } from "../lib/usage.js";
import { loadBrandContext } from "../lib/brand.js";
import { brandBriefContext } from "../lib/brand-identity.js";
import type { BrandProfile } from "@catgpt/types";
import {
  VARIATION_ANGLES,
  briefPrompt,
  occasionById,
  rankByScore,
  selectRelevantReferences,
  sizeForAspect,
  type ReferenceCandidate,
} from "../lib/image-brief-logic.js";
import { analyzeImagePrompt, scoreImageRelevance } from "./image-brief.js";
import {
  generateCampaignPostCopy,
  isCampaignConversation,
  prepareCampaignCalendar,
  isCampaignPrompt,
  spawnCreatives,
  streamCampaign,
  stripCampaignPrefix,
} from "./campaign.js";
import { env } from "../env.js";
import { startCampaignScheduler } from "./campaign-autopilot.js";
import { startReelAutopilot } from "./reel-plan.js";
import { startSocialScheduler } from "./social/posts.js";
import { startShortsFactory } from "./shorts/index.js";

interface GenerationMetadata {
  referenceImageUrl?: string;
  referenceImageUrls?: string[];
  maskImageUrl?: string;
  editOperation?: ImageEditOperation;
  quality?: Quality;
  size?: ImageSize;
  workerAttempts?: number;
  /** A ready-made carousel set: how many images to generate for this one prompt. */
  imageCount?: number;
  /** Verified per-date occasions resolved at request time for calendar asks. */
  calendarNote?: string;
  [key: string]: unknown;
}

/** Thrown mid-stream when the user hit Stop (row flipped to "cancelled"). */
class GenerationCancelled extends Error {}

/**
 * One cheap chat call that answers "why did I just pay for this image?" —
 * a 1–2 sentence note on the concrete use it serves and the business effect
 * it drives. Runs on every image turn; failure must never fail the job, so
 * callers wrap it. ~150 output tokens ≈ a fraction of a cent against the
 * image cost itself.
 */
async function describeImageValue(opts: {
  prompt: string;
  themeSlug: string | null;
  mode: "draft" | "edit";
  brandSummary: string | null;
}): Promise<string | null> {
  const res = await getClient().chat.completions.create({
    model: env.CHAT_MODEL,
    temperature: 0.6,
    max_tokens: 120,
    messages: [
      {
        role: "system",
        content:
          "You write the note shown under a freshly generated image in a marketing studio. In at most 2 sentences say concretely what this specific image is good for (post, story, menu board, WhatsApp status, ad…) and the business effect it can drive (attention, trust, orders, footfall). Tie it to the request — never generic praise, no hashtags, no emoji, no bullet points.",
      },
      {
        role: "user",
        content: `Request: "${opts.prompt.slice(0, 600)}"${
          opts.themeSlug ? ` (theme /${opts.themeSlug})` : ""
        }${opts.mode === "edit" ? " — an edit of an earlier image" : ""}${
          opts.brandSummary ? `\n\nBrand:\n${opts.brandSummary}` : ""
        }`,
      },
    ],
  });
  return res.choices[0]?.message.content?.trim() || null;
}

export function startGenerationWorker(): Worker | null {
  startCampaignScheduler();
  startReelAutopilot();
  startSocialScheduler();
  startRetentionScheduler();
  startShortsFactory();
  if (!env.redisConfigured) {
    // No queue — enqueueGeneration() calls runGeneration() directly. Rows
    // left pending/processing by a previous boot would never resume, so
    // kick them off again here.
    console.log("[worker] no REDIS_URL — processing generations inline");
    void recoverPendingGenerations();
    void recoverSocialPosts().catch((err) =>
      console.error("[worker] social recovery failed:", err),
    );
    const sweeper = setInterval(
      () =>
        void sweepStaleWork().catch((err) =>
          console.error("[worker] sweep failed:", err),
        ),
      SWEEP_INTERVAL_MS,
    );
    sweeper.unref();
    return null;
  }
  void sweepStaleWork();
  // Repeated, not just at boot: rows can go stale at any time (crash, deploy,
  // dropped BullMQ lock), and documents/team answers have no other recovery.
  const sweeper = setInterval(
    () =>
      void sweepStaleWork().catch((err) =>
        console.error("[worker] sweep failed:", err),
      ),
    SWEEP_INTERVAL_MS,
  );
  sweeper.unref();
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
  // One job per SocialPost; BullMQ owns the 3-attempt exponential backoff, so a
  // retryable failure on a non-final attempt throws to hand control back to it.
  const socialWorker = new Worker(
    SOCIAL_QUEUE,
    async (job: Job<SocialPostJob>) => {
      const finalAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      const outcome = await runSocialPost(job.data.socialPostId, { finalAttempt });
      if (outcome === "retry") throw new Error("retryable social post failure");
    },
    { connection: createRedisConnection(), concurrency: 4 },
  );
  worker.on("closing", () => {
    void ingestWorker.close();
    void socialWorker.close();
  });
  for (const [name, w] of [
    ["worker", worker],
    ["ingest", ingestWorker],
    ["social", socialWorker],
  ] as const) {
    w.on("error", (err) => console.error(`[${name}] error:`, err));
    w.on("failed", (job, err) =>
      console.error(`[${name}] job ${job?.id} failed:`, err.message),
    );
  }
  return worker;
}

const SWEEP_INTERVAL_MS = 5 * 60_000;
const STALE_PROCESSING_MS = 15 * 60_000;
const MAX_SWEEP_RETRIES = 2;

/**
 * Rows whose worker vanished mid-flight: a crashed job leaves "processing"
 * forever because BullMQ's stalled retry no-ops on a non-pending row, and the
 * boot sweep only ran once at startup. Stale rows get a bounded number of
 * re-queues, then are failed (with quota refund and a terminal event).
 * Documents stuck "processing" and team answers stuck "pending" get the same
 * treatment — they had no recovery path at all.
 */
async function sweepStaleWork() {
  await recoverSocialPosts().catch((err) =>
    console.error("[worker] social recovery failed:", err),
  );
  const cutoff = new Date(Date.now() - STALE_PROCESSING_MS);
  const stale = await prisma.generation.findMany({
    where: { status: "processing", createdAt: { lt: cutoff } },
    select: { id: true, kind: true, metadata: true },
  });
  for (const gen of stale) {
    const meta = (gen.metadata ?? {}) as GenerationMetadata;
    // A carousel turn stays "processing" while its slides render; the
    // carousel sweep below checks it instead.
    if (meta.carouselHost === true) continue;
    const attempts = (meta.workerAttempts ?? 0) + 1;
    if (attempts <= MAX_SWEEP_RETRIES) {
      // Back to pending so runGeneration's atomic claim picks it up cleanly.
      await prisma.generation.update({
        where: { id: gen.id },
        data: {
          status: "pending",
          metadata: { ...meta, workerAttempts: attempts },
        },
      });
      const { requeueGeneration } = await import("./queue.js");
      await requeueGeneration(gen.id).catch((err) =>
        console.error(`[worker] sweep re-enqueue ${gen.id} failed:`, err),
      );
    } else {
      await prisma.generation.update({
        where: { id: gen.id },
        data: { status: "failed", error: "Interrupted - please try again" },
      });
      publishGenerationEvent({
        generationId: gen.id,
        status: "failed",
        error: "Interrupted - please try again",
      });
      if (gen.kind === "image") {
        await refundImageUsage(gen.id).catch(() => {});
      }
    }
  }
  // Pending rows whose queue job vanished (Redis flushed, enqueue died
  // silently). requeueGeneration clears any dead job first — a plain add
  // would be deduped against a stale jobId and never run.
  const lost = await prisma.generation.findMany({
    where: {
      status: "pending",
      createdAt: { lt: new Date(Date.now() - 2 * 60_000) },
    },
    select: { id: true },
    take: 50,
  });
  for (const gen of lost) {
    const { requeueGeneration } = await import("./queue.js");
    await requeueGeneration(gen.id).catch(() => {});
  }

  await import("./carousel.js")
    .then((m) => m.sweepCarousels())
    .catch((err) => console.error("[worker] carousel sweep failed:", err));

  await prisma.document
    .updateMany({
      where: { status: "processing", createdAt: { lt: cutoff } },
      data: {
        status: "failed",
        error: "Ingestion was interrupted — retry the upload",
      },
    })
    .catch(() => {});
  await prisma.teamMessage
    .updateMany({
      where: { status: "pending", createdAt: { lt: cutoff } },
      data: {
        status: "failed",
        body: "The AI response was interrupted — please try again.",
      },
    })
    .catch(() => {});
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

/**
 * Avoid paying twice for the exact same image: an identical fresh request
 * (same user, prompt, brand, theme, style, size, quality, references) that
 * already completed recently is served from the stored result, and the quota
 * slot is refunded. "Generate again" never sets requestHash, so it always
 * renders a new image.
 */
async function reuseIdenticalImage(
  generation: { id: string; userId: string },
  meta: GenerationMetadata,
): Promise<boolean> {
  if (typeof meta.requestHash !== "string" || env.IMAGE_REUSE_HOURS <= 0) {
    return false;
  }
  const prior = await prisma.generation.findFirst({
    where: {
      userId: generation.userId,
      id: { not: generation.id },
      kind: "image",
      status: "completed",
      createdAt: { gte: new Date(Date.now() - env.IMAGE_REUSE_HOURS * 3_600_000) },
      metadata: { path: ["requestHash"], equals: meta.requestHash },
    },
    orderBy: { createdAt: "desc" },
  });
  if (!prior || prior.imageUrls.length === 0) return false;
  const priorMeta = (prior.metadata ?? {}) as Record<string, unknown>;
  const note =
    "Reused your identical image from earlier instead of generating a duplicate. Use **Generate again** for a fresh variation.";
  const textResponse = [prior.textResponse, `_${note}_`].filter(Boolean).join("\n\n");
  const done = await prisma.generation.updateMany({
    where: { id: generation.id, status: "processing" },
    data: {
      status: "completed",
      imageUrls: prior.imageUrls,
      textResponse,
      provider: prior.provider,
      model: prior.model,
      finalPrompt: prior.finalPrompt,
      metadata: {
        ...meta,
        ...(priorMeta.imageBrief ? { imageBrief: priorMeta.imageBrief } : {}),
        ...(priorMeta.relevanceScores ? { relevanceScores: priorMeta.relevanceScores } : {}),
        reusedFrom: prior.id,
      } as object,
    },
  });
  if (done.count === 0) return true; // cancelled meanwhile - nothing to do
  await refundImageUsage(generation.id).catch(() => {});
  publishGenerationEvent({
    generationId: generation.id,
    status: "completed",
    kind: "image",
    imageUrls: prior.imageUrls,
    textResponse,
  });
  return true;
}

export async function runGeneration(generationId: string): Promise<void> {
  try {
    await runGenerationJob(generationId);
  } finally {
    // A carousel slide job settled (or was skipped): let the carousel move
    // on - record the image, retry a failure, or start the next slides.
    void prisma.carouselSlide
      .findFirst({ where: { generationId }, select: { carouselId: true } })
      .then(async (slide) => {
        if (!slide) return;
        const { reconcileCarousel } = await import("./carousel.js");
        await reconcileCarousel(slide.carouselId);
      })
      .catch((err) => console.error("[worker] carousel hook failed:", err));
  }
}

async function runGenerationJob(generationId: string): Promise<void> {
  // Atomic claim — a single conditional UPDATE instead of read-then-write.
  // A BullMQ stalled-retry, the recovery sweep and a live enqueue can all
  // reach this row concurrently; only one can flip pending -> processing, so
  // the provider call (and its spend) can never run twice. Stale "processing"
  // rows are resurrected by sweepStaleWork, not claimed here.
  const claimed = await prisma.generation.updateMany({
    where: { id: generationId, status: "pending" },
    data: { status: "processing" },
  });
  if (claimed.count === 0) return;

  const generation = await prisma.generation.findUnique({
    where: { id: generationId },
    include: { theme: true },
  });
  if (!generation) return;

  // A carousel's chat turn is not a render job: its slides are their own
  // generations. A recovery/sweep that re-queued it just re-checks the set.
  if ((generation.metadata as GenerationMetadata | null)?.carouselHost === true) {
    const carouselId = (generation.metadata as GenerationMetadata).carouselId;
    if (typeof carouselId === "string") {
      const { reconcileCarousel } = await import("./carousel.js");
      await reconcileCarousel(carouselId);
    }
    return;
  }

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
  let mode: GenerationMode =
    generation.parentId ||
    meta.referenceImageUrl ||
    meta.referenceImageUrls?.length
      ? "edit"
      : "draft";
  let referenceImageUrls = meta.referenceImageUrls?.length
    ? meta.referenceImageUrls
    : meta.referenceImageUrl
      ? [meta.referenceImageUrl]
      : [];
  const providerName = (PROVIDERS as readonly string[]).includes(
    generation.provider,
  )
    ? (generation.provider as ProviderName)
    : "openai";
  const imageCount = Math.min(
    Math.max(Number(meta.imageCount) || 1, 1),
    SOCIAL_MAX_CAROUSEL_IMAGES,
  );

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
            wants_doc_edit: {
              type: "noul",
              instructions:
                "The user wants a document or file (an attached or previously produced PDF/Word file) rewritten, edited, translated, reformatted or corrected, producing a new version of the document itself — not merely a summary, an answer about it, a pure file-format conversion, or help with code.",
            },
            wants_doc_convert: {
              type: "noul",
              instructions:
                "The user wants the document delivered in a different file format — converted, exported or downloaded as e.g. PDF or Word — with its content unchanged. Pure format delivery only: an edit, rewrite, translation or summary is not a conversion.",
            },
            wants_summary: {
              type: "noul",
              instructions:
                "The user wants a summary, overview, recap or key points of an entire document or file, rather than an answer to one specific question about it.",
            },
          });
      // One lookup serves both the RAG scope and the chat mode below —
      // a workspace conversation pulls every workspace doc and switches
      // to the grounded "analyze the workspace" system prompt. The brand
      // context rides the same Promise.all instead of waiting its turn.
      const brandId = typeof meta.brandId === "string" ? meta.brandId : null;
      const [history, conversation, brand] = await Promise.all([
        generation.conversationId
          ? loadChatHistory(generation.conversationId, generation.id)
          : Promise.resolve([]),
        generation.conversationId
          ? prisma.conversation.findUnique({
              where: { id: generation.conversationId },
              select: { workspaceId: true },
            })
          : Promise.resolve(null),
        brandId ? loadBrandContext(brandId, generation.userId) : null,
      ]);
      const workspaceId = conversation?.workspaceId ?? null;
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
      // A doc attached seconds ago may still be ingesting — without this
      // wait retrieval skips it silently and the reply ignores the upload.
      // Only worth a DB query when the turn could actually have documents.
      const attachedDocs = Array.isArray(meta.attachedDocuments)
        ? meta.attachedDocuments
        : [];
      if (attachedDocs.length > 0 || workspaceId || brand) {
        await waitForScopeIngestion({
          conversationId: generation.conversationId,
          workspaceId,
          brandId: brand?.id ?? null,
        }).catch(() => {});
      }
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

      // "run this" / "/run" → real Python execution in OpenAI's sandbox
      // (non-streaming — runs take seconds; the reply is assembled once).
      const codeRun = wantsCodeExecution(
        generation.prompt,
        jev?.wants_code == null ? null : (jev.wants_code.noul ?? 0) > 0.5,
      );

      // "Summarize this PDF" reads the WHOLE document in order — top-K
      // retrieval would only see the chunks nearest the word "summarize".
      // Attached docs win; otherwise the conversation/workspace/brand scope.
      const attachedIds = new Set(
        attachedDocs
          .map((d) => (d as { id?: unknown } | null)?.id)
          .filter((id): id is string => typeof id === "string"),
      );
      const attachedScope = scopeDocs.filter((d) => attachedIds.has(d.id));
      const summaryDocs = attachedScope.length ? attachedScope : scopeDocs;
      // "Rewrite this doc…" edits the file itself and returns Word + PDF.
      // An attached doc is the target; otherwise the newest doc in scope
      // (which is the previous edit's output on follow-ups).
      const editDoc = attachedScope[0] ?? scopeDocs[0];
      const editRun =
        !voice &&
        !codeRun &&
        editDoc !== undefined &&
        !isCampaignPrompt(generation.prompt) &&
        wantsDocumentEdit(generation.prompt, {
          attachedNow: attachedScope.length > 0,
          jevSays:
            jev?.wants_doc_edit == null
              ? null
              : (jev.wants_doc_edit.noul ?? 0) > 0.7,
        });
      // A pure format ask ("give me in pdf") converts the document's own text —
      // no model call, no rewrite. Edits win first: "change X and export as
      // pdf" must apply the change, and the edit already returns a PDF.
      const convertRun =
        !editRun &&
        !voice &&
        !codeRun &&
        editDoc !== undefined &&
        !isCampaignPrompt(generation.prompt) &&
        wantsDocumentConvert(generation.prompt, {
          attachedNow: attachedScope.length > 0,
          jevSays:
            jev?.wants_doc_convert == null
              ? null
              : (jev.wants_doc_convert.noul ?? 0) > 0.6,
        });
      const summaryRun =
        !voice &&
        !codeRun &&
        !editRun &&
        !convertRun &&
        summaryDocs.length > 0 &&
        !isCampaignPrompt(generation.prompt) &&
        wantsDocumentSummary(
          generation.prompt,
          jev?.wants_summary == null
            ? null
            : (jev.wants_summary.noul ?? 0) > 0.6,
        );

      // RAG + learned memory run in parallel — both are best-effort context.
      const [context, memories] = await Promise.all([
        scopeDocs.length && needsDocs && !summaryRun && !editRun && !convertRun
          ? retrievePassages(
              generation.prompt,
              scopeDocs.map((d) => d.id),
            ).catch((): string[] => [])
          : Promise.resolve<string[]>([]),
        loadLearnedMemories(generation.userId).catch(() => []),
      ]);
      // Verified per-date occasions resolved when the request came in (a
      // non-campaign "posts for the next N days" ask) — keeps the reply's
      // day-by-day content factual instead of letting the model guess.
      if (meta.calendarNote) context.push(meta.calendarNote);

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
      let editOutcome: EditOutcome | null = null;
      let convertOutcome: EditOutcome | null = null;
      let campaign = false;
      let creativesRequested = 0;
      if (!codeRun && !voice && !summaryRun && !editRun) {
        campaign =
          isCampaignPrompt(generation.prompt) ||
          (generation.conversationId
            ? await isCampaignConversation(generation.conversationId)
            : false);
      }
      if (campaign) {
        // Campaign mode: interview -> full sales plan -> image creatives.
        const userPrompt = stripCampaignPrefix(generation.prompt);
        const calendarContext = [
          brandSummary,
          ...context,
          ...memories,
          ...history.slice(-8).map(
            (turn) => `${turn.prompt}\n${turn.textResponse ?? ""}`,
          ),
        ]
          .filter(Boolean)
          .join("\n\n");
        const calendarPlan = await prepareCampaignCalendar(
          userPrompt,
          calendarContext,
          brandSummary,
        );
        const reply = await streamCampaign(
          userPrompt,
          history,
          context,
          memories,
          onDelta,
          brandSummary,
          calendarPlan,
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
      } else if (convertRun && editDoc) {
        convertOutcome = await convertDocument({
          userId: generation.userId,
          conversationId: generation.conversationId,
          workspaceId,
          doc: editDoc,
          skipped: Math.max(0, attachedScope.length - 1),
          onProgress: onDelta,
        });
        text = convertOutcome.text;
      } else if (editRun && editDoc) {
        editOutcome = await editDocument({
          userId: generation.userId,
          conversationId: generation.conversationId,
          workspaceId,
          instruction: generation.prompt,
          doc: editDoc,
          skipped: Math.max(0, attachedScope.length - 1),
          onProgress: onDelta,
        });
        text = editOutcome.text;
      } else if (summaryRun) {
        text = await summarizeDocuments(
          generation.prompt,
          summaryDocs,
          history,
          memories,
          onDelta,
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
              : convertRun
                ? null
                : env.CHAT_MODEL,
          metadata: {
            ...meta,
            ...(codeRun ? { codeRun: true } : {}),
            ...(summaryRun ? { documentSummary: true } : {}),
            ...(editOutcome
              ? {
                  documentEdit: true,
                  // Spread: interfaces aren't assignable to Prisma's JSON type.
                  files: editOutcome.files.map((f) => ({ ...f })),
                }
              : {}),
            ...(convertOutcome
              ? {
                  documentConvert: true,
                  files: convertOutcome.files.map((f) => ({ ...f })),
                }
              : {}),
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
                    summary: jev.wants_summary?.noul ?? null,
                    edit: jev.wants_doc_edit?.noul ?? null,
                    convert: jev.wants_doc_convert?.noul ?? null,
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

    // Intelligent curation for fresh drafts: understand the request, keep
    // only stored images that genuinely match it, and turn it into a
    // detailed brief - never an edit of an arbitrary image from the
    // collection. Edits/regenerates of an exact image skip all of this.
    let finalPrompt = generation.finalPrompt;
    let size: ImageSize = meta.size ?? "auto";
    let brief: VisualBrief | null = null;
    const curation: Record<string, unknown> = {};
    if (meta.curate === true && !generation.parentId && !meta.editOperation) {
      if (await reuseIdenticalImage(generation, meta)) return;

      publishGenerationEvent({
        generationId,
        status: "processing",
        kind: "image",
        stage: "Understanding your request…",
      });
      const brandId =
        generation.brandId ??
        (typeof meta.brandId === "string" ? meta.brandId : null);
      const [brandCtx, previous] = await Promise.all([
        brandId
          ? loadBrandContext(brandId, generation.userId).catch(() => null)
          : Promise.resolve(null),
        typeof meta.variationOf === "string"
          ? prisma.generation.findFirst({
              where: { id: meta.variationOf, userId: generation.userId },
              select: { metadata: true },
            })
          : Promise.resolve(null),
      ]);
      const previousBrief =
        ((previous?.metadata ?? null) as { imageBrief?: VisualBrief } | null)
          ?.imageBrief ?? null;
      const style = (IMAGE_STYLES as readonly string[]).includes(String(meta.style))
        ? (meta.style as ImageStyle)
        : "auto";
      brief = await analyzeImagePrompt(generation.prompt, {
        style,
        size,
        themeLabel: generation.theme?.label ?? null,
        // The selected brand drives the scene (palette, real products,
        // style); the occasion only sets the theme.
        brandSummary: brandCtx
          ? brandBriefContext({
              id: brandCtx.id,
              name: brandCtx.name,
              summary: brandCtx.summary,
              profile: (brandCtx.profile ?? {}) as BrandProfile,
              assets: brandCtx.assets,
            })
          : null,
        brandMode: Boolean(brandCtx),
        brandColors: ((brandCtx?.profile ?? {}) as BrandProfile).colors,
        previousBrief,
      });
      const candidates = Array.isArray(meta.candidateReferences)
        ? (meta.candidateReferences as ReferenceCandidate[])
        : [];
      const { selected, rejected } = selectRelevantReferences(
        brief,
        generation.prompt,
        candidates,
        { brandMode: Boolean(brandCtx) },
      );
      referenceImageUrls = [
        ...new Set([...referenceImageUrls, ...selected.map((c) => c.url)]),
      ].slice(0, 10);
      mode = referenceImageUrls.length > 0 ? "edit" : "draft";
      size = sizeForAspect(meta.size, brief.aspect);
      const variationIndex = previous
        ? await prisma.generation.count({
            where: {
              userId: generation.userId,
              metadata: { path: ["variationOf"], equals: meta.variationOf as string },
            },
          })
        : 0;
      finalPrompt =
        generation.finalPrompt +
        briefPrompt(brief, previous ? { index: Math.max(variationIndex - 1, 0) } : null) +
        (brandCtx && selected.some((c) => c.kind === "product")
          ? `\nThe supplied product photos are ${brandCtx.name}'s REAL products (${selected
              .filter((c) => c.kind === "product")
              .map((c) => c.label?.trim() || "unnamed product")
              .join(", ")}): place them as the clearly visible hero, exactly as photographed - same shape, packaging, labels and colours - inside a newly generated background and decorations that follow the brief. Do not invent any other product.`
          : "") +
        (selected.some((c) => !brandCtx || c.kind !== "product")
          ? "\nThe other supplied reference images are relevant assets from the user's own collection: use them for the matching elements only, inside a newly composed scene that follows the brief."
          : "") +
        (imageCount > 1
          ? `\nThis is a set of ${imageCount} images: every image must follow the brief but be clearly different from the others - vary the composition across ${VARIATION_ANGLES.slice(0, imageCount).join(", ")}. No two images may look alike.`
          : "");
      Object.assign(curation, {
        imageBrief: brief,
        size,
        referenceImageUrl: referenceImageUrls[0],
        referenceImageUrls,
        selectedReferences: selected,
        rejectedReferenceCount: rejected.length,
      });
      // Persist the brief + exact prompt now, so a failed render still shows
      // what was understood and "Generate again" can build on it.
      await prisma.generation
        .update({
          where: { id: generationId },
          data: { finalPrompt, metadata: { ...meta, ...curation } as object },
        })
        .catch(() => {});
      const occasionLabel = brief.occasion
        ? `${occasionById(brief.occasion)?.label ?? brief.occasion} `
        : "";
      publishGenerationEvent({
        generationId,
        status: "processing",
        kind: "image",
        stage: `Generating ${occasionLabel}${imageCount > 1 ? `${imageCount} images` : "image"}…`,
      });
    }

    const genParams = {
      prompt: finalPrompt,
      mode,
      referenceImageUrl: referenceImageUrls[0],
      referenceImageUrls,
      operation: meta.editOperation,
      maskImageUrl: meta.maskImageUrl,
      quality: meta.quality ?? "low",
      size,
      n: imageCount,
      // Progressive previews stream through SSE as they arrive from the
      // model — each one is also a checkpoint for Stop, so a cancelled image
      // job aborts at the next partial instead of running to completion.
      // A multi-image (carousel) request skips previews (see the OpenAI
      // adapter) - only a single-image job ever calls this.
      onPartialImage: (b64: string) => {
        pollCancelled();
        // Provider-specific abort error — it survives the provider's
        // stream-failure fallback instead of triggering a retry.
        if (cancelFlag) throw new ImageGenerationAborted();
        publishGenerationEvent({
          generationId,
          status: "processing",
          kind: "image",
          partialImage: `data:image/png;base64,${b64}`,
        });
      },
    };
    let result = await generateWithFallback(providerName, genParams);

    // Relevance check (curated drafts only): score each image against the
    // brief, put the best first, and redo a single clearly off-brief image
    // once. Scoring is best-effort - null means "unknown", never a failure.
    let relevance: (number | null)[] = [];
    if (brief && !cancelFlag && env.IMAGE_RELEVANCE_CHECK === "on") {
      const activeBrief = brief;
      publishGenerationEvent({
        generationId,
        status: "processing",
        kind: "image",
        stage: "Checking the result matches your request…",
      });
      const scoreAll = (images: typeof result.images) =>
        Promise.all(
          images.map((img) =>
            scoreImageRelevance({ url: img.url, b64: img.b64Json }, activeBrief),
          ),
        );
      let scores = await scoreAll(result.images);
      const first = scores[0];
      if (imageCount === 1 && first && first.score < 5 && !cancelFlag) {
        publishGenerationEvent({
          generationId,
          status: "processing",
          kind: "image",
          stage: "Refining - the first try missed part of your request…",
        });
        const retry = await generateWithFallback(providerName, {
          ...genParams,
          prompt:
            finalPrompt +
            (first.missing.length
              ? `\nIMPORTANT: the image must clearly include: ${first.missing.join("; ")}.`
              : "\nIMPORTANT: follow every element of the brief exactly."),
          onPartialImage: undefined,
        }).catch(() => null);
        if (retry?.images.length) {
          const retryScores = await scoreAll(retry.images);
          if ((retryScores[0]?.score ?? 0) >= first.score) {
            result = retry;
            scores = retryScores;
          }
        }
      }
      const raw = scores.map((s) => s?.score ?? null);
      result = { ...result, images: rankByScore(result.images, raw) };
      relevance = [...raw].sort((a, b) => (b ?? -1) - (a ?? -1));
    }

    // Stop pressed while the provider was rendering — bail before storage
    // so we never pay to persist images nobody will see.
    if (cancelFlag) throw new GenerationCancelled();

    // Carousel slides must all share the exact Instagram dimensions: crop
    // and resize before the logo is stamped, so the logo is never cut off.
    const exactSize = meta.exactSize as { width?: number; height?: number } | undefined;
    if (exactSize?.width && exactSize.height) {
      const { fitImageToSize } = await import("../lib/image-fit.js");
      const { width, height } = exactSize as { width: number; height: number };
      result = {
        ...result,
        images: await Promise.all(
          result.images.map(async (img) => {
            const raw = img.b64Json
              ? Buffer.from(img.b64Json, "base64")
              : Buffer.from(
                  await (await fetch(img.url!, { signal: AbortSignal.timeout(30_000) })).arrayBuffer(),
                );
            const fitted = await fitImageToSize(raw, width, height);
            return { b64Json: fitted.toString("base64"), mimeType: "image/png" };
          }),
        ),
      };
    }

    // Brand kit: stamp the brand's REAL logo file (never an AI redraw) on
    // brand images after generation. Fresh drafts always; edits only when
    // they were built from a stamped parent's clean original (restampLogo),
    // so a logo is never doubled. Mascot candidates are raw assets - skipped.
    // The clean, logo-free original is stored too, so later edits and
    // logo repositioning start from it instead of the stamped copy.
    const stampBrandId =
      generation.brandId ?? (typeof meta.brandId === "string" ? meta.brandId : null);
    const stampKit =
      ((!generation.parentId && !meta.editOperation) || meta.restampLogo === true) &&
      !(meta as { mascotCandidate?: unknown }).mascotCandidate
        ? await loadAutoStampKit(stampBrandId).catch(() => null)
        : null;

    let brandKitStamped = false;
    const unbrandedImageUrls: string[] = [];
    const imageUrls = await Promise.all(
      result.images.map(async (img, i) => {
        let buffer: Buffer | undefined = img.b64Json ? Buffer.from(img.b64Json, "base64") : undefined;
        let sourceUrl = img.url;
        let mimeType = img.mimeType;
        if (stampKit) {
          try {
            const raw =
              buffer ?? Buffer.from(await (await fetch(img.url!, { signal: AbortSignal.timeout(30_000) })).arrayBuffer());
            const stamped = await composeBrandKit(raw, stampKit, { logo: true });
            if (stamped) {
              unbrandedImageUrls[i] = await storeImage({
                buffer: raw,
                mimeType: img.mimeType,
                keyPrefix: `generations/${generationId}/${i}-clean`,
              });
              buffer = stamped;
              brandKitStamped = true;
              sourceUrl = undefined;
              mimeType = "image/png";
            }
          } catch (err) {
            // Fail open, but never silently: the image is kept and flagged
            // (brandApplied.logo = false) so the UI warns the logo is missing.
            console.warn("[worker] brand-kit stamp skipped:", err instanceof Error ? err.message : err);
          }
        }
        return storeImage({
          buffer,
          sourceUrl,
          mimeType,
          keyPrefix: `generations/${generationId}/${i}`,
        });
      }),
    );
    // A product named in the prompt is attached directly (not via curation).
    const namedProduct =
      stampBrandId && typeof meta.selectedProductAssetId === "string"
        ? await prisma.brandAsset
            .findFirst({
              where: { id: meta.selectedProductAssetId, brandId: stampBrandId },
              select: { label: true },
            })
            .catch(() => null)
        : null;
    // What brand identity actually reached this image - shown on the card.
    const brandApplied = stampBrandId
      ? {
          brandId: stampBrandId,
          logo: brandKitStamped,
          logoExpected: Boolean(stampKit),
          products: referenceImageUrls.filter((u) =>
            ((meta.candidateReferences as { url: string; kind: string }[] | undefined) ?? []).some(
              (c) => c.url === u && c.kind === "product",
            ),
          ).length + (typeof meta.selectedProductAssetId === "string" ? 1 : 0),
          productNames: [
            ...(namedProduct ? [namedProduct.label?.trim() || "unnamed product"] : []),
            ...((curation.selectedReferences as ReferenceCandidate[] | undefined) ?? [])
              .filter((c) => c.kind === "product")
              .map((c) => c.label?.trim() || "unnamed product"),
          ],
          colors:
            stampKit?.profile.colors ??
            (meta.brandCheck as { colors?: string[] } | undefined)?.colors ??
            [],
          warnings: [
            ...((meta.brandCheck as { warnings?: string[] } | undefined)?.warnings ?? []),
            ...(stampKit && !brandKitStamped
              ? ["The brand logo could not be applied to this image - use Apply brand kit to add it."]
              : []),
          ],
        }
      : null;

    let campaignPostCopy: string | null = null;
    if (
      meta.campaignCreative &&
      typeof meta.campaignCreative === "object" &&
      imageUrls[0] &&
      generation.conversationId
    ) {
      try {
        const campaignHistory = await loadChatHistory(
          generation.conversationId,
          generationId,
        );
        campaignPostCopy = await generateCampaignPostCopy(
          imageUrls[0],
          generation.prompt,
          campaignHistory,
          null,
        );
      } catch {
        console.warn("[worker] campaign post caption generation failed");
      }
    }

    // Every image ships with a why-it-matters note — the value framing turns
    // a render into a business asset the user knows how to deploy.
    const noteBrandId =
      generation.brandId ??
      (typeof meta.brandId === "string" ? meta.brandId : null);
    const noteBrand = noteBrandId
      ? await loadBrandContext(noteBrandId, generation.userId).catch(() => null)
      : null;
    const valueNote = meta.carouselSlide ? null : await describeImageValue({
      prompt: generation.prompt,
      themeSlug: generation.theme?.slug ?? null,
      mode,
      brandSummary: noteBrand?.summary?.trim() || null,
    }).catch((err) => {
      console.warn(
        "[worker] image value note failed:",
        err instanceof Error ? err.message : err,
      );
      return null;
    });
    const textResponse =
      [
        campaignPostCopy,
        valueNote ? `**Why this helps:** ${valueNote}` : null,
      ]
        .filter(Boolean)
        .join("\n\n") || null;

    const finished = await prisma.generation.updateMany({
      where: { id: generationId, status: "processing" },
      data: {
        status: "completed",
        imageUrls,
        textResponse,
        provider: result.providerUsed,
        model: (result.metadata.model as string | undefined) ?? null,
        metadata: {
          ...meta,
          ...result.metadata,
          ...curation,
          ...(relevance.length ? { relevanceScores: relevance } : {}),
          ...(brandKitStamped
            ? {
                brandKitStamped: true,
                ...(unbrandedImageUrls.length === imageUrls.length &&
                unbrandedImageUrls.every(Boolean)
                  ? { unbrandedImageUrls }
                  : {}),
              }
            : {}),
          ...(brandApplied ? { brandApplied } : {}),
          latencyMs: Date.now() - startedAt,
        },
      },
    });
    if (finished.count === 0) {
      // Cancelled while the provider was rendering — refund and stop quietly.
      await prisma.campaignPost.updateMany({
        where: { generationId },
        data: { status: "cancelled", error: "Stopped" },
      });
      await refundImageUsage(generationId).catch(() => {});
      publishGenerationEvent({ generationId, status: "cancelled" });
      return;
    }

    await prisma.campaignPost.updateMany({
      where: { generationId },
      data: { status: "ready_for_review", error: null },
    });

    // Persistent memory snapshot — everything needed to recall or reproduce
    // this generation later, not just the image. Bookkeeping must never
    // downgrade a completed job: a failure here used to mark the row failed
    // and refund quota for images that exist.
    if (!meta.carouselSlide) try {
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
          finalPrompt,
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
    } catch (err) {
      console.error("[worker] memory snapshot failed:", err);
    }

    publishGenerationEvent({ generationId, status: "completed", imageUrls });
  } catch (err) {
    // ImageGenerationAborted = Stop observed inside onPartialImage; same
    // handling as a mid-text-stream cancel.
    if (
      err instanceof GenerationCancelled ||
      err instanceof ImageGenerationAborted
    ) {
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
      await prisma.campaignPost
        .updateMany({
          where: { generationId },
          data: { status: "cancelled", error: "Stopped" },
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
    await prisma.campaignPost
      .updateMany({
        where: { generationId },
        data: { status: "failed", error: message },
      })
      .catch(() => {});
    await refundImageUsage(generationId).catch(() => {});
    publishGenerationEvent({ generationId, status: "failed", error: message });
    throw err;
  }
}
