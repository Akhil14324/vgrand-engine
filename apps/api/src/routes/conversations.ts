import type { FastifyInstance, FastifyRequest } from "fastify";
import { prisma } from "@catgpt/db";
import { updateConversationSchema } from "@catgpt/types";
import { badRequest, forbidden, notFound, parseBody } from "../lib/errors.js";
import { toConversationDto } from "../lib/serialize.js";
import { loadTranscript, transcriptMarkdown } from "../lib/transcript.js";
import { renderMarkdownPdf } from "../services/pdf-export.js";
import { deleteStoredFiles, storeFile } from "../services/storage.js";

const PREVIEW_INCLUDE = {
  _count: { select: { generations: true } },
  generations: {
    take: 1,
    orderBy: { createdAt: "desc" as const },
    select: { id: true, prompt: true, imageUrls: true, status: true },
  },
  workspace: { select: { id: true, name: true } },
};

async function loadOwned(req: FastifyRequest, id: string) {
  const conversation = await prisma.conversation.findUnique({ where: { id } });
  if (!conversation) throw notFound("Conversation not found");
  if (conversation.userId !== req.userId) throw forbidden();
  return conversation;
}

export async function conversationRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  /** Recent chats for the sidebar — pinned first, then most recently active.
   *  ?search= matches title OR any generation prompt/reply inside the chat. */
  app.get("/conversations", async (req) => {
    const q = req.query as {
      cursor?: string;
      limit?: string;
      archived?: string;
      search?: string;
    };
    const limit = Math.min(Math.max(Number(q.limit) || 50, 1), 100);
    const search = q.search?.trim();
    if (q.cursor && !/^[0-9a-f-]{36}$/i.test(q.cursor)) {
      throw badRequest("invalid cursor");
    }
    const items = await prisma.conversation.findMany({
      where: {
        userId: req.userId,
        archived: q.archived === "true",
        ...(search
          ? {
              OR: [
                { title: { contains: search, mode: "insensitive" as const } },
                {
                  generations: {
                    some: {
                      OR: [
                        {
                          prompt: {
                            contains: search,
                            mode: "insensitive" as const,
                          },
                        },
                        {
                          textResponse: {
                            contains: search,
                            mode: "insensitive" as const,
                          },
                        },
                      ],
                    },
                  },
                },
              ],
            }
          : {}),
      },
      orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }, { id: "asc" }],
      take: limit + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
      include: PREVIEW_INCLUDE,
    });
    const hasMore = items.length > limit;
    const page = hasMore ? items.slice(0, limit) : items;
    return {
      items: page.map(toConversationDto),
      nextCursor: hasMore ? page[page.length - 1]!.id : null,
    };
  });

  app.get("/conversations/:id", async (req) => {
    const { id } = req.params as { id: string };
    // One query — loadOwned + findUniqueOrThrow paid two round-trips for the
    // same row.
    const conversation = await prisma.conversation.findUnique({
      where: { id },
      include: PREVIEW_INCLUDE,
    });
    if (!conversation) throw notFound("Conversation not found");
    if (conversation.userId !== req.userId) throw forbidden();
    return toConversationDto(conversation);
  });

  /** Rename / pin / archive a chat. */
  app.patch("/conversations/:id", async (req) => {
    const { id } = req.params as { id: string };
    await loadOwned(req, id);
    const body = parseBody(updateConversationSchema, req.body);
    const conversation = await prisma.conversation.update({
      where: { id },
      data: body,
      include: PREVIEW_INCLUDE,
    });
    return toConversationDto(conversation);
  });

  /** Whole chat as Markdown text (client saves it as a .md file). */
  app.get("/conversations/:id/export", async (req, reply) => {
    const { id } = req.params as { id: string };
    const conversation = await loadOwned(req, id);
    const md = transcriptMarkdown(conversation.title, await loadTranscript(id));
    return reply
      .header("Content-Type", "text/markdown; charset=utf-8")
      .send(md);
  });

  /** Whole chat as a PDF; returns the stored file's URL. */
  app.post("/conversations/:id/pdf", async (req) => {
    const { id } = req.params as { id: string };
    const conversation = await loadOwned(req, id);
    const md = transcriptMarkdown(conversation.title, await loadTranscript(id));
    const buffer = await renderMarkdownPdf(conversation.title.slice(0, 90), md);
    const url = await storeFile({
      buffer,
      mimeType: "application/pdf",
      keyPrefix: `exports/${req.userId}`,
    });
    return { url };
  });

  /** Delete a chat and its generations (cascade). */
  app.delete("/conversations/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    await loadOwned(req, id);
    // Collect the files the cascade is about to orphan: generated images plus
    // chat-scoped document uploads (workspace/brand docs are never linked to
    // a conversation, so they are untouched here).
    const [generations, docs] = await Promise.all([
      prisma.generation.findMany({
        where: { conversationId: id },
        select: { imageUrls: true },
      }),
      prisma.document.findMany({
        where: { conversationId: id },
        select: { storageUrl: true },
      }),
    ]);
    await prisma.conversation.delete({ where: { id } });
    await deleteStoredFiles([
      ...generations.flatMap((g) => g.imageUrls),
      ...docs.map((d) => d.storageUrl),
    ]);
    return reply.code(204).send();
  });
}
