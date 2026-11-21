import { createHmac, randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { prisma } from "@catgpt/db";
import { env } from "../../env.js";
import { encryptToken } from "../../lib/social-crypto.js";
import { drainJobs } from "../shorts/jobs.js";
import { endpoints } from "./graph.js";
import { registerIgAutomationHandlers } from "./processor.js";

/**
 * End to end against a local fake of Meta's Graph API: signed webhook -> stored
 * event -> job -> public reply + private reply. Real Fastify app, real Postgres,
 * real job queue. Opt-in: SHORTS_IT=1 DATABASE_URL=postgresql://... (local DB).
 */
const RUN = process.env.SHORTS_IT === "1";
const SECRET = "test-app-secret";
const IG = `17841${Math.floor(Math.random() * 1e10)}`;
const PAGE = `1000${Math.floor(Math.random() * 1e8)}`;

interface Call {
  method: string;
  path: string;
  body: string;
}

describe.skipIf(!RUN)("Instagram automation end to end (fake Meta)", () => {
  let app: FastifyInstance;
  let fake: Server;
  let calls: Call[] = [];
  let behaviour: { replies: "ok" | "rate_once" | "drop" | "auth"; messages: "ok" | "no_template" } = { replies: "ok", messages: "ok" };
  let rateFailed = false;
  const userId = randomUUID();
  let accountId = "";
  const saved: Record<string, unknown> = {};

  const sign = (body: string) => `sha256=${createHmac("sha256", SECRET).update(body).digest("hex")}`;
  const deliver = (payload: unknown, signature?: string) => {
    const body = JSON.stringify(payload);
    return app.inject({ method: "POST", url: "/webhooks/meta", payload: body, headers: { "content-type": "application/json", "x-hub-signature-256": signature ?? sign(body) } });
  };
  const comment = (id: string, text: string, extra: Record<string, unknown> = {}) => ({
    object: "instagram",
    entry: [{ id: IG, time: Math.floor(Date.now() / 1000), changes: [{ field: "comments", value: { from: { id: `U-${id}`, username: `user_${id}` }, media: { id: "M1" }, comment_id: id, text, ...extra } }] }],
  });
  const event = (sourceId: string) => prisma.igAutomationEvent.findFirstOrThrow({ where: { accountId, sourceId } });

  beforeAll(async () => {
    for (const k of ["META_APP_SECRET", "META_WEBHOOK_VERIFY_TOKEN", "SOCIAL_TOKEN_KEY", "META_APP_ID"] as const) saved[k] = env[k];
    Object.assign(env, { META_APP_SECRET: SECRET, META_WEBHOOK_VERIFY_TOKEN: "verify-me", SOCIAL_TOKEN_KEY: "b".repeat(64), META_APP_ID: "app1" });

    fake = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const url = new URL(req.url!, "http://x");
        calls.push({ method: req.method!, path: url.pathname, body });
        const json = (code: number, obj: unknown) => {
          res.writeHead(code, { "content-type": "application/json" });
          res.end(JSON.stringify(obj));
        };
        if (url.pathname.endsWith("/replies")) {
          if (behaviour.replies === "drop") return req.socket.destroy();
          if (behaviour.replies === "auth") return json(400, { error: { code: 190, message: "Error validating access token" } });
          if (behaviour.replies === "rate_once" && !rateFailed) {
            rateFailed = true;
            return json(400, { error: { code: 4, message: "Application request limit reached" } });
          }
          return json(200, { id: `reply-${calls.length}` });
        }
        if (url.pathname === `/${PAGE}/messages`) {
          const b = JSON.parse(body);
          if (behaviour.messages === "no_template" && b.message.attachment) return json(400, { error: { code: 100, message: "Invalid parameter" } });
          return json(200, { recipient_id: "IGSID1", message_id: `mid-${calls.length}` });
        }
        if (url.pathname === `/${PAGE}/subscribed_apps`) {
          return req.method === "POST" ? json(200, { success: true }) : json(200, { data: [{ id: "app1", subscribed_fields: ["feed", "messages"] }] });
        }
        if (url.pathname === "/debug_token") {
          return json(200, { data: { is_valid: true, scopes: ["instagram_basic", "instagram_manage_comments", "instagram_manage_messages", "pages_manage_metadata", "pages_read_engagement", "pages_show_list"] } });
        }
        json(404, { error: { code: 100, error_subcode: 33, message: "Unknown path" } });
      });
    });
    await new Promise<void>((r) => fake.listen(0, "127.0.0.1", r));
    const port = (fake.address() as { port: number }).port;
    endpoints.base = () => `http://127.0.0.1:${port}`;

    const { buildApp } = await import("../../app.js");
    app = await buildApp();
    registerIgAutomationHandlers();
    await prisma.user.create({ data: { id: userId, email: `${userId}@it.test` } });
    const acc = await prisma.socialAccount.create({
      data: {
        userId,
        platform: "instagram",
        externalAccountId: IG,
        handle: "@brand",
        accessTokenEnc: encryptToken("PAGE_TOKEN"),
        scopes: [],
        metadata: { pageId: PAGE, igUserId: IG },
      },
    });
    accountId = acc.id;
    await prisma.igAutomationRule.create({
      data: {
        accountId,
        createdById: userId,
        name: "Guide funnel",
        keywords: ["guide", "link"],
        publicReplies: ["Sent it to your DMs {username}!"],
        dmText: "Here's the free guide",
        dmButtonTitle: "Open guide",
        dmButtonUrl: "https://example.com/guide",
      },
    });
    await prisma.igAutomationRule.create({
      data: { accountId, createdById: userId, name: "DM price", trigger: "dm", keywords: ["price"], publicReplies: [], dmText: "Prices start at 499" },
    });
  });

  afterAll(async () => {
    fake?.close();
    await app?.close();
    Object.assign(env, saved);
    await prisma.shortsJob.deleteMany({ where: { type: "ig_event", payload: { path: ["eventId"], not: "" } } }).catch(() => {});
    await prisma.user.delete({ where: { id: userId } }).catch(() => {});
    await prisma.$disconnect();
  });

  beforeEach(() => {
    calls = [];
    behaviour = { replies: "ok", messages: "ok" };
    rateFailed = false;
  });

  it("answers Meta's verification handshake only with the right token", async () => {
    const ok = await app.inject({ method: "GET", url: "/webhooks/meta?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=12345" });
    expect(ok.statusCode).toBe(200);
    expect(ok.body).toBe("12345");
    const bad = await app.inject({ method: "GET", url: "/webhooks/meta?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=1" });
    expect(bad.statusCode).toBe(403);
  });

  it("rejects deliveries with a bad signature and stores nothing", async () => {
    const r = await deliver(comment("C-bad", "guide"), "sha256=deadbeef");
    expect(r.statusCode).toBe(401);
    expect(await prisma.igAutomationEvent.count({ where: { accountId, sourceId: "C-bad" } })).toBe(0);
  });

  it("keyword comment -> public reply + private reply with a link button; Meta's retry is a no-op", async () => {
    const payload = comment("C1", "Can I get the GUIDE please?");
    expect((await deliver(payload)).statusCode).toBe(200);
    expect((await deliver(payload)).json()).toMatchObject({ stored: 0 }); // Meta retry
    await drainJobs({ types: ["ig_event"] });
    const ev = await event("C1");
    expect(ev).toMatchObject({ status: "done", publicReplyStatus: "sent", dmStatus: "sent", publicReplyText: "Sent it to your DMs @user_C1!" });
    const reply = calls.find((c) => c.path === "/C1/replies")!;
    expect(new URLSearchParams(reply.body).get("message")).toBe("Sent it to your DMs @user_C1!");
    const dm = JSON.parse(calls.find((c) => c.path === `/${PAGE}/messages`)!.body);
    expect(dm.recipient).toEqual({ comment_id: "C1" });
    expect(dm.message.attachment.payload.buttons[0]).toEqual({ type: "web_url", url: "https://example.com/guide", title: "Open guide" });
    expect(calls.filter((c) => c.path === "/C1/replies")).toHaveLength(1);
  });

  it("the same person commenting again is skipped (once per user)", async () => {
    await deliver(comment("C1b", "link?", { from: { id: "U-C1", username: "user_C1" } }));
    await drainJobs({ types: ["ig_event"] });
    expect(await event("C1b")).toMatchObject({ status: "skipped", skipReason: "already_replied_to_user" });
    expect(calls).toHaveLength(0);
  });

  it("no keyword -> no_match; own comments -> skipped", async () => {
    await deliver(comment("C2", "nice video"));
    await deliver(comment("C3", "guide", { from: { id: IG, username: "brand" } }));
    await drainJobs({ types: ["ig_event"] });
    expect((await event("C2")).status).toBe("no_match");
    expect(await event("C3")).toMatchObject({ status: "skipped", skipReason: "own_account" });
    expect(calls).toHaveLength(0);
  });

  it("a reply to a comment gets no public reply (Instagram rule) but still the DM", async () => {
    await deliver(comment("C4", "guide", { parent_id: "C1" }));
    await drainJobs({ types: ["ig_event"] });
    const ev = await event("C4");
    expect(ev).toMatchObject({ status: "done", publicReplyStatus: null, dmStatus: "sent" });
    expect(ev.skipReason).toMatch(/top-level/);
    expect(calls.some((c) => c.path.endsWith("/replies"))).toBe(false);
  });

  it("button template refused -> link sent as text", async () => {
    behaviour.messages = "no_template";
    await deliver(comment("C5", "guide"));
    await drainJobs({ types: ["ig_event"] });
    const ev = await event("C5");
    expect(ev.dmStatus).toBe("sent");
    const sent = calls.filter((c) => c.path === `/${PAGE}/messages`).map((c) => JSON.parse(c.body).message);
    expect(sent[1]).toEqual({ text: "Here's the free guide\n\nOpen guide: https://example.com/guide" });
    expect(ev.skipReason).toMatch(/link as text/);
  });

  it("rate limit -> job retries later and succeeds without double posting", async () => {
    behaviour.replies = "rate_once";
    await deliver(comment("C6", "guide"));
    await drainJobs({ types: ["ig_event"] });
    expect((await event("C6")).status).toBe("pending"); // waiting for backoff
    await prisma.shortsJob.updateMany({ where: { type: "ig_event", status: "queued" }, data: { runAt: new Date() } });
    await drainJobs({ types: ["ig_event"] });
    const ev = await event("C6");
    expect(ev).toMatchObject({ status: "done", publicReplyStatus: "sent", dmStatus: "sent" });
    expect(calls.filter((c) => c.path === "/C6/replies")).toHaveLength(2); // 1 refused + 1 sent
  });

  it("network drop on the public reply -> never resent; DM still goes", async () => {
    behaviour.replies = "drop";
    await deliver(comment("C7", "guide"));
    await drainJobs({ types: ["ig_event"] });
    const ev = await event("C7");
    expect(ev.publicReplyStatus).toBe("attempted");
    expect(ev.dmStatus).toBe("sent");
    expect(calls.filter((c) => c.path === "/C7/replies")).toHaveLength(1);
  });

  it("DM keyword -> DM reply in the 24h window; echoes ignored", async () => {
    await deliver({
      object: "instagram",
      entry: [
        {
          id: IG,
          time: Math.floor(Date.now() / 1000),
          messaging: [
            { sender: { id: "IGSID9" }, recipient: { id: IG }, timestamp: Date.now(), message: { mid: "m-1", text: "what's the PRICE?" } },
            { sender: { id: IG }, recipient: { id: "IGSID9" }, timestamp: Date.now(), message: { mid: "m-2", text: "echo", is_echo: true } },
          ],
        },
      ],
    });
    await drainJobs({ types: ["ig_event"] });
    expect(await event("m-1")).toMatchObject({ kind: "message", status: "done", dmStatus: "sent" });
    expect(await prisma.igAutomationEvent.count({ where: { accountId, sourceId: "m-2" } })).toBe(0);
    const body = JSON.parse(calls.find((c) => c.path === `/${PAGE}/messages`)!.body);
    expect(body).toEqual({ recipient: { id: "IGSID9" }, messaging_type: "RESPONSE", message: { text: "Prices start at 499" } });
  });

  it("expired token -> account flagged for reconnect, event failed with a clear reason", async () => {
    behaviour.replies = "auth";
    await deliver(comment("C8", "guide"));
    await drainJobs({ types: ["ig_event"] });
    const ev = await event("C8");
    expect(ev.publicReplyStatus).toBe("failed");
    expect(ev.dmStatus).toBe("failed");
    expect(calls.filter((c) => c.path === `/${PAGE}/messages`)).toHaveLength(0); // no pointless second call
    expect(ev.error).toBe("The Instagram connection expired or was revoked: reconnect the account.");
    expect((await prisma.socialAccount.findUniqueOrThrow({ where: { id: accountId } })).status).toBe("reauth_required");
    // While it needs a reconnect, new comments are skipped instead of erroring.
    await deliver(comment("C9", "guide"));
    await drainJobs({ types: ["ig_event"] });
    expect(await event("C9")).toMatchObject({ status: "skipped", skipReason: "account_not_active" });
    await prisma.socialAccount.update({ where: { id: accountId }, data: { status: "active" } });
  });

  it("unknown Instagram accounts are ignored (200, nothing stored)", async () => {
    const r = await deliver({ object: "instagram", entry: [{ id: "999", changes: [{ field: "comments", value: { comment_id: "X", text: "guide" } }] }] });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ stored: 0, unknownAccounts: ["999"] });
  });
});
