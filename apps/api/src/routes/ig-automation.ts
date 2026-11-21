import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "@catgpt/db";
import { igRuleInputSchema, igRuleUpdateSchema, igTestSchema } from "@catgpt/types";
import { HttpError, notFound, parseBody } from "../lib/errors.js";
import { decryptToken } from "../lib/social-crypto.js";
import { GraphError, listMedia, subscribePage } from "../services/ig-automation/graph.js";
import { retryEvent } from "../services/ig-automation/processor.js";
import {
  accountStatus,
  listEvents,
  listIgAccounts,
  listRules,
  ownedIgAccount,
  ownedRule,
  prepareRule,
  testRules,
  toRuleDto,
} from "../services/ig-automation/service.js";

/** Meta errors become a 502 with Meta's message (never the token or URL). */
function metaFailure(err: unknown): never {
  if (err instanceof GraphError) throw new HttpError(502, `Meta: ${err.message}`, `META_${err.kind.toUpperCase()}`);
  throw err;
}

/** Instagram comment/DM automation (management API). All routes are per-user scoped. */
export async function igAutomationRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  app.get("/ig-automation/accounts", async (req) => ({ items: await listIgAccounts(req.userId) }));

  app.get<{ Params: { id: string } }>("/ig-automation/accounts/:id/status", async (req) => {
    const account = await ownedIgAccount(req.userId, req.params.id);
    return accountStatus(account);
  });

  /** Subscribes this app to the account's Facebook Page so Meta delivers its webhooks. */
  app.post<{ Params: { id: string } }>("/ig-automation/accounts/:id/subscribe", async (req) => {
    const account = await ownedIgAccount(req.userId, req.params.id);
    const pageId = ((account.metadata ?? {}) as { pageId?: string }).pageId;
    if (!pageId) throw new HttpError(409, "This account has no linked Facebook Page id; reconnect it.", "NO_PAGE");
    try {
      const fields = await subscribePage(decryptToken(account.accessTokenEnc), pageId);
      return { subscribed: true, fields };
    } catch (err) {
      metaFailure(err);
    }
  });

  app.get<{ Params: { id: string } }>("/ig-automation/accounts/:id/media", async (req) => {
    const account = await ownedIgAccount(req.userId, req.params.id);
    try {
      return { items: await listMedia(decryptToken(account.accessTokenEnc), account.externalAccountId) };
    } catch (err) {
      metaFailure(err);
    }
  });

  app.get<{ Params: { id: string } }>("/ig-automation/accounts/:id/rules", async (req) => {
    await ownedIgAccount(req.userId, req.params.id);
    return { items: await listRules(req.params.id) };
  });

  app.post<{ Params: { id: string } }>("/ig-automation/accounts/:id/rules", async (req, reply) => {
    const account = await ownedIgAccount(req.userId, req.params.id);
    const data = prepareRule(parseBody(igRuleInputSchema, req.body));
    const rule = await prisma.igAutomationRule.create({ data: { ...data, accountId: account.id, createdById: req.userId } });
    return reply.code(201).send(toRuleDto(rule));
  });

  app.patch<{ Params: { id: string } }>("/ig-automation/rules/:id", async (req) => {
    const current = await ownedRule(req.userId, req.params.id);
    const patch = parseBody(igRuleUpdateSchema, req.body);
    const merged = parseBody(igRuleInputSchema, { ...toRuleDto(current), ...patch });
    const data = prepareRule(merged);
    const rule = await prisma.igAutomationRule.update({ where: { id: current.id }, data });
    return toRuleDto(rule);
  });

  app.delete<{ Params: { id: string } }>("/ig-automation/rules/:id", async (req, reply) => {
    const rule = await ownedRule(req.userId, req.params.id);
    await prisma.igAutomationRule.delete({ where: { id: rule.id } });
    return reply.code(204).send();
  });

  app.get<{ Params: { id: string } }>("/ig-automation/accounts/:id/events", async (req) => {
    await ownedIgAccount(req.userId, req.params.id);
    const q = parseBody(
      z.object({ ruleId: z.string().uuid().optional(), status: z.string().max(20).optional(), limit: z.coerce.number().int().min(1).max(200).default(100) }),
      req.query,
    );
    return { items: await listEvents(req.params.id, q) };
  });

  /** "Test a comment": which rule would fire and what would be sent. Sends nothing. */
  app.post<{ Params: { id: string } }>("/ig-automation/accounts/:id/test", async (req) => {
    await ownedIgAccount(req.userId, req.params.id);
    return testRules(req.params.id, parseBody(igTestSchema, req.body));
  });

  app.post<{ Params: { id: string } }>("/ig-automation/events/:id/retry", async (req) => {
    const ev = await prisma.igAutomationEvent.findUnique({ where: { id: req.params.id } });
    if (!ev) throw notFound("Event not found");
    await ownedIgAccount(req.userId, ev.accountId);
    if (ev.status !== "failed" && ev.status !== "partial") throw new HttpError(409, "Only failed or partial events can be retried", "INVALID_STATE");
    await retryEvent(ev.id);
    return { ok: true };
  });
}
