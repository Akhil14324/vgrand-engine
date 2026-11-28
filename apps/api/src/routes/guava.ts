import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "@catgpt/db";
import {
  instagramSetupUpdateSchema,
  guavaAskSchema,
  guavaContentAuditRequestSchema,
  guavaFindRequestSchema,
  guavaProfileUpdateSchema,
} from "@catgpt/types";
import { parseBody } from "../lib/errors.js";
import { findAccessibleBrand, findManageableBrand } from "../lib/brand.js";
import { findWorkspaceForUser } from "../lib/workspace-access.js";
import { buildProfileDto, saveProfileUpdate } from "../services/guava-profile.js";
import { askFollowUp, getDiagnosis, listDiagnoses, startDiagnosis } from "../services/guava-diagnosis.js";
import { generateInstagramStrategy, getInstagramInsights } from "../services/ig-insights.js";
import {
  getInstagramSetup,
  getContentAudit,
  listContentAudits,
  saveInstagramSetup,
  startContentAudit,
} from "../services/guava-content.js";
import { findInstagramAccounts } from "../services/guava-find.js";

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

  // Instagram setup: one own account + up to 3 rivals, shared by all brands in a
  // scope (personal, or one workspace). Brand Strategist splits posts by brand.
  const setupQuery = z.object({ workspaceId: z.string().uuid().optional() });

  app.get("/guava/instagram-setup", async (req) => {
    const { workspaceId } = parseBody(setupQuery, req.query);
    let canEdit = true;
    if (workspaceId) {
      const ws = await findWorkspaceForUser(req.userId, workspaceId);
      canEdit = ws.userId === req.userId;
    }
    return getInstagramSetup(req.userId, workspaceId ?? null, canEdit);
  });

  app.put("/guava/instagram-setup", async (req) => {
    const body = parseBody(instagramSetupUpdateSchema, req.body);
    if (body.workspaceId) await findWorkspaceForUser(req.userId, body.workspaceId, { ownerOnly: true });
    return saveInstagramSetup(req.userId, body);
  });

  // Search Instagram for rivals or creators: web search for handles, then each one checked on Instagram.
  app.post(
    "/guava/instagram-find",
    { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (req) => {
      const body = parseBody(guavaFindRequestSchema, req.body);
      if (body.workspaceId) await findWorkspaceForUser(req.userId, body.workspaceId);
      return findInstagramAccounts(req.userId, body.workspaceId, body.kind, body.query);
    },
  );

  // Instagram Insights (views, reach, watch time) for the account saved on the Instagram page.
  app.get("/guava/instagram-insights", async (req) => {
    const q = parseBody(z.object({ workspaceId: z.string().uuid().optional(), accountId: z.string().uuid().optional(), refresh: z.coerce.boolean().optional() }), req.query);
    if (q.workspaceId) await findWorkspaceForUser(req.userId, q.workspaceId);
    return getInstagramInsights(req.userId, q.workspaceId ?? null, { refresh: q.refresh, accountId: q.accountId ?? null });
  });

  // AI "next strategy" for one brand, from those insights.
  app.post(
    "/guava/brands/:brandId/instagram-insights/strategy",
    { config: { rateLimit: { max: 3, timeWindow: "1 minute" } } },
    async (req) => {
      const { brandId } = parseBody(brandParams, req.params);
      const brand = await findManageableBrand(req.userId, brandId);
      const body = parseBody(z.object({ accountId: z.string().uuid().nullable().optional() }), req.body ?? {});
      return generateInstagramStrategy(brand, req.userId, brand.workspaceId, body.accountId ?? null);
    },
  );

  // Instagram content review: Gemini watches the brand's (and competitors') reels.
  app.get("/guava/brands/:brandId/content-audits", async (req) => {
    const { brandId } = parseBody(brandParams, req.params);
    await findAccessibleBrand(req.userId, brandId);
    return { items: await listContentAudits(brandId) };
  });

  app.post(
    "/guava/brands/:brandId/content-audits",
    { config: { rateLimit: { max: 3, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const { brandId } = parseBody(brandParams, req.params);
      const brand = await findManageableBrand(req.userId, brandId);
      // No body: run with the brand's saved Instagram setup (Brand Engine → Instagram).
      const hasBody = !!req.body && typeof req.body === "object" && Object.keys(req.body).length > 0;
      const input = hasBody ? parseBody(guavaContentAuditRequestSchema, req.body) : null;
      return reply.code(202).send(await startContentAudit(brand, req.userId, input));
    },
  );

  app.get("/guava/brands/:brandId/content-audits/:id", async (req) => {
    const { brandId } = parseBody(brandParams, req.params);
    const { id } = parseBody(diagnosisParams, req.params);
    await findAccessibleBrand(req.userId, brandId);
    return getContentAudit(brandId, id);
  });
}
