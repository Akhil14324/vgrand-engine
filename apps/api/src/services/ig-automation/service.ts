import { Prisma, prisma, type SocialAccount } from "@catgpt/db";
import { randomUUID } from "node:crypto";
import type { IgAccountDto, IgAccountStatusDto, IgEventDto, IgOption, IgRuleDto, IgRuleInput, IgRuleStatsDto, IgSearchDto, IgSearchQuery, IgTestResultDto } from "@catgpt/types";
import { env } from "../../env.js";
import { badRequest, notFound } from "../../lib/errors.js";
import { decryptToken } from "../../lib/social-crypto.js";
import { workspaceAccess } from "../../lib/workspace-access.js";
import { findUsableAccount } from "../social/accounts.js";
import { grantedScopes, pageSubscription } from "./graph.js";
import { missingPermissions, pickRule, pickVariant, planCommentActions, readOptions, renderTemplate, ruleProblems } from "./logic.js";
import { searchEvents } from "./search-logic.js";

export type RuleRow = Prisma.IgAutomationRuleGetPayload<object>;

export const webhookCallbackUrl = () => `${env.API_PUBLIC_URL.replace(/\/+$/, "")}/webhooks/meta`;

/** Instagram accounts the user can use (own personal ones + workspaces they belong to). */
export async function listIgAccounts(userId: string): Promise<IgAccountDto[]> {
  const accounts = await prisma.socialAccount.findMany({
    where: { platform: "instagram", OR: [{ userId, workspaceId: null }, { workspace: workspaceAccess(userId) }] },
    orderBy: { createdAt: "asc" },
  });
  const ids = accounts.map((a) => a.id);
  const [ruleCounts, lastEvents] = await Promise.all([
    prisma.igAutomationRule.groupBy({ by: ["accountId", "active"], where: { accountId: { in: ids } }, _count: { _all: true } }),
    prisma.igAutomationEvent.groupBy({ by: ["accountId"], where: { accountId: { in: ids } }, _max: { createdAt: true } }),
  ]);
  return accounts.map((a) => ({
    id: a.id,
    handle: a.handle,
    displayName: a.displayName,
    avatarUrl: a.avatarUrl,
    status: a.status,
    workspaceId: a.workspaceId,
    rules: ruleCounts.filter((r) => r.accountId === a.id).reduce((n, r) => n + r._count._all, 0),
    activeRules: ruleCounts.filter((r) => r.accountId === a.id && r.active).reduce((n, r) => n + r._count._all, 0),
    lastEventAt: lastEvents.find((l) => l.accountId === a.id)?._max.createdAt?.toISOString() ?? null,
  }));
}

/** Access check: the account must be usable by this user AND be an Instagram account. */
export async function ownedIgAccount(userId: string, accountId: string): Promise<SocialAccount> {
  const a = await findUsableAccount(userId, accountId);
  if (a.platform !== "instagram") throw notFound("Instagram account not found");
  return a;
}

export async function ownedRule(userId: string, ruleId: string): Promise<RuleRow> {
  const r = await prisma.igAutomationRule.findUnique({ where: { id: ruleId } });
  if (!r) throw notFound("Rule not found");
  await ownedIgAccount(userId, r.accountId);
  return r;
}

const emptyStats = (): IgRuleStatsDto => ({ triggered: 0, done: 0, partial: 0, failed: 0, skipped: 0, publicReplies: 0, dms: 0 });

export async function listRules(accountId: string): Promise<IgRuleDto[]> {
  const rules = await prisma.igAutomationRule.findMany({ where: { accountId }, orderBy: [{ priority: "asc" }, { createdAt: "asc" }] });
  const ids = rules.map((r) => r.id);
  const [byStatus, pub, dm] = await Promise.all([
    prisma.igAutomationEvent.groupBy({ by: ["ruleId", "status"], where: { ruleId: { in: ids } }, _count: { _all: true } }),
    prisma.igAutomationEvent.groupBy({ by: ["ruleId"], where: { ruleId: { in: ids }, publicReplyStatus: "sent" }, _count: { _all: true } }),
    prisma.igAutomationEvent.groupBy({ by: ["ruleId"], where: { ruleId: { in: ids }, dmStatus: "sent" }, _count: { _all: true } }),
  ]);
  return rules.map((r) => {
    const s = emptyStats();
    for (const g of byStatus.filter((x) => x.ruleId === r.id)) {
      s.triggered += g._count._all;
      if (g.status in s) (s as unknown as Record<string, number>)[g.status] = g._count._all;
    }
    s.publicReplies = pub.find((x) => x.ruleId === r.id)?._count._all ?? 0;
    s.dms = dm.find((x) => x.ruleId === r.id)?._count._all ?? 0;
    return toRuleDto(r, s);
  });
}

export function toRuleDto(r: RuleRow, stats: IgRuleStatsDto = emptyStats()): IgRuleDto {
  return {
    id: r.id,
    accountId: r.accountId,
    name: r.name,
    active: r.active,
    trigger: r.trigger as IgRuleDto["trigger"],
    matchMode: r.matchMode as IgRuleDto["matchMode"],
    keywords: r.keywords,
    mediaScope: r.mediaScope as IgRuleDto["mediaScope"],
    mediaIds: r.mediaIds,
    publicReplies: r.publicReplies,
    dmText: r.dmText,
    dmButtonTitle: r.dmButtonTitle,
    dmButtonUrl: r.dmButtonUrl,
    dmOptions: readOptions(r.dmOptions).map((o) => ({ id: o.id, title: o.title, kind: o.kind as IgOption["kind"], url: o.url, text: o.text })),
    oncePerUser: r.oncePerUser,
    priority: r.priority,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    stats,
    problems: ruleProblems({ ...r, dmOptions: readOptions(r.dmOptions) }),
  };
}

/** Normalises and validates a rule before saving. DM rules never keep post scope or public replies. */
export function prepareRule(input: IgRuleInput) {
  // Each option keeps a stable id: it is inside the buttons already sent, so editing a title must not break them.
  const dmOptions = input.dmOptions.map((o) => ({ ...o, id: o.id || randomUUID().replace(/-/g, "").slice(0, 8), text: o.text?.trim() || null }));
  const data = {
    ...input,
    dmOptions,
    dmText: input.dmText?.trim() ? input.dmText.trim() : null,
    dmButtonTitle: input.dmButtonTitle?.trim() || null,
    dmButtonUrl: input.dmButtonUrl?.trim() || null,
    mediaScope: input.trigger === "dm" ? "all" : input.mediaScope,
    mediaIds: input.trigger === "dm" || input.mediaScope === "all" ? [] : [...new Set(input.mediaIds)],
    keywords: input.matchMode === "any" ? [] : [...new Set(input.keywords)],
  };
  const problems = ruleProblems(data);
  if (problems.length) throw badRequest(problems.join(". "));
  return data;
}

export function toEventDto(e: Prisma.IgAutomationEventGetPayload<{ include: { rule: { select: { name: true } } } }>): IgEventDto {
  return {
    id: e.id,
    kind: e.kind as IgEventDto["kind"],
    ruleId: e.ruleId,
    ruleName: e.rule?.name ?? null,
    mediaId: e.mediaId,
    fromUsername: e.fromUsername,
    fromId: e.fromId,
    text: e.text,
    occurredAt: e.occurredAt.toISOString(),
    status: e.status,
    skipReason: e.skipReason,
    publicReplyStatus: e.publicReplyStatus,
    publicReplyText: e.publicReplyText,
    dmStatus: e.dmStatus,
    dmText: e.dmText,
    error: e.error,
    processedAt: e.processedAt?.toISOString() ?? null,
  };
}

export async function listEvents(accountId: string, q: { ruleId?: string; status?: string; limit: number }): Promise<IgEventDto[]> {
  const rows = await prisma.igAutomationEvent.findMany({
    where: { accountId, ...(q.ruleId ? { ruleId: q.ruleId } : {}), ...(q.status ? { status: q.status } : {}) },
    orderBy: { createdAt: "desc" },
    take: q.limit,
    include: { rule: { select: { name: true } } },
  });
  return rows.map(toEventDto);
}

/** How far back the comment search looks. */
export const SEARCH_SCAN_LIMIT = 5000;

/** Search over the account's stored comments and DMs (our own replies and button taps left out). */
export async function searchAccountEvents(account: SocialAccount, query: IgSearchQuery): Promise<IgSearchDto> {
  const [rows, rules] = await Promise.all([
    prisma.igAutomationEvent.findMany({
      where: { accountId: account.id, kind: { in: ["comment", "message"] }, OR: [{ fromId: null }, { fromId: { not: account.externalAccountId } }] },
      orderBy: { occurredAt: "desc" },
      take: SEARCH_SCAN_LIMIT + 1,
      select: { id: true, kind: true, fromId: true, fromUsername: true, text: true, occurredAt: true, status: true },
    }),
    // Keywords of paused rules count too: they are still "ours".
    prisma.igAutomationRule.findMany({ where: { accountId: account.id }, select: { matchMode: true, keywords: true } }),
  ]);
  const keywords = rules.filter((r) => r.matchMode !== "any").flatMap((r) => r.keywords);
  return { ...searchEvents(rows.slice(0, SEARCH_SCAN_LIMIT), keywords, query), truncated: rows.length > SEARCH_SCAN_LIMIT };
}

/** Everything that must be true for automations to run on this account, checked live against Meta. */
export async function accountStatus(account: SocialAccount): Promise<IgAccountStatusDto> {
  const pageId = ((account.metadata ?? {}) as { pageId?: string }).pageId ?? null;
  const token = decryptToken(account.accessTokenEnc);
  const out: IgAccountStatusDto = {
    accountId: account.id,
    webhook: { callbackUrl: webhookCallbackUrl(), verifyTokenSet: !!env.META_WEBHOOK_VERIFY_TOKEN, appSecretSet: !!env.META_APP_SECRET },
    permissions: { checked: false, valid: null, granted: [], missing: [], error: null },
    subscription: { checked: false, subscribed: null, fields: [], error: null },
    lastEventAt: null,
    ready: false,
  };
  try {
    const g = await grantedScopes(token);
    out.permissions = { checked: true, valid: g.valid, granted: g.scopes.sort(), missing: missingPermissions(g.scopes), error: null };
  } catch (err) {
    out.permissions.error = err instanceof Error ? err.message : String(err);
  }
  if (pageId) {
    try {
      const s = await pageSubscription(token, pageId);
      out.subscription = { checked: true, subscribed: s.subscribed, fields: s.fields, error: null };
    } catch (err) {
      out.subscription.error = err instanceof Error ? err.message : String(err);
    }
  } else {
    out.subscription.error = "This account has no linked Facebook Page id; reconnect it.";
  }
  const last = await prisma.igAutomationEvent.findFirst({ where: { accountId: account.id }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
  out.lastEventAt = last?.createdAt.toISOString() ?? null;
  out.ready =
    account.status === "active" &&
    out.webhook.verifyTokenSet &&
    out.webhook.appSecretSet &&
    out.permissions.valid === true &&
    out.permissions.missing.length === 0 &&
    out.subscription.subscribed === true;
  return out;
}

/** Dry run: which rule a comment/DM would hit and exactly what would be sent. Sends nothing. */
export async function testRules(accountId: string, input: { trigger: "comment" | "dm"; text: string; mediaId: string | null; username: string | null }): Promise<IgTestResultDto> {
  const rules = await prisma.igAutomationRule.findMany({ where: { accountId, active: true } });
  const rule = pickRule(rules, input);
  if (!rule) return { matched: false, ruleId: null, ruleName: null, publicReply: null, publicReplyNote: null, dm: null };
  const plan =
    input.trigger === "comment"
      ? planCommentActions({ ev: { parentId: null, live: false, occurredAt: new Date() }, rule })
      : { publicReply: false, publicReplyNote: null, dm: !!rule.dmText?.trim(), dmNote: null };
  const variant = pickVariant(rule.publicReplies, `test:${input.text}`);
  return {
    matched: true,
    ruleId: rule.id,
    ruleName: rule.name,
    publicReply: plan.publicReply && variant ? renderTemplate(variant, { username: input.username }) : null,
    publicReplyNote: plan.publicReplyNote,
    dm: plan.dm
      ? {
          text: renderTemplate(rule.dmText ?? "", { username: input.username }),
          buttonTitle: rule.dmButtonTitle,
          buttonUrl: rule.dmButtonUrl,
          options: readOptions(rule.dmOptions).map((o) => o.title),
        }
      : null,
  };
}
