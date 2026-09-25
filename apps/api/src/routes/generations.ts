import type { FastifyInstance, FastifyRequest } from "fastify";
import { prisma } from "@catgpt/db";
import {
  createGenerationSchema,
  regenerateGenerationSchema,
  type GenerationEvent,
  type ThemeStyleGuide,
} from "@catgpt/types";
import { badRequest, forbidden, notFound, parseBody } from "../lib/errors.js";
import { buildFinalPrompt, resolveProvider } from "../lib/prompt.js";
import { toGenerationDto } from "../lib/serialize.js";
import { enqueueGeneration } from "../services/queue.js";
import {
  publishGenerationEvent,
  subscribeGenerationEvents,
} from "../services/events.js";
import { classifyIntent, loadChatHistory } from "../services/chat.js";
import { renderMarkdownPdf } from "../services/pdf-export.js";
import { deleteStoredFiles, storeFile } from "../services/storage.js";
import {
  assertImageQuota,
  getImageUsage,
  quotaError,
  recordImageUsage,
  refundImageUsage,
} from "../lib/usage.js";
import { isCampaignConversation, isCampaignPrompt } from "../services/campaign.js";
import {
  brandImageGuidance,
  brandReferenceUrls,
  loadBrandContext,
} from "../lib/brand.js";
import type { BrandProfile } from "@catgpt/types";
import { findWorkspaceForUser } from "../lib/workspace-access.js";
import { env } from "../env.js";
import { isTrustedImageUrl } from "../lib/urls.js";

/**
 * Strict image gate — a prompt must explicitly ask to "create an image"
 * (anywhere in the text) to produce one. Everything else is a chat reply,
 * even with a theme armed; the theme only shapes image output, it is not
 * itself a request to generate.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const IMAGE_TRIGGER = /create\s+an?\s+image/i;

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
    // Campaign chats never take this path: "make 5 more images" there means
    // new campaign creatives, not an edit of the last image.
    if (
      conversationId &&
      !body.parentId &&
      userRefs.length === 0 &&
      !IMAGE_TRIGGER.test(body.prompt) &&
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
          // Seed refs from the image being edited — same path as an explicit
          // user upload, so the edit mode/references plumbing is unchanged.
          userRefs.push(...lastImage.imageUrls);
        }
      }
    }

    // An attached picture used to force an image job. Now a question ABOUT it
    // ("what is wrong with this UI?") is answered as text with vision; only
    // edit-style requests stay image jobs. One small classifier call, and only
    // in this narrow case (attachment, no explicit trigger/parent/campaign).
    let visionOnly = false;
    if (
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

    // Strict gate: an image only on explicit request — "create an image" in
    // the prompt, attached references, or a regenerate/edit chain (explicit
    // or inferred just above). Everything else is a text reply.
    // Voice turns are always spoken text replies - never an image job.
    const kind =
      !body.voice &&
      !visionOnly &&
      (userRefs.length > 0 ||
        effectiveParentId ||
        IMAGE_TRIGGER.test(body.prompt))
        ? ("image" as const)
        : ("text" as const);

    if (kind === "image") await assertImageQuota(req.userId);

    // Theme brand references come first — they're the base the edit keeps;
    // any user-attached refs are extra guidance on top.
    const brandRefs = brand && kind === "image" ? brandReferenceUrls(brand.assets) : [];
    const referenceImageUrls =
      kind === "image"
        ? [
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
          themeId: theme?.id ?? null,
          conversationId: chatId,
          kind,
          prompt: body.prompt,
          finalPrompt:
            kind === "image"
              ? buildFinalPrompt(theme, body.prompt) +
                (brand
                  ? brandImageGuidance(
                      brand.name,
                      (brand.profile ?? {}) as BrandProfile,
                      brand.assets.some((a) => a.kind === "logo"),
                    )
                  : "")
              : body.prompt,
          provider:
            kind === "image" ? resolveProvider(theme, body.provider) : "openai",
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
            ...(body.voice ? { voice: true } : {}),
            ...(visionOnly ? { visionImageUrls: userRefs.slice(0, 4) } : {}),
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
        !(await recordImageUsage(req.userId, generation.id))
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

    const referenceImageUrl = parent.imageUrls[0];
    if (!referenceImageUrl) {
      throw badRequest("Parent generation has no image to edit");
    }
    await assertImageQuota(req.userId);
    const prompt = body.prompt ?? parent.prompt;
    const theme = parent.themeId
      ? await prisma.theme.findUnique({ where: { id: parent.themeId } })
      : null;
    const parentMeta = (parent.metadata ?? {}) as Record<string, unknown>;
    const brandId =
      typeof parentMeta.brandId === "string" ? parentMeta.brandId : null;
    const brand = brandId ? await loadBrandContext(brandId, req.userId) : null;
    // The image being edited leads; extra references from the original carry over.
    const extraRefs = Array.isArray(parentMeta.referenceImageUrls)
      ? (parentMeta.referenceImageUrls as unknown[]).filter(
          (u): u is string => typeof u === "string" && u !== referenceImageUrl,
        )
      : [];
    const referenceImageUrls = [referenceImageUrl, ...extraRefs].slice(0, 10);

    const child = await prisma.generation.create({
      data: {
        userId: req.userId,
        themeId: parent.themeId,
        conversationId: parent.conversationId,
        prompt,
        finalPrompt:
          buildFinalPrompt(theme, prompt) +
          (brand
            ? brandImageGuidance(
                brand.name,
                (brand.profile ?? {}) as BrandProfile,
                brand.assets.some((a) => a.kind === "logo"),
              )
            : ""),
        provider: resolveProvider(theme, parent.provider),
        parentId: parent.id,
        metadata: {
          referenceImageUrl,
          referenceImageUrls,
          quality: body.quality ?? parentMeta.quality ?? "low",
          size: parentMeta.size ?? "auto",
          ...(brand ? { brandId: brand.id } : {}),
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
