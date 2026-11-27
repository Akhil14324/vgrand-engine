import { randomUUID } from "node:crypto";
import { Prisma, prisma, type CrmLead } from "@catgpt/db";
import {
  CRM_FIELDS,
  toCsv,
  type CrmDue,
  type CrmImportInput,
  type CrmInstagramAccountDto,
  type CrmInstagramRouteInput,
  type CrmLeadDetailDto,
  type CrmLeadDto,
  type CrmLeadListDto,
  type CrmLeadUpdateInput,
  type CrmMemberDto,
  type CrmNoteInput,
  type CrmSource,
  type CrmStage,
  type crmLeadCreateSchema,
} from "@catgpt/types";
import type { z } from "zod";
import { HttpError, badRequest, forbidden, notFound } from "../../lib/errors.js";
import { workspaceAccess } from "../../lib/workspace-access.js";
import { ownedIgAccount } from "../ig-automation/service.js";
import { normalizePhone } from "../whatsapp/logic.js";
import { adoptWhatsappChats, backfillInstagramLeads, writeBackToWhatsapp } from "./capture.js";
import { CLOSED_STAGES, cleanFields, editFields, mergeLeads, stageLabel } from "./logic.js";

export const PAGE_SIZE = 100;

/* --------------------------------- access ---------------------------------- */

/**
 * Anyone who can use the brand sees and works all its leads. `canManage` (brand or
 * workspace owner) is also needed to import, export, delete and set up Instagram.
 */
export async function crmBrand(userId: string, brandId: string, opts: { manage?: boolean } = {}) {
  const brand = await prisma.brand.findFirst({
    where: { id: brandId, OR: [{ userId }, { workspace: workspaceAccess(userId) }] },
    select: { id: true, name: true, userId: true, workspaceId: true, workspace: { select: { userId: true, members: { select: { userId: true } } } } },
  });
  if (!brand) throw notFound("Brand not found");
  const canManage = brand.userId === userId || brand.workspace?.userId === userId;
  if (opts.manage && !canManage) throw forbidden("Only the brand owner can do that");
  return { ...brand, canManage };
}
type CrmBrand = Awaited<ReturnType<typeof crmBrand>>;

/** People who can own a lead of this brand. */
async function members(brand: CrmBrand): Promise<CrmMemberDto[]> {
  const ids = [...new Set([brand.userId, brand.workspace?.userId, ...(brand.workspace?.members.map((m) => m.userId) ?? [])].filter((v): v is string => !!v))];
  const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } });
  return users.map((u) => ({ id: u.id, name: u.name || u.email.split("@")[0]! })).sort((a, b) => a.name.localeCompare(b.name));
}

/** The lead and its brand, or a 404 that doesn't reveal whether the id exists. */
async function accessibleLead(userId: string, id: string) {
  const lead = await prisma.crmLead.findUnique({ where: { id } });
  if (!lead) throw notFound("Lead not found");
  const brand = await crmBrand(userId, lead.brandId).catch(() => {
    throw notFound("Lead not found");
  });
  return { lead, brand };
}

/* ---------------------------------- shapes --------------------------------- */

const toDay = (d: Date | null) => d?.toISOString().slice(0, 10) ?? null;
const fromDay = (s: string | null) => (s ? new Date(`${s}T00:00:00Z`) : null);

const toLeadDto = (l: CrmLead, people: CrmMemberDto[]): CrmLeadDto => ({
  id: l.id,
  brandId: l.brandId,
  name: l.name,
  phone: l.phone,
  instagram: l.igUsername,
  fromInstagram: !!l.igUserId,
  source: l.source as CrmSource,
  stage: l.stage as CrmStage,
  ownerId: l.ownerId,
  ownerName: l.ownerId ? (people.find((p) => p.id === l.ownerId)?.name ?? "Former member") : null,
  followUpOn: toDay(l.followUpOn),
  fields: cleanFields(l.fields),
  createdAt: l.createdAt.toISOString(),
  lastActivityAt: l.lastActivityAt.toISOString(),
});

function phoneOrThrow(raw: string): string | null {
  if (!raw.trim()) return null;
  const phone = normalizePhone(raw);
  if (!phone) throw badRequest("That phone number isn't valid");
  return phone;
}

function duplicatePhone(err: unknown): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    throw new HttpError(409, "A lead with this phone number already exists", "DUPLICATE");
  }
  throw err;
}

async function checkOwner(brand: CrmBrand, ownerId: string | null): Promise<CrmMemberDto[]> {
  const people = await members(brand);
  if (ownerId && !people.some((p) => p.id === ownerId)) throw badRequest("The owner must be a member of this brand's workspace");
  return people;
}

/* ---------------------------------- leads ---------------------------------- */

export interface ListQuery {
  stage?: string;
  source?: string;
  /** a user id, or "none" for unassigned */
  owner?: string;
  q?: string;
  due?: CrmDue;
  /** The viewer's date (YYYY-MM-DD), so "today" follows their clock. */
  today: string;
  page: number;
}

function dueFilter(due: CrmDue, today: Date): Prisma.CrmLeadWhereInput {
  // Follow-ups on closed leads aren't work to do.
  const open = { stage: { notIn: CLOSED_STAGES } };
  if (due === "none") return { AND: [open, { followUpOn: null }] };
  return { AND: [open, { followUpOn: due === "overdue" ? { lt: today } : due === "today" ? { equals: today } : { gt: today } }] };
}

export async function listLeads(userId: string, brandId: string, query: ListQuery): Promise<CrmLeadListDto> {
  const brand = await crmBrand(userId, brandId);
  const today = fromDay(query.today)!;
  const q = query.q?.trim();
  const digits = q?.replace(/\D/g, "") ?? "";
  const where: Prisma.CrmLeadWhereInput = {
    brandId,
    ...(query.stage ? { stage: query.stage } : {}),
    ...(query.source ? { source: query.source } : {}),
    ...(query.owner ? { ownerId: query.owner === "none" ? null : query.owner } : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { igUsername: { contains: q.replace(/^@/, ""), mode: "insensitive" } },
            ...(digits.length >= 3 ? [{ phone: { contains: digits } }] : []),
          ],
        }
      : {}),
    ...(query.due ? dueFilter(query.due, today) : {}),
  };
  const [rows, total, stages, overdue, dueToday, people] = await Promise.all([
    prisma.crmLead.findMany({
      where,
      orderBy: query.due && query.due !== "none" ? [{ followUpOn: "asc" }, { id: "asc" }] : [{ lastActivityAt: "desc" }, { id: "asc" }],
      skip: (query.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.crmLead.count({ where }),
    prisma.crmLead.groupBy({ by: ["stage"], where: { brandId }, _count: { _all: true } }),
    prisma.crmLead.count({ where: { brandId, ...dueFilter("overdue", today) } }),
    prisma.crmLead.count({ where: { brandId, ...dueFilter("today", today) } }),
    members(brand),
  ]);
  const byStage = Object.fromEntries(stages.map((s) => [s.stage, s._count._all]));
  return {
    items: rows.map((l) => toLeadDto(l, people)),
    total,
    counts: { all: stages.reduce((n, s) => n + s._count._all, 0), overdue, today: dueToday, byStage },
    members: people,
    canManage: brand.canManage,
  };
}

export async function getLead(userId: string, id: string): Promise<CrmLeadDetailDto> {
  const { lead, brand } = await accessibleLead(userId, id);
  const [people, activities, messages] = await Promise.all([
    members(brand),
    prisma.crmActivity.findMany({ where: { leadId: id }, orderBy: { createdAt: "desc" }, take: 200 }),
    lead.phone
      ? prisma.whatsappMessage.findMany({ where: { contact: { waId: lead.phone, number: { brandId: lead.brandId } } }, orderBy: { createdAt: "desc" }, take: 50 })
      : Promise.resolve([]),
  ]);
  return {
    lead: toLeadDto(lead, people),
    activities: activities.map((a) => ({
      id: a.id,
      kind: a.kind,
      text: a.text,
      by: a.userId ? (people.find((p) => p.id === a.userId)?.name ?? "Former member") : null,
      createdAt: a.createdAt.toISOString(),
    })),
    messages: messages.reverse().map((m) => ({ id: m.id, direction: m.direction as "in" | "out", text: m.text ?? `[${m.type}]`, createdAt: m.createdAt.toISOString() })),
  };
}

export async function createLead(userId: string, input: z.output<typeof crmLeadCreateSchema>): Promise<{ id: string }> {
  const brand = await crmBrand(userId, input.brandId);
  await checkOwner(brand, input.ownerId);
  const phone = phoneOrThrow(input.phone);
  const lead = await prisma.crmLead
    .create({
      data: {
        brandId: brand.id,
        name: input.name || null,
        phone,
        source: input.source,
        stage: input.stage,
        ownerId: input.ownerId,
        followUpOn: fromDay(input.followUpOn),
        fields: cleanFields(input.fields),
        activities: {
          create: [
            { kind: "created", text: "Lead added by hand", userId },
            ...(input.note ? [{ kind: "note", text: input.note, userId }] : []),
          ],
        },
      },
    })
    .catch(duplicatePhone);
  // The person may already be chatting with the brand (e.g. saved as a buyer): line the two up.
  if (phone) await writeBackToWhatsapp(await adoptWhatsappChats(lead, userId));
  return { id: lead.id };
}

export async function updateLead(userId: string, id: string, input: CrmLeadUpdateInput): Promise<void> {
  const { lead, brand } = await accessibleLead(userId, id);
  const people = await checkOwner(brand, input.ownerId && input.ownerId !== lead.ownerId ? input.ownerId : null);
  const data: Prisma.CrmLeadUpdateInput = {};
  const history: { kind: string; text: string; userId: string }[] = [];
  let cleared: string[] = [];

  if (input.name !== undefined) data.name = input.name || null;
  if (input.phone !== undefined) data.phone = phoneOrThrow(input.phone);
  const name = input.name !== undefined ? data.name : lead.name;
  const phone = input.phone !== undefined ? data.phone : lead.phone;
  if (!name && !phone && !lead.igUserId) throw badRequest("A lead needs a name or a phone number");

  if (input.stage && input.stage !== lead.stage) {
    data.stage = input.stage;
    history.push({ kind: "stage", text: `Stage: ${stageLabel(lead.stage)} → ${stageLabel(input.stage)}`, userId });
  }
  if (input.ownerId !== undefined && input.ownerId !== lead.ownerId) {
    data.ownerId = input.ownerId;
    history.push({ kind: "owner", text: input.ownerId ? `Assigned to ${people.find((p) => p.id === input.ownerId)!.name}` : "Owner removed", userId });
  }
  if (input.followUpOn !== undefined && input.followUpOn !== toDay(lead.followUpOn)) {
    data.followUpOn = fromDay(input.followUpOn);
    history.push({ kind: "followup", text: input.followUpOn ? `Follow-up set for ${input.followUpOn}` : "Follow-up cleared", userId });
  }
  if (input.fields) {
    const edit = editFields(lead.fields, input.fields);
    data.fields = edit.fields;
    cleared = edit.cleared;
  }
  if (history.length) {
    data.lastActivityAt = new Date();
    data.activities = { create: history };
  }
  let updated = await prisma.crmLead.update({ where: { id }, data }).catch(duplicatePhone);
  if (updated.phone !== lead.phone) updated = await adoptWhatsappChats(updated, userId);
  await writeBackToWhatsapp(updated, cleared);
}

export async function addNote(userId: string, id: string, input: Required<CrmNoteInput>): Promise<void> {
  await accessibleLead(userId, id);
  await prisma.crmLead.update({ where: { id }, data: { lastActivityAt: new Date(), activities: { create: { kind: input.kind, text: input.text, userId } } } });
}

export async function mergeInto(userId: string, id: string, otherId: string): Promise<void> {
  if (id === otherId) throw badRequest("Pick a different lead to merge");
  const { lead } = await accessibleLead(userId, id);
  const { lead: other } = await accessibleLead(userId, otherId);
  if (lead.brandId !== other.brandId) throw badRequest("Both leads must belong to the same brand");
  const result = mergeLeads(lead, other);
  if ("problem" in result) throw new HttpError(409, result.problem, "CANNOT_MERGE");
  const merged = await prisma.$transaction(async (tx) => {
    await tx.crmActivity.updateMany({ where: { leadId: other.id }, data: { leadId: lead.id } });
    await tx.crmLead.delete({ where: { id: other.id } }); // frees its phone / Instagram id first
    return tx.crmLead.update({
      where: { id: lead.id },
      data: {
        ...result.data,
        fields: result.data.fields as Prisma.InputJsonValue,
        activities: { create: { kind: "merge", text: `Merged with ${other.name || (other.igUsername ? `@${other.igUsername}` : other.phone) || "another lead"}`, userId } },
      },
    });
  });
  await writeBackToWhatsapp(merged);
}

export async function deleteLead(userId: string, id: string): Promise<void> {
  const { lead } = await accessibleLead(userId, id);
  await crmBrand(userId, lead.brandId, { manage: true });
  await prisma.crmLead.delete({ where: { id } });
}

/* ------------------------------ import / export ---------------------------- */

/** Adds new phones; for known ones only fills blanks, never overwriting the team's work. */
export async function importLeads(userId: string, input: CrmImportInput): Promise<{ added: number; updated: number; unchanged: number; invalid: number }> {
  await crmBrand(userId, input.brandId, { manage: true });
  let invalid = 0;
  const rows = new Map<string, { name: string; fields: Record<string, string> }>();
  for (const row of input.rows) {
    const phone = normalizePhone(row.phone);
    if (!phone) {
      invalid++;
      continue;
    }
    const prev = rows.get(phone);
    const fields = cleanFields(Object.fromEntries(CRM_FIELDS.map((k) => [k, row[k] ?? ""])));
    rows.set(phone, { name: prev?.name || row.name || "", fields: { ...fields, ...prev?.fields } });
  }

  const existing = await prisma.crmLead.findMany({ where: { brandId: input.brandId, phone: { in: [...rows.keys()] } } });
  let updated = 0;
  for (const lead of existing) {
    const row = rows.get(lead.phone!)!;
    rows.delete(lead.phone!);
    const current = cleanFields(lead.fields);
    const fields = { ...row.fields, ...current };
    const name = lead.name || row.name || null;
    if (name === lead.name && Object.keys(fields).length === Object.keys(current).length) continue;
    await prisma.crmLead.update({ where: { id: lead.id }, data: { name, fields } });
    updated++;
  }

  const fresh = [...rows].map(([phone, r]) => ({ id: randomUUID(), brandId: input.brandId, phone, name: r.name || null, source: "import", fields: r.fields }));
  let added = 0;
  if (fresh.length) {
    added = (await prisma.crmLead.createMany({ data: fresh, skipDuplicates: true })).count;
    const made = await prisma.crmLead.findMany({ where: { id: { in: fresh.map((f) => f.id) } }, select: { id: true } });
    await prisma.crmActivity.createMany({ data: made.map((l) => ({ leadId: l.id, kind: "created", text: "Lead added from a CSV import", userId })) });
  }
  return { added, updated, unchanged: existing.length - updated + (fresh.length - added), invalid };
}

export async function exportLeads(userId: string, brandId: string): Promise<string> {
  const brand = await crmBrand(userId, brandId, { manage: true });
  const [rows, people] = await Promise.all([prisma.crmLead.findMany({ where: { brandId }, orderBy: { createdAt: "asc" } }), members(brand)]);
  const header = ["Name", "Phone", "Instagram", "Source", "Stage", "Owner", "Follow-up", "Budget", "BHK", "Location", "Timeline", "Purpose", "Added"];
  return toCsv([
    header,
    ...rows.map((l) => {
      const d = toLeadDto(l, people);
      return [d.name ?? "", d.phone ?? "", d.instagram ?? "", d.source, stageLabel(d.stage), d.ownerName ?? "", d.followUpOn ?? "", ...CRM_FIELDS.map((k) => d.fields[k] ?? ""), d.createdAt.slice(0, 10)];
    }),
  ]);
}

/* -------------------------------- instagram -------------------------------- */

/** Accounts that may feed this brand: its workspace's accounts and the viewer's own. */
export async function listInstagramRoutes(userId: string, brandId: string): Promise<CrmInstagramAccountDto[]> {
  const brand = await crmBrand(userId, brandId, { manage: true });
  const accounts = await prisma.socialAccount.findMany({
    where: { platform: "instagram", OR: [{ userId, workspaceId: null }, ...(brand.workspaceId ? [{ workspaceId: brand.workspaceId }] : [])] },
    include: { crmRoute: { include: { brand: { select: { id: true, name: true } } } } },
    orderBy: { createdAt: "asc" },
  });
  const out: CrmInstagramAccountDto[] = [];
  for (const a of accounts) {
    const routed = a.crmRoute?.brand;
    const visible = routed ? await crmBrand(userId, routed.id).then(() => true, () => false) : false;
    out.push({ accountId: a.id, handle: a.handle ?? a.displayName, brandId: routed?.id ?? null, brandName: routed ? (visible ? routed.name : "another brand") : null });
  }
  return out;
}

/** Chooses (or clears) the brand that receives an account's leads, then adds its past matched people. */
export async function setInstagramRoute(userId: string, input: CrmInstagramRouteInput): Promise<{ added: number }> {
  const account = await ownedIgAccount(userId, input.accountId);
  const ownsAccount = account.userId === userId;
  const current = await prisma.crmInstagramRoute.findUnique({ where: { accountId: account.id } });
  // Moving or removing someone else's choice needs ownership of the account or of that brand.
  if (current && !ownsAccount) await crmBrand(userId, current.brandId, { manage: true });
  if (!input.brandId) {
    await prisma.crmInstagramRoute.deleteMany({ where: { accountId: account.id } });
    return { added: 0 };
  }
  const brand = await crmBrand(userId, input.brandId, { manage: true });
  const sameScope = account.workspaceId ? account.workspaceId === brand.workspaceId : ownsAccount;
  if (!sameScope) throw badRequest("This Instagram account belongs to a different workspace than the brand");
  await prisma.crmInstagramRoute.upsert({
    where: { accountId: account.id },
    create: { accountId: account.id, brandId: brand.id, createdById: userId },
    update: { brandId: brand.id, createdById: userId },
  });
  return { added: await backfillInstagramLeads(account, brand.id) };
}
