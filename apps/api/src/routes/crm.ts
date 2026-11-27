import type { FastifyInstance } from "fastify";
import {
  CRM_DUE,
  CRM_SOURCES,
  CRM_STAGES,
  crmImportSchema,
  crmInstagramRouteSchema,
  crmLeadCreateSchema,
  crmLeadUpdateSchema,
  crmMergeSchema,
  crmNoteSchema,
} from "@catgpt/types";
import { z } from "zod";
import { parseBody } from "../lib/errors.js";
import {
  addNote,
  createLead,
  deleteLead,
  exportLeads,
  getLead,
  importLeads,
  listInstagramRoutes,
  listLeads,
  mergeInto,
  setInstagramRoute,
  updateLead,
} from "../services/crm/service.js";

const brandQuery = z.object({ brandId: z.string().min(1) });

const listQuery = brandQuery.extend({
  stage: z.enum(CRM_STAGES).optional(),
  source: z.enum(CRM_SOURCES).optional(),
  owner: z.string().min(1).optional(),
  q: z.string().max(120).optional(),
  due: z.enum(CRM_DUE).optional(),
  today: z.string().date(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});

/** CRM (lead management) per brand. Access rules live in services/crm/service.ts. */
export async function crmRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  app.get("/crm/leads", async (req) => {
    const { brandId, ...query } = parseBody(listQuery, req.query);
    return listLeads(req.userId, brandId, query);
  });

  app.post("/crm/leads", async (req, reply) => reply.code(201).send(await createLead(req.userId, parseBody(crmLeadCreateSchema, req.body))));

  app.get<{ Params: { id: string } }>("/crm/leads/:id", async (req) => getLead(req.userId, req.params.id));

  app.patch<{ Params: { id: string } }>("/crm/leads/:id", async (req) => {
    await updateLead(req.userId, req.params.id, parseBody(crmLeadUpdateSchema, req.body));
    return getLead(req.userId, req.params.id);
  });

  app.post<{ Params: { id: string } }>("/crm/leads/:id/notes", async (req, reply) => {
    await addNote(req.userId, req.params.id, parseBody(crmNoteSchema, req.body));
    return reply.code(201).send({ ok: true });
  });

  /** Folds another record of the same person into this one. */
  app.post<{ Params: { id: string } }>("/crm/leads/:id/merge", async (req) => {
    await mergeInto(req.userId, req.params.id, parseBody(crmMergeSchema, req.body).otherId);
    return getLead(req.userId, req.params.id);
  });

  app.delete<{ Params: { id: string } }>("/crm/leads/:id", async (req, reply) => {
    await deleteLead(req.userId, req.params.id);
    return reply.code(204).send();
  });

  // A 5,000-row import is larger than Fastify's default body limit.
  app.post("/crm/import", { bodyLimit: 4 * 1024 * 1024 }, async (req) => importLeads(req.userId, parseBody(crmImportSchema, req.body)));

  app.get("/crm/export", async (req, reply) => {
    const csv = await exportLeads(req.userId, parseBody(brandQuery, req.query).brandId);
    // The BOM makes Excel read Telugu and Hindi names correctly.
    return reply.type("text/csv; charset=utf-8").header("Content-Disposition", 'attachment; filename="leads.csv"').send(`\uFEFF${csv}`);
  });

  app.get("/crm/instagram", async (req) => ({ items: await listInstagramRoutes(req.userId, parseBody(brandQuery, req.query).brandId) }));

  app.put("/crm/instagram", async (req) => setInstagramRoute(req.userId, parseBody(crmInstagramRouteSchema, req.body)));
}
