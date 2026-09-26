import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  complianceCheckSchema,
  rewriteCaptionSchema,
  type ComplianceCheckDto,
  type RewriteCaptionDto,
} from "@catgpt/types";
import { parseBody } from "../lib/errors.js";
import { listComplianceChecks, rewriteCaption, runComplianceCheck } from "../services/brand-compliance.js";

const idParams = z.object({ id: z.string().uuid() });
const listQuery = z.object({ generationId: z.string().uuid().optional() });
const limit = { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } };

/**
 * Brand compliance. Any user who can USE a brand (own, or a workspace member)
 * can check against it, so workspace members are held to the workspace brand.
 */
export async function brandComplianceRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  app.post("/brands/:id/compliance/check", limit, async (req, reply): Promise<ComplianceCheckDto> => {
    const { id } = parseBody(idParams, req.params);
    const body = parseBody(complianceCheckSchema, req.body);
    return reply.code(201).send(await runComplianceCheck(req.userId, id, body));
  });

  app.get("/brands/:id/compliance", async (req): Promise<{ items: ComplianceCheckDto[] }> => {
    const { id } = parseBody(idParams, req.params);
    const q = parseBody(listQuery, req.query);
    return { items: await listComplianceChecks(req.userId, id, q.generationId) };
  });

  app.post("/brands/:id/compliance/rewrite-caption", limit, async (req): Promise<RewriteCaptionDto> => {
    const { id } = parseBody(idParams, req.params);
    const body = parseBody(rewriteCaptionSchema, req.body);
    return rewriteCaption(req.userId, id, body.caption, body.issues);
  });
}
