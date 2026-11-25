import { prisma, type WhatsappBroadcast, type WhatsappContact, type WhatsappMessage, type WhatsappNumber, type WhatsappTemplate } from "@catgpt/db";
import type { WaBotMode, WaBroadcastDto, WaButton, WaContactDto, WaMessageDto, WaNumberDto, WaTemplateDto } from "@catgpt/types";
import { env } from "../../env.js";
import { notFound } from "../../lib/errors.js";
import { workspaceAccess } from "../../lib/workspace-access.js";
import { menuOf } from "./bot.js";
import { canFreeReply } from "./logic.js";

export const webhookCallbackUrl = () => `${env.API_PUBLIC_URL.replace(/\/+$/, "")}/webhooks/whatsapp`;

/** Brands the user can read/use, or (manage) only ones they own or own the workspace of. */
const brandFilter = (userId: string, manage: boolean) => (manage ? { OR: [{ userId }, { workspace: { userId } }] } : { OR: [{ userId }, { workspace: workspaceAccess(userId) }] });

/** Missing and not-yours are the same 404 so ids can't be probed. */
export async function ownedNumber(userId: string, id: string, manage = false) {
  const n = await prisma.whatsappNumber.findFirst({ where: { id, brand: brandFilter(userId, manage) }, include: { brand: { select: { name: true } } } });
  if (!n) throw notFound("WhatsApp number not found");
  return n;
}

export async function ownedContact(userId: string, id: string) {
  const c = await prisma.whatsappContact.findFirst({ where: { id, number: { brand: brandFilter(userId, false) } }, include: { number: true } });
  if (!c) throw notFound("Contact not found");
  return c;
}

export async function listNumbers(userId: string): Promise<WaNumberDto[]> {
  const rows = await prisma.whatsappNumber.findMany({ where: { brand: brandFilter(userId, false) }, include: { brand: { select: { name: true } } }, orderBy: { createdAt: "asc" } });
  return rows.map(toNumberDto);
}

export const toNumberDto = (n: WhatsappNumber & { brand: { name: string } }): WaNumberDto => ({
  id: n.id,
  brandId: n.brandId,
  brandName: n.brand.name,
  phoneNumberId: n.phoneNumberId,
  displayPhone: n.displayPhone,
  verifiedName: n.verifiedName,
  status: n.status,
  botMode: n.botMode as WaBotMode,
  greeting: n.greeting,
  aiInstructions: n.aiInstructions,
  menu: menuOf(n),
  handoffKeywords: n.handoffKeywords,
  handoffMessage: n.handoffMessage,
  createdAt: n.createdAt.toISOString(),
});

export const toContactDto = (c: WhatsappContact): WaContactDto => ({
  id: c.id,
  waId: c.waId,
  name: c.name,
  kind: c.kind,
  stage: c.stage,
  tags: c.tags,
  fields: c.fields as Record<string, string>,
  optedIn: c.optedIn,
  optedOutAt: c.optedOutAt?.toISOString() ?? null,
  botPaused: c.botPaused,
  unreadCount: c.unreadCount,
  canReply: canFreeReply(c.lastInboundAt),
  lastMessage: c.lastMessage,
  lastMessageAt: c.lastMessageAt?.toISOString() ?? null,
});

export const toMessageDto = (m: WhatsappMessage): WaMessageDto => ({
  id: m.id,
  direction: m.direction as "in" | "out",
  source: m.source,
  type: m.type,
  text: m.text,
  mediaUrl: m.mediaUrl,
  templateName: m.templateName,
  status: m.status,
  error: m.error,
  createdAt: m.createdAt.toISOString(),
});

export const toTemplateDto = (t: WhatsappTemplate): WaTemplateDto => ({
  id: t.id,
  name: t.name,
  language: t.language,
  category: t.category,
  headerUrl: t.headerUrl,
  body: t.body,
  variables: t.variables,
  examples: t.examples,
  buttons: (Array.isArray(t.buttons) ? t.buttons : []) as unknown as WaButton[],
  metaStatus: t.metaStatus,
  rejectReason: t.rejectReason,
});

export async function listBroadcasts(numberId: string): Promise<WaBroadcastDto[]> {
  const rows = await prisma.whatsappBroadcast.findMany({ where: { numberId }, include: { template: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: 50 });
  const counts = await prisma.whatsappBroadcastRecipient.groupBy({ by: ["broadcastId", "status"], where: { broadcastId: { in: rows.map((r) => r.id) } }, _count: { _all: true } });
  return rows.map((b) => toBroadcastDto(b, counts.filter((c) => c.broadcastId === b.id)));
}

function toBroadcastDto(b: WhatsappBroadcast & { template: { name: string } }, counts: { status: string; _count: { _all: number } }[]): WaBroadcastDto {
  const n = (s: string) => counts.find((c) => c.status === s)?._count._all ?? 0;
  const [sent, delivered, read, failed, pending] = [n("sent"), n("delivered"), n("read"), n("failed"), n("pending")];
  // sent/delivered/read are cumulative from the reader's view: a read message was also delivered and sent.
  return {
    id: b.id,
    name: b.name,
    templateName: b.template.name,
    status: b.status,
    scheduledAt: b.scheduledAt?.toISOString() ?? null,
    startedAt: b.startedAt?.toISOString() ?? null,
    finishedAt: b.finishedAt?.toISOString() ?? null,
    counts: { total: sent + delivered + read + failed + pending, sent: sent + delivered + read, delivered: delivered + read, read, failed },
  };
}
