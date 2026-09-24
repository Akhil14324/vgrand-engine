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
import { subscribeGenerationEvents } from "../services/events.js";
import { renderMarkdownPdf } from "../services/pdf-export.js";
import { storeFile } from "../services/storage.js";
import { env } from "../env.js";

/**
 * Strict image gate — a prompt must explicitly ask to "create an image"
 * (anywhere in the text) to produce one. Everything else is a chat reply,
 * even with a theme armed; the theme only shapes image output, it is not
 * itself a request to generate.
 */
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
  app.post("/generations", async (req, reply) => {
    const body = parseBody(createGenerationSchema, req.body);

    let theme = null;
    if (body.themeSlug) {
      theme = await prisma.theme.findUnique({
        where: { slug: body.themeSlug },
      });
      if (!theme || !theme.isActive) {
        throw notFound(`Theme "/${body.themeSlug}" not found`);
      }
    }
    const parent = body.parentId ? await loadOwned(req, body.parentId) : null;
    const userRefs = [
      ...new Set([
        ...(body.referenceImageUrl ? [body.referenceImageUrl] : []),
        ...(body.referenceImageUrls ?? []),
      ]),
    ];

    // Strict gate: an image only on explicit request — "create an image" in
    // the prompt, attached references, or a regenerate/edit chain. No
    // classifier guesswork: everything else is a text reply.
    const kind =
      userRefs.length > 0 || body.parentId || IMAGE_TRIGGER.test(body.prompt)
        ? ("image" as const)
        : ("text" as const);

    // Theme brand references come first — they're the base the edit keeps;
    // any user-attached refs are extra guidance on top.
    const referenceImageUrls =
      kind === "image"
        ? [
            ...new Set([...themeReferenceUrls(req, theme), ...userRefs]),
          ].slice(0, 10)
        : [];

    // Chat resolution order: explicit conversationId → inherit the parent's
    // chat → spin up a new conversation titled from the prompt.
    let conversationId =
      body.conversationId ?? parent?.conversationId ?? null;
    if (body.conversationId) {
      await loadOwnedConversation(req, body.conversationId);
    }

    // Attached PDFs must belong to the caller — they get linked to this chat
    // so every later turn retrieves their chunks automatically.
    const docs = body.documentIds?.length
      ? await prisma.document.findMany({
          where: { id: { in: body.documentIds }, userId: req.userId },
          select: { id: true, filename: true },
        })
      : [];
    if (body.documentIds?.length && docs.length !== body.documentIds.length) {
      throw badRequest("one or more attached documents were not found");
    }

    const generation = await prisma.$transaction(async (tx) => {
      if (conversationId) {
        // Bump recency so the chat floats to the top of the sidebar.
        await tx.conversation.update({
          where: { id: conversationId },
          data: { updatedAt: new Date() },
        });
      } else {
        const conversation = await tx.conversation.create({
          data: { userId: req.userId, title: deriveTitle(body.prompt) },
        });
        conversationId = conversation.id;
      }
      if (docs.length) {
        await tx.document.updateMany({
          where: { id: { in: docs.map((d) => d.id) } },
          data: { conversationId },
        });
      }
      return tx.generation.create({
        data: {
          userId: req.userId,
          themeId: theme?.id ?? null,
          conversationId,
          kind,
          prompt: body.prompt,
          finalPrompt:
            kind === "image" ? buildFinalPrompt(theme, body.prompt) : body.prompt,
          provider:
            kind === "image" ? resolveProvider(theme, body.provider) : "openai",
          parentId: body.parentId ?? null,
          metadata: {
            referenceImageUrl: referenceImageUrls[0],
            referenceImageUrls,
            ...(docs.length
              ? {
                  attachedDocuments: docs.map((d) => ({
                    id: d.id,
                    filename: d.filename,
                  })),
                }
              : {}),
            quality: body.quality ?? "low",
            size: body.size ?? "auto",
          },
        },
      });
    });
    await enqueueGeneration(generation.id);
    return reply.code(202).send({
      generationId: generation.id,
      conversationId,
      status: "pending",
      kind,
    });
  });

  /** Paginated history — the "memory" feed. Filter by theme or chat. */
  app.get("/generations", async (req) => {
    const q = req.query as {
      themeSlug?: string;
      conversationId?: string;
      cursor?: string;
      limit?: string;
    };
    const limit = Math.min(Number(q.limit) || 30, 100);
    const items = await prisma.generation.findMany({
      where: {
        userId: req.userId,
        ...(q.themeSlug ? { theme: { slug: q.themeSlug } } : {}),
        ...(q.conversationId ? { conversationId: q.conversationId } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: limit + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
      include: {
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

  app.delete("/generations/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    await loadOwned(req, id);
    await prisma.generation.delete({ where: { id } });
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
    const prompt = body.prompt ?? parent.prompt;
    const theme = parent.themeId
      ? await prisma.theme.findUnique({ where: { id: parent.themeId } })
      : null;
    const parentMeta = (parent.metadata ?? {}) as Record<string, unknown>;

    const child = await prisma.generation.create({
      data: {
        userId: req.userId,
        themeId: parent.themeId,
        conversationId: parent.conversationId,
        prompt,
        finalPrompt: buildFinalPrompt(theme, prompt),
        provider: resolveProvider(theme, parent.provider),
        parentId: parent.id,
        metadata: {
          referenceImageUrl,
          quality: body.quality ?? parentMeta.quality ?? "low",
          size: parentMeta.size ?? "auto",
        },
      },
    });
    if (child.conversationId) {
      await prisma.conversation.update({
        where: { id: child.conversationId },
        data: { updatedAt: new Date() },
      });
    }
    await enqueueGeneration(child.id);
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
    const generation = await loadOwned(req, id);

    await reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      "Access-Control-Allow-Origin": "*",
    });

    const send = (evt: GenerationEvent) =>
      reply.raw.write(`data: ${JSON.stringify(evt)}\n\n`);

    send({
      generationId: generation.id,
      status: generation.status as GenerationEvent["status"],
      kind: generation.kind as GenerationEvent["kind"],
      imageUrls: generation.imageUrls,
      textResponse: generation.textResponse,
      error: generation.error,
    });
    if (generation.status === "completed" || generation.status === "failed") {
      reply.raw.end();
      return;
    }

    const heartbeat = setInterval(() => reply.raw.write(": ping\n\n"), 25_000);
    const unsubscribe = subscribeGenerationEvents((evt) => {
      if (evt.generationId !== generation.id) return;
      send(evt);
      if (evt.status === "completed" || evt.status === "failed") cleanup();
    });
    const cleanup = () => {
      clearInterval(heartbeat);
      unsubscribe();
      reply.raw.end();
    };
    req.raw.on("close", cleanup);
  });
}
