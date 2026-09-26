import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  exportBrandGuidelinesSchema,
  saveBrandGuidelinesSchema,
  type BrandGuidelinesDto,
  type BrandGuidelinesSaveDto,
} from "@catgpt/types";
import { parseBody } from "../lib/errors.js";
import {
  exportGuidelines,
  generateGuidelinesDraft,
  getGuidelines,
  saveGuidelines,
} from "../services/brand-guidelines.js";

const idParams = z.object({ id: z.string().uuid() });

/** Editable brand guidelines: generate a draft, save edits (updates the brand profile), export. */
export async function brandGuidelinesRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  app.get("/brands/:id/guidelines", async (req): Promise<{ item: BrandGuidelinesDto | null }> => {
    const { id } = parseBody(idParams, req.params);
    return { item: await getGuidelines(req.userId, id) };
  });

  /** A draft only - nothing is saved until the user reviews it and saves. */
  app.post(
    "/brands/:id/guidelines/generate",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (req): Promise<{ content: string }> => {
      const { id } = parseBody(idParams, req.params);
      return { content: await generateGuidelinesDraft(req.userId, id) };
    },
  );

  app.put("/brands/:id/guidelines", async (req): Promise<BrandGuidelinesSaveDto> => {
    const { id } = parseBody(idParams, req.params);
    const body = parseBody(saveBrandGuidelinesSchema, req.body);
    return saveGuidelines(req.userId, id, body.content);
  });

  app.post(
    "/brands/:id/guidelines/export",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (req): Promise<{ url: string }> => {
      const { id } = parseBody(idParams, req.params);
      const body = parseBody(exportBrandGuidelinesSchema, req.body);
      return exportGuidelines(req.userId, id, body.format);
    },
  );
}
