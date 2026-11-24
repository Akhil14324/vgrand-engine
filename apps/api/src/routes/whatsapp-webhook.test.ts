import { createHmac } from "node:crypto";
import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "../env.js";

const ingest = vi.fn(async () => ({ events: 1, stored: 1 }));
vi.mock("../services/whatsapp/processor.js", () => ({ ingestWebhook: ingest }));

const { whatsappWebhookRoutes } = await import("./whatsapp-webhook.js");
const SECRET = "app-secret";
const body = JSON.stringify({ object: "whatsapp_business_account", entry: [] });
const sign = (raw: string, secret = SECRET) => `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;

describe("whatsapp webhook route", () => {
  const saved = { s: env.META_APP_SECRET, v: env.META_WEBHOOK_VERIFY_TOKEN };
  beforeEach(() => {
    Object.assign(env, { META_APP_SECRET: SECRET, META_WEBHOOK_VERIFY_TOKEN: "verify-me" });
    ingest.mockClear();
  });
  afterEach(() => Object.assign(env, { META_APP_SECRET: saved.s, META_WEBHOOK_VERIFY_TOKEN: saved.v }));

  const app = async () => {
    const a = Fastify();
    await a.register(whatsappWebhookRoutes);
    return a;
  };

  it("answers the verification handshake only with the right token", async () => {
    const a = await app();
    const ok = await a.inject({ url: "/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=123" });
    expect(ok.statusCode).toBe(200);
    expect(ok.body).toBe("123");
    const bad = await a.inject({ url: "/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=123" });
    expect(bad.statusCode).toBe(403);
  });

  it("rejects missing or wrong signatures and never ingests them", async () => {
    const a = await app();
    const headers = { "content-type": "application/json" };
    expect((await a.inject({ method: "POST", url: "/webhooks/whatsapp", headers, payload: body })).statusCode).toBe(401);
    expect((await a.inject({ method: "POST", url: "/webhooks/whatsapp", headers: { ...headers, "x-hub-signature-256": sign(body, "other") }, payload: body })).statusCode).toBe(401);
    expect(ingest).not.toHaveBeenCalled();
  });

  it("ingests a correctly signed delivery", async () => {
    const a = await app();
    const res = await a.inject({ method: "POST", url: "/webhooks/whatsapp", headers: { "content-type": "application/json", "x-hub-signature-256": sign(body) }, payload: body });
    expect(res.statusCode).toBe(200);
    expect(ingest).toHaveBeenCalledTimes(1);
  });
});
