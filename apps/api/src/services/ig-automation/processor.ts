import { Prisma, prisma, type SocialAccount } from "@catgpt/db";
import { decryptToken } from "../../lib/social-crypto.js";
import { captureInstagramLead } from "../crm/capture.js";
import { enqueueJob, PermanentJobError, registerJobHandler, type ShortsJobRow } from "../shorts/jobs.js";
import { GraphError, GraphNetworkError, replyToComment, sendDm, sendOptionReply, sendPrivateReply } from "./graph.js";
import {
  buildOptionReply,
  parseOptionPayload,
  parseWebhook,
  readOptions,
  pickRule,
  pickVariant,
  planCommentActions,
  renderTemplate,
  type InboundEvent,
  type Trigger,
} from "./logic.js";

/**
 * Instagram automation processing.
 *  1. The webhook stores each comment/message ONCE per connected account
 *     (unique accountId+kind+sourceId) and enqueues a job: Meta retries for up
 *     to 36 h, and every retry after the first is a no-op.
 *  2. The job matches a rule and sends the public reply and/or DM. Each action
 *     records its outcome before moving on, so a retried job never repeats a
 *     reply that already went out.
 */

const log = (level: "info" | "warn" | "error", event: string, data: Record<string, unknown>) => {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, scope: "ig-automation", event, ...data });
  if (level === "info") console.log(line);
  else console.error(line);
};

export type EventRow = Prisma.IgAutomationEventGetPayload<object>;

/* --------------------------------- ingest ---------------------------------- */

/** Stores and enqueues every event in a webhook delivery. Returns how many were new. */
export async function ingestWebhook(body: unknown): Promise<{ events: number; stored: number; unknownAccounts: string[] }> {
  const events = parseWebhook(body);
  let stored = 0;
  const unknown = new Set<string>();
  for (const ev of events) {
    const accounts = await prisma.socialAccount.findMany({
      where: { platform: "instagram", externalAccountId: ev.igAccountId },
      select: { id: true },
    });
    if (!accounts.length) {
      unknown.add(ev.igAccountId);
      continue;
    }
    for (const a of accounts) {
      const row = await storeEvent(a.id, ev);
      if (row) {
        stored++;
        await enqueueJob({ type: "ig_event", key: `ig:${row.id}`, payload: { eventId: row.id }, maxAttempts: 5 });
      }
    }
  }
  if (unknown.size) log("warn", "webhook.unknown_account", { igAccountIds: [...unknown] });
  return { events: events.length, stored, unknownAccounts: [...unknown] };
}

async function storeEvent(accountId: string, ev: InboundEvent): Promise<EventRow | null> {
  const sourceId = ev.kind === "comment" ? ev.commentId : ev.mid;
  const existing = await prisma.igAutomationEvent.findUnique({ where: { accountId_kind_sourceId: { accountId, kind: ev.kind, sourceId } } });
  if (existing) return null;
  try {
    return await prisma.igAutomationEvent.create({
      data:
        ev.kind === "comment"
          ? {
              accountId,
              kind: "comment",
              sourceId,
              mediaId: ev.mediaId,
              parentCommentId: ev.parentId,
              fromId: ev.fromId,
              fromUsername: ev.fromUsername,
              text: ev.text,
              occurredAt: ev.occurredAt,
              // Live comments: remembered so no public reply is attempted.
              skipReason: ev.live ? "live" : null,
            }
          : ev.kind === "postback"
            ? { accountId, kind: "postback", sourceId, fromId: ev.senderId, text: ev.title || null, payload: ev.payload, occurredAt: ev.occurredAt }
            : { accountId, kind: "message", sourceId, fromId: ev.senderId, text: ev.text, occurredAt: ev.occurredAt },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return null; // concurrent retry
    throw err;
  }
}

/* --------------------------------- process --------------------------------- */

async function finish(id: string, data: Prisma.IgAutomationEventUpdateInput): Promise<void> {
  await prisma.igAutomationEvent.update({ where: { id }, data: { ...data, processedAt: new Date() } });
}

async function markReauth(account: SocialAccount, why: string): Promise<void> {
  await prisma.socialAccount.update({ where: { id: account.id }, data: { status: "reauth_required" } }).catch(() => {});
  log("warn", "account.reauth_required", { accountId: account.id, why });
}

/** Human-readable reason for a failed Graph call. */
function describe(err: unknown): string {
  if (err instanceof GraphError) {
    switch (err.kind) {
      case "permission":
        return `Meta refused (missing permission or access): ${err.message}. Check the account's permissions on the Automations page and reconnect after Meta approves them.`;
      case "auth":
        return "The Instagram connection expired or was revoked: reconnect the account.";
      case "window":
        return `Instagram won't deliver this message now (messaging window or one-reply limit): ${err.message}`;
      default:
        return err.message;
    }
  }
  return err instanceof Error ? err.message : String(err);
}

const retryable = (err: unknown) => err instanceof GraphError && (err.kind === "rate_limit" || err.kind === "retryable");

export async function processEvent(eventId: string): Promise<void> {
  const ev = await prisma.igAutomationEvent.findUnique({ where: { id: eventId } });
  if (!ev || ev.status !== "pending") return; // already handled
  const account = await prisma.socialAccount.findUnique({ where: { id: ev.accountId } });
  if (!account) return;
  if (account.status !== "active") {
    await finish(ev.id, { status: "skipped", skipReason: "account_not_active" });
    return;
  }
  const igUserId = account.externalAccountId;
  const pageId = ((account.metadata ?? {}) as { pageId?: string }).pageId ?? null;
  if (ev.fromId && ev.fromId === igUserId) {
    await finish(ev.id, { status: "skipped", skipReason: "own_account" });
    return;
  }
  if (ev.kind === "postback") {
    await processPostback(ev, account, igUserId, pageId);
    return;
  }
  const text = ev.text ?? "";
  if (!text.trim()) {
    await finish(ev.id, { status: "skipped", skipReason: "empty_text" });
    return;
  }

  // Keep the rule once chosen (retries must not switch rules mid-way).
  let rule = ev.ruleId ? await prisma.igAutomationRule.findUnique({ where: { id: ev.ruleId } }) : null;
  if (!rule) {
    const rules = await prisma.igAutomationRule.findMany({ where: { accountId: account.id, active: true } });
    const trigger: Trigger = ev.kind === "comment" ? "comment" : "dm";
    rule = pickRule(rules, { trigger, text, mediaId: ev.mediaId });
    if (!rule) {
      await finish(ev.id, { status: "no_match" });
      return;
    }
    if (rule.oncePerUser && ev.fromId) {
      const prior = await prisma.igAutomationEvent.findFirst({
        where: { ruleId: rule.id, fromId: ev.fromId, id: { not: ev.id }, status: { in: ["done", "partial"] } },
        select: { id: true },
      });
      if (prior) {
        await finish(ev.id, { status: "skipped", skipReason: "already_replied_to_user", rule: { connect: { id: rule.id } } });
        return;
      }
    }
    await prisma.igAutomationEvent.update({ where: { id: ev.id }, data: { ruleId: rule.id } });
  }

  const token = decryptToken(account.accessTokenEnc);
  const options = readOptions(rule.dmOptions);
  const dmContent = {
    text: renderTemplate(rule.dmText ?? "", { username: ev.fromUsername }),
    buttonTitle: rule.dmButtonTitle,
    buttonUrl: rule.dmButtonUrl,
    options: options.map((o) => ({ id: o.id, title: o.title })),
    ruleId: rule.id,
  };
  const notes: string[] = [];
  // An invalid token fails every call: once seen, nothing else is attempted for this event.
  let authFailed = false;
  let current = (await prisma.igAutomationEvent.findUniqueOrThrow({ where: { id: ev.id } })) as EventRow;

  const plan =
    ev.kind === "comment"
      ? planCommentActions({ ev: { parentId: ev.parentCommentId, live: ev.skipReason === "live", occurredAt: ev.occurredAt }, rule })
      : { publicReply: false, publicReplyNote: null, dm: !!rule.dmText?.trim(), dmNote: null };
  if (plan.publicReplyNote) notes.push(plan.publicReplyNote);
  if (plan.dmNote) notes.push(plan.dmNote);

  // 1. Public reply (comments only). Marked "attempted" before the call: if the
  //    call's outcome is unknown (network drop), it is never resent (no double replies).
  if (plan.publicReply && current.publicReplyStatus === null) {
    const replyText = renderTemplate(pickVariant(rule.publicReplies, ev.sourceId)!, { username: ev.fromUsername });
    await prisma.igAutomationEvent.update({ where: { id: ev.id }, data: { publicReplyStatus: "attempted", publicReplyText: replyText } });
    try {
      const id = await replyToComment(token, ev.sourceId, replyText);
      current = await prisma.igAutomationEvent.update({ where: { id: ev.id }, data: { publicReplyStatus: "sent", publicReplyId: id } });
    } catch (err) {
      if (err instanceof GraphNetworkError) {
        notes.push("Public reply: no answer from Meta, not resent to avoid a duplicate");
      } else {
        // Meta answered with an error, so nothing was posted: safe to retry or record.
        if (err instanceof GraphError && err.kind === "auth") await markReauth(account, err.message);
        if (retryable(err)) {
          await prisma.igAutomationEvent.update({ where: { id: ev.id }, data: { publicReplyStatus: null } });
          throw err;
        }
        current = await prisma.igAutomationEvent.update({ where: { id: ev.id }, data: { publicReplyStatus: "failed", error: describe(err) } });
        if (err instanceof GraphError && err.kind === "auth") authFailed = true;
      }
    }
  }

  // 2. DM: a private reply to the comment, or a reply to the incoming message.
  //    Meta allows one private reply per comment, so a retry can't double-send.
  if (plan.dm && current.dmStatus === null && authFailed) {
    current = await prisma.igAutomationEvent.update({ where: { id: ev.id }, data: { dmStatus: "failed" } });
  } else if (plan.dm && current.dmStatus === null) {
    await prisma.igAutomationEvent.update({ where: { id: ev.id }, data: { dmText: dmContent.text } });
    try {
      const r =
        ev.kind === "comment"
          ? await sendPrivateReply(token, { pageId, igUserId }, ev.sourceId, dmContent)
          : await sendDm(token, pageId, ev.fromId!, dmContent);
      if (r.usedFallback) notes.push("Button not accepted by Instagram; sent the link as text");
      current = await prisma.igAutomationEvent.update({ where: { id: ev.id }, data: { dmStatus: "sent", dmMessageId: r.messageId } });
    } catch (err) {
      if (err instanceof GraphError && err.kind === "auth") await markReauth(account, err.message);
      if (err instanceof GraphNetworkError || retryable(err)) throw err;
      current = await prisma.igAutomationEvent.update({
        where: { id: ev.id },
        data: { dmStatus: "failed", error: [...new Set([current.error, describe(err)].filter(Boolean))].join(" | ") },
      });
    }
  }

  const wanted = [plan.publicReply ? current.publicReplyStatus : null, plan.dm ? current.dmStatus : null].filter((s): s is string => s !== null);
  const sent = wanted.filter((s) => s === "sent" || s === "attempted").length;
  const status = wanted.length === 0 ? "skipped" : sent === wanted.length ? "done" : sent > 0 ? "partial" : "failed";
  await finish(ev.id, { status, skipReason: notes.length ? notes.join("; ").slice(0, 500) : current.skipReason === "live" ? "live" : null });
  log(status === "failed" ? "warn" : "info", "event.processed", { eventId: ev.id, ruleId: rule.id, status, publicReply: current.publicReplyStatus, dm: current.dmStatus });
}

/**
 * The person tapped one of the options we sent: answer with that option's content.
 * Taps are always answerable (they open a fresh 24-hour window); a retry of the
 * job never resends once the reply is recorded.
 */
async function processPostback(ev: EventRow, account: SocialAccount, igUserId: string, pageId: string | null): Promise<void> {
  const parsed = parseOptionPayload(ev.payload);
  const rule = parsed ? await prisma.igAutomationRule.findFirst({ where: { id: parsed.ruleId, accountId: account.id } }) : null;
  if (!parsed || !rule) {
    await finish(ev.id, { status: "skipped", skipReason: "unknown_option" });
    return;
  }
  const option = readOptions(rule.dmOptions).find((o) => o.id === parsed.optionId);
  if (!option) {
    await finish(ev.id, { status: "skipped", skipReason: "option_removed", rule: { connect: { id: rule.id } } });
    return;
  }
  const current = await prisma.igAutomationEvent.findUniqueOrThrow({ where: { id: ev.id } });
  await prisma.igAutomationEvent.update({ where: { id: ev.id }, data: { ruleId: rule.id, text: option.title } });
  if (current.dmStatus !== null) {
    await finish(ev.id, { status: current.dmStatus === "failed" ? "failed" : "done" });
    return;
  }
  const token = decryptToken(account.accessTokenEnc);
  await prisma.igAutomationEvent.update({ where: { id: ev.id }, data: { dmText: option.text?.trim() || option.title } });
  try {
    const r = await sendOptionReply(token, pageId, ev.fromId!, buildOptionReply(option));
    await prisma.igAutomationEvent.update({ where: { id: ev.id }, data: { dmStatus: "sent", dmMessageId: r.messageId } });
    await finish(ev.id, { status: "done", skipReason: r.usedFallback ? "Instagram didn't accept the file; sent the link as text" : null });
    log("info", "postback.processed", { eventId: ev.id, ruleId: rule.id, option: option.id, igUserId });
  } catch (err) {
    if (err instanceof GraphError && err.kind === "auth") await markReauth(account, err.message);
    if (err instanceof GraphNetworkError || retryable(err)) throw err;
    await prisma.igAutomationEvent.update({ where: { id: ev.id }, data: { dmStatus: "failed", error: describe(err) } });
    await finish(ev.id, { status: "failed" });
  }
}

async function onDead(job: ShortsJobRow, message: string): Promise<void> {
  const eventId = (job.payload as { eventId?: string }).eventId;
  if (!eventId) return;
  await prisma.igAutomationEvent
    .updateMany({ where: { id: eventId, status: "pending" }, data: { status: "failed", error: `Gave up after retries: ${message}`.slice(0, 2000), processedAt: new Date() } })
    .catch(() => {});
}

/** Re-runs a failed event from the start of whatever wasn't sent. */
export async function retryEvent(eventId: string): Promise<void> {
  const ev = await prisma.igAutomationEvent.findUniqueOrThrow({ where: { id: eventId } });
  if (ev.status !== "failed" && ev.status !== "partial") throw new PermanentJobError("Only failed or partial events can be retried");
  await prisma.igAutomationEvent.update({
    where: { id: eventId },
    data: {
      status: "pending",
      error: null,
      processedAt: null,
      // Failed steps run again; sent/attempted steps are kept so nothing is posted twice.
      publicReplyStatus: ev.publicReplyStatus === "failed" ? null : ev.publicReplyStatus,
      dmStatus: ev.dmStatus === "failed" ? null : ev.dmStatus,
    },
  });
  await enqueueJob({ type: "ig_event", key: `ig:${eventId}:retry:${Date.now()}`, payload: { eventId }, maxAttempts: 5 });
}

export function registerIgAutomationHandlers(): void {
  registerJobHandler(
    "ig_event",
    async (job) => {
      const eventId = (job.payload as { eventId?: string }).eventId;
      if (!eventId) return;
      try {
        await processEvent(eventId);
      } finally {
        // A matched rule makes this person a CRM lead, whether or not the reply went out.
        await captureInstagramLead(eventId);
      }
    },
    onDead,
  );
}
