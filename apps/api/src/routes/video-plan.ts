import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "@catgpt/db";
import { createReelPlanSchema } from "@catgpt/types";
import { findAccessibleBrand } from "../lib/brand.js";
import { HttpError, notFound, parseBody } from "../lib/errors.js";
import { createReelPlanItems, removePlanItem, toReelPlanItemDto } from "../services/reel-plan.js";

const brandQuerySchema = z.object({ brandId: z.string().uuid() });

/** Planned reels for posting. The autopilot produces them; nothing is posted until approval. */
export async function videoPlanRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  app.get("/video/plan", async (req) => {
    const { brandId } = parseBody(brandQuerySchema, req.query);
    await findAccessibleBrand(req.userId, brandId);
    const items = await prisma.reelPlanItem.findMany({
      where: { brandId },
      orderBy: { postAt: "asc" },
      take: 200,
    });
    return items.map(toReelPlanItemDto);
  });

  app.post("/video/plan", async (req, reply) => {
    const body = parseBody(createReelPlanSchema, req.body);
    const items = await createReelPlanItems(req.userId, body);
    return reply.code(201).send({ items });
  });

  app.delete<{ Params: { id: string } }>("/video/plan/:id", async (req, reply) => {
    await removePlanItem(req.userId, req.params.id);
    return reply.code(204).send();
  });

  /** Stops a planned reel from being produced. Its post time is kept on record. */
  app.post<{ Params: { id: string } }>("/video/plan/:id/skip", async (req) => {
    const item = await prisma.reelPlanItem.findFirst({ where: { id: req.params.id, userId: req.userId } });
    if (!item) throw notFound("Plan item not found");
    if (item.status !== "planned") throw new HttpError(409, "Only a planned reel can be skipped", "INVALID_STATE");
    const updated = await prisma.reelPlanItem.updateMany({
      where: { id: item.id, status: "planned" },
      data: { status: "skipped" },
    });
    if (updated.count === 0) throw new HttpError(409, "This reel has already started. Refresh and check its status.", "INVALID_STATE");
    return toReelPlanItemDto({ ...item, status: "skipped" });
  });
}
