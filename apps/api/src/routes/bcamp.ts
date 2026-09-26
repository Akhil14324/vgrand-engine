import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  commentSchema,
  convertSchema,
  createResultSchema,
  createStrategySchema,
  deliverableActionSchema,
  flagSchema,
  linkGenerationSchema,
  manualCompleteSchema,
  strategyMessageSchema,
  strategyStatusSchema,
  syncSchema,
  updateDeliverableSchema,
  updateStrategySchema,
  updateTaskSchema,
  type UpdateStrategyRequest,
} from "@catgpt/types";
import { badRequest, parseBody } from "../lib/errors.js";
import {
  applySync,
  askAssistant,
  commitConversion,
  compareVersions,
  createStrategy,
  getDashboard,
  getVersion,
  loadStrategy,
  previewConversion,
  previewSync,
  reviewStrategy,
  saveStrategy,
  strategyAction,
  toStrategyDto,
} from "../services/bcamp.js";
import {
  addResult,
  commentDeliverable,
  commentTask,
  deleteResult,
  deliverableAction,
  getDeliverable,
  getExecutionDashboard,
  getGenerationBrief,
  getTask,
  linkGeneration,
  listResults,
  manualComplete,
  setDeliverableFlag,
  setTaskFlag,
  updateDeliverable,
  updateTask,
} from "../services/execution.js";

const id = z.object({ id: z.string().uuid() });
const brandQuery = z.object({ brandId: z.string().uuid() });

/**
 * B Camp (strategy) and the Execution Center (work). Every handler resolves the
 * record's business and checks access on the server; other businesses' ids 404.
 */
export async function bcampRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  // Model calls: keep them tight.
  const ai = { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } };

  /* ------------------------------- B Camp -------------------------------- */

  app.get("/bcamp/dashboard", async (req) => getDashboard(req.userId, parseBody(brandQuery, req.query).brandId));

  app.post("/bcamp/strategies", ai, async (req, reply) => reply.code(201).send(await createStrategy(req.userId, parseBody(createStrategySchema, req.body))));

  app.get("/bcamp/strategies/:id", async (req) => {
    const { strategy, canManage } = await loadStrategy(req.userId, parseBody(id, req.params).id);
    return toStrategyDto(strategy, canManage);
  });

  app.patch("/bcamp/strategies/:id", async (req) => saveStrategy(req.userId, parseBody(id, req.params).id, parseBody(updateStrategySchema, req.body) as UpdateStrategyRequest));

  app.post("/bcamp/strategies/:id/status", async (req) =>
    strategyAction(req.userId, parseBody(id, req.params).id, parseBody(strategyStatusSchema, req.body).action),
  );

  app.get("/bcamp/strategies/:id/versions/:version", async (req) => {
    const p = parseBody(id.extend({ version: z.coerce.number().int().min(1) }), req.params);
    return getVersion(req.userId, p.id, p.version);
  });

  app.get("/bcamp/strategies/:id/compare", async (req) => {
    const p = parseBody(id, req.params);
    const q = parseBody(z.object({ from: z.coerce.number().int().min(1), to: z.coerce.number().int().min(1) }), req.query);
    return compareVersions(req.userId, p.id, q.from, q.to);
  });

  app.get("/bcamp/strategies/:id/convert", async (req) => previewConversion(req.userId, parseBody(id, req.params).id));
  app.post("/bcamp/strategies/:id/convert", async (req) => commitConversion(req.userId, parseBody(id, req.params).id, parseBody(convertSchema, req.body)));

  app.get("/bcamp/strategies/:id/sync", async (req) => previewSync(req.userId, parseBody(id, req.params).id));
  app.post("/bcamp/strategies/:id/sync", async (req) => {
    const b = parseBody(syncSchema, req.body) as { accept: string[]; dismiss: string[] };
    return applySync(req.userId, parseBody(id, req.params).id, b.accept, b.dismiss);
  });

  app.post("/bcamp/strategies/:id/messages", ai, async (req) =>
    askAssistant(req.userId, parseBody(id, req.params).id, parseBody(strategyMessageSchema, req.body).message),
  );

  app.post("/bcamp/strategies/:id/review", ai, async (req) => reviewStrategy(req.userId, parseBody(id, req.params).id));

  /* ------------------------------- results ------------------------------- */

  app.get("/bcamp/strategies/:id/results", async (req) => listResults(req.userId, parseBody(id, req.params).id));
  app.post("/execution/results", async (req, reply) => reply.code(201).send(await addResult(req.userId, parseBody(createResultSchema, req.body))));
  app.delete("/execution/results/:id", async (req, reply) => {
    await deleteResult(req.userId, parseBody(id, req.params).id);
    return reply.code(204).send();
  });

  /* ---------------------------- Execution Center ------------------------- */

  app.get("/execution/dashboard", async (req) => getExecutionDashboard(req.userId, parseBody(brandQuery, req.query).brandId));

  app.get("/execution/deliverables/:id", async (req) => getDeliverable(req.userId, parseBody(id, req.params).id));
  app.patch("/execution/deliverables/:id", async (req) =>
    updateDeliverable(req.userId, parseBody(id, req.params).id, parseBody(updateDeliverableSchema, req.body)),
  );
  app.get("/execution/deliverables/:id/brief", async (req) => getGenerationBrief(req.userId, parseBody(id, req.params).id));
  app.post("/execution/deliverables/:id/content", async (req) =>
    linkGeneration(req.userId, parseBody(id, req.params).id, parseBody(linkGenerationSchema, req.body).generationId),
  );
  app.post("/execution/deliverables/:id/action", async (req) => {
    const b = parseBody(deliverableActionSchema, req.body);
    return deliverableAction(req.userId, parseBody(id, req.params).id, b.action, b.note);
  });
  app.post("/execution/deliverables/:id/manual-complete", async (req) =>
    manualComplete(req.userId, parseBody(id, req.params).id, parseBody(manualCompleteSchema, req.body)),
  );
  app.post("/execution/deliverables/:id/flag", async (req) => {
    const b = parseBody(flagSchema, req.body);
    if (b.flagged && !b.reason?.trim()) throw badRequest("Say what is blocking this so the strategy can be reviewed");
    return setDeliverableFlag(req.userId, parseBody(id, req.params).id, b.flagged, b.reason);
  });
  app.post("/execution/deliverables/:id/comments", async (req) =>
    commentDeliverable(req.userId, parseBody(id, req.params).id, parseBody(commentSchema, req.body).note),
  );

  app.get("/execution/tasks/:id", async (req) => getTask(req.userId, parseBody(id, req.params).id));
  app.patch("/execution/tasks/:id", async (req) => updateTask(req.userId, parseBody(id, req.params).id, parseBody(updateTaskSchema, req.body)));
  app.post("/execution/tasks/:id/flag", async (req) => {
    const b = parseBody(flagSchema, req.body);
    if (b.flagged && !b.reason?.trim()) throw badRequest("Say what is blocking this so the strategy can be reviewed");
    return setTaskFlag(req.userId, parseBody(id, req.params).id, b.flagged, b.reason);
  });
  app.post("/execution/tasks/:id/comments", async (req) =>
    commentTask(req.userId, parseBody(id, req.params).id, parseBody(commentSchema, req.body).note),
  );
}
