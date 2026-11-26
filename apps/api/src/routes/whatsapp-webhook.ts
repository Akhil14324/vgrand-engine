import type { FastifyInstance, FastifyRequest } from "fastify";
import { env } from "../env.js";
import { verifySignature } from "../services/ig-automation/logic.js";
import { ingestWebhook } from "../services/whatsapp/processor.js";

/**
 * Meta WhatsApp webhook. No app.authenticate: trust comes from the
 * X-Hub-Signature-256 HMAC (app secret) on each delivery and the verify token on the
 * one-time GET. Callback URL for Meta App Dashboard > WhatsApp > Configuration:
 * <API_PUBLIC_URL>/webhooks/whatsapp (uses WHATSAPP_WEBHOOK_VERIFY_TOKEN / WHATSAPP_APP_SECRET, falling back to the META_* ones).
 */
export async function whatsappWebhookRoutes(app: FastifyInstance) {
  const secret = () => env.WHATSAPP_APP_SECRET ?? env.META_APP_SECRET;
  const verifyToken = () => env.WHATSAPP_WEBHOOK_VERIFY_TOKEN ?? env.META_WEBHOOK_VERIFY_TOKEN;

  app.addContentTypeParser("application/json", { parseAs: "buffer", bodyLimit: 5 * 1024 * 1024 }, (req, body, done) => {
    (req as FastifyRequest & { rawBody?: Buffer }).rawBody = body as Buffer;
    try {
      done(null, JSON.parse((body as Buffer).toString("utf8")));
    } catch {
      done(null, null);
    }
  });

  app.get<{ Querystring: Record<string, string | undefined> }>("/webhooks/whatsapp", async (req, reply) => {
    if (!verifyToken()) return reply.code(503).send("Webhook verify token not configured");
    const q = req.query;
    if (q["hub.mode"] === "subscribe" && q["hub.verify_token"] === verifyToken() && q["hub.challenge"]) {
      return reply.type("text/plain").send(q["hub.challenge"]);
    }
    return reply.code(403).send("Verification failed");
  });

  app.post("/webhooks/whatsapp", async (req, reply) => {
    const raw = (req as FastifyRequest & { rawBody?: Buffer }).rawBody;
    const appSecret = secret();
    if (!appSecret) {
      req.log.error("whatsapp webhook received but no app secret is set (WHATSAPP_APP_SECRET / META_APP_SECRET); refusing unsigned processing");
      return reply.code(503).send({ ok: false });
    }
    const sig = req.headers["x-hub-signature-256"];
    if (!raw || !verifySignature(raw, typeof sig === "string" ? sig : undefined, appSecret)) {
      req.log.warn("whatsapp webhook with a missing or invalid signature rejected");
      return reply.code(401).send({ ok: false });
    }
    try {
      return reply.send({ ok: true, ...(await ingestWebhook(req.body)) });
    } catch (err) {
      req.log.error({ err }, "whatsapp webhook ingest failed"); // 500: Meta retries, stored messages dedupe
      return reply.code(500).send({ ok: false });
    }
  });
}
