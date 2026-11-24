import { Prisma, prisma, type WhatsappContact } from "@catgpt/db";
import type { ShortsJobRow } from "../shorts/jobs.js";
import { enqueueJob } from "../shorts/jobs.js";
import { WaError, WaNetworkError } from "./graph.js";
import { renderTemplateBody, resolveVariable } from "./logic.js";
import { noteAuthFailure, sendTemplate } from "./send.js";

type Audience = { kind?: string; stages?: string[]; tags?: string[] };

/** Only people who agreed (and haven't since opted out) are ever eligible. */
export function audienceWhere(numberId: string, a: Audience): Prisma.WhatsappContactWhereInput {
  return {
    numberId,
    optedIn: true,
    optedOutAt: null,
    ...(a.kind ? { kind: a.kind } : {}),
    ...(a.stages?.length ? { stage: { in: a.stages } } : {}),
    ...(a.tags?.length ? { tags: { hasSome: a.tags } } : {}),
  };
}

export const countAudience = (numberId: string, a: Audience) => prisma.whatsappContact.count({ where: audienceWhere(numberId, a) });

export async function enqueueBroadcast(broadcastId: string, runAt: Date | null): Promise<void> {
  await enqueueJob({ type: "wa_broadcast", key: `wa:bc:${broadcastId}:${runAt?.getTime() ?? "now"}`, payload: { broadcastId }, runAt: runAt ?? undefined, maxAttempts: 5 });
}

const BATCH = 100;
const PARALLEL = 5;

/** Job handler. Sends one batch of pending recipients, then asks to run again until none are left. */
export async function runBroadcast(job: ShortsJobRow): Promise<void | { deferUntil: Date }> {
  const id = (job.payload as { broadcastId?: string }).broadcastId;
  if (!id) return;
  const bc = await prisma.whatsappBroadcast.findUnique({ where: { id }, include: { template: true, number: true } });
  if (!bc || bc.status === "cancelled" || bc.status === "done") return;
  if (bc.number.status !== "active") {
    await prisma.whatsappBroadcast.update({ where: { id }, data: { status: "cancelled", finishedAt: new Date() } });
    return;
  }
  if (bc.template.metaStatus !== "approved") throw new Error("Template is not approved by Meta");

  if (bc.status === "draft") {
    const contacts = await prisma.whatsappContact.findMany({ where: audienceWhere(bc.numberId, bc.audience as Audience), select: { id: true } });
    await prisma.whatsappBroadcastRecipient.createMany({ data: contacts.map((c) => ({ broadcastId: id, contactId: c.id })), skipDuplicates: true });
    await prisma.whatsappBroadcast.update({ where: { id }, data: { status: "sending", startedAt: new Date() } });
  }

  const pending = await prisma.whatsappBroadcastRecipient.findMany({ where: { broadcastId: id, status: "pending" }, include: { contact: true }, take: BATCH });
  const varMap = (Array.isArray(bc.variableMap) ? bc.variableMap : []) as string[];
  let backoff = false;

  const sendOne = async (r: (typeof pending)[number]) => {
    const c: WhatsappContact = r.contact;
    if (!c.optedIn || c.optedOutAt) {
      await prisma.whatsappBroadcastRecipient.update({ where: { id: r.id }, data: { status: "failed", error: "Opted out before send" } });
      return;
    }
    const values = bc.template.variables.map((_, i) => resolveVariable(varMap[i] ?? "", { name: c.name, fields: c.fields as Record<string, string> }));
    try {
      const mid = await sendTemplate(bc.number, c, { name: bc.template.name, language: bc.template.language, headerUrl: bc.template.headerUrl, renderedText: renderTemplateBody(bc.template.body, values) }, values);
      await prisma.whatsappBroadcastRecipient.update({ where: { id: r.id }, data: { status: "sent", waMessageId: mid } });
    } catch (err) {
      if (err instanceof WaError && err.kind === "retryable") {
        backoff = true; // stays pending, tried again after the pause
        return;
      }
      await noteAuthFailure(bc.number, err);
      const unknown = err instanceof WaNetworkError;
      await prisma.whatsappBroadcastRecipient.update({
        where: { id: r.id },
        // A network drop may have delivered it: never resend automatically.
        data: { status: "failed", error: unknown ? "Outcome unknown (network); not resent" : (err as Error).message.slice(0, 500) },
      });
    }
  };

  for (let i = 0; i < pending.length; i += PARALLEL) {
    await Promise.all(pending.slice(i, i + PARALLEL).map(sendOne));
    if (backoff) break;
  }

  const left = await prisma.whatsappBroadcastRecipient.count({ where: { broadcastId: id, status: "pending" } });
  if (left === 0) {
    await prisma.whatsappBroadcast.update({ where: { id }, data: { status: "done", finishedAt: new Date() } });
    return;
  }
  return { deferUntil: new Date(Date.now() + (backoff ? 60_000 : 1_000)) };
}
