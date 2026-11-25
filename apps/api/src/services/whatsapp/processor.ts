import { Prisma, prisma } from "@catgpt/db";
import { enqueueJob, registerJobHandler, type ShortsJobRow } from "../shorts/jobs.js";
import { handleInbound } from "./bot.js";
import { runBroadcast } from "./broadcast.js";
import { isOptIn, isOptOut, parseWebhook, type InboundMessage, type StatusUpdate } from "./logic.js";
import { sendText } from "./send.js";

const log = (level: "info" | "warn" | "error", event: string, data: Record<string, unknown> = {}) => {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, scope: "whatsapp", event, ...data });
  if (level === "info") console.log(line);
  else console.error(line);
};

/** Stores every inbound message once (unique per number + wamid) and queues the bot. Safe to retry. */
export async function ingestWebhook(body: unknown): Promise<{ events: number; stored: number }> {
  const events = parseWebhook(body);
  let stored = 0;
  for (const ev of events) {
    const number = await prisma.whatsappNumber.findUnique({ where: { phoneNumberId: ev.phoneNumberId } });
    if (!number) {
      log("warn", "webhook.unknown_number", { phoneNumberId: ev.phoneNumberId });
      continue;
    }
    if (ev.kind === "status") await applyStatus(number.id, ev);
    else if (await storeInbound(number.id, ev)) stored++;
  }
  return { events: events.length, stored };
}

const RANK: Record<string, number> = { queued: 0, sent: 1, delivered: 2, read: 3, failed: 4 };

async function applyStatus(numberId: string, s: StatusUpdate): Promise<void> {
  const msg = await prisma.whatsappMessage.findUnique({ where: { numberId_waMessageId: { numberId, waMessageId: s.mid } } });
  // Statuses can arrive out of order (read before delivered): only move forward.
  if (msg && (RANK[s.status] ?? 0) > (RANK[msg.status] ?? 0)) {
    await prisma.whatsappMessage.update({ where: { id: msg.id }, data: { status: s.status, error: s.error } });
  }
  const rec = await prisma.whatsappBroadcastRecipient.findFirst({ where: { waMessageId: s.mid, broadcast: { numberId } } });
  if (rec && (RANK[s.status] ?? 0) > (RANK[rec.status] ?? 0)) {
    await prisma.whatsappBroadcastRecipient.update({ where: { id: rec.id }, data: { status: s.status, error: s.error } });
  }
}

async function storeInbound(numberId: string, ev: InboundMessage): Promise<boolean> {
  const label = ev.text ?? `[${ev.type}]`;
  const contact = await prisma.whatsappContact.upsert({
    where: { numberId_waId: { numberId, waId: ev.waId } },
    create: { numberId, waId: ev.waId, name: ev.profileName, lastInboundAt: ev.occurredAt, lastMessageAt: ev.occurredAt, lastMessage: label.slice(0, 200), unreadCount: 1 },
    update: { lastInboundAt: ev.occurredAt, lastMessageAt: ev.occurredAt, lastMessage: label.slice(0, 200), unreadCount: { increment: 1 } },
  });
  let row;
  try {
    row = await prisma.whatsappMessage.create({
      data: { numberId, contactId: contact.id, direction: "in", source: "customer", waMessageId: ev.mid, type: ev.type, text: ev.text, replyId: ev.replyId, status: "received", createdAt: ev.occurredAt },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return false; // webhook retry
    throw err;
  }
  if (!contact.name && ev.profileName) await prisma.whatsappContact.update({ where: { id: contact.id }, data: { name: ev.profileName } });

  // Consent keywords are handled before the bot ever sees the message.
  if (ev.text && isOptOut(ev.text)) {
    await prisma.whatsappContact.update({ where: { id: contact.id }, data: { optedIn: false, optedOutAt: new Date() } });
    const number = await prisma.whatsappNumber.findUniqueOrThrow({ where: { id: numberId } });
    await sendText(number, { ...contact, lastInboundAt: ev.occurredAt }, "You've been unsubscribed and won't get promotional messages. Reply START anytime to subscribe again.", "bot").catch(() => {});
    return true;
  }
  if (ev.text && isOptIn(ev.text)) {
    await prisma.whatsappContact.update({ where: { id: contact.id }, data: { optedIn: true, optedOutAt: null, optInSource: "whatsapp_keyword" } });
    const number = await prisma.whatsappNumber.findUniqueOrThrow({ where: { id: numberId } });
    await sendText(number, { ...contact, lastInboundAt: ev.occurredAt }, "You're subscribed to updates. Reply STOP anytime to unsubscribe.", "bot").catch(() => {});
    return true;
  }
  await enqueueJob({ type: "wa_bot", key: `wa:bot:${row.id}`, payload: { messageId: row.id }, maxAttempts: 3 });
  return true;
}

export function registerWhatsappHandlers(): void {
  registerJobHandler("wa_bot", async (job: ShortsJobRow) => {
    const id = (job.payload as { messageId?: string }).messageId;
    if (id) await handleInbound(id);
  });
  registerJobHandler("wa_broadcast", runBroadcast);
}
