import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { prisma } from "@catgpt/db";
import { forbidden, notFound } from "../lib/errors.js";
import { env } from "../env.js";
import { loadTranscript, promptForDisplay } from "../lib/transcript.js";

export async function shareRoutes(app: FastifyInstance) {
  /** Create (or reuse) a public share link for a generation. */
  app.post(
    "/share/:generationId",
    { preHandler: app.authenticate },
    async (req) => {
      const { generationId } = req.params as { generationId: string };
      const generation = await prisma.generation.findUnique({
        where: { id: generationId },
      });
      if (!generation) throw notFound("Generation not found");
      if (generation.userId !== req.userId) throw forbidden();

      const existing = await prisma.shareLink.findFirst({
        where: {
          generationId,
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
        orderBy: { createdAt: "desc" },
      });
      const link =
        existing ??
        (await prisma.shareLink.create({
          data: {
            generationId,
            token: randomBytes(24).toString("base64url"),
          },
        }));

      return {
        token: link.token,
        url: `${env.WEB_ORIGIN}/share/${link.token}`,
        expiresAt: link.expiresAt?.toISOString() ?? null,
      };
    },
  );

  /** Share a whole chat (text + images) as a public read-only link. */
  app.post(
    "/share/conversation/:conversationId",
    { preHandler: app.authenticate },
    async (req) => {
      const { conversationId } = req.params as { conversationId: string };
      const conversation = await prisma.conversation.findUnique({
        where: { id: conversationId },
        select: { userId: true },
      });
      if (!conversation) throw notFound("Conversation not found");
      if (conversation.userId !== req.userId) throw forbidden();
      const link =
        (await prisma.conversationShare.findFirst({
          where: { conversationId },
          orderBy: { createdAt: "desc" },
        })) ??
        (await prisma.conversationShare.create({
          data: {
            conversationId,
            token: randomBytes(24).toString("base64url"),
          },
        }));
      return { token: link.token, url: `${env.WEB_ORIGIN}/share/c/${link.token}` };
    },
  );

  /** Stop sharing a chat - every link to it stops working. */
  app.delete(
    "/share/conversation/:conversationId",
    { preHandler: app.authenticate },
    async (req, reply) => {
      const { conversationId } = req.params as { conversationId: string };
      const conversation = await prisma.conversation.findUnique({
        where: { id: conversationId },
        select: { userId: true },
      });
      if (!conversation) throw notFound("Conversation not found");
      if (conversation.userId !== req.userId) throw forbidden();
      await prisma.conversationShare.deleteMany({ where: { conversationId } });
      return reply.code(204).send();
    },
  );

  /** Public read-only chat. Only the conversation and its completed turns are
   * exposed - no user ids, attachments, brand or workspace details. */
  app.get("/share/c/:token", async (req) => {
    const { token } = req.params as { token: string };
    const link = await prisma.conversationShare.findUnique({
      where: { token },
      include: { conversation: { select: { id: true, title: true, createdAt: true } } },
    });
    if (!link) throw notFound("Share link not found");
    const turns = await loadTranscript(link.conversation.id);
    return {
      title: link.conversation.title,
      createdAt: link.conversation.createdAt.toISOString(),
      turns: turns.map((t) => ({
        id: t.id,
        prompt: promptForDisplay(t),
        kind: t.kind,
        textResponse: t.textResponse,
        imageUrls: t.imageUrls,
        createdAt: t.createdAt.toISOString(),
      })),
    };
  });

  /** Public, unauthenticated view — powers /share/[token] in the web app. */
  app.get("/share/:token", async (req) => {
    const { token } = req.params as { token: string };
    const link = await prisma.shareLink.findUnique({
      where: { token },
      include: {
        generation: {
          include: {
            theme: { select: { label: true } },
          },
        },
      },
    });
    if (!link || (link.expiresAt && link.expiresAt < new Date())) {
      throw notFound("Share link not found or expired");
    }
    const g = link.generation;
    return {
      prompt: g.prompt,
      imageUrls: g.imageUrls,
      themeLabel: g.theme?.label ?? null,
      provider: g.provider,
      createdAt: g.createdAt.toISOString(),
    };
  });
}
