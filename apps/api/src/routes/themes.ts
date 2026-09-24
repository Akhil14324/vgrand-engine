import type { FastifyInstance } from "fastify";
import { prisma } from "@catgpt/db";
import { notFound } from "../lib/errors.js";
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

  // Themes are shared, read-only brand presets. Creating/editing them is done
  // out-of-band (prisma seed) — never by end users.
}
