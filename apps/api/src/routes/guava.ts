import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "@catgpt/db";
import { guavaAskSchema, guavaProfileUpdateSchema } from "@catgpt/types";
import { parseBody } from "../lib/errors.js";
import { findAccessibleBrand, findManageableBrand } from "../lib/brand.js";
import { buildProfileDto, saveProfileUpdate } from "../services/guava-profile.js";
import { askFollowUp, getDiagnosis, listDiagnoses, startDiagnosis } from "../services/guava-diagnosis.js";

const brandParams = z.object({ brandId: z.string().uuid() });
const diagnosisParams = z.object({ id: z.string().uuid() });

/**
 * Guava, the business strategist. Everything hangs off a brand, so it inherits
 * the brand's access rules: anyone with access can read, only owners (of the
 * brand or its workspace) can edit the profile or run a diagnosis.
 */
export async function guavaRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  const canManage = async (userId: string, brandId: string) =>
    !!(await prisma.brand.findFirst({
      where: { id: brandId, OR: [{ userId }, { workspace: { userId } }] },
      select: { id: true },
    }));

  app.get("/guava/brands/:brandId/profile", async (req) => {
    const { brandId } = parseBody(brandParams, req.params);
    const brand = await findAccessibleBrand(req.userId, brandId);
    return buildProfileDto(brand, await canManage(req.userId, brandId));
  });

  app.patch("/guava/brands/:brandId/profile", async (req) => {
    const { brandId } = parseBody(brandParams, req.params);
    const brand = await findManageableBrand(req.userId, brandId);
    await saveProfileUpdate(brandId, parseBody(guavaProfileUpdateSchema, req.body));
    return buildProfileDto(brand, true);
  });

  app.get("/guava/brands/:brandId/diagnoses", async (req) => {
    const { brandId } = parseBody(brandParams, req.params);
    await findAccessibleBrand(req.userId, brandId);
    return { items: await listDiagnoses(brandId) };
  });

  app.post(
    "/guava/brands/:brandId/diagnoses",
    { config: { rateLimit: { max: 6, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const { brandId } = parseBody(brandParams, req.params);
      const brand = await findManageableBrand(req.userId, brandId);
      return reply.code(202).send(await startDiagnosis(brand, req.userId));
    },
  );

  app.get("/guava/brands/:brandId/diagnoses/:id", async (req) => {
    const { brandId } = parseBody(brandParams, req.params);
    const { id } = parseBody(diagnosisParams, req.params);
    await findAccessibleBrand(req.userId, brandId);
    return getDiagnosis(brandId, id);
  });

  app.post(
    "/guava/brands/:brandId/diagnoses/:id/messages",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (req) => {
      const { brandId } = parseBody(brandParams, req.params);
      const { id } = parseBody(diagnosisParams, req.params);
      const { question } = parseBody(guavaAskSchema, req.body);
      const brand = await findAccessibleBrand(req.userId, brandId);
      return askFollowUp(brand, id, question);
    },
  );
}
