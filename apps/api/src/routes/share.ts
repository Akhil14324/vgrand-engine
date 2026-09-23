import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { prisma } from "@prompthub/db";
import { forbidden, notFound } from "../lib/errors.js";
import { env } from "../env.js";

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
