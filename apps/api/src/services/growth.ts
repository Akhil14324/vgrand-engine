import { prisma, type Prisma, type Strategy } from "@catgpt/db";
import {
  ATTENTION_METRIC_LIST,
  OUTCOME_METRIC_LIST,
  RESULT_METRIC_LABELS,
  applyRevisionFocus,
  buildInsights,
  comparabilityNotes,
  computeGuavaCompleteness,
  computeSuggestions,
  deriveGoals,
  diffPlans,
  kpiMetric,
  measurementGaps,
  parseTargetNumber,
  plannedEnd,
  strategyPlanSchema,
  type CampaignInsightsDto,
  type CampaignLearningDto,
  type CampaignSnapshot,
  type CampaignStatusDto,
  type GoalDto,
  type GrowthDashboardDto,
  type LearningSnapshot,
  type PlanChange,
  type ResultMetric,
  type ResultRow,
  type ResultSource,
  type RevisionDto,
  type RevisionFocus,
  type StrategyReview,
  type Suggestion,
  type SuggestionDto,
} from "@catgpt/types";
import { env } from "../env.js";
import { HttpError, badRequest, notFound } from "../lib/errors.js";
import { findAccessibleBrand } from "../lib/brand.js";
import { getClient } from "./chat.js";
import { loadEffectiveProfile } from "./guava-profile.js";
import { brandPeople, canManageBrand, loadManageableStrategy, loadStrategy, readPlan, sanitizePlan } from "./bcamp.js";
import { buildResultsSummary } from "./execution.js";

const DAY = 86_400_000;
const iso = (d: Date | null | undefined) => d?.toISOString() ?? null;
type Brand = Awaited<ReturnType<typeof findAccessibleBrand>>;

/* ------------------------------- data loading ------------------------------ */

async function toResultRows(rows: { id: string; metric: string; label: string | null; value: number; source: string; channel: string | null; deliverableId: string | null; sourceNote: string | null; periodStart: Date; periodEnd: Date; enteredById: string }[]): Promise<ResultRow[]> {
  const ids = [...new Set(rows.map((r) => r.enteredById))];
  const users = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } }) : [];
  const names = new Map(users.map((u) => [u.id, u.name || u.email]));
  return rows.map((r) => ({
    id: r.id,
    metric: r.metric,
    label: r.label,
    value: r.value,
    source: r.source as ResultSource,
    channel: r.channel,
    deliverableId: r.deliverableId,
    sourceNote: r.sourceNote,
    periodStart: r.periodStart.toISOString(),
    periodEnd: r.periodEnd.toISOString(),
    enteredBy: names.get(r.enteredById) ?? null,
  }));
}

interface Loaded {
  brand: Brand;
  strategies: Strategy[];
  dels: Awaited<ReturnType<typeof prisma.deliverable.findMany>>;
  tasks: Awaited<ReturnType<typeof prisma.execTask.findMany>>;
  results: Awaited<ReturnType<typeof prisma.campaignResult.findMany>>;
  posted: Map<string, Date>;
  reschedules: Map<string, number>;
  pendingRevisions: Set<string>;
  people: Map<string, string>;
}

async function load(brand: Brand): Promise<Loaded> {
  const strategies = await prisma.strategy.findMany({ where: { brandId: brand.id, status: { in: ["draft", "active", "completed"] } }, orderBy: { updatedAt: "desc" } });
  const ids = strategies.map((s) => s.id);
  const [dels, tasks, results, revs, people] = await Promise.all([
    prisma.deliverable.findMany({ where: { strategyId: { in: ids }, status: { not: "cancelled" } } }),
    prisma.execTask.findMany({ where: { strategyId: { in: ids }, status: { not: "cancelled" } } }),
    prisma.campaignResult.findMany({ where: { strategyId: { in: ids } }, orderBy: { periodEnd: "desc" } }),
    prisma.strategyRevision.findMany({ where: { strategyId: { in: ids }, status: "pending" }, select: { strategyId: true } }),
    brandPeople(brand.id),
  ]);
  const genIds = dels.map((d) => d.generationId).filter((g): g is string => !!g);
  const posts = genIds.length ? await prisma.socialPost.findMany({ where: { generationId: { in: genIds }, status: "posted" }, select: { generationId: true, postedAt: true } }) : [];
  const posted = new Map<string, Date>();
  for (const p of posts) if (p.postedAt && (!posted.has(p.generationId) || p.postedAt < posted.get(p.generationId)!)) posted.set(p.generationId, p.postedAt);
  const events = ids.length ? await prisma.execEvent.findMany({ where: { strategyId: { in: ids }, kind: "rescheduled" }, select: { deliverableId: true, taskId: true } }) : [];
  const reschedules = new Map<string, number>();
  for (const e of events) {
    const k = e.deliverableId ?? e.taskId;
    if (k) reschedules.set(k, (reschedules.get(k) ?? 0) + 1);
  }
  return { brand, strategies, dels, tasks, results, posted, reschedules, pendingRevisions: new Set(revs.map((r) => r.strategyId)), people: new Map(people.map((p) => [p.id, p.name])) };
}

function snapshotFor(s: Strategy, L: Loaded): CampaignSnapshot {
  const plan = readPlan(s.plan);
  const dels = L.dels.filter((d) => d.strategyId === s.id);
  const tasks = L.tasks.filter((t) => t.strategyId === s.id);
  const rows = L.results.filter((r) => r.strategyId === s.id);
  const publishedGens = new Set(dels.filter((d) => d.generationId && L.posted.has(d.generationId)).map((d) => d.id));
  return {
    id: s.id,
    title: s.title,
    status: s.status as CampaignSnapshot["status"],
    updatedAt: s.updatedAt.toISOString(),
    startsAt: iso(s.startsAt),
    endsAt: plannedEnd(plan, iso(s.startsAt)),
    convertedAt: iso(s.convertedAt),
    reviewedAt: iso(s.reviewedAt),
    spendApproved: plan.budget.spendApproved,
    hasTrackingMethod: !!plan.measurement.tracking.trim(),
    primaryMetric: kpiMetric(plan.measurement.primaryKpi),
    deliverables: dels.map((d) => ({
      id: d.id, title: d.title, status: d.status, dueAt: iso(d.dueAt), hasOwner: !!d.assigneeId,
      blockedReason: d.blockedReason, flagged: !!d.flaggedAt, reschedules: L.reschedules.get(d.id) ?? 0,
      submittedAt: iso(d.submittedAt), publishing: publishedGens.has(d.id) ? "published" : "",
    })),
    tasks: tasks.map((t) => ({
      id: t.id, title: t.title, status: t.status, dueAt: iso(t.dueAt), hasOwner: !!t.assigneeId,
      blockedReason: t.blockedReason, flagged: !!t.flaggedAt, reschedules: L.reschedules.get(t.id) ?? 0,
    })),
    recordedMetrics: [...new Set(rows.map((r) => r.metric))],
    spendRecorded: rows.some((r) => r.metric === "spend"),
    publishedCount: publishedGens.size,
    pendingRevision: L.pendingRevisions.has(s.id),
  };
}

/* --------------------------------- goals ---------------------------------- */

function buildGoals(values: Awaited<ReturnType<typeof loadEffectiveProfile>>["values"], L: Loaded): GoalDto[] {
  const active = L.strategies.filter((s) => s.status === "active");
  return deriveGoals(values).map((seed) => {
    const supporting = active.filter((s) => {
      if (!seed.metrics.length) return true;
      const m = kpiMetric(readPlan(s.plan).measurement.primaryKpi);
      return !!m && seed.metrics.includes(m);
    });
    const target = parseTargetNumber(seed.target);
    const metric = supporting.length && seed.metrics.length ? kpiMetric(readPlan(supporting[0]!.plan).measurement.primaryKpi) : null;
    let progress: GoalDto["progress"] = null;
    let note = "";
    if (!seed.metrics.length) note = "This goal is not a single number, so progress is not calculated. Check the campaigns that support it.";
    else if (!supporting.length) note = "No active campaign is measuring this yet.";
    else if (!target) note = "The target is not a single clear number, so progress is not calculated.";
    else if (metric) {
      const ids = new Set(supporting.map((s) => s.id));
      const recorded = L.results.filter((r) => ids.has(r.strategyId) && r.metric === metric && r.source !== "estimate").reduce((n, r) => n + r.value, 0);
      if (!recorded) note = `No ${RESULT_METRIC_LABELS[metric as ResultMetric].toLowerCase()} have been recorded yet, so progress is unknown.`;
      else {
        progress = {
          recorded, metric: RESULT_METRIC_LABELS[metric as ResultMetric], target, pct: Math.min(999, Math.round((recorded / target) * 100)), evidence: "calculated",
          note: "Adds up figures people entered for the supporting campaigns. It is not verified and does not show the campaigns caused it.",
        };
      }
    }
    return {
      key: seed.key, label: seed.label, target: seed.target,
      current: values.goals?.current?.trim() || null, timeline: values.goals?.timeline?.trim() || null,
      supportedBy: supporting.map((s) => ({ strategyId: s.id, title: s.title })), progress, note,
    };
  });
}

/* -------------------------------- suggestions ----------------------------- */

const CREATES_TASK = (key: string) => key.startsWith("tracking:") || key.startsWith("delay:");

async function suggestionsFor(brand: Brand, L: Loaded, goals: GoalDto[]) {
  const diagnosis = await prisma.guavaDiagnosis.findFirst({ where: { brandId: brand.id, status: "completed" }, select: { id: true } });
  const now = new Date();
  const computed: Suggestion[] = computeSuggestions({
    now: now.toISOString(),
    hasDiagnosis: !!diagnosis,
    goals: goals.map((g) => ({ key: g.key, label: g.label, target: g.target, supportedBy: g.supportedBy.length })),
    campaigns: L.strategies.map((s) => snapshotFor(s, L)),
  });
  const decisions = await prisma.suggestionDecision.findMany({ where: { brandId: brand.id } });
  const byKey = new Map(decisions.map((d) => [d.key, d]));
  const open: SuggestionDto[] = [];
  const handled: SuggestionDto[] = [];
  for (const s of computed) {
    const d = byKey.get(s.key);
    const base = { ...s, createsTask: CREATES_TASK(s.key) && !!s.strategyId };
    if (!d) open.push({ ...base, status: "open", deferUntil: null });
    else if (d.status === "dismissed") continue;
    else if (d.status === "deferred" && d.deferUntil && d.deferUntil <= now) open.push({ ...base, status: "open", deferUntil: null });
    else handled.push({ ...base, status: d.status as SuggestionDto["status"], deferUntil: iso(d.deferUntil) });
  }
  return { open, handled, computed };
}

export async function decideSuggestion(userId: string, brandId: string, body: { key: string; action: "accept" | "dismiss" | "defer"; deferDays?: number; note?: string }) {
  const brand = await findAccessibleBrand(userId, brandId);
  const L = await load(brand);
  const { values } = await loadEffectiveProfile(brand);
  const { computed } = await suggestionsFor(brand, L, buildGoals(values, L));
  const s = computed.find((c) => c.key === body.key);
  if (!s) throw notFound("That suggestion is no longer current");
  // Direction and approvals belong to the owner; team members can act on team-level items.
  if (s.actor === "owner" && !(await canManageBrand(userId, brandId))) throw new HttpError(403, "Only the business owner can decide on this");

  const status = body.action === "accept" ? "accepted" : body.action === "dismiss" ? "dismissed" : "deferred";
  const deferUntil = body.action === "defer" ? new Date(Date.now() + (body.deferDays ?? 7) * DAY) : null;
  await prisma.suggestionDecision.upsert({
    where: { brandId_key: { brandId, key: body.key } },
    create: { brandId, key: body.key, status, deferUntil, note: body.note ?? null, decidedById: userId },
    update: { status, deferUntil, note: body.note ?? null, decidedById: userId, decidedAt: new Date() },
  });

  let taskCreated = false;
  if (status === "accepted" && CREATES_TASK(s.key) && s.strategyId) {
    const strategy = L.strategies.find((x) => x.id === s.strategyId);
    if (strategy?.status === "active") {
      // Idempotent: one task per suggestion, however many times it is accepted.
      const existing = await prisma.execTask.findUnique({ where: { strategyId_dedupeKey: { strategyId: strategy.id, dedupeKey: `sugg:${s.key}` } }, select: { id: true } });
      if (!existing) {
        await prisma.execTask.create({
          data: {
            strategyId: strategy.id, brandId, dedupeKey: `sugg:${s.key}`, title: s.title,
            description: `${s.what}\n\nWhy: ${s.why}\nMeasure: ${s.measure}`,
            priority: s.category === "urgent" ? "high" : s.category === "important" ? "medium" : "low",
            dueAt: new Date(Date.now() + 3 * DAY), source: { suggestion: s.key } as Prisma.InputJsonValue, planVersion: strategy.version,
          },
        });
        await prisma.execEvent.create({ data: { strategyId: strategy.id, userId, kind: "created", note: `Task created from a suggested action: ${s.title}` } });
        taskCreated = true;
      }
    }
  }
  return { status, taskCreated };
}

/* -------------------------------- dashboard ------------------------------- */

export async function getGrowthDashboard(userId: string, brandId: string): Promise<GrowthDashboardDto> {
  const brand = await findAccessibleBrand(userId, brandId);
  const L = await load(brand);
  const { industry, values, skipped } = await loadEffectiveProfile(brand);
  const goals = buildGoals(values, L);
  const { open, handled } = await suggestionsFor(brand, L, goals);
  const now = Date.now();
  const active = L.strategies.filter((s) => s.status === "active");
  const titleOf = new Map(L.strategies.map((s) => [s.id, s.title]));

  const campaigns: CampaignStatusDto[] = active.map((s) => {
    const snap = snapshotFor(s, L);
    const open_ = (x: { status: string }) => !["done", "completed", "cancelled"].includes(x.status);
    const overdueT = snap.tasks.filter((t) => open_(t) && t.dueAt && now - Date.parse(t.dueAt) > DAY / 2).length;
    const outcome = snap.recordedMetrics.some((m) => OUTCOME_METRIC_LIST.includes(m));
    const attention = snap.recordedMetrics.some((m) => ATTENTION_METRIC_LIST.includes(m));
    return {
      id: s.id, title: s.title, status: snap.status,
      execution: {
        deliverables: { total: snap.deliverables.length, done: snap.deliverables.filter((d) => ["approved", "completed"].includes(d.status)).length, awaitingApproval: snap.deliverables.filter((d) => d.status === "awaiting_approval").length },
        tasks: { total: snap.tasks.length, done: snap.tasks.filter((t) => t.status === "done").length, overdue: overdueT, blocked: snap.tasks.filter((t) => t.status === "blocked").length },
        published: snap.publishedCount,
      },
      outcomes: { state: outcome ? "tracked" : attention ? "attention_only" : "none", recorded: snap.recordedMetrics },
      endsAt: snap.endsAt,
      blockers: snap.tasks.filter((t) => t.status === "blocked" || t.flagged).length + snap.deliverables.filter((d) => d.flagged || d.blockedReason).length,
      pendingRevision: snap.pendingRevision,
    };
  });

  const activeIds = new Set(active.map((s) => s.id));
  const openItem = (x: { status: string }) => !["done", "completed", "cancelled"].includes(x.status);
  const deadlines = [
    ...L.tasks.filter((t) => activeIds.has(t.strategyId) && openItem(t) && t.dueAt).map((t) => ({ kind: "task" as const, id: t.id, title: t.title, due: t.dueAt!, strategyId: t.strategyId, owner: t.assigneeId })),
    ...L.dels.filter((d) => activeIds.has(d.strategyId) && openItem(d) && d.status !== "approved" && d.dueAt).map((d) => ({ kind: "deliverable" as const, id: d.id, title: d.title, due: d.dueAt!, strategyId: d.strategyId, owner: d.assigneeId })),
  ]
    .filter((x) => x.due.getTime() < now + 14 * DAY)
    .sort((a, b) => a.due.getTime() - b.due.getTime())
    .slice(0, 10)
    .map((x) => ({ kind: x.kind, id: x.id, title: x.title, dueAt: x.due.toISOString(), overdue: now - x.due.getTime() > DAY / 2, strategyId: x.strategyId, strategyTitle: titleOf.get(x.strategyId) ?? "", owner: x.owner ? (L.people.get(x.owner) ?? null) : null }));

  const blockers: GrowthDashboardDto["blockers"] = [
    ...L.tasks.filter((t) => activeIds.has(t.strategyId) && (t.status === "blocked" || t.flaggedAt)).map((t) => ({ kind: "task" as const, id: t.id, title: t.title, reason: t.blockedReason ?? "Flagged for review", strategyId: t.strategyId, strategyTitle: titleOf.get(t.strategyId) ?? "", flagged: !!t.flaggedAt })),
    ...L.dels.filter((d) => activeIds.has(d.strategyId) && (d.flaggedAt || d.blockedReason)).map((d) => ({ kind: "deliverable" as const, id: d.id, title: d.title, reason: d.blockedReason ?? "Flagged for review", strategyId: d.strategyId, strategyTitle: titleOf.get(d.strategyId) ?? "", flagged: !!d.flaggedAt })),
  ].slice(0, 8);

  const recentRows = await toResultRows(L.results.slice().sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, 6));
  const recentResults = recentRows.map((r, i) => ({ ...r, strategyId: L.results.slice().sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[i]!.strategyId, strategyTitle: "" }));
  for (const r of recentResults) r.strategyTitle = titleOf.get(r.strategyId) ?? "";

  // What moved since the last review (or the last two weeks).
  const lastReview = L.strategies.map((s) => s.reviewedAt?.getTime() ?? 0).reduce((a, b) => Math.max(a, b), 0);
  const since = new Date(lastReview || now - 14 * DAY);
  const ids = L.strategies.map((s) => s.id);
  const [versions, events] = await Promise.all([
    prisma.strategyVersion.findMany({ where: { strategyId: { in: ids }, createdAt: { gt: since }, version: { gt: 1 } }, select: { strategyId: true, version: true, label: true, createdAt: true } }),
    prisma.execEvent.findMany({ where: { strategyId: { in: ids }, createdAt: { gt: since }, kind: { in: ["approved", "manual_complete", "flagged", "rescheduled"] } }, orderBy: { createdAt: "desc" }, take: 30 }),
  ]);
  const items: GrowthDashboardDto["changes"]["items"] = [];
  const newResults = L.results.filter((r) => r.createdAt > since);
  if (newResults.length) items.push({ text: `${newResults.length} result(s) recorded`, at: newResults[0]!.createdAt.toISOString(), strategyId: null });
  for (const [gen, at] of L.posted) if (at > since) { const d = L.dels.find((x) => x.generationId === gen); items.push({ text: `Published: ${d?.title ?? "a post"}`, at: at.toISOString(), strategyId: d?.strategyId ?? null }); }
  for (const v of versions) items.push({ text: `Plan updated to version ${v.version}${v.label ? ` (${v.label})` : ""} - ${titleOf.get(v.strategyId) ?? ""}`, at: v.createdAt.toISOString(), strategyId: v.strategyId });
  const verb: Record<string, string> = { approved: "Approved", manual_complete: "Marked done by hand", flagged: "Flagged for review", rescheduled: "Deadline moved" };
  for (const e of events) items.push({ text: `${verb[e.kind]}${e.note ? `: ${e.note}` : ""}`, at: e.createdAt.toISOString(), strategyId: e.strategyId });
  items.sort((a, b) => b.at.localeCompare(a.at));

  // What stops reliable conclusions.
  const missing: GrowthDashboardDto["missing"] = [];
  const completeness = computeGuavaCompleteness(values, industry, skipped);
  for (const m of completeness.missing.slice(0, 3)) missing.push({ text: `Business profile: ${m.label} is not filled in.`, link: "/guava" });
  for (const s of active) {
    const plan = readPlan(s.plan);
    const rows = await toResultRows(L.results.filter((r) => r.strategyId === s.id));
    const { gaps } = measurementGaps(plan, rows);
    for (const g of gaps.slice(0, 2).filter((x) => !x.startsWith("Likes, views"))) missing.push({ text: `${s.title}: ${g}`, link: `/bcamp?strategy=${s.id}&tab=insights` });
  }

  const learnings = await prisma.campaignLearning.count({ where: { brandId } });
  return {
    brandId, brandName: brand.name, industry, canManage: await canManageBrand(userId, brandId),
    goals, campaigns, deadlines, blockers, recentResults,
    changes: { since: since.toISOString(), items: items.slice(0, 8) },
    missing: missing.slice(0, 8), suggestions: open.slice(0, 12), handled: handled.slice(0, 8), learnings: { count: learnings },
  };
}

/* ---------------------------------- insights ------------------------------- */

async function insightsFor(strategy: Strategy): Promise<CampaignInsightsDto> {
  const plan = readPlan(strategy.plan);
  const [dels, tasks, results] = await Promise.all([
    prisma.deliverable.findMany({ where: { strategyId: strategy.id, status: { not: "cancelled" } } }),
    prisma.execTask.findMany({ where: { strategyId: strategy.id, status: { not: "cancelled" } }, select: { status: true } }),
    prisma.campaignResult.findMany({ where: { strategyId: strategy.id }, orderBy: { periodEnd: "desc" } }),
  ]);
  const genIds = dels.map((d) => d.generationId).filter((g): g is string => !!g);
  const posts = genIds.length ? await prisma.socialPost.findMany({ where: { generationId: { in: genIds }, status: "posted" }, select: { generationId: true, postedAt: true } }) : [];
  const postedAt = new Map<string, Date>();
  for (const p of posts) if (p.postedAt && (!postedAt.has(p.generationId) || p.postedAt < postedAt.get(p.generationId)!)) postedAt.set(p.generationId, p.postedAt);

  const body = buildInsights({
    plan, startsAt: iso(strategy.startsAt), now: new Date().toISOString(),
    deliverables: dels.map((d) => {
      const pub = d.generationId ? postedAt.get(d.generationId) : undefined;
      const finished = pub ?? (d.status === "completed" ? d.completedAt : d.status === "approved" ? d.decidedAt : null);
      return { status: d.status, dueAt: iso(d.dueAt), finishedAt: iso(finished ?? null), publishing: pub ? "published" : "" };
    }),
    taskCounts: { total: tasks.length, done: tasks.filter((t) => t.status === "done").length },
    results: await toResultRows(results),
  });
  return { strategyId: strategy.id, title: strategy.title, ...body };
}

export async function getCampaignInsights(userId: string, strategyId: string) {
  const { strategy } = await loadStrategy(userId, strategyId);
  return insightsFor(strategy);
}

/* -------------------------------- learnings ------------------------------- */

const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

async function snapshotLearning(strategy: Strategy): Promise<LearningSnapshot> {
  const plan = readPlan(strategy.plan);
  const insights = await insightsFor(strategy);
  const results = await prisma.campaignResult.findMany({ where: { strategyId: strategy.id } });
  const outcomeRows = results.filter((r) => OUTCOME_METRIC_LIST.includes(r.metric));
  const review = strategy.review as StrategyReview | null;
  const starts = results.length ? Math.min(...results.map((r) => r.periodStart.getTime())) : null;
  const ends = results.length ? Math.max(...results.map((r) => r.periodEnd.getTime())) : null;
  const sources = [...new Set(results.map((r) => r.source))];
  return {
    objective: plan.objective.outcome,
    metric: plan.objective.metric || plan.measurement.primaryKpi,
    audience: plan.audience.who,
    location: plan.audience.location,
    offer: plan.offer.promoting,
    message: plan.offer.message,
    channels: plan.channels.map((c) => c.channel).filter(Boolean),
    formats: [...new Set(plan.deliverables.map((d) => d.format || d.type).filter(Boolean))],
    execution: { deliverablesPlanned: insights.execution.planned, approvedOrDone: insights.execution.approvedOrDone, published: insights.execution.published, tasksDone: insights.execution.tasksDone, tasksTotal: insights.execution.tasksTotal },
    outcomes: insights.metrics.map((m) => ({ metric: m.metric, label: m.label, values: m.values.map((v) => ({ source: v.source, value: v.value })) })),
    dataSources: sources.map((s) => (s === "observed" ? "Observed by platform" : s === "user_entered" ? "Entered by a person" : "Estimate")),
    period: { start: starts ? new Date(starts).toISOString() : null, end: ends ? new Date(ends).toISOString() : null },
    review: review ? { supported: strs(review.supported), unknown: strs(review.unknown), keep: strs(review.keep), stop: strs(review.stop), change: strs(review.change), nextTest: strs(review.nextTest) } : null,
    comparability: comparabilityNotes({
      outcomeRows: outcomeRows.length, outcomeKinds: new Set(outcomeRows.map((r) => r.metric)).size,
      windowDays: starts && ends ? Math.round((ends - starts) / DAY) : null, hasTracking: !!plan.measurement.tracking.trim(),
      published: insights.execution.published, sources, reviewed: !!review,
    }),
    planVersion: strategy.version,
  };
}

const toLearningDto = (l: { id: string; strategyId: string; snapshot: unknown; nextStep: string | null; updatedAt: Date; strategy: { title: string; status: string } }): CampaignLearningDto => ({
  id: l.id, strategyId: l.strategyId, title: l.strategy.title, status: l.strategy.status as CampaignLearningDto["status"],
  snapshot: l.snapshot as LearningSnapshot, nextStep: l.nextStep, updatedAt: l.updatedAt.toISOString(),
});

/** Save what this campaign taught the business. Re-recording updates the same entry. */
export async function recordLearning(userId: string, strategyId: string, nextStep?: string) {
  const { strategy } = await loadManageableStrategy(userId, strategyId);
  if (strategy.status === "draft") throw badRequest("A draft has nothing to learn from yet. Approve and run it first.");
  const snapshot = (await snapshotLearning(strategy)) as unknown as Prisma.InputJsonValue;
  const row = await prisma.campaignLearning.upsert({
    where: { strategyId },
    create: { brandId: strategy.brandId, strategyId, snapshot, nextStep: nextStep ?? null, createdById: userId },
    update: { snapshot, ...(nextStep !== undefined ? { nextStep } : {}) },
    include: { strategy: { select: { title: true, status: true } } },
  });
  return toLearningDto(row);
}

export async function getLearning(userId: string, strategyId: string) {
  await loadStrategy(userId, strategyId);
  const row = await prisma.campaignLearning.findUnique({ where: { strategyId }, include: { strategy: { select: { title: true, status: true } } } });
  return row ? toLearningDto(row) : null;
}

export async function listLearnings(userId: string, brandId: string) {
  await findAccessibleBrand(userId, brandId);
  const rows = await prisma.campaignLearning.findMany({ where: { brandId }, orderBy: { updatedAt: "desc" }, take: 30, include: { strategy: { select: { title: true, status: true } } } });
  return { items: rows.map(toLearningDto) };
}

/**
 * Prior campaigns of THIS business, phrased as cautious context for a new plan.
 * Scoped by brand only; nothing from another business can appear here.
 */
export async function learningsPrompt(brandId: string): Promise<{ text: string; used: { id: string; title: string }[] }> {
  const rows = await prisma.campaignLearning.findMany({ where: { brandId }, orderBy: { updatedAt: "desc" }, take: 5, include: { strategy: { select: { title: true } } } });
  if (!rows.length) return { text: "", used: [] };
  const lines = rows.map((r) => {
    const s = r.snapshot as unknown as LearningSnapshot;
    const outcomes = s.outcomes.map((o) => `${o.label}: ${o.values.map((v) => `${v.value} (${v.source})`).join(" / ")}`).join("; ") || "none recorded";
    return [
      `## ${r.strategy.title}`,
      `Objective: ${s.objective}. Audience: ${s.audience || "n/a"}. Offer: ${s.offer || "n/a"}. Channels: ${s.channels.join(", ") || "n/a"}. Formats: ${s.formats.join(", ") || "n/a"}.`,
      `Executed: ${s.execution.approvedOrDone}/${s.execution.deliverablesPlanned} deliverables approved or done, ${s.execution.published} published.`,
      `Recorded outcomes: ${outcomes}.`,
      s.review ? `Review: unknown - ${s.review.unknown.slice(0, 2).join(" | ")}; keep - ${s.review.keep.join(" | ")}; change - ${s.review.change.join(" | ")}` : "No review written.",
      `Limits: ${s.comparability.slice(0, 3).join(" ")}`,
      r.nextStep ? `The owner decided to try next: ${r.nextStep}` : "",
    ].filter(Boolean).join("\n");
  });
  return {
    text: `\n# Previous campaigns for this business (evidence about this one business, not rules)\n${lines.join("\n\n")}`,
    used: rows.map((r) => ({ id: r.id, title: r.strategy.title })),
  };
}

/* -------------------------------- revisions ------------------------------- */

const REVISE_SYSTEM = `You propose a revision to an existing marketing campaign plan, using what actually happened.

RULES
- Only change the parts named in "Revise these parts". Keep everything else identical.
- Base changes on the recorded evidence given. Where evidence is thin or missing, say so in "rationale" and prefer small tests over big changes.
- Never invent results, audience sizes, prices or competitor facts. Never treat one campaign as proof of a general rule.
- Keep the "key" of every deliverable and task unchanged where the item stays.
- Never approve spend. Do not change budget approval.
- Plain language.

Return ONE JSON object: { "rationale": "why these changes, and how sure we are", "plan": <the FULL plan in the same shape as the current plan> }`;

const toRevisionDto = (r: { id: string; strategyId: string; baseVersion: number; rationale: string; focus: string[]; changes: unknown; status: string; createdAt: Date; createdById: string; decidedAt: Date | null; decisionNote: string | null }, currentVersion: number, names: Map<string, string>): RevisionDto => ({
  id: r.id, strategyId: r.strategyId, baseVersion: r.baseVersion, currentVersion, stale: r.status === "pending" && r.baseVersion !== currentVersion,
  rationale: r.rationale, focus: r.focus as RevisionFocus[], changes: r.changes as PlanChange[], status: r.status as RevisionDto["status"],
  createdAt: r.createdAt.toISOString(), createdBy: names.get(r.createdById) ?? null, decidedAt: iso(r.decidedAt), decisionNote: r.decisionNote,
});

export async function listRevisions(userId: string, strategyId: string) {
  const { strategy } = await loadStrategy(userId, strategyId);
  const [rows, people] = await Promise.all([
    prisma.strategyRevision.findMany({ where: { strategyId }, orderBy: { createdAt: "desc" }, take: 8 }),
    brandPeople(strategy.brandId),
  ]);
  const names = new Map(people.map((p) => [p.id, p.name]));
  return { items: rows.map((r) => toRevisionDto(r, strategy.version, names)), currentPlan: readPlan(strategy.plan) };
}

export async function proposeRevision(userId: string, strategyId: string, focus: RevisionFocus[], note?: string) {
  const { strategy } = await loadManageableStrategy(userId, strategyId);
  if (strategy.status === "archived" || strategy.status === "draft") throw badRequest("Revisions are for approved or completed campaigns. Edit a draft directly.");
  const current = readPlan(strategy.plan);
  const summary = await buildResultsSummary(strategy);
  const prior = await learningsPrompt(strategy.brandId);
  const review = strategy.review as StrategyReview | null;
  const flagged = [
    ...(await prisma.deliverable.findMany({ where: { strategyId, flaggedAt: { not: null } }, select: { title: true, blockedReason: true } })),
    ...(await prisma.execTask.findMany({ where: { strategyId, flaggedAt: { not: null } }, select: { title: true, blockedReason: true } })),
  ];
  const user = [
    `Revise these parts: ${focus.join(", ")}`,
    note ? `Owner's note: ${note}` : "",
    `\n# Current plan (version ${strategy.version})\n${JSON.stringify(current)}`,
    `\n# Execution (recorded by the platform)\n${JSON.stringify(summary.execution)}`,
    `\n# Recorded results (source shown)\n${JSON.stringify(summary.results.map((r) => ({ metric: r.metric === "other" ? (r.label ?? "other") : r.metric, value: r.value, source: r.source, note: r.sourceNote, from: r.periodStart.slice(0, 10), to: r.periodEnd.slice(0, 10) })))}`,
    `\n# Known gaps\n${summary.gaps.join(" ")}`,
    review ? `\n# Earlier review (AI interpretation)\n${JSON.stringify({ conclusions: review.conclusions, unknown: review.unknown, keep: review.keep, stop: review.stop, change: review.change, nextTest: review.nextTest })}` : "",
    flagged.length ? `\n# Blockers flagged by the team\n${flagged.map((f) => `${f.title}: ${f.blockedReason ?? ""}`).join("; ")}` : "",
    prior.text,
  ].filter(Boolean).join("\n");

  let json: Record<string, unknown>;
  try {
    const res = await getClient().chat.completions.create({
      model: env.CHAT_MODEL,
      response_format: { type: "json_object" },
      messages: [{ role: "system", content: `${REVISE_SYSTEM}` }, { role: "user", content: user }],
    });
    json = JSON.parse(res.choices[0]?.message.content?.trim() || "{}") as Record<string, unknown>;
  } catch (err) {
    console.error("[growth] revision failed", err instanceof Error ? err.message : err);
    throw new HttpError(502, "Could not draft a revision right now - please try again");
  }
  const parsed = strategyPlanSchema.safeParse(json.plan);
  if (!parsed.success) throw new HttpError(502, "Could not draft a revision right now - please try again");
  // Only the requested parts are taken, and spend approval can never change.
  const proposed = applyRevisionFocus(current, sanitizePlan(parsed.data, note ?? "", current), focus);
  proposed.budget.spendApproved = current.budget.spendApproved;
  const changes = diffPlans(current, proposed);
  if (!changes.length) throw badRequest("The assistant found nothing it would change in those parts, given the evidence so far.");

  await prisma.strategyRevision.updateMany({ where: { strategyId, status: "pending" }, data: { status: "superseded" } });
  const row = await prisma.strategyRevision.create({
    data: { strategyId, baseVersion: strategy.version, proposedPlan: proposed as unknown as Prisma.InputJsonValue, rationale: typeof json.rationale === "string" ? json.rationale : "", changes: changes as unknown as Prisma.InputJsonValue, focus, createdById: userId },
  });
  const people = await brandPeople(strategy.brandId);
  return toRevisionDto(row, strategy.version, new Map(people.map((p) => [p.id, p.name])));
}

/**
 * Approving replaces the plan with a NEW version (the old one is kept). Existing
 * work is not touched: the Work tab then shows which items differ from the plan,
 * and the owner applies or keeps each one.
 */
export async function decideRevision(userId: string, revisionId: string, action: "approve" | "reject", note?: string) {
  const rev = await prisma.strategyRevision.findUnique({ where: { id: revisionId } });
  if (!rev) throw notFound("Revision not found");
  const { strategy } = await loadManageableStrategy(userId, rev.strategyId);
  if (rev.status !== "pending") throw badRequest("This revision has already been decided");

  if (action === "reject") {
    await prisma.strategyRevision.update({ where: { id: revisionId }, data: { status: "rejected", decidedById: userId, decidedAt: new Date(), decisionNote: note ?? null } });
    return { status: "rejected" as const, version: strategy.version };
  }
  if (rev.baseVersion !== strategy.version) {
    throw new HttpError(409, "The plan changed after this was proposed. Ask for a fresh revision.", "stale_revision");
  }
  const res = await prisma.strategy.updateMany({ where: { id: strategy.id, version: strategy.version }, data: { plan: rev.proposedPlan as Prisma.InputJsonValue, version: { increment: 1 } } });
  if (res.count === 0) throw new HttpError(409, "The plan changed while you were deciding. Ask for a fresh revision.", "stale_revision");
  await prisma.strategyVersion.create({ data: { strategyId: strategy.id, version: strategy.version + 1, plan: rev.proposedPlan as Prisma.InputJsonValue, label: "Approved revision", createdById: userId } });
  await prisma.strategyRevision.update({ where: { id: revisionId }, data: { status: "approved", decidedById: userId, decidedAt: new Date(), decisionNote: note ?? null } });
  return { status: "approved" as const, version: strategy.version + 1 };
}

