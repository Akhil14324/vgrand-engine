import { prisma, type WhatsappContact, type WhatsappNumber } from "@catgpt/db";
import type { WaMenuItem } from "@catgpt/types";
import { decryptToken } from "../../lib/social-crypto.js";
import { sendImagePayload, sendRaw, sendTemplatePayload, sendTextPayload, WaError } from "./graph.js";
import { buildMenuPayload, canFreeReply, splitText } from "./logic.js";

export type Source = "bot" | "human" | "broadcast";

async function record(
  number: WhatsappNumber,
  contact: WhatsappContact,
  source: Source,
  d: { mid: string | null; type: string; text: string | null; mediaUrl?: string | null; templateName?: string | null; status?: string; error?: string | null },
) {
  const row = await prisma.whatsappMessage.create({
    data: {
      numberId: number.id,
      contactId: contact.id,
      direction: "out",
      source,
      waMessageId: d.mid,
      type: d.type,
      text: d.text,
      mediaUrl: d.mediaUrl ?? null,
      templateName: d.templateName ?? null,
      status: d.status ?? "sent",
      error: d.error ?? null,
    },
  });
  await prisma.whatsappContact.update({ where: { id: contact.id }, data: { lastMessage: (d.text ?? `[${d.type}]`).slice(0, 200), lastMessageAt: new Date() } });
  return row;
}

/** A bad token disables the number so the UI can ask to reconnect, instead of failing silently. */
export async function noteAuthFailure(number: WhatsappNumber, err: unknown): Promise<void> {
  if (err instanceof WaError && err.kind === "auth") await prisma.whatsappNumber.update({ where: { id: number.id }, data: { status: "reauth_required" } }).catch(() => {});
}

const token = (n: WhatsappNumber) => decryptToken(n.accessTokenEnc);

/** Free-form text. Only valid inside the 24 h window; callers check, we enforce. */
export async function sendText(number: WhatsappNumber, contact: WhatsappContact, text: string, source: Source): Promise<void> {
  if (!canFreeReply(contact.lastInboundAt)) throw new WaError("rejected", 400, null, "The 24-hour reply window is closed: send an approved template instead");
  for (const part of splitText(text)) {
    try {
      const mid = await sendRaw(token(number), number.phoneNumberId, sendTextPayload(contact.waId, part));
      await record(number, contact, source, { mid, type: "text", text: part });
    } catch (err) {
      await noteAuthFailure(number, err);
      throw err;
    }
  }
}

export async function sendImage(number: WhatsappNumber, contact: WhatsappContact, url: string, caption: string, source: Source): Promise<void> {
  const mid = await sendRaw(token(number), number.phoneNumberId, sendImagePayload(contact.waId, url, caption));
  await record(number, contact, source, { mid, type: "image", text: caption || null, mediaUrl: url });
}

export async function sendMenu(number: WhatsappNumber, contact: WhatsappContact, body: string, items: WaMenuItem[]): Promise<void> {
  const mid = await sendRaw(token(number), number.phoneNumberId, buildMenuPayload(contact.waId, body, items));
  await record(number, contact, "bot", { mid, type: "interactive", text: `${body}\n[${items.map((i) => i.title).join(" | ")}]` });
}

/** Template sends work outside the 24 h window; the caller must already have checked consent. */
export async function sendTemplate(
  number: WhatsappNumber,
  contact: WhatsappContact,
  t: { name: string; language: string; headerUrl: string | null; renderedText: string },
  values: string[],
): Promise<string> {
  const mid = await sendRaw(token(number), number.phoneNumberId, sendTemplatePayload(contact.waId, t.name, t.language, t.headerUrl, values));
  await record(number, contact, "broadcast", { mid, type: "template", text: t.renderedText, templateName: t.name, mediaUrl: t.headerUrl });
  return mid;
}
