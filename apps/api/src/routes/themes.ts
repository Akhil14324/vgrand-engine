import type { FastifyInstance } from "fastify";
import { prisma, type Prisma } from "@prompthub/db";
import { createThemeSchema, updateThemeSchema } from "@prompthub/types";
import { notFound, parseBody } from "../lib/errors.js";
import { toThemeDto } from "../lib/serialize.js";

export async function themeRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  /** Powers the `/` command menu. */
  app.get("/themes", async () => {
    const themes = await prisma.theme.findMany({
      where: { isActive: true },
      orderBy: { createdAt: "asc" },
    });
    return { items: themes.map(toThemeDto) };
  });

  app.get("/themes/:slug", async (req) => {
    const { slug } = req.params as { slug: string };
    const theme = await prisma.theme.findUnique({ where: { slug } });
    if (!theme) throw notFound("Theme not found");
    return toThemeDto(theme);
  });

  // Admin endpoints — v1 allows any authenticated user. Add a role check
  // before opening this to real tenants.
  app.post("/themes", async (req, reply) => {
    const body = parseBody(createThemeSchema, req.body);
    const theme = await prisma.theme.create({
      data: {
        ...body,
        styleGuide: body.styleGuide as Prisma.InputJsonValue | undefined,
      },
    });
    return reply.code(201).send(toThemeDto(theme));
  });

  app.put("/themes/:id", async (req) => {
    const { id } = req.params as { id: string };
    const body = parseBody(updateThemeSchema, req.body);
    try {
      const theme = await prisma.theme.update({
        where: { id },
        data: {
          ...body,
          styleGuide: body.styleGuide as Prisma.InputJsonValue | undefined,
        },
      });
      return toThemeDto(theme);
    } catch {
      throw notFound("Theme not found");
    }
  });
}
