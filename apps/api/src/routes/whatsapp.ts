import type { FastifyInstance } from "fastify";
import { Prisma, prisma } from "@catgpt/db";
import {
  waBroadcastInputSchema, waConnectSchema, waContactUpdateSchema, waImportSchema, waSendSchema, waSettingsSchema, waTemplateInputSchema,
  type WaWebhookStatusDto,
} from "@catgpt/types";
import { env } from "../env.js";
import { HttpError, badRequest, notFound, parseBody } from "../lib/errors.js";
import { findManageableBrand } from "../lib/brand.js";
import { decryptToken, encryptToken, hasValidTokenKey } from "../lib/social-crypto.js";
import { captureWhatsappLead, syncLeadFromWhatsapp } from "../services/crm/capture.js";
import { audienceWhere, countAudience, enqueueBroadcast } from "../services/whatsapp/broadcast.js";
import { WaError, WaNetworkError, createMetaTemplate, getPhoneInfo, listMetaTemplates, subscribeWaba, uploadExampleImage } from "../services/whatsapp/graph.js";
import { normalizePhone, templateToMeta, validateTemplate } from "../services/whatsapp/logic.js";
import { noteAuthFailure, sendText } from "../services/whatsapp/send.js";
import { listBroadcasts, listNumbers, ownedContact, ownedNumber, toContactDto, toMessageDto, toNumberDto, toTemplateDto, webhookCallbackUrl } from "../services/whatsapp/service.js";

/** Meta errors become a 502 with Meta's message (never the token). */
function metaFailure(err: unknown): never {
  if (err instanceof WaError) throw new HttpError(err.kind === "auth" ? 401 : 502, `Meta: ${err.message}`, err.kind === "auth" ? "WA_AUTH" : "WA_META");
  if (err instanceof WaNetworkError) throw new HttpError(502, err.message, "WA_NETWORK");
  throw err;
}

/**
 * Subscribes the WhatsApp account to our webhook. A token without whatsapp_business_management
 * (e.g. the temporary one from API Setup) is refused by Meta; connecting still works for sending
 * and receiving on an already-subscribed account, so that case becomes a warning instead of a failure.
 */
async function subscribeOrWarn(token: string, wabaId: string): Promise<string | null> {
  try {
    await subscribeWaba(token, wabaId);
    return null;
  } catch (err) {
    if (err instanceof WaError && err.kind === "rejected") {
      return `Connected, but Meta would not subscribe the account to webhooks (${err.message}). Replies may not arrive and templates will not work until you use a System User token with whatsapp_business_management.`;
    }
    return metaFailure(err);
  }
}

/** WhatsApp management API: numbers per brand, bot settings, inbox, templates, broadcasts. */
export async function whatsappRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  app.get("/whatsapp/status", async (): Promise<WaWebhookStatusDto> => ({
    callbackUrl: webhookCallbackUrl(),
    verifyTokenSet: !!(env.WHATSAPP_WEBHOOK_VERIFY_TOKEN ?? env.META_WEBHOOK_VERIFY_TOKEN),
    appSecretSet: !!(env.WHATSAPP_APP_SECRET ?? env.META_APP_SECRET),
    tokenKeySet: hasValidTokenKey(),
  }));

  /* ------------------------------- numbers ------------------------------- */

  app.get("/whatsapp/numbers", async (req) => ({ items: await listNumbers(req.userId) }));

  app.post("/whatsapp/numbers", async (req, reply) => {
    const body = parseBody(waConnectSchema, req.body);
    if (!hasValidTokenKey()) throw new HttpError(503, "SOCIAL_TOKEN_KEY is not configured on the server", "NO_TOKEN_KEY");
    const brand = await findManageableBrand(req.userId, body.brandId);
    if (await prisma.whatsappNumber.findUnique({ where: { phoneNumberId: body.phoneNumberId } })) throw new HttpError(409, "This WhatsApp number is already connected", "ALREADY_CONNECTED");
    let info;
    let warning: string | null = null;
    try {
      info = await getPhoneInfo(body.accessToken, body.phoneNumberId); // proves the token + id work together
    } catch (err) {
      metaFailure(err);
    }
    warning = await subscribeOrWarn(body.accessToken, body.wabaId);
    const n = await prisma.whatsappNumber.create({
      data: { brandId: brand.id, createdById: req.userId, phoneNumberId: body.phoneNumberId, wabaId: body.wabaId, accessTokenEnc: encryptToken(body.accessToken), ...info },
      include: { brand: { select: { name: true } } },
    });
    return reply.code(201).send({ ...toNumberDto(n), warning });
  });

  app.patch<{ Params: { id: string } }>("/whatsapp/numbers/:id", async (req) => {
    const n = await ownedNumber(req.userId, req.params.id, true);
    const s = parseBody(waSettingsSchema, req.body);
    if (new Set(s.menu.map((m) => m.id)).size !== s.menu.length) throw badRequest("Menu item ids must be unique");
    if (s.menu.some((m) => m.kind === "link" && !m.url)) throw badRequest("A link item needs a URL");
    const u = await prisma.whatsappNumber.update({ where: { id: n.id }, data: { ...s, menu: s.menu as unknown as Prisma.InputJsonValue }, include: { brand: { select: { name: true } } } });
    return toNumberDto(u);
  });

  /** Swap in a fresh token (expired/revoked). Verified against Meta first; history and contacts stay. */
  app.put<{ Params: { id: string } }>("/whatsapp/numbers/:id/token", async (req) => {
    const n = await ownedNumber(req.userId, req.params.id, true);
    const { accessToken } = parseBody(waConnectSchema.pick({ accessToken: true }), req.body);
    if (!hasValidTokenKey()) throw new HttpError(503, "SOCIAL_TOKEN_KEY is not configured on the server", "NO_TOKEN_KEY");
    let info;
    try {
      info = await getPhoneInfo(accessToken, n.phoneNumberId);
    } catch (err) {
      metaFailure(err);
    }
    const warning = await subscribeOrWarn(accessToken, n.wabaId);
    const u = await prisma.whatsappNumber.update({ where: { id: n.id }, data: { accessTokenEnc: encryptToken(accessToken), status: "active", ...info }, include: { brand: { select: { name: true } } } });
    return { ...toNumberDto(u), warning };
  });

  app.delete<{ Params: { id: string } }>("/whatsapp/numbers/:id", async (req, reply) => {
    const n = await ownedNumber(req.userId, req.params.id, true);
    await prisma.whatsappNumber.delete({ where: { id: n.id } });
    return reply.code(204).send();
  });

  /* ------------------------------- contacts ------------------------------ */

  app.get<{ Params: { id: string }; Querystring: { stage?: string; kind?: string; q?: string; limit?: string; unread?: string } }>("/whatsapp/numbers/:id/contacts", async (req) => {
    const n = await ownedNumber(req.userId, req.params.id);
    const { stage, kind, q, unread } = req.query;
    const limit = Math.min(Number(req.query.limit) || 100, 300);
    const rows = await prisma.whatsappContact.findMany({
      where: {
        numberId: n.id,
        ...(stage ? { stage } : {}),
        ...(kind ? { kind } : {}),
        ...(unread === "1" ? { unreadCount: { gt: 0 } } : {}),
        ...(q ? { OR: [{ waId: { contains: q.replace(/\D/g, "") || "~~" } }, { name: { contains: q, mode: "insensitive" as const } }] } : {}),
      },
      orderBy: [{ lastMessageAt: { sort: "desc", nulls: "last" } }],
      take: limit,
    });
    return { items: rows.map(toContactDto) };
  });

  app.patch<{ Params: { id: string } }>("/whatsapp/contacts/:id", async (req) => {
    const c = await ownedContact(req.userId, req.params.id);
    const { optedIn, ...rest } = parseBody(waContactUpdateSchema, req.body);
    const u = await prisma.whatsappContact.update({
      where: { id: c.id },
      data: {
        ...rest,
        ...(optedIn === true ? { optedIn: true, optedOutAt: null, optInSource: "confirmed by owner" } : optedIn === false ? { optedIn: false, optedOutAt: new Date() } : {}),
      },
    });
    // A stage picked here is a person's decision, so the CRM takes it even if it moves back.
    await syncLeadFromWhatsapp(u.id, rest.stage ? "manual" : "auto", req.userId);
    return toContactDto(await prisma.whatsappContact.findUniqueOrThrow({ where: { id: u.id } }));
  });

  /** Bulk add people (buyers, past leads). The owner must confirm they consented; that is recorded. */
  app.post<{ Params: { id: string } }>("/whatsapp/numbers/:id/contacts/import", async (req) => {
    const n = await ownedNumber(req.userId, req.params.id, true);
    const body = parseBody(waImportSchema, req.body);
    let added = 0, updated = 0, invalid = 0;
    for (const row of body.rows) {
      const waId = normalizePhone(row.phone);
      if (!waId) { invalid++; continue; }
      const existing = await prisma.whatsappContact.findUnique({ where: { numberId_waId: { numberId: n.id, waId } } });
      if (existing?.optedOutAt) continue; // never re-subscribe someone who said STOP
      const contact = await prisma.whatsappContact.upsert({
        where: { numberId_waId: { numberId: n.id, waId } },
        create: { numberId: n.id, waId, name: row.name || null, kind: body.kind, tags: body.tags, optedIn: true, optInSource: body.consentSource },
        update: { name: existing?.name || row.name || undefined, kind: body.kind, tags: [...new Set([...(existing?.tags ?? []), ...body.tags])], optedIn: true, optInSource: body.consentSource },
      });
      await captureWhatsappLead(contact.id);
      if (existing) updated++;
      else added++;
    }
    return { added, updated, invalid };
  });

  app.get<{ Params: { id: string } }>("/whatsapp/contacts/:id/messages", async (req) => {
    const c = await ownedContact(req.userId, req.params.id);
    const rows = await prisma.whatsappMessage.findMany({ where: { contactId: c.id }, orderBy: { createdAt: "desc" }, take: 200 });
    if (c.unreadCount) await prisma.whatsappContact.update({ where: { id: c.id }, data: { unreadCount: 0 } });
    return { contact: toContactDto({ ...c, unreadCount: 0 }), items: rows.reverse().map(toMessageDto) };
  });

  /** A person replies. This also pauses the bot for this contact so the two don't talk over each other. */
  app.post<{ Params: { id: string } }>("/whatsapp/contacts/:id/messages", async (req, reply) => {
    const c = await ownedContact(req.userId, req.params.id);
    const { text } = parseBody(waSendSchema, req.body);
    if (c.number.status !== "active") throw new HttpError(409, "Reconnect this WhatsApp number first", "WA_AUTH");
    try {
      await sendText(c.number, c, text, "human");
    } catch (err) {
      await noteAuthFailure(c.number, err);
      if (err instanceof WaError && err.status === 400 && err.code === null) throw new HttpError(409, err.message, "WINDOW_CLOSED");
      metaFailure(err);
    }
    await prisma.whatsappContact.update({ where: { id: c.id }, data: { botPaused: true, stage: c.stage === "new" ? "engaged" : c.stage } });
    await captureWhatsappLead(c.id);
    return reply.code(201).send({ ok: true });
  });

  /* ------------------------------ templates ------------------------------ */

  app.get<{ Params: { id: string } }>("/whatsapp/numbers/:id/templates", async (req) => {
    const n = await ownedNumber(req.userId, req.params.id);
    return { items: (await prisma.whatsappTemplate.findMany({ where: { numberId: n.id }, orderBy: { createdAt: "desc" } })).map(toTemplateDto) };
  });

  app.post<{ Params: { id: string } }>("/whatsapp/numbers/:id/templates", async (req, reply) => {
    const n = await ownedNumber(req.userId, req.params.id, true);
    const t = parseBody(waTemplateInputSchema, req.body);
    const problem = validateTemplate(t);
    if (problem) throw badRequest(problem);
    if (await prisma.whatsappTemplate.findUnique({ where: { numberId_name_language: { numberId: n.id, name: t.name, language: t.language } } })) throw new HttpError(409, "A template with this name and language already exists", "DUPLICATE");
    const token = decryptToken(n.accessTokenEnc);
    let meta;
    try {
      const payload = templateToMeta(t) as { components: { type: string; example?: unknown }[] };
      if (t.headerUrl) payload.components[0]!.example = { header_handle: [await uploadExampleImage(token, t.headerUrl)] };
      meta = await createMetaTemplate(token, n.wabaId, payload);
    } catch (err) {
      metaFailure(err);
    }
    const row = await prisma.whatsappTemplate.create({
      data: { numberId: n.id, ...t, buttons: t.buttons as unknown as Prisma.InputJsonValue, metaId: meta.id, metaStatus: meta.status === "approved" ? "approved" : "pending" },
    });
    return reply.code(201).send(toTemplateDto(row));
  });

  /** Pulls approval status from Meta (approval usually takes minutes to a day). */
  app.post<{ Params: { id: string } }>("/whatsapp/numbers/:id/templates/sync", async (req) => {
    const n = await ownedNumber(req.userId, req.params.id);
    let remote;
    try {
      remote = await listMetaTemplates(decryptToken(n.accessTokenEnc), n.wabaId);
    } catch (err) {
      await noteAuthFailure(n, err);
      metaFailure(err);
    }
    const local = await prisma.whatsappTemplate.findMany({ where: { numberId: n.id } });
    for (const t of local) {
      const r = remote.find((x) => x.name === t.name && x.language === t.language);
      if (r && (r.status !== t.metaStatus || r.reason !== t.rejectReason)) {
        await prisma.whatsappTemplate.update({ where: { id: t.id }, data: { metaStatus: r.status, rejectReason: r.reason, metaId: r.id } });
      }
    }
    return { items: (await prisma.whatsappTemplate.findMany({ where: { numberId: n.id }, orderBy: { createdAt: "desc" } })).map(toTemplateDto) };
  });

  app.delete<{ Params: { id: string } }>("/whatsapp/templates/:id", async (req, reply) => {
    const t = await prisma.whatsappTemplate.findUnique({ where: { id: req.params.id }, include: { _count: { select: { broadcasts: true } } } });
    if (!t) throw notFound("Template not found");
    await ownedNumber(req.userId, t.numberId, true);
    if (t._count.broadcasts) throw new HttpError(409, "This template was used in a broadcast and can't be removed", "IN_USE");
    await prisma.whatsappTemplate.delete({ where: { id: t.id } });
    return reply.code(204).send();
  });

  /* ------------------------------ broadcasts ----------------------------- */

  app.get<{ Params: { id: string } }>("/whatsapp/numbers/:id/broadcasts", async (req) => {
    const n = await ownedNumber(req.userId, req.params.id);
    return { items: await listBroadcasts(n.id) };
  });

  /** How many people a broadcast would reach (opted-in only). */
  app.post<{ Params: { id: string } }>("/whatsapp/numbers/:id/audience", async (req) => {
    const n = await ownedNumber(req.userId, req.params.id);
    const { audience } = parseBody(waBroadcastInputSchema.pick({ audience: true }), req.body);
    const [eligible, total] = await Promise.all([countAudience(n.id, audience), prisma.whatsappContact.count({ where: { ...audienceWhere(n.id, audience), optedIn: undefined, optedOutAt: undefined } })]);
    return { eligible, skippedNoConsent: total - eligible };
  });

  app.post<{ Params: { id: string } }>("/whatsapp/numbers/:id/broadcasts", async (req, reply) => {
    const n = await ownedNumber(req.userId, req.params.id, true);
    const b = parseBody(waBroadcastInputSchema, req.body);
    const t = await prisma.whatsappTemplate.findFirst({ where: { id: b.templateId, numberId: n.id } });
    if (!t) throw notFound("Template not found");
    if (t.metaStatus !== "approved") throw new HttpError(409, `Template is ${t.metaStatus}; only approved templates can be sent`, "TEMPLATE_NOT_APPROVED");
    if (b.variableMap.length !== t.variables.length) throw badRequest(`Fill in all ${t.variables.length} template variables`);
    if (b.scheduledAt && new Date(b.scheduledAt).getTime() < Date.now() + 60_000) throw badRequest("Schedule at least a minute ahead");
    const row = await prisma.whatsappBroadcast.create({
      data: { numberId: n.id, templateId: t.id, createdById: req.userId, name: b.name, audience: b.audience, variableMap: b.variableMap, scheduledAt: b.scheduledAt ? new Date(b.scheduledAt) : null },
    });
    return reply.code(201).send({ id: row.id });
  });

  app.post<{ Params: { id: string } }>("/whatsapp/broadcasts/:id/send", async (req) => {
    const b = await prisma.whatsappBroadcast.findUnique({ where: { id: req.params.id } });
    if (!b) throw notFound("Broadcast not found");
    const n = await ownedNumber(req.userId, b.numberId, true);
    if (n.status !== "active") throw new HttpError(409, "Reconnect this WhatsApp number first", "WA_AUTH");
    if (b.status !== "draft") throw new HttpError(409, `Broadcast is already ${b.status}`, "NOT_DRAFT");
    await enqueueBroadcast(b.id, b.scheduledAt && b.scheduledAt.getTime() > Date.now() ? b.scheduledAt : null);
    return { queued: true };
  });

  app.post<{ Params: { id: string } }>("/whatsapp/broadcasts/:id/cancel", async (req) => {
    const b = await prisma.whatsappBroadcast.findUnique({ where: { id: req.params.id } });
    if (!b) throw notFound("Broadcast not found");
    await ownedNumber(req.userId, b.numberId, true);
    const r = await prisma.whatsappBroadcast.updateMany({ where: { id: b.id, status: { in: ["draft", "sending"] } }, data: { status: "cancelled", finishedAt: new Date() } });
    return { cancelled: r.count > 0 };
  });
}
