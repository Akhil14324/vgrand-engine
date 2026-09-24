import type { FastifyInstance, FastifyRequest } from "fastify";
import { prisma } from "@catgpt/db";
import { updateConversationSchema } from "@catgpt/types";
import { forbidden, notFound, parseBody } from "../lib/errors.js";
import { toConversationDto } from "../lib/serialize.js";

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
    const limit = Math.min(Number(q.limit) || 50, 100);
    const search = q.search?.trim();
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
      orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
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
    await loadOwned(req, id);
    const conversation = await prisma.conversation.findUniqueOrThrow({
      where: { id },
      include: PREVIEW_INCLUDE,
    });
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

  /** Delete a chat and its generations (cascade). */
  app.delete("/conversations/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    await loadOwned(req, id);
    await prisma.conversation.delete({ where: { id } });
    return reply.code(204).send();
  });
}
