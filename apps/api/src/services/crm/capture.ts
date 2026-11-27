import { randomUUID } from "node:crypto";
import { Prisma, prisma, type CrmLead } from "@catgpt/db";
import { advanceStage } from "../whatsapp/logic.js";
import { cleanFields, stageLabel } from "./logic.js";

/**
 * Feeds the CRM from WhatsApp and Instagram. A lead is found by (brand, phone) or
 * (brand, Instagram id), so capture is idempotent. The `capture*` wrappers never
 * throw: a CRM problem must not stop a webhook or a bot reply.
 */

const isDuplicate = (err: unknown) => err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
const later = (a: Date, b: Date | null | undefined) => (b && b > a ? b : a);

const logFailure = (what: string, err: unknown) =>
  console.error(JSON.stringify({ ts: new Date().toISOString(), level: "error", scope: "crm", event: what, error: err instanceof Error ? err.message : String(err) }));

/**
 * Brings the CRM lead and a WhatsApp contact into line.
 *  - "auto" (bot, incoming message): the stage only moves forward.
 *  - "manual" (a person set the contact's stage in the inbox): it is taken as is.
 * Afterwards every chat of this person with the brand carries the lead's stage and
 * details, so the bot continues from them and an older chat can't undo newer ones.
 * Imported buyers are not leads and never create one.
 */
export async function syncLeadFromWhatsapp(contactId: string, mode: "auto" | "manual", userId: string | null = null): Promise<void> {
  const contact = await prisma.whatsappContact.findUnique({ where: { id: contactId }, include: { number: { select: { brandId: true } } } });
  if (!contact) return;
  const brandId = contact.number.brandId;
  const where = { brandId_phone: { brandId, phone: contact.waId } };
  const fields = cleanFields(contact.fields);

  let lead = await prisma.crmLead.findUnique({ where });
  if (!lead) {
    if (contact.kind !== "lead") return;
    const source = contact.lastInboundAt ? "whatsapp" : "import";
    try {
      await prisma.crmLead.create({
        data: {
          brandId,
          phone: contact.waId,
          name: contact.name || null,
          source,
          stage: contact.stage,
          fields,
          lastActivityAt: contact.lastMessageAt ?? new Date(),
          activities: { create: { kind: "created", text: source === "whatsapp" ? "Lead added from a WhatsApp chat" : "Lead added from a WhatsApp contact import", userId } },
        },
      });
      return;
    } catch (err) {
      if (!isDuplicate(err)) throw err;
      lead = await prisma.crmLead.findUniqueOrThrow({ where }); // created a moment ago by a parallel job
    }
  }

  const stage = mode === "manual" ? contact.stage : advanceStage(lead.stage, contact.stage);
  const updated = await prisma.crmLead.update({
    where: { id: lead.id },
    data: {
      stage,
      name: lead.name || contact.name || null,
      fields: { ...cleanFields(lead.fields), ...fields },
      lastActivityAt: later(lead.lastActivityAt, contact.lastMessageAt),
      ...(stage !== lead.stage ? { activities: { create: { kind: "stage", text: `Stage: ${stageLabel(lead.stage)} → ${stageLabel(stage)}`, userId } } } : {}),
    },
  });
  await writeBackToWhatsapp(updated);
}

/** Copies a team member's CRM edit to the lead's WhatsApp chat(s) for the same brand. */
export async function writeBackToWhatsapp(lead: CrmLead, clearedFields: string[] = []): Promise<void> {
  if (!lead.phone) return;
  const contacts = await prisma.whatsappContact.findMany({ where: { waId: lead.phone, number: { brandId: lead.brandId } } });
  for (const c of contacts) {
    const fields = { ...cleanFields(c.fields), ...cleanFields(lead.fields) };
    for (const key of clearedFields) delete fields[key];
    const name = lead.name || c.name;
    const before = cleanFields(c.fields);
    const same =
      c.stage === lead.stage && c.name === name && Object.keys(fields).length === Object.keys(before).length && Object.entries(fields).every(([k, v]) => before[k] === v);
    if (!same) await prisma.whatsappContact.update({ where: { id: c.id }, data: { stage: lead.stage, name, fields } });
  }
}

/**
 * A team member gave a lead a phone number that already has chats: the lead takes
 * the chats' progress and details. What the lead already says wins over the chats.
 */
export async function adoptWhatsappChats(lead: CrmLead, userId: string): Promise<CrmLead> {
  if (!lead.phone) return lead;
  const chats = await prisma.whatsappContact.findMany({ where: { waId: lead.phone, number: { brandId: lead.brandId } } });
  if (!chats.length) return lead;
  let stage = lead.stage;
  let name = lead.name;
  let fields = cleanFields(lead.fields);
  for (const c of chats) {
    stage = advanceStage(stage, c.stage);
    name ||= c.name;
    fields = { ...cleanFields(c.fields), ...fields };
  }
  return prisma.crmLead.update({
    where: { id: lead.id },
    data: {
      stage,
      name,
      fields,
      ...(stage !== lead.stage ? { activities: { create: { kind: "stage", text: `Stage: ${stageLabel(lead.stage)} → ${stageLabel(stage)} (from WhatsApp)`, userId } } } : {}),
    },
  });
}

export async function captureWhatsappLead(contactId: string): Promise<void> {
  await syncLeadFromWhatsapp(contactId, "auto").catch((err) => logFailure("whatsapp_capture_failed", err));
}

export async function captureWhatsappLeadForMessage(messageId: string): Promise<void> {
  try {
    const m = await prisma.whatsappMessage.findUnique({ where: { id: messageId }, select: { contactId: true } });
    if (m) await syncLeadFromWhatsapp(m.contactId, "auto");
  } catch (err) {
    logFailure("whatsapp_capture_failed", err);
  }
}

/** The history line for one comment or DM. */
function instagramActivity(ev: { kind: string; text: string | null; occurredAt: Date }) {
  const what = ev.kind === "comment" ? "Commented" : ev.kind === "postback" ? "Chose an option" : "Sent a DM";
  return { kind: "instagram", text: `${what}${ev.text ? `: “${ev.text.slice(0, 300)}”` : ""}`, createdAt: ev.occurredAt };
}

/**
 * A comment or DM that matched an automation rule becomes (or updates) a lead of
 * the brand chosen for that Instagram account. Returns true when a lead was created.
 */
export async function syncLeadFromInstagram(eventId: string): Promise<boolean> {
  const ev = await prisma.igAutomationEvent.findUnique({ where: { id: eventId }, include: { account: { select: { externalAccountId: true, crmRoute: true } } } });
  const route = ev?.account.crmRoute;
  if (!ev || !route || !ev.ruleId || !ev.fromId || ev.fromId === ev.account.externalAccountId) return false;

  const where = { brandId_igUserId: { brandId: route.brandId, igUserId: ev.fromId } };
  const activity = instagramActivity(ev);

  let lead = await prisma.crmLead.findUnique({ where });
  if (!lead) {
    try {
      await prisma.crmLead.create({
        data: { brandId: route.brandId, igUserId: ev.fromId, igUsername: ev.fromUsername, source: "instagram", lastActivityAt: ev.occurredAt, activities: { create: activity } },
      });
      return true;
    } catch (err) {
      if (!isDuplicate(err)) throw err;
      lead = await prisma.crmLead.findUniqueOrThrow({ where });
    }
  }
  // A retried job must not repeat the history line.
  const seen = await prisma.crmActivity.findFirst({ where: { leadId: lead.id, kind: "instagram", createdAt: ev.occurredAt, text: activity.text }, select: { id: true } });
  await prisma.crmLead.update({
    where: { id: lead.id },
    data: {
      igUsername: lead.igUsername || ev.fromUsername,
      lastActivityAt: later(lead.lastActivityAt, ev.occurredAt),
      ...(seen ? {} : { activities: { create: activity } }),
    },
  });
  return false;
}

/**
 * When an account is first pointed at a brand: adds the people who already matched
 * a rule (latest 2,000 events), in a handful of queries. Existing leads are left alone.
 */
export async function backfillInstagramLeads(account: { id: string; externalAccountId: string }, brandId: string): Promise<number> {
  const events = await prisma.igAutomationEvent.findMany({
    where: { accountId: account.id, ruleId: { not: null }, fromId: { not: null } },
    orderBy: { occurredAt: "desc" },
    take: 2000,
    select: { kind: true, fromId: true, fromUsername: true, text: true, occurredAt: true },
  });
  const people = new Map<string, typeof events>();
  for (const ev of events) {
    if (ev.fromId === account.externalAccountId) continue;
    const list = people.get(ev.fromId!);
    if (list) list.push(ev);
    else people.set(ev.fromId!, [ev]);
  }
  if (!people.size) return 0;
  const known = await prisma.crmLead.findMany({ where: { brandId, igUserId: { in: [...people.keys()] } }, select: { igUserId: true } });
  for (const k of known) people.delete(k.igUserId!);
  const fresh = [...people].map(([igUserId, list]) => ({
    id: randomUUID(),
    brandId,
    igUserId,
    igUsername: list.find((e) => e.fromUsername)?.fromUsername ?? null,
    source: "instagram",
    lastActivityAt: list[0]!.occurredAt, // newest first
  }));
  if (!fresh.length) return 0;
  await prisma.crmLead.createMany({ data: fresh, skipDuplicates: true });
  // A webhook may have created some of them meanwhile: write history only for ours.
  const made = await prisma.crmLead.findMany({ where: { id: { in: fresh.map((f) => f.id) } }, select: { id: true, igUserId: true } });
  await prisma.crmActivity.createMany({ data: made.flatMap((l) => people.get(l.igUserId!)!.map((ev) => ({ leadId: l.id, ...instagramActivity(ev) }))) });
  return made.length;
}

export async function captureInstagramLead(eventId: string): Promise<void> {
  await syncLeadFromInstagram(eventId).catch((err) => logFailure("instagram_capture_failed", err));
}
