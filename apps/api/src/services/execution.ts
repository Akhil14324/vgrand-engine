import { prisma, type Deliverable, type ExecEvent, type ExecTask, type Prisma, type Strategy } from "@catgpt/db";
import {
  DELIVERABLE_STATUS_LABELS,
  DELIVERABLE_STATUSES,
  measurementGaps,
  summarizeResults,
  type CreateResultRequest,
  type DeliverableDto,
  type DeliverableStatus,
  type DeliverableType,
  type ExecEventDto,
  type ExecTaskDto,
  type ExecutionDashboardDto,
  type PersonDto,
  type PublishingState,
  type ResultRow,
  type ResultSource,
  type ResultsSummaryDto,
  type StrategyStatus,
} from "@catgpt/types";
import { HttpError, badRequest, notFound } from "../lib/errors.js";
import { findAccessibleBrand } from "../lib/brand.js";
import { assertAssignee, brandPeople, canManageBrand, readPlan } from "./bcamp.js";
import { buildContentPrompt, canGenerateFor, derivePublishing, manualSteps, type AccountFact } from "./execution-logic.js";

const DAY = 86_400_000;
const iso = (d: Date | null | undefined) => d?.toISOString() ?? null;

/* --------------------------------- results -------------------------------- */

/** Planned vs actual for one strategy, built only from recorded rows. */
export async function buildResultsSummary(strategy: Pick<Strategy, "id" | "title" | "plan">): Promise<ResultsSummaryDto> {
  const plan = readPlan(strategy.plan);
  const [dels, tasks, rows] = await Promise.all([
    prisma.deliverable.findMany({ where: { strategyId: strategy.id, status: { not: "cancelled" } }, select: { status: true, generationId: true, completedById: true, externalUrl: true } }),
    prisma.execTask.findMany({ where: { strategyId: strategy.id, status: { not: "cancelled" } }, select: { status: true } }),
    prisma.campaignResult.findMany({ where: { strategyId: strategy.id }, orderBy: { periodEnd: "desc" } }),
  ]);
  const genIds = dels.map((d) => d.generationId).filter((g): g is string => !!g);
  const posts = genIds.length ? await prisma.socialPost.findMany({ where: { generationId: { in: genIds } }, select: { generationId: true, status: true } }) : [];
  const byGen = (statuses: string[]) => new Set(posts.filter((p) => statuses.includes(p.status)).map((p) => p.generationId)).size;

  const deliverablesByStatus: Record<string, number> = {};
  for (const d of dels) deliverablesByStatus[d.status] = (deliverablesByStatus[d.status] ?? 0) + 1;

  const results: ResultRow[] = rows.map((r) => ({
    id: r.id,
    metric: r.metric,
    value: r.value,
    source: r.source as ResultSource,
    channel: r.channel,
    deliverableId: r.deliverableId,
    sourceNote: r.sourceNote,
    periodStart: r.periodStart.toISOString(),
    periodEnd: r.periodEnd.toISOString(),
  }));
  const { gaps, outcomesTracked } = measurementGaps(plan, results);
  const spendRows = results.filter((r) => r.metric === "spend");
  return {
    strategyId: strategy.id,
    title: strategy.title,
    planned: {
      objective: plan.objective.outcome,
      primaryKpi: plan.measurement.primaryKpi,
      deliverables: plan.deliverables.reduce((n, d) => n + d.count, 0),
    },
    execution: {
      deliverablesByStatus,
      published: byGen(["posted"]),
      scheduled: byGen(["scheduled", "pending", "posting"]),
      failed: byGen(["failed"]),
      completedManually: dels.filter((d) => d.status === "completed" && !!d.completedById).length,
      tasksDone: tasks.filter((t) => t.status === "done").length,
      tasksTotal: tasks.length,
    },
    spend: {
      proposed: plan.budget.proposedAmount,
      approved: plan.budget.spendApproved,
      recorded: spendRows.length ? spendRows.reduce((n, r) => n + r.value, 0) : null,
    },
    metrics: summarizeResults(results),
    results,
    gaps,
    outcomesTracked,
  };
}

export async function listResults(userId: string, strategyId: string) {
  const strategy = await prisma.strategy.findUnique({ where: { id: strategyId } });
  if (!strategy) throw notFound("Strategy not found");
  await findAccessibleBrand(userId, strategy.brandId);
  return buildResultsSummary(strategy);
}

export async function addResult(userId: string, body: CreateResultRequest) {
  const strategy = await prisma.strategy.findUnique({ where: { id: body.strategyId } });
  if (!strategy) throw notFound("Strategy not found");
  await findAccessibleBrand(userId, strategy.brandId);
  if (!(await canManageBrand(userId, strategy.brandId))) throw new HttpError(403, "Only the business owner can record results");
  if (body.deliverableId) {
    const d = await prisma.deliverable.findFirst({ where: { id: body.deliverableId, strategyId: strategy.id }, select: { id: true } });
    if (!d) throw badRequest("That deliverable does not belong to this strategy");
  }
  await prisma.campaignResult.create({
    data: {
      strategyId: strategy.id,
      deliverableId: body.deliverableId ?? null,
      channel: body.channel || null,
      metric: body.metric,
      value: body.value,
      source: body.source,
      sourceNote: body.sourceNote,
      periodStart: new Date(body.periodStart),
      periodEnd: new Date(body.periodEnd),
      enteredById: userId,
    },
  });
  return buildResultsSummary(strategy);
}

export async function deleteResult(userId: string, id: string) {
  const row = await prisma.campaignResult.findUnique({ where: { id }, include: { strategy: true } });
  if (!row) throw notFound("Result not found");
  await findAccessibleBrand(userId, row.strategy.brandId);
  if (!(await canManageBrand(userId, row.strategy.brandId))) throw new HttpError(403, "Only the business owner can remove results");
  if (row.source === "observed") throw badRequest("Platform-recorded results cannot be deleted");
  await prisma.campaignResult.delete({ where: { id } });
}

/* ------------------------------- serializers ------------------------------ */

interface Ctx {
  people: Map<string, PersonDto>;
  accounts: AccountFact[];
  strategyTitles: Map<string, string>;
  generations: Map<string, { imageUrls: string[]; textResponse: string | null }>;
  posts: Map<string, { status: string; scheduledFor: Date | null; remoteUrl: string | null; error: string | null; createdAt: Date }[]>;
  previous: Map<string, string | null>;
  clientReview: Map<string, { status: string; comment: string | null }>;
  taskIds: Map<string, string[]>;
  now: number;
}

const person = (ctx: Ctx, id: string | null): PersonDto | null => (id ? (ctx.people.get(id) ?? { id, name: "Former member" }) : null);

function toDeliverableDto(d: Deliverable, ctx: Ctx, events: ExecEventDto[] = []): DeliverableDto {
  const gen = d.generationId ? ctx.generations.get(d.generationId) : undefined;
  const publishing = derivePublishing({
    status: d.status as DeliverableStatus,
    type: d.type as DeliverableType,
    channel: d.channel,
    generationId: d.generationId,
    posts: d.generationId ? (ctx.posts.get(d.generationId) ?? []) : [],
    accounts: ctx.accounts,
  });
  const open = d.status !== "completed" && d.status !== "cancelled";
  return {
    id: d.id,
    strategyId: d.strategyId,
    strategyTitle: ctx.strategyTitles.get(d.strategyId) ?? "",
    brandId: d.brandId,
    type: d.type as DeliverableType,
    title: d.title,
    channel: d.channel,
    format: d.format,
    brief: d.brief,
    status: d.status as DeliverableStatus,
    dueAt: iso(d.dueAt),
    assignee: person(ctx, d.assigneeId),
    generationId: d.generationId,
    imageUrl: gen?.imageUrls[0] ?? null,
    captionPreview: gen?.textResponse?.slice(0, 280) ?? null,
    previousGenerationId: ctx.previous.get(d.id) ?? null,
    submittedBy: person(ctx, d.submittedById),
    submittedAt: iso(d.submittedAt),
    decisionNote: d.decisionNote,
    completionNote: d.completionNote,
    externalUrl: d.externalUrl,
    blockedReason: d.blockedReason,
    flaggedForReview: !!d.flaggedAt,
    clientReview: d.generationId ? (ctx.clientReview.get(d.generationId) ?? null) : null,
    publishing,
    manualSteps: manualSteps({ type: d.type as DeliverableType, channel: d.channel, state: publishing }),
    taskIds: ctx.taskIds.get(d.id) ?? [],
    overdue: open && !!d.dueAt && d.dueAt.getTime() < ctx.now - DAY / 2 && publishing.kind !== "published",
    canGenerate: canGenerateFor(d.type as DeliverableType) && open,
    events,
    createdAt: d.createdAt.toISOString(),
  };
}

function toTaskDto(t: ExecTask, ctx: Ctx, all: Map<string, ExecTask>, deliverableTitles: Map<string, string>, events: ExecEventDto[] = []): ExecTaskDto {
  const dep = t.dependsOnId ? all.get(t.dependsOnId) : undefined;
  const open = t.status !== "done" && t.status !== "cancelled";
  return {
    id: t.id,
    strategyId: t.strategyId,
    strategyTitle: ctx.strategyTitles.get(t.strategyId) ?? "",
    deliverableId: t.deliverableId,
    deliverableTitle: t.deliverableId ? (deliverableTitles.get(t.deliverableId) ?? null) : null,
    title: t.title,
    description: t.description,
    checklist: (Array.isArray(t.checklist) ? t.checklist : []) as { text: string; done: boolean }[],
    status: t.status as ExecTaskDto["status"],
    priority: t.priority as ExecTaskDto["priority"],
    assignee: person(ctx, t.assigneeId),
    dueAt: iso(t.dueAt),
    dependsOn: dep ? { id: dep.id, title: dep.title, status: dep.status } : null,
    blockedByDependency: !!dep && dep.status !== "done" && dep.status !== "cancelled",
    blockedReason: t.blockedReason,
    flaggedForReview: !!t.flaggedAt,
    overdue: open && !!t.dueAt && t.dueAt.getTime() < ctx.now - DAY / 2,
    events,
  };
}

async function toEvents(rows: ExecEvent[], people: Map<string, PersonDto>): Promise<ExecEventDto[]> {
  return rows.map((e) => ({
    id: e.id,
    kind: e.kind,
    note: e.note,
    userId: e.userId,
    userName: e.userId ? (people.get(e.userId)?.name ?? "Former member") : null,
    createdAt: e.createdAt.toISOString(),
  }));
}

async function buildCtx(brandId: string, strategyIds: string[], dels: Deliverable[]): Promise<Ctx> {
  const brand = await prisma.brand.findUniqueOrThrow({ where: { id: brandId }, select: { userId: true, workspaceId: true } });
  const people = await brandPeople(brandId);
  const genIds = dels.map((d) => d.generationId).filter((g): g is string => !!g);
  const delIds = dels.map((d) => d.id);
  const [accounts, gens, posts, strategies, links, tasks, linkedEvents] = await Promise.all([
    prisma.socialAccount.findMany({
      where: brand.workspaceId ? { workspaceId: brand.workspaceId } : { userId: brand.userId, workspaceId: null },
      select: { platform: true, status: true },
    }),
    genIds.length ? prisma.generation.findMany({ where: { id: { in: genIds } }, select: { id: true, imageUrls: true, textResponse: true } }) : [],
    genIds.length ? prisma.socialPost.findMany({ where: { generationId: { in: genIds } }, select: { generationId: true, status: true, scheduledFor: true, remoteUrl: true, error: true, createdAt: true } }) : [],
    prisma.strategy.findMany({ where: { id: { in: strategyIds } }, select: { id: true, title: true } }),
    genIds.length ? prisma.approvalLink.findMany({ where: { generationId: { in: genIds }, revokedAt: null }, orderBy: { createdAt: "desc" }, select: { generationId: true, status: true, comment: true } }) : [],
    delIds.length ? prisma.execTask.findMany({ where: { deliverableId: { in: delIds } }, select: { id: true, deliverableId: true } }) : [],
    delIds.length ? prisma.execEvent.findMany({ where: { deliverableId: { in: delIds }, kind: "linked_content" }, orderBy: { createdAt: "desc" } }) : [],
  ]);
  const postMap: Ctx["posts"] = new Map();
  for (const p of posts) postMap.set(p.generationId, [...(postMap.get(p.generationId) ?? []), p]);
  const previous = new Map<string, string | null>();
  for (const e of linkedEvents) {
    if (e.deliverableId && !previous.has(e.deliverableId)) {
      const prev = (e.data as { previousGenerationId?: string | null } | null)?.previousGenerationId ?? null;
      previous.set(e.deliverableId, prev);
    }
  }
  const clientReview: Ctx["clientReview"] = new Map();
  for (const l of links) if (!clientReview.has(l.generationId)) clientReview.set(l.generationId, { status: l.status, comment: l.comment });
  const taskIds: Ctx["taskIds"] = new Map();
  for (const t of tasks) if (t.deliverableId) taskIds.set(t.deliverableId, [...(taskIds.get(t.deliverableId) ?? []), t.id]);
  return {
    people: new Map(people.map((p) => [p.id, p])),
    accounts,
    strategyTitles: new Map(strategies.map((s) => [s.id, s.title])),
    generations: new Map(gens.map((g) => [g.id, g])),
    posts: postMap,
    previous,
    clientReview,
    taskIds,
    now: Date.now(),
  };
}

/* -------------------------------- dashboard ------------------------------- */

function stageFor(dels: Deliverable[], tasks: ExecTask[], published: number): string {
  const live = dels.filter((d) => d.status !== "cancelled");
  if (!live.length && !tasks.length) return "Not converted into work yet";
  if (live.length && live.every((d) => d.status === "completed")) return "Measurement and review";
  if (published > 0) return "Live";
  if (live.some((d) => d.status === "awaiting_approval" || d.status === "changes_requested")) return "Review and approval";
  if (live.some((d) => d.status === "approved")) return "Ready to launch";
  if (live.some((d) => d.status === "drafting")) return "Creative production";
  return "Preparation";
}

export async function getExecutionDashboard(userId: string, brandId: string): Promise<ExecutionDashboardDto> {
  await findAccessibleBrand(userId, brandId);
  const strategies = await prisma.strategy.findMany({
    where: { brandId, status: { in: ["active", "completed"] } },
    orderBy: { updatedAt: "desc" },
  });
  const ids = strategies.map((s) => s.id);
  const [dels, tasks] = await Promise.all([
    prisma.deliverable.findMany({ where: { strategyId: { in: ids }, status: { not: "cancelled" } }, orderBy: [{ dueAt: "asc" }] }),
    prisma.execTask.findMany({ where: { strategyId: { in: ids }, status: { not: "cancelled" } }, orderBy: [{ dueAt: "asc" }] }),
  ]);
  const ctx = await buildCtx(brandId, ids, dels);
  const allTasks = new Map(tasks.map((t) => [t.id, t]));
  const delTitles = new Map(dels.map((d) => [d.id, d.title]));
  const dDtos = dels.map((d) => toDeliverableDto(d, ctx));
  const tDtos = tasks.map((t) => toTaskDto(t, ctx, allTasks, delTitles));

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const endOfToday = startOfToday.getTime() + DAY;
  const dueToday = (s: string | null) => !!s && new Date(s).getTime() >= startOfToday.getTime() && new Date(s).getTime() < endOfToday;
  const openTask = (t: ExecTaskDto) => t.status !== "done" && t.status !== "cancelled";

  const pipeline = DELIVERABLE_STATUSES.filter((s) => s !== "cancelled").map((s) => ({
    status: s as string,
    label: DELIVERABLE_STATUS_LABELS[s],
    count: dDtos.filter((d) => d.status === s).length,
  }));
  // Publishing is read from the publishing service, not duplicated as a status.
  pipeline.push(
    { status: "scheduled", label: "Scheduled to publish", count: dDtos.filter((d) => d.publishing.kind === "scheduled").length },
    { status: "published", label: "Published", count: dDtos.filter((d) => d.publishing.kind === "published").length },
  );

  const campaigns = strategies.map((s) => {
    const sd = dDtos.filter((d) => d.strategyId === s.id);
    const st = tDtos.filter((t) => t.strategyId === s.id);
    const total = sd.length + st.length;
    const done = sd.filter((d) => d.status === "completed" || d.publishing.kind === "published").length + st.filter((t) => t.status === "done").length;
    const nextTask = st.filter(openTask).find((t) => t.dueAt);
    const raw = dels.filter((d) => d.strategyId === s.id);
    return {
      id: s.id,
      title: s.title,
      status: s.status as StrategyStatus,
      stage: stageFor(raw, tasks.filter((t) => t.strategyId === s.id), sd.filter((d) => d.publishing.kind === "published").length),
      progressPct: total ? Math.round((done / total) * 100) : null,
      nextMilestone: nextTask ? `${nextTask.title}${nextTask.dueAt ? ` - ${nextTask.dueAt.slice(0, 10)}` : ""}` : null,
      blockers: st.filter((t) => t.status === "blocked" || t.blockedByDependency).length + sd.filter((d) => d.blockedReason || d.publishing.kind === "failed").length,
      owner: ctx.people.get(s.userId)?.name ?? null,
    };
  });

  const results = await Promise.all(strategies.filter((s) => s.status === "active" || s.status === "completed").map((s) => buildResultsSummary(s)));

  return {
    brandId,
    today: {
      tasksDue: tDtos.filter((t) => openTask(t) && dueToday(t.dueAt)),
      overdueTasks: tDtos.filter((t) => openTask(t) && t.overdue && !dueToday(t.dueAt)),
      review: dDtos.filter((d) => d.status === "awaiting_approval"),
      scheduled: dDtos.filter((d) => d.publishing.kind === "scheduled" && dueToday(d.publishing.at)),
      blocked: [...tDtos.filter((t) => t.status === "blocked"), ...dDtos.filter((d) => d.blockedReason || d.publishing.kind === "failed")],
    },
    campaigns,
    pipeline,
    approvals: dDtos.filter((d) => d.status === "awaiting_approval"),
    tasks: tDtos,
    deliverables: dDtos,
    results,
    members: [...ctx.people.values()],
  };
}

/* ------------------------------- access helpers --------------------------- */

async function loadDeliverable(userId: string, id: string) {
  const d = await prisma.deliverable.findUnique({ where: { id }, include: { strategy: true } });
  if (!d) throw notFound("Deliverable not found");
  await findAccessibleBrand(userId, d.brandId); // 404 for other businesses
  return { d, canManage: await canManageBrand(userId, d.brandId) };
}

async function loadTask(userId: string, id: string) {
  const t = await prisma.execTask.findUnique({ where: { id }, include: { strategy: true } });
  if (!t) throw notFound("Task not found");
  await findAccessibleBrand(userId, t.brandId);
  return { t, canManage: await canManageBrand(userId, t.brandId) };
}

const managerOnly = (ok: boolean) => {
  if (!ok) throw new HttpError(403, "Only the business owner can do that");
};

const log = (data: { strategyId: string; deliverableId?: string | null; taskId?: string | null; userId: string; kind: string; note?: string | null; data?: Prisma.InputJsonValue }) =>
  prisma.execEvent.create({ data });

async function deliverableDetail(userId: string, id: string): Promise<DeliverableDto> {
  const { d } = await loadDeliverable(userId, id);
  const fresh = await prisma.deliverable.findUniqueOrThrow({ where: { id } });
  const ctx = await buildCtx(fresh.brandId, [fresh.strategyId], [fresh]);
  const events = await prisma.execEvent.findMany({ where: { deliverableId: d.id }, orderBy: { createdAt: "desc" }, take: 50 });
  return toDeliverableDto(fresh, ctx, await toEvents(events, ctx.people));
}
export const getDeliverable = deliverableDetail;

export async function getTask(userId: string, id: string): Promise<ExecTaskDto> {
  const { t } = await loadTask(userId, id);
  const fresh = await prisma.execTask.findUniqueOrThrow({ where: { id } });
  const ctx = await buildCtx(fresh.brandId, [fresh.strategyId], []);
  const related = await prisma.execTask.findMany({ where: { strategyId: fresh.strategyId } });
  const dels = fresh.deliverableId ? await prisma.deliverable.findMany({ where: { id: fresh.deliverableId }, select: { id: true, title: true } }) : [];
  const events = await prisma.execEvent.findMany({ where: { taskId: t.id }, orderBy: { createdAt: "desc" }, take: 50 });
  return toTaskDto(fresh, ctx, new Map(related.map((r) => [r.id, r])), new Map(dels.map((d) => [d.id, d.title])), await toEvents(events, ctx.people));
}

/* ------------------------------ deliverable ops --------------------------- */

export async function updateDeliverable(userId: string, id: string, body: { title?: string; brief?: string; dueAt?: string | null; assigneeId?: string | null }) {
  const { d, canManage } = await loadDeliverable(userId, id);
  managerOnly(canManage);
  if (body.assigneeId !== undefined) await assertAssignee(d.brandId, body.assigneeId);
  if (body.brief !== undefined && body.brief !== d.brief && d.status === "approved") {
    throw badRequest("This is approved. Reopen it before changing the brief.");
  }
  await prisma.deliverable.update({
    where: { id },
    data: {
      ...(body.title ? { title: body.title } : {}),
      ...(body.brief !== undefined ? { brief: body.brief } : {}),
      ...(body.dueAt !== undefined ? { dueAt: body.dueAt ? new Date(body.dueAt) : null } : {}),
      ...(body.assigneeId !== undefined ? { assigneeId: body.assigneeId } : {}),
    },
  });
  if (body.assigneeId !== undefined && body.assigneeId !== d.assigneeId) {
    await log({ strategyId: d.strategyId, deliverableId: id, userId, kind: "assigned", note: body.assigneeId ? "Assigned" : "Unassigned", data: { from: d.assigneeId, to: body.assigneeId } });
  }
  return deliverableDetail(userId, id);
}

/** The composed brief for content generation, taken from the saved plan. The client never supplies it. */
export async function getGenerationBrief(userId: string, id: string) {
  const { d } = await loadDeliverable(userId, id);
  if (!canGenerateFor(d.type as DeliverableType)) throw badRequest("Content for this type of deliverable is made outside the platform.");
  if (d.status === "approved" || d.status === "completed" || d.status === "cancelled") throw badRequest("Reopen this deliverable before generating new content.");
  const brand = await prisma.brand.findUniqueOrThrow({ where: { id: d.brandId }, select: { name: true } });
  const feedback = d.status === "changes_requested" ? d.decisionNote : null;
  return {
    brandId: d.brandId,
    prompt: buildContentPrompt({ plan: readPlan(d.strategy.plan), brandName: brand.name, deliverable: { type: d.type as DeliverableType, title: d.title, channel: d.channel, format: d.format, brief: d.brief }, feedback }),
  };
}

/** Attach generated content. Replacing approved content sends it back for approval. */
export async function linkGeneration(userId: string, id: string, generationId: string) {
  const { d } = await loadDeliverable(userId, id);
  if (d.status === "completed" || d.status === "cancelled") throw badRequest("This deliverable is closed.");
  const gen = await prisma.generation.findUnique({ where: { id: generationId }, select: { userId: true, brandId: true, status: true } });
  if (!gen || gen.userId !== userId) throw notFound("Generation not found");
  if (gen.brandId !== d.brandId) throw badRequest("That content was made for a different business");
  if (gen.status === "failed" || gen.status === "cancelled") throw badRequest("That generation did not complete");
  if (d.generationId === generationId) return deliverableDetail(userId, id);
  const reopened = d.status === "approved" || d.status === "awaiting_approval";
  await prisma.deliverable.update({
    where: { id },
    data: { generationId, status: reopened || d.status === "planned" || d.status === "changes_requested" ? "drafting" : d.status, decidedAt: null, decidedById: null, submittedAt: reopened ? null : d.submittedAt },
  });
  await log({
    strategyId: d.strategyId,
    deliverableId: id,
    userId,
    kind: "linked_content",
    note: reopened ? "New version attached - approval must be given again" : "Content attached",
    data: { generationId, previousGenerationId: d.generationId },
  });
  return deliverableDetail(userId, id);
}

export async function deliverableAction(userId: string, id: string, action: "submit" | "approve" | "request_changes" | "reject" | "reopen", note?: string) {
  const { d, canManage } = await loadDeliverable(userId, id);
  const status = d.status as DeliverableStatus;
  const now = new Date();
  const need = (ok: boolean, msg: string) => {
    if (!ok) throw badRequest(msg);
  };
  if (action === "submit") {
    need(["planned", "drafting", "changes_requested"].includes(status), "This can't be submitted from its current state");
    need(!canGenerateFor(d.type as DeliverableType) || !!d.generationId, "Attach or generate the content before submitting");
    await prisma.deliverable.update({ where: { id }, data: { status: "awaiting_approval", submittedById: userId, submittedAt: now, decidedAt: null, decidedById: null, decisionNote: null } });
    await log({ strategyId: d.strategyId, deliverableId: id, userId, kind: "submitted", note });
  } else if (action === "reopen") {
    managerOnly(canManage);
    need(["approved", "completed", "cancelled", "changes_requested"].includes(status), "Nothing to reopen");
    await prisma.deliverable.update({ where: { id }, data: { status: "drafting", decidedAt: null, decidedById: null, completedAt: null, completedById: null } });
    await log({ strategyId: d.strategyId, deliverableId: id, userId, kind: "status", note: note ?? "Reopened" });
  } else {
    managerOnly(canManage);
    need(status === "awaiting_approval", "Only items awaiting approval can be decided");
    if (action !== "approve") need(!!note?.trim(), "Add a short note so the team knows what to fix");
    const next: DeliverableStatus = action === "approve" ? "approved" : action === "reject" ? "cancelled" : "changes_requested";
    await prisma.deliverable.update({ where: { id }, data: { status: next, decidedById: userId, decidedAt: now, decisionNote: note?.trim() || null } });
    await log({ strategyId: d.strategyId, deliverableId: id, userId, kind: action === "approve" ? "approved" : action === "reject" ? "rejected" : "changes_requested", note });
  }
  return deliverableDetail(userId, id);
}

/**
 * Record that work was finished outside the platform. This is a person's
 * statement, logged as such - it never becomes a "published" state.
 */
export async function manualComplete(userId: string, id: string, body: { note: string; externalUrl?: string }) {
  const { d } = await loadDeliverable(userId, id);
  if (d.status !== "approved") throw badRequest("Only approved work can be marked done");
  await prisma.deliverable.update({
    where: { id },
    data: { status: "completed", completedAt: new Date(), completedById: userId, completionNote: body.note, externalUrl: body.externalUrl ?? null },
  });
  await log({ strategyId: d.strategyId, deliverableId: id, userId, kind: "manual_complete", note: body.note, data: { externalUrl: body.externalUrl ?? null } });
  return deliverableDetail(userId, id);
}

export async function setDeliverableFlag(userId: string, id: string, flagged: boolean, reason?: string) {
  const { d } = await loadDeliverable(userId, id);
  await prisma.deliverable.update({ where: { id }, data: { flaggedAt: flagged ? new Date() : null, blockedReason: flagged ? (reason ?? d.blockedReason) : d.blockedReason } });
  await log({ strategyId: d.strategyId, deliverableId: id, userId, kind: flagged ? "flagged" : "unflagged", note: reason });
  return deliverableDetail(userId, id);
}

export async function commentDeliverable(userId: string, id: string, note: string) {
  const { d } = await loadDeliverable(userId, id);
  await log({ strategyId: d.strategyId, deliverableId: id, userId, kind: "comment", note });
  return deliverableDetail(userId, id);
}

/* --------------------------------- task ops ------------------------------- */

export async function updateTask(
  userId: string,
  id: string,
  body: { title?: string; description?: string; status?: string; priority?: string; dueAt?: string | null; assigneeId?: string | null; checklist?: { text: string; done: boolean }[]; blockedReason?: string | null },
) {
  const { t, canManage } = await loadTask(userId, id);
  const structural = body.title !== undefined || body.description !== undefined || body.priority !== undefined || body.dueAt !== undefined || body.assigneeId !== undefined;
  if (structural) managerOnly(canManage);
  if (body.assigneeId !== undefined) await assertAssignee(t.brandId, body.assigneeId);

  if (body.status && body.status !== t.status) {
    if ((body.status === "in_progress" || body.status === "done") && t.dependsOnId) {
      const dep = await prisma.execTask.findUnique({ where: { id: t.dependsOnId }, select: { title: true, status: true } });
      if (dep && dep.status !== "done" && dep.status !== "cancelled") throw badRequest(`Waiting on "${dep.title}" to be finished first`);
    }
    if (body.status === "blocked" && !(body.blockedReason ?? t.blockedReason)?.trim()) throw badRequest("Say what is blocking this task");
  }
  const data: Prisma.ExecTaskUpdateInput = {
    ...(body.title ? { title: body.title } : {}),
    ...(body.description !== undefined ? { description: body.description } : {}),
    ...(body.priority ? { priority: body.priority } : {}),
    ...(body.dueAt !== undefined ? { dueAt: body.dueAt ? new Date(body.dueAt) : null } : {}),
    ...(body.assigneeId !== undefined ? { assigneeId: body.assigneeId } : {}),
    ...(body.checklist ? { checklist: body.checklist as Prisma.InputJsonValue } : {}),
    ...(body.blockedReason !== undefined ? { blockedReason: body.blockedReason } : {}),
  };
  if (body.status) {
    data.status = body.status;
    data.completedAt = body.status === "done" ? new Date() : null;
    if (body.status !== "blocked" && body.blockedReason === undefined) data.blockedReason = null;
  }
  await prisma.execTask.update({ where: { id }, data });
  if (body.status && body.status !== t.status) {
    await log({ strategyId: t.strategyId, taskId: id, userId, kind: "status", note: `${t.status} -> ${body.status}${body.blockedReason ? `: ${body.blockedReason}` : ""}` });
  }
  if (body.assigneeId !== undefined && body.assigneeId !== t.assigneeId) {
    await log({ strategyId: t.strategyId, taskId: id, userId, kind: "assigned", note: body.assigneeId ? "Assigned" : "Unassigned", data: { from: t.assigneeId, to: body.assigneeId } });
  }
  return getTask(userId, id);
}

export async function setTaskFlag(userId: string, id: string, flagged: boolean, reason?: string) {
  const { t } = await loadTask(userId, id);
  await prisma.execTask.update({ where: { id }, data: { flaggedAt: flagged ? new Date() : null, ...(flagged && reason ? { blockedReason: reason } : {}) } });
  await log({ strategyId: t.strategyId, taskId: id, userId, kind: flagged ? "flagged" : "unflagged", note: reason });
  return getTask(userId, id);
}

export async function commentTask(userId: string, id: string, note: string) {
  const { t } = await loadTask(userId, id);
  await log({ strategyId: t.strategyId, taskId: id, userId, kind: "comment", note });
  return getTask(userId, id);
}

/* ------------------------------ publish guard ----------------------------- */

/**
 * Called before any social post is created. Content that belongs to a campaign
 * deliverable may only be published once that deliverable has been approved.
 */
export async function assertGenerationPublishable(generationId: string) {
  const linked = await prisma.deliverable.findMany({ where: { generationId }, select: { status: true, title: true } });
  const blocked = linked.find((d) => d.status !== "approved" && d.status !== "completed");
  if (blocked) {
    throw new HttpError(409, `"${blocked.title}" needs approval in the Execution Center before it can be published`, "approval_required");
  }
}
