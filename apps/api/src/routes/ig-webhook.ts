import type { FastifyInstance, FastifyRequest } from "fastify";
import { env } from "../env.js";
import { verifySignature } from "../services/ig-automation/logic.js";
import { ingestWebhook } from "../services/ig-automation/processor.js";

/**
 * Meta webhook endpoint for Instagram comments and messages. Registered WITHOUT
 * app.authenticate: trust comes from the X-Hub-Signature-256 HMAC (app secret)
 * on every delivery, and from the verify token on the one-time GET handshake.
 * Callback URL to paste in Meta App Dashboard: <API_PUBLIC_URL>/webhooks/meta
 */
export async function igWebhookRoutes(app: FastifyInstance) {
  // Keep the raw bytes: the signature is computed over them, not over re-serialised JSON.
  app.addContentTypeParser("application/json", { parseAs: "buffer", bodyLimit: 5 * 1024 * 1024 }, (req, body, done) => {
    (req as FastifyRequest & { rawBody?: Buffer }).rawBody = body as Buffer;
    try {
      done(null, JSON.parse((body as Buffer).toString("utf8")));
    } catch {
      done(null, null);
    }
  });

  /** Verification handshake when the callback URL is saved in the App Dashboard. */
  app.get<{ Querystring: Record<string, string | undefined> }>("/webhooks/meta", async (req, reply) => {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    if (!env.META_WEBHOOK_VERIFY_TOKEN) {
      req.log.warn("meta webhook verification attempted but META_WEBHOOK_VERIFY_TOKEN is not set");
      return reply.code(503).send("Webhook verify token not configured");
    }
    if (mode === "subscribe" && token === env.META_WEBHOOK_VERIFY_TOKEN && challenge) {
      return reply.type("text/plain").send(challenge);
    }
    return reply.code(403).send("Verification failed");
  });

  /** Event deliveries: verify, store once, answer 200 fast. Processing happens in the job queue. */
  app.post("/webhooks/meta", async (req, reply) => {
    const raw = (req as FastifyRequest & { rawBody?: Buffer }).rawBody;
    if (!env.META_APP_SECRET) {
      req.log.error("meta webhook received but META_APP_SECRET is not set; refusing unsigned processing");
      return reply.code(503).send({ ok: false });
    }
    const sig = req.headers["x-hub-signature-256"];
    if (!raw || !verifySignature(raw, typeof sig === "string" ? sig : undefined, env.META_APP_SECRET)) {
      req.log.warn("meta webhook with a missing or invalid signature rejected");
      return reply.code(401).send({ ok: false });
    }
    try {
      const r = await ingestWebhook(req.body);
      return reply.send({ ok: true, ...r });
    } catch (err) {
      // 500 makes Meta retry the delivery later; stored events dedupe on retry.
      req.log.error({ err }, "meta webhook ingest failed");
      return reply.code(500).send({ ok: false });
    }
  });
}
