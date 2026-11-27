import type { FastifyInstance } from "fastify";
import { websiteListQuery, websiteOverviewQuery } from "@catgpt/types";
import { parseBody } from "../lib/errors.js";
import { assertWebsiteViewer, websiteConsents, websiteLeads, websiteLeadsCsv, websiteOverview } from "../services/website/reader.js";

/** Website to CatGPT integration: read-only view of the company website's leads and clicks. */
export async function websiteRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);
  app.addHook("preHandler", async (req) => assertWebsiteViewer(req.userId));

  app.get("/website/overview", async (req) => websiteOverview(parseBody(websiteOverviewQuery, req.query).days));

  app.get("/website/leads", async (req) => {
    const { page, q } = parseBody(websiteListQuery, req.query);
    return websiteLeads(page, q);
  });

  app.get("/website/consents", async (req) => websiteConsents(parseBody(websiteListQuery, req.query).page));

  app.get("/website/leads/export", async (req, reply) => {
    const { q } = parseBody(websiteListQuery, req.query);
    return reply.type("text/csv; charset=utf-8").header("Content-Disposition", 'attachment; filename="website-leads.csv"').send(await websiteLeadsCsv(q));
  });
}
