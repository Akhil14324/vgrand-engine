import type { FastifyInstance, FastifyRequest } from "fastify";
import { prisma } from "@catgpt/db";
import {
  createGenerationSchema,
  regenerateGenerationSchema,
  SOCIAL_MAX_CAROUSEL_IMAGES,
  type GenerationEvent,
  type ImageEditOperation,
  type ThemeStyleGuide,
} from "@catgpt/types";
import { badRequest, forbidden, notFound, parseBody } from "../lib/errors.js";
import {
  buildEditPrompt,
  buildFinalPrompt,
  resolveProvider,
} from "../lib/prompt.js";
import { toGenerationDto } from "../lib/serialize.js";
import { enqueueGeneration } from "../services/queue.js";
import {
  publishGenerationEvent,
  subscribeGenerationEvents,
} from "../services/events.js";
import {
  classifyIntent,
  isImageCaptionRequest,
  loadChatHistory,
} from "../services/chat.js";
import { renderMarkdownPdf } from "../services/pdf-export.js";
import { deleteStoredFiles, storeFile } from "../services/storage.js";
import {
  assertImageQuota,
  getImageUsage,
  quotaError,
  recordImageUsage,
  refundImageUsage,
} from "../lib/usage.js";
import { isCampaignConversation, isCampaignPrompt, prepareCampaignCalendar } from "../services/campaign.js";
import { spawnImageBatch, splitImageBatch } from "../services/image-batch.js";
import {
  brandImageGuidance,
  brandReferenceUrls,
  loadBrandContext,
} from "../lib/brand.js";
import type { BrandProfile } from "@catgpt/types";
import { findWorkspaceForUser } from "../lib/workspace-access.js";
import { env } from "../env.js";
import { isTrustedImageUrl } from "../lib/urls.js";
import {
  requestsImageFromProductImage,
  resolveProductImageReference,
} from "../lib/product-image-reference.js";

/**
 * Fast-path image trigger — an explicit "create/make/generate/draw/design an
 * image" (any of a set of synonyms, plus a few common misspellings) skips
 * the classifyIntent() call below entirely. This is NOT the only way to
 * trigger an image: anything that doesn't match this regex still falls
 * through to classifyIntent(), which judges intent semantically (via Jev or
 * the chat model) rather than by keyword, so novel phrasing, synonyms not
 * listed here, and typos not listed here are still expected to route
 * correctly. This regex only exists to skip that extra call/latency for the
 * common, obvious phrasings.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const IMAGE_TRIGGER =
  /\b(?:crea[ts]e?d?|make|makes|generate?[sd]?|gen(?:erat)?e|genereate|genarate|genrate|draw|drawn|design(?:ed)?|render(?:ed)?|produce[sd]?|paint(?:ed)?|sketch(?:ed)?|illustrate[sd]?)\b\s*(?:\w+\s+){0,3}\b(?:an?\s+)?(?:image|images|imag\w*|imge|immage|iamge|photo|photos|picture|pictures|pic|pics|piture|pitcure|artwork|logo|logos|poster|posters|graphic|graphics)\b/i;

/**
 * Explicit "start over" phrasing — the user is asking for a complete
 * transformation, so the follow-up must NOT auto-attach the last image as an
 * edit base; it becomes a fresh draft. Narrow on purpose: "replace the
 * background" is an edit, "replace this image" is a recreate.
 */
const RECREATE_IMAGE =
  /\b(?:recreate|re-create|remake|re-?do|start over|from scratch|brand[- ]new|entirely (?:new|different)|totally different|completely (?:change|different|new|redo|remake|redesign|transform)|(?:redesign|replace|change) (?:the|this|that|my) (?:image|images|picture|pictures|photo|photos|poster|creative|design)|(?:new|different|another) (?:image|picture|photo|poster|design))\b/i;

const EDIT_OPERATION_PROMPTS: Record<Exclude<ImageEditOperation, "edit">, string> = {
  inpaint:
    "Edit only the transparent painted area in the mask. Match the surrounding image's lighting, texture, perspective, and style; leave every unmasked pixel unchanged.",
  outpaint:
    "Extend the existing image naturally into the transparent border. Preserve the subject, lighting, palette, and composition; do not redraw or crop the original pixels.",
  remove_background:
    "Remove the background completely. Keep the main subject exactly as it is - same shape, colours, details and any text - and place it on a clean, plain transparent or white background.",
  upscale:
    "Recreate this image at higher fidelity. Preserve the exact subject, layout, colours, text, and composition while improving edge clarity and detail.",
};

/** Chat title from the first prompt — first line, capped at 60 chars. */
function deriveTitle(prompt: string): string {
  const line = prompt.split("\n")[0]!.trim();
  return line.length > 60 ? `${line.slice(0, 60).trimEnd()}…` : line;
}

/** This API's public base URL as the caller sees it (proxy-aware). */
function publicBaseUrl(req: FastifyRequest): string {
  const proto =
    (req.headers["x-forwarded-proto"] as string | undefined)
      ?.split(",")[0]
      ?.trim() ?? req.protocol;
  return `${proto}://${req.headers.host ?? "localhost"}`;
}

/**
 * Brand references attached to a theme. Relative /theme-assets/ paths are
 * resolved to absolute URLs so providers can fetch them over HTTP.
 */
function themeReferenceUrls(
  req: FastifyRequest,
  theme: { styleGuide: unknown } | null,
): string[] {
  const refs =
    (theme?.styleGuide as ThemeStyleGuide | null)?.referenceImageUrls ?? [];
  return refs.map((u) => (u.startsWith("http") ? u : `${publicBaseUrl(req)}${u}`));
}

/** Verify a conversation exists and belongs to the caller. */
async function loadOwnedConversation(req: FastifyRequest, id: string) {
  const conversation = await prisma.conversation.findUnique({ where: { id } });
  if (!conversation) throw notFound("Conversation not found");
  if (conversation.userId !== req.userId) throw forbidden();
  return conversation;
}

async function loadOwned(req: FastifyRequest, id: string) {
  const generation = await prisma.generation.findUnique({
    where: { id },
    include: {
      theme: { select: { id: true, slug: true, label: true, icon: true } },
    },
  });
  if (!generation) throw notFound("Generation not found");
  if (generation.userId !== req.userId) throw forbidden();
  return generation;
}

export async function generationRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  /** Create a generation job. New ideas route to gpt-image-2.5-flare. */
  app.post(
    "/generations",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (req, reply) => {
    const body = parseBody(createGenerationSchema, req.body);

    // Every lookup here is independent — fire them together instead of paying
    // one DB round-trip after another before the 202 can go out.
    const [theme, brand, parent, , docs] = await Promise.all([
      body.themeSlug
        ? prisma.theme.findUnique({ where: { slug: body.themeSlug } })
        : Promise.resolve(null),
      // Brand mode: usable only if it is the caller's own brand (or one in a
      // workspace they own). Loaded once, narrowly - no assets/docs unless needed.
      body.brandId
        ? loadBrandContext(body.brandId, req.userId)
        : Promise.resolve(null),
      body.parentId ? loadOwned(req, body.parentId) : Promise.resolve(null),
      body.conversationId
        ? loadOwnedConversation(req, body.conversationId)
        : Promise.resolve(null),
      // Attached PDFs must belong to the caller — they get linked to this chat
      // so every later turn retrieves their chunks automatically.
      body.documentIds?.length
        ? prisma.document.findMany({
            where: { id: { in: body.documentIds }, userId: req.userId },
            select: { id: true, filename: true, storageUrl: true },
          })
        : Promise.resolve([]),
      // A workspaceId only applies to conversations this request creates —
      // it gives the new chat a durable workspace home from turn one.
      body.workspaceId
        ? findWorkspaceForUser(req.userId, body.workspaceId)
        : Promise.resolve(null),
    ]);
    if (body.themeSlug && (!theme || !theme.isActive)) {
      throw notFound(`Theme "/${body.themeSlug}" not found`);
    }
    if (body.brandId && !brand) throw notFound("Brand not found");
    if (body.documentIds?.length && docs.length !== body.documentIds.length) {
      throw badRequest("one or more attached documents were not found");
    }

    const productImageResolution = resolveProductImageReference(
      body.prompt,
      brand?.assets
        .filter((asset) => asset.kind === "product")
        .map(({ id, label, url }) => ({ id, label, url })) ?? [],
    );
    const hasProductImageReference = productImageResolution.status !== "none";
    const userRefs = [
      ...new Set([
        ...(body.referenceImageUrl ? [body.referenceImageUrl] : []),
        ...(body.referenceImageUrls ?? []),
      ]),
    ];
    // The server fetches these — only images uploaded through the app.
    if (!userRefs.every(isTrustedImageUrl)) {
      throw badRequest("reference images must be uploaded through the app");
    }

    // Chat resolution order: explicit conversationId → inherit the parent's
    // chat → spin up a new conversation titled from the prompt.
    let conversationId =
      body.conversationId ?? parent?.conversationId ?? null;
    // Looked up at most once per send, and only if a branch below needs it.
    let campaignChat: Promise<boolean> | undefined;
    const inCampaignChat = () =>
      (campaignChat ??= conversationId
        ? isCampaignConversation(conversationId)
        : Promise.resolve(false));

    // In a chat that already produced an image, a follow-up like "now add a
    // hat" is an edit of that image — but only when nothing else claimed the
    // turn (no fresh upload, no explicit parent, no "create an image" trigger).
    // The classifier only runs in this narrow branch, not on every message.
    let effectiveParentId: string | null = body.parentId ?? null;
    let inferredParentImageUrl: string | null = null;
    // Campaign chats never take this path: "make 5 more images" there means
    // new campaign creatives, not an edit of the last image. Likewise an
    // explicit "recreate it completely" (or a UI recreate flag) is a fresh
    // draft — the rule is: described change edits the exact image, a full
    // redo starts a new one.
    if (
      conversationId &&
      !body.parentId &&
      !body.recreate &&
      !hasProductImageReference &&
      userRefs.length === 0 &&
      !IMAGE_TRIGGER.test(body.prompt) &&
      !RECREATE_IMAGE.test(body.prompt) &&
      !isCampaignPrompt(body.prompt)
    ) {
      const [inCampaign, lastImage] = await Promise.all([
        inCampaignChat(),
        prisma.generation.findFirst({
          where: { conversationId, kind: "image", status: "completed" },
          orderBy: { createdAt: "desc" },
        }),
      ]);
      if (!inCampaign && lastImage && lastImage.imageUrls.length > 0) {
        const intent = await classifyIntent(
          body.prompt,
          await loadChatHistory(conversationId),
        );
        if (intent === "image") {
          effectiveParentId = lastImage.id;
          inferredParentImageUrl = lastImage.imageUrls[0] ?? null;
        }
      }
    }

    // An attached picture used to force an image job. Now a question ABOUT it
    // ("what is wrong with this UI?") is answered as text with vision; only
    // edit-style requests stay image jobs. One small classifier call, and only
    // in this narrow case (attachment, no explicit trigger/parent/campaign).
    let visionOnly = Boolean(
      userRefs.length > 0 &&
        !effectiveParentId &&
        !IMAGE_TRIGGER.test(body.prompt) &&
        isImageCaptionRequest(body.prompt),
    );
    if (
      !visionOnly &&
      userRefs.length > 0 &&
      !effectiveParentId &&
      !IMAGE_TRIGGER.test(body.prompt) &&
      !isCampaignPrompt(body.prompt) &&
      !(await inCampaignChat())
    ) {
      const intent = await classifyIntent(
        body.prompt,
        conversationId ? await loadChatHistory(conversationId) : [],
        { hasImage: true },
      );
      visionOnly = intent === "text";
    }

    // A plain request such as "generate a biryani image" or "show me what a
    // treehouse in the clouds would look like" has no exact trigger phrase
    // and no guarantee of hitting one of the IMAGE_CUE words either — so
    // instead of gating the classifier on a keyword guess, let it look at
    // every plain prompt (plus recent history) and decide for itself. Jev is
    // a cheap typed-choice call, not a full chat completion, so this is
    // worth paying on every turn that isn't already resolved above.
    let inferredImage = requestsImageFromProductImage(
      body.prompt,
      productImageResolution,
    );
    if (
      !inferredImage &&
      !body.voice &&
      !visionOnly &&
      userRefs.length === 0 &&
      !effectiveParentId &&
      !IMAGE_TRIGGER.test(body.prompt) &&
      !isCampaignPrompt(body.prompt) &&
      !(await inCampaignChat())
    ) {
      const intent = await classifyIntent(
        body.prompt,
        conversationId ? await loadChatHistory(conversationId) : [],
      );
      inferredImage = intent === "image";
    }

    // A dated multi-day content ask in a normal chat ("posts for the next 7
    // days") still gets the same verified calendar check campaign mode runs:
    // per-date occasions feed the reply text and any per-day image briefs,
    // so day content is grounded in real events rather than guessed. Campaign
    // chats run their own (richer-context) check in the worker instead.
    let calendarNote: string | null = null;
    if (
      !body.voice &&
      !visionOnly &&
      !isCampaignPrompt(body.prompt) &&
      !(await inCampaignChat())
    ) {
      const cal = await prepareCampaignCalendar(
        body.prompt,
        brand ? `Brand: ${brand.name}\n${brand.summary ?? ""}` : "",
        brand?.name ?? null,
      );
      if (cal) {
        calendarNote = [
          "Verified calendar check for the requested dates (Asia/Kolkata):",
          ...cal.days.map(
            (d) =>
              `- ${d.date}: ${d.relevantEvent ?? "no relevant occasion - normal brand content"}`,
          ),
          `Sources: ${cal.sources.map((s) => `${s.title} ${s.url}`).join("; ") || "curated holiday calendar"}`,
          "When a date lists an occasion, theme that day's post on it; otherwise write a normal on-brand post. Never invent or assume an occasion not listed here.",
        ].join("\n");
      }
    }

    // One message can describe several distinct images ("Days 10 to 14,
    // each with its own Telugu text") — without this split the chat model
    // cannot actually call the image tool more than once, so it used to
    // narrate the request back with sample code instead of ever producing
    // one. Only worth checking once we already know this is an image ask.
    const batchBriefs = inferredImage
      ? await splitImageBatch(
          calendarNote ? `${body.prompt}\n\n${calendarNote}` : body.prompt,
          [],
        )
      : [];
    const isBatch = batchBriefs.length > 1;

    // Strict gate: an image only on explicit request — "create an image" in
    // the prompt, attached references, or a regenerate/edit chain (explicit
    // or inferred just above). Everything else is a text reply.
    // Voice turns are always spoken text replies - never an image job.
    const kind =
      !body.voice &&
      !visionOnly &&
      (userRefs.length > 0 ||
        effectiveParentId ||
        IMAGE_TRIGGER.test(body.prompt) ||
        inferredImage)
        ? ("image" as const)
        : ("text" as const);

    if (kind === "image" && productImageResolution.status === "ambiguous") {
      throw badRequest(
        `More than one Product Image matches the requested name (${productImageResolution.names.join(", ")}). Rename the duplicates or quote one unique name.`,
      );
    }
    if (kind === "image" && productImageResolution.status === "missing") {
      if (!brand) {
        throw badRequest(
          `Select the Brand that owns Product Image "${productImageResolution.requestedName}" before generating.`,
        );
      }
      const names = brand.assets
        .filter((asset) => asset.kind === "product" && asset.label?.trim())
        .map((asset) => asset.label!.trim());
      throw badRequest(
        `Product Image "${productImageResolution.requestedName}" was not found in the selected Brand.${names.length ? ` Available names: ${names.join(", ")}.` : " Name a Product Image in the Brand section first."}`,
      );
    }
    const selectedProduct =
      productImageResolution.status === "match"
        ? productImageResolution.asset
        : null;

    // A ready-made carousel set: only for a fresh, non-edit-chain image
    // request that wasn't already split into distinct per-item briefs.
    const imageCount =
      kind === "image" && !effectiveParentId && !isBatch
        ? Math.min(Math.max(body.imageCount ?? 1, 1), SOCIAL_MAX_CAROUSEL_IMAGES)
        : 1;

    if (kind === "image") await assertImageQuota(req.userId, imageCount);

    const parentImageUrl = effectiveParentId
      ? parent?.id === effectiveParentId
        ? parent.imageUrls[0] ?? null
        : inferredParentImageUrl
      : null;
    if (effectiveParentId && !parentImageUrl) {
      throw badRequest("Parent generation has no image to edit");
    }
    const brandRefs =
      brand && kind === "image"
        ? brandReferenceUrls(
            brand.assets,
            brand.mascot?.asset.url,
            selectedProduct?.url,
          )
        : [];
    const referenceImageUrls =
      kind === "image"
        ? effectiveParentId
          ? [
              ...new Set([
                parentImageUrl!,
                ...(selectedProduct ? [selectedProduct.url] : []),
                ...userRefs,
              ]),
            ].slice(0, 10)
          : [
              ...new Set([
                ...brandRefs,
                ...themeReferenceUrls(req, theme),
                ...userRefs,
              ]),
            ].slice(0, 10)
        : [];

    // Plain writes, not an interactive $transaction: behind the Supabase
    // transaction pooler (pgbouncer) interactive transactions time out with
    // "Unable to start a transaction in the given time" under load. Only a new
    // chat has to exist before the rest; the other writes go out together.
    const generation = await (async () => {
      const isNewChat = !conversationId;
      const chatId: string =
        conversationId ??
        (
          await prisma.conversation.create({
            data: {
              userId: req.userId,
              title: deriveTitle(body.prompt),
              workspaceId: body.workspaceId ?? null,
              campaign: isCampaignPrompt(body.prompt),
            },
          })
        ).id;
      conversationId = chatId;
      const [created] = await Promise.all([
        prisma.generation.create({
        data: {
          userId: req.userId,
          brandId: brand?.id ?? null,
          themeId: theme?.id ?? null,
          conversationId: chatId,
          kind,
          prompt: body.prompt,
          finalPrompt:
            kind === "image"
              ? (effectiveParentId
                  ? buildEditPrompt(
                      body.prompt,
                      userRefs.length > 0 || Boolean(selectedProduct),
                    )
                  : buildFinalPrompt(
                      theme,
                      isBatch ? batchBriefs[0]!.prompt : body.prompt,
                    )) +
                (selectedProduct
                  ? `\nUse the exact saved Product Image ${JSON.stringify(selectedProduct.label)} from the active Brand. ${effectiveParentId ? "It follows the image being edited in the references." : "It is supplied first as a reference."} Do not substitute or reinterpret it as a different product.`
                  : "") +
                (brand
                  ? brandImageGuidance(
                      brand.name,
                      (brand.profile ?? {}) as BrandProfile,
                      brand.assets.some((a) => a.kind === "logo"),
                      brand.mascot,
                      brand.assets.some((a) => a.kind === "product"),
                    )
                  : "")
              : body.prompt,
          provider:
            kind === "image"
              ? selectedProduct
                ? "openai"
                : resolveProvider(theme, body.provider)
              : "openai",
          parentId: effectiveParentId,
          metadata: {
            referenceImageUrl: referenceImageUrls[0],
            referenceImageUrls,
            ...(docs.length
              ? {
                  attachedDocuments: docs.map((d) => ({
                    id: d.id,
                    filename: d.filename,
                    storageUrl: d.storageUrl,
                  })),
                }
              : {}),
            quality: body.quality ?? "low",
            size: body.size ?? "auto",
            ...(body.webSearch ? { webSearch: true } : {}),
            ...(brand ? { brandId: brand.id } : {}),
            ...(selectedProduct ? { selectedProductAssetId: selectedProduct.id } : {}),
            ...(body.voice ? { voice: true } : {}),
            ...(visionOnly ? { visionImageUrls: userRefs.slice(0, 4) } : {}),
            ...(imageCount > 1 ? { imageCount } : {}),
            ...(calendarNote ? { calendarNote } : {}),
          },
        },
        }),
        // Bump recency so the chat floats to the top of the sidebar.
        isNewChat
          ? null
          : prisma.conversation.update({
              where: { id: chatId },
              data: {
                updatedAt: new Date(),
                // Sticky flag — campaign mode survives across later turns
                // without re-scanning prompts on every message.
                ...(isCampaignPrompt(body.prompt) ? { campaign: true } : {}),
              },
            }),
        docs.length
          ? prisma.document.updateMany({
              // Workspace and brand documents keep their own home — linking
              // them here would make deleting this chat delete them too.
              where: {
                id: { in: docs.map((d) => d.id) },
                workspaceId: null,
                brandId: null,
              },
              data: { conversationId: chatId },
            })
          : null,
      ]);
      return created;
    })();
    // Quota row and enqueue don't depend on each other — but the quota insert
    // is itself atomic (count + insert in one statement), so racing sends
    // can't both pass the last slot. If either step fails the user must not
    // stay charged for a job that will never run.
    try {
      if (
        kind === "image" &&
        !(await recordImageUsage(req.userId, generation.id, imageCount))
      ) {
        throw quotaError(env.IMAGE_DAILY_LIMIT);
      }
      await enqueueGeneration(generation.id);
    } catch (err) {
      await Promise.allSettled([
        refundImageUsage(generation.id),
        prisma.generation.update({
          where: { id: generation.id },
          data: { status: "failed", error: "Could not start the job" },
        }),
      ]);
      throw err;
    }
    // The rest of the batch (briefs beyond the first) - fire-and-forget so it
    // never delays this response; each spawned image is its own generation
    // that shows up in the feed as the worker finishes it.
    if (kind === "image" && isBatch) {
      void spawnImageBatch({
        userId: req.userId,
        conversationId: conversationId!,
        briefs: batchBriefs.slice(1),
        theme,
        brandId: brand?.id ?? null,
        provider: generation.provider,
        referenceImageUrls,
        ...(selectedProduct
          ? {
              productImage: {
                id: selectedProduct.id,
                label: selectedProduct.label ?? "",
                url: selectedProduct.url,
              },
            }
          : {}),
        quality: body.quality ?? "low",
        size: body.size ?? "auto",
      }).catch((err) =>
        console.error("[generations] image batch spawn failed:", err),
      );
    }
    return reply.code(202).send({
      generationId: generation.id,
      conversationId,
      status: "pending",
      kind,
    });
  });

  /** Today's image quota — chat is unlimited, images are capped per day. */
  app.get("/usage", async (req) => getImageUsage(req.userId));

  /** Paginated history — the "memory" feed. Filter by theme or chat. */
  app.get("/generations", async (req) => {
    const q = req.query as {
      themeSlug?: string;
      conversationId?: string;
      cursor?: string;
      limit?: string;
    };
    const limit = Math.min(Math.max(Number(q.limit) || 30, 1), 100);
    if (q.cursor && !UUID_RE.test(q.cursor)) throw badRequest("invalid cursor");
    const items = await prisma.generation.findMany({
      where: {
        userId: req.userId,
        ...(q.themeSlug ? { theme: { slug: q.themeSlug } } : {}),
        ...(q.conversationId ? { conversationId: q.conversationId } : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: limit + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
      // Everything except finalPrompt — it duplicates prompt + the theme
      // template and the feed never renders it.
      select: {
        id: true,
        userId: true,
        themeId: true,
        kind: true,
        prompt: true,
        textResponse: true,
        provider: true,
        model: true,
        imageUrls: true,
        status: true,
        error: true,
        metadata: true,
        parentId: true,
        conversationId: true,
        brandId: true,
        createdAt: true,
        theme: { select: { id: true, slug: true, label: true, icon: true } },
      },
    });
    const hasMore = items.length > limit;
    const page = hasMore ? items.slice(0, limit) : items;
    return {
      items: page.map(toGenerationDto),
      nextCursor: hasMore ? page[page.length - 1]!.id : null,
    };
  });

  app.get("/generations/:id", async (req) => {
    const { id } = req.params as { id: string };
    return toGenerationDto(await loadOwned(req, id));
  });

  /**
   * Stop a running turn. Marks the row cancelled so a queued worker skips it
   * and an in-flight worker aborts at its next check; the image quota is
   * refunded either way (the ledger row only exists for image jobs).
   */
  app.post("/generations/:id/cancel", async (req, reply) => {
    const { id } = req.params as { id: string };
    await loadOwned(req, id);
    const { count } = await prisma.generation.updateMany({
      where: { id, status: { in: ["pending", "processing"] } },
      data: { status: "cancelled", error: "Stopped" },
    });
    if (count > 0) {
      await refundImageUsage(id).catch(() => {});
      publishGenerationEvent({ generationId: id, status: "cancelled" });
    }
    return reply.code(204).send();
  });

  app.delete("/generations/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const generation = await loadOwned(req, id);
    await prisma.generation.delete({ where: { id } });
    // Reclaim the generated images — references/uploads are shared inputs and
    // are deliberately left alone.
    await deleteStoredFiles(generation.imageUrls);
    return reply.code(204).send();
  });

  /**
   * Re-run with an edited prompt — routes to gpt-image-2.5-sunburst and links
   * to the source via parentId, passing the parent's image as the reference.
   */
  app.post("/generations/:id/regenerate", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parent = await loadOwned(req, id);
    const body = parseBody(regenerateGenerationSchema, req.body);
    const operation = body.operation ?? "edit";

    const parentImageUrl = parent.imageUrls[0];
    if (!parentImageUrl) {
      throw badRequest("Parent generation has no image to edit");
    }
    const referenceImageUrl = body.referenceImageUrl ?? parentImageUrl;
    if (body.referenceImageUrl && !isTrustedImageUrl(body.referenceImageUrl)) {
      throw badRequest("edit base must be uploaded through the app");
    }
    // Extra user uploads the edit should draw from (e.g. "swap the biryani
    // for this photo") — same upload-only rule as every server-fetched ref.
    const userRefUrls = body.referenceImageUrls ?? [];
    if (!userRefUrls.every(isTrustedImageUrl)) {
      throw badRequest("reference images must be uploaded through the app");
    }
    if (body.maskImageUrl && !isTrustedImageUrl(body.maskImageUrl)) {
      throw badRequest("mask image must be uploaded through the app");
    }
    if (operation === "inpaint" && !body.maskImageUrl) {
      throw badRequest("inpaint needs a painted mask");
    }
    if (operation === "outpaint" && !body.referenceImageUrl) {
      throw badRequest("outpaint needs an expanded canvas image");
    }
    const prompt =
      body.prompt ??
      (operation === "edit" ? parent.prompt : EDIT_OPERATION_PROMPTS[operation]);
    const theme = parent.themeId
      ? await prisma.theme.findUnique({ where: { id: parent.themeId } })
      : null;
    const parentMeta = (parent.metadata ?? {}) as Record<string, unknown>;
    const brandId =
      typeof parentMeta.brandId === "string" ? parentMeta.brandId : null;
    const brand = brandId ? await loadBrandContext(brandId, req.userId) : null;
    const productImageResolution = resolveProductImageReference(
      prompt,
      brand?.assets
        .filter((asset) => asset.kind === "product")
        .map(({ id, label, url }) => ({ id, label, url })) ?? [],
    );
    if (productImageResolution.status === "ambiguous") {
      throw badRequest(
        `More than one Product Image matches the requested name (${productImageResolution.names.join(", ")}). Rename the duplicates or quote one unique name.`,
      );
    }
    if (productImageResolution.status === "missing") {
      if (!brand) {
        throw badRequest(
          `Select the Brand that owns Product Image "${productImageResolution.requestedName}" before editing.`,
        );
      }
      const names = brand.assets
        .filter((asset) => asset.kind === "product" && asset.label?.trim())
        .map((asset) => asset.label!.trim());
      throw badRequest(
        `Product Image "${productImageResolution.requestedName}" was not found in the selected Brand.${names.length ? ` Available names: ${names.join(", ")}.` : " Name a Product Image in the Brand section first."}`,
      );
    }
    const selectedProduct =
      productImageResolution.status === "match"
        ? productImageResolution.asset
        : null;
    const referenceImageUrls = [
      ...new Set([
        referenceImageUrl,
        ...(selectedProduct ? [selectedProduct.url] : []),
        ...userRefUrls,
      ]),
    ].slice(0, 10);
    await assertImageQuota(req.userId);

    const child = await prisma.generation.create({
      data: {
        userId: req.userId,
        brandId: brand?.id ?? null,
        themeId: parent.themeId,
        conversationId: parent.conversationId,
        prompt,
        finalPrompt:
          buildEditPrompt(
            prompt,
            userRefUrls.length > 0 || Boolean(selectedProduct),
          ) +
          (selectedProduct
            ? `\nUse the exact saved Product Image ${JSON.stringify(selectedProduct.label)} from the active Brand. This selected image is supplied after the image being edited. Do not substitute or reinterpret it as a different product.`
            : "") +
          (brand
            ? brandImageGuidance(
                brand.name,
                (brand.profile ?? {}) as BrandProfile,
                brand.assets.some((a) => a.kind === "logo"),
                brand.mascot,
                brand.assets.some((a) => a.kind === "product"),
              )
            : ""),
        provider:
          !selectedProduct && operation === "edit" && userRefUrls.length === 0
            ? resolveProvider(theme, parent.provider)
            : "openai",
        parentId: parent.id,
        metadata: {
          referenceImageUrl,
          referenceImageUrls,
          maskImageUrl: body.maskImageUrl,
          editOperation: operation,
          quality: body.quality ?? parentMeta.quality ?? "low",
          size: body.size ?? parentMeta.size ?? "auto",
          ...(brand ? { brandId: brand.id } : {}),
          ...(selectedProduct ? { selectedProductAssetId: selectedProduct.id } : {}),
        },
      },
    });
    if (child.conversationId) {
      await prisma.conversation.update({
        where: { id: child.conversationId },
        data: { updatedAt: new Date() },
      });
    }
    // Same contract as POST /generations: if the enqueue fails (Redis blip)
    // the child must not sit pending forever, and the quota is refunded.
    try {
      if (!(await recordImageUsage(req.userId, child.id))) {
        throw quotaError(env.IMAGE_DAILY_LIMIT);
      }
      await enqueueGeneration(child.id);
    } catch (err) {
      await Promise.allSettled([
        refundImageUsage(child.id),
        prisma.generation.update({
          where: { id: child.id },
          data: { status: "failed", error: "Could not start the job" },
        }),
      ]);
      throw err;
    }
    return reply.code(202).send({
      generationId: child.id,
      conversationId: child.conversationId,
      status: "pending",
    });
  });

  /**
   * Export a text reply as a downloadable PDF. Rendered server-side with a
   * lightweight markdown layout; the URL is cached in metadata so repeat
   * clicks return instantly.
   */
  app.post("/generations/:id/pdf", async (req) => {
    const { id } = req.params as { id: string };
    const generation = await loadOwned(req, id);
    const text = generation.textResponse;
    if (!text) {
      throw badRequest("Generation has no text response to export");
    }
    const meta = (generation.metadata ?? {}) as Record<string, unknown>;
    if (typeof meta.pdfUrl === "string") return { url: meta.pdfUrl };

    const title =
      generation.prompt.split("\n")[0]!.slice(0, 90) || "CatGPT export";
    const buffer = await renderMarkdownPdf(title, text);
    const url = await storeFile({
      buffer,
      mimeType: "application/pdf",
      keyPrefix: `exports/${req.userId}`,
    });
    await prisma.generation.update({
      where: { id },
      data: { metadata: { ...meta, pdfUrl: url } },
    });
    return { url };
  });

  /** SSE stream for the live "generating..." state. Token may come via ?token=. */
  app.get("/generations/:id/events", async (req, reply) => {
    const { id } = req.params as { id: string };
    // Ownership check before the stream opens — loadOwned throws 404/403.
    await loadOwned(req, id);

    await reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      "Access-Control-Allow-Origin": "*",
    });

    let done = false;
    const send = (evt: GenerationEvent) => {
      if (done) return;
      reply.raw.write(`data: ${JSON.stringify(evt)}\n\n`);
    };

    const heartbeat = setInterval(() => reply.raw.write(": ping\n\n"), 25_000);
    // Subscribe BEFORE the snapshot read: a completion that lands between the
    // auth check above and this point is caught by the fresh read below rather
    // than silently missed (the old order could leave the stream stuck).
    const unsubscribe = subscribeGenerationEvents(id, (evt) => {
      send(evt);
      if (
        evt.status === "completed" ||
        evt.status === "failed" ||
        evt.status === "cancelled"
      )
        cleanup();
    });
    const cleanup = () => {
      if (done) return;
      done = true;
      clearInterval(heartbeat);
      unsubscribe();
      reply.raw.end();
    };
    req.raw.on("close", cleanup);

    const generation = await prisma.generation.findUnique({ where: { id } });
    if (generation) {
      send({
        generationId: generation.id,
        status: generation.status as GenerationEvent["status"],
        kind: generation.kind as GenerationEvent["kind"],
        imageUrls: generation.imageUrls,
        textResponse: generation.textResponse,
        error: generation.error,
      });
    }
    if (
      !generation ||
      generation.status === "completed" ||
      generation.status === "failed" ||
      generation.status === "cancelled"
    ) {
      cleanup();
    }
  });
}
