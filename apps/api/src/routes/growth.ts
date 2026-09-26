import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { decideRevisionSchema, decideSuggestionSchema, proposeRevisionSchema, recordLearningSchema } from "@catgpt/types";
import { parseBody } from "../lib/errors.js";
import {
  decideRevision,
  decideSuggestion,
  getCampaignInsights,
  getGrowthDashboard,
  getLearning,
  listLearnings,
  listRevisions,
  proposeRevision,
  recordLearning,
} from "../services/growth.js";

const id = z.object({ id: z.string().uuid() });
const brandQuery = z.object({ brandId: z.string().uuid() });

/** Growth Intelligence: goals, insights, next best actions, revisions and learnings. */
export async function growthRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);
  const ai = { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } };

  app.get("/growth/dashboard", async (req) => getGrowthDashboard(req.userId, parseBody(brandQuery, req.query).brandId));

  app.post("/growth/suggestions", async (req) => {
    const { brandId } = parseBody(brandQuery, req.query);
    return decideSuggestion(req.userId, brandId, parseBody(decideSuggestionSchema, req.body));
  });

  app.get("/growth/learnings", async (req) => listLearnings(req.userId, parseBody(brandQuery, req.query).brandId));

  app.get("/bcamp/strategies/:id/insights", async (req) => getCampaignInsights(req.userId, parseBody(id, req.params).id));

  app.get("/bcamp/strategies/:id/learning", async (req) => ({ item: await getLearning(req.userId, parseBody(id, req.params).id) }));
  app.post("/bcamp/strategies/:id/learning", async (req) =>
    recordLearning(req.userId, parseBody(id, req.params).id, parseBody(recordLearningSchema, req.body).nextStep),
  );

  app.get("/bcamp/strategies/:id/revisions", async (req) => listRevisions(req.userId, parseBody(id, req.params).id));
  app.post("/bcamp/strategies/:id/revisions", ai, async (req, reply) => {
    const b = parseBody(proposeRevisionSchema, req.body);
    return reply.code(201).send(await proposeRevision(req.userId, parseBody(id, req.params).id, b.focus, b.note));
  });
  app.post("/bcamp/revisions/:id/decision", async (req) => {
    const b = parseBody(decideRevisionSchema, req.body);
    return decideRevision(req.userId, parseBody(id, req.params).id, b.action, b.note);
  });
}
