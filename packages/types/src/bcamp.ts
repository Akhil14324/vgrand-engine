import { z } from "zod";

/**
 * B Camp (campaign strategy) and the Execution Center share these shapes. The
 * pure planning logic (turning a plan into work, diffing plans, summarising
 * results honestly) lives here so the API, the web app and the tests all use
 * the same rules.
 */

/* --------------------------------- basics --------------------------------- */

export const STRATEGY_STATUSES = ["draft", "active", "completed", "archived"] as const;
export type StrategyStatus = (typeof STRATEGY_STATUSES)[number];

export const STRATEGY_SOURCES = ["goal", "guava", "idea", "seasonal", "custom"] as const;
export type StrategySource = (typeof STRATEGY_SOURCES)[number];

/** How trustworthy a number or claim in the plan is. Mirrors Guava's evidence tags. */
export const BASIS = ["user", "historical", "estimate", "unknown"] as const;
export type Basis = (typeof BASIS)[number];
export const BASIS_LABELS: Record<Basis, string> = {
  user: "Set by you",
  historical: "Based on past results",
  estimate: "Proposed estimate",
  unknown: "Not known yet",
};

export const DELIVERABLE_STATUSES = [
  "planned",
  "drafting",
  "awaiting_approval",
  "changes_requested",
  "approved",
  "completed",
  "cancelled",
] as const;
export type DeliverableStatus = (typeof DELIVERABLE_STATUSES)[number];
export const DELIVERABLE_STATUS_LABELS: Record<DeliverableStatus, string> = {
  planned: "Planned",
  drafting: "In production",
  awaiting_approval: "Awaiting approval",
  changes_requested: "Changes requested",
  approved: "Approved",
  completed: "Completed",
  cancelled: "Cancelled",
};

/** Work on these is underway or signed off, so a plan change must never overwrite it silently. */
export const LOCKED_DELIVERABLE_STATUSES: DeliverableStatus[] = [
  "drafting",
  "awaiting_approval",
  "changes_requested",
  "approved",
  "completed",
];

export const TASK_STATUSES = ["todo", "in_progress", "blocked", "done", "cancelled"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const TASK_PRIORITIES = ["high", "medium", "low"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const DELIVERABLE_TYPES = [
  "social_post",
  "video",
  "image",
  "landing_page",
  "email",
  "ad_setup",
  "flyer",
  "other",
] as const;
export type DeliverableType = (typeof DELIVERABLE_TYPES)[number];
export const DELIVERABLE_TYPE_LABELS: Record<DeliverableType, string> = {
  social_post: "Social post",
  video: "Video",
  image: "Image",
  landing_page: "Landing page",
  email: "Email or message",
  ad_setup: "Ad setup",
  flyer: "Flyer or print",
  other: "Other",
};

/** Types the platform can generate content for today (image / caption pipeline). */
export const GENERATABLE_TYPES: DeliverableType[] = ["social_post", "image", "flyer"];

/** Platforms with real publishing integrations. Anything else is manual. */
export const PUBLISHABLE_CHANNELS = ["instagram", "facebook", "x", "youtube"] as const;
export const normalizeChannel = (c: string | null | undefined): string =>
  (c ?? "").trim().toLowerCase().replace(/^twitter$/, "x");

export const RESULT_METRICS = [
  "spend",
  "reach",
  "engagement",
  "clicks",
  "leads",
  "inquiries",
  "orders",
  "revenue",
  "other",
] as const;
export type ResultMetric = (typeof RESULT_METRICS)[number];
export const RESULT_SOURCES = ["observed", "user_entered", "estimate"] as const;
export type ResultSource = (typeof RESULT_SOURCES)[number];
export const RESULT_SOURCE_LABELS: Record<ResultSource, string> = {
  observed: "Recorded by the platform",
  user_entered: "Entered by a person",
  estimate: "Estimate",
};

/* ---------------------------------- plan ---------------------------------- */

const s = (max = 1500) => z.string().trim().max(max).catch("");
const list = (max = 300) => z.array(z.string().trim().max(max)).max(20).catch([]);
const basis = z.enum(BASIS).catch("unknown");
const priority = z.enum(TASK_PRIORITIES).catch("medium");
const key = z.string().trim().min(1).max(60).regex(/^[a-z0-9_-]+$/i);

export const planDeliverableSchema = z.object({
  key,
  type: z.enum(DELIVERABLE_TYPES).catch("other"),
  title: s(200),
  channel: s(60),
  format: s(100),
  /** How many of these to make (each becomes its own deliverable). */
  count: z.number().int().min(1).max(30).catch(1),
  dueOffsetDays: z.number().int().min(0).max(730).catch(7),
  brief: s(1500),
});
export type PlanDeliverable = z.infer<typeof planDeliverableSchema>;

export const planTaskSchema = z.object({
  key,
  title: s(200),
  description: s(1500),
  dueOffsetDays: z.number().int().min(0).max(730).catch(7),
  priority,
  /** Plan key of the deliverable this task supports (optional). */
  deliverableKey: s(60),
  dependsOnKey: s(60),
  checklist: list(200),
  /** Optional recurrence: repeat every N weeks, `repeat` times in total. */
  everyWeeks: z.number().int().min(1).max(12).optional().catch(undefined),
  repeat: z.number().int().min(1).max(26).optional().catch(undefined),
});
export type PlanTask = z.infer<typeof planTaskSchema>;

export const strategyPlanSchema = z.object({
  summary: s(600),
  objective: z
    .object({
      outcome: s(),
      why: s(),
      metric: s(200),
      targetValue: s(100),
      period: s(100),
      targetBasis: basis,
    })
    .catch({ outcome: "", why: "", metric: "", targetValue: "", period: "", targetBasis: "unknown" }),
  audience: z
    .object({ who: s(), needs: s(), location: s(300), evidence: s(), toValidate: s() })
    .catch({ who: "", needs: "", location: "", evidence: "", toValidate: "" }),
  offer: z
    .object({ promoting: s(), benefit: s(), message: s(), cta: s(300), requirements: s() })
    .catch({ promoting: "", benefit: "", message: "", cta: "", requirements: "" }),
  channels: z
    .array(z.object({ channel: s(60), why: s(500), formats: list(100), manualWork: s(500) }))
    .max(10)
    .catch([]),
  budget: z
    .object({
      proposedAmount: s(100),
      currency: s(10),
      /** Always false when generated. Only a person can approve spend, outside this plan. */
      spendApproved: z.boolean().catch(false),
      actualSpend: s(100),
      resources: s(600),
      people: s(300),
      constraints: s(600),
    })
    .catch({ proposedAmount: "", currency: "", spendApproved: false, actualSpend: "", resources: "", people: "", constraints: "" }),
  timeline: z
    .array(
      z.object({
        phase: s(80),
        startOffsetDays: z.number().int().min(0).max(730).catch(0),
        endOffsetDays: z.number().int().min(0).max(730).catch(0),
        description: s(500),
      }),
    )
    .max(12)
    .catch([]),
  measurement: z
    .object({
      primaryKpi: s(300),
      supportingKpis: list(),
      tracking: s(600),
      frequency: s(100),
      changeTrigger: s(600),
      targetBasis: basis,
    })
    .catch({ primaryKpi: "", supportingKpis: [], tracking: "", frequency: "", changeTrigger: "", targetBasis: "unknown" }),
  deliverables: z.array(planDeliverableSchema).max(40).catch([]),
  tasks: z.array(planTaskSchema).max(60).catch([]),
  risks: z
    .array(z.object({ kind: z.enum(["risk", "assumption", "missing"]).catch("assumption"), text: s(500) }))
    .max(30)
    .catch([]),
});
export type StrategyPlan = z.infer<typeof strategyPlanSchema>;

export const EMPTY_PLAN: StrategyPlan = strategyPlanSchema.parse({});

/* ------------------------------ industry packs ---------------------------- */

export interface StrategyTemplate {
  key: string;
  label: string;
  goal: string;
  /** Suggested deliverables/tasks - a starting point the model may adapt, never a required workflow. */
  deliverables: Pick<PlanDeliverable, "type" | "title" | "channel" | "count">[];
  tasks: string[];
  metrics: string[];
}

/** Suggestions per Guava industry key. Adding a business type is adding one entry. */
export const STRATEGY_TEMPLATES: StrategyTemplate[] = [
  {
    key: "real_estate",
    label: "Qualified property inquiries",
    goal: "Generate more qualified inquiries and site visits for a property or project.",
    deliverables: [
      { type: "video", title: "Property walkthrough video", channel: "instagram", count: 1 },
      { type: "social_post", title: "Property highlight post", channel: "instagram", count: 4 },
      { type: "landing_page", title: "Inquiry landing page", channel: "web", count: 1 },
    ],
    tasks: [
      "Verify unit availability and pricing before anything is published",
      "Set up a lead source tracker (where each inquiry came from)",
      "Agree a site-visit scheduling and follow-up process",
    ],
    metrics: ["Qualified inquiries", "Site visits booked", "Bookings", "Lead source"],
  },
  {
    key: "restaurant",
    label: "Weekday orders and repeat visits",
    goal: "Increase weekday orders and bring past customers back.",
    deliverables: [
      { type: "social_post", title: "Menu or offer post", channel: "instagram", count: 5 },
      { type: "image", title: "Hero dish photo", channel: "instagram", count: 2 },
      { type: "email", title: "Repeat-customer message", channel: "whatsapp", count: 1 },
    ],
    tasks: [
      "Confirm the offer, its dates and any conditions",
      "Decide how orders or reservations from this campaign will be counted",
      "Update the Google Maps listing with current photos and hours",
    ],
    metrics: ["Orders", "Reservations", "Repeat customers", "Average order value"],
  },
  {
    key: "general",
    label: "Grow sales",
    goal: "Bring in more customers with one clear offer.",
    deliverables: [
      { type: "social_post", title: "Offer post", channel: "instagram", count: 4 },
      { type: "image", title: "Campaign visual", channel: "instagram", count: 1 },
    ],
    tasks: ["Decide how sales from this campaign will be tracked", "Review results weekly"],
    metrics: ["Leads", "Orders", "Revenue"],
  },
];

export function getStrategyTemplate(industry: string | null | undefined): StrategyTemplate {
  return STRATEGY_TEMPLATES.find((t) => t.key === industry) ?? STRATEGY_TEMPLATES.find((t) => t.key === "general")!;
}

/* ------------------------ plan -> execution conversion -------------------- */

export interface ProposedDeliverable {
  dedupeKey: string;
  planKey: string;
  type: DeliverableType;
  title: string;
  channel: string;
  format: string;
  brief: string;
  dueAt: string;
  source: PlanDeliverable & { index: number };
}
export interface ProposedTask {
  dedupeKey: string;
  planKey: string;
  title: string;
  description: string;
  checklist: string[];
  priority: TaskPriority;
  dueAt: string;
  deliverableDedupeKey: string | null;
  dependsOnDedupeKey: string | null;
  source: PlanTask & { index: number };
}
export interface ConversionProposal {
  deliverables: ProposedDeliverable[];
  tasks: ProposedTask[];
}

const DAY = 86_400_000;
const addDays = (start: Date, days: number) => new Date(start.getTime() + days * DAY).toISOString();

/** Stable per-strategy keys: converting twice yields the same keys, so nothing is duplicated. */
export const deliverableKey = (planKey: string, n: number, count: number) => (count > 1 ? `${planKey}#${n}` : planKey);
export const taskKey = (planKey: string, n: number, total: number) => (total > 1 ? `${planKey}@${n}` : planKey);

export function proposeExecution(plan: StrategyPlan, startsAt: Date): ConversionProposal {
  const deliverables: ProposedDeliverable[] = [];
  plan.deliverables.forEach((d, index) => {
    for (let n = 1; n <= d.count; n++) {
      deliverables.push({
        dedupeKey: deliverableKey(d.key, n, d.count),
        planKey: d.key,
        type: d.type,
        title: d.count > 1 ? `${d.title} (${n} of ${d.count})` : d.title,
        channel: normalizeChannel(d.channel),
        format: d.format,
        brief: d.brief,
        // Spread multiples across the window rather than stacking them on one day.
        dueAt: addDays(startsAt, d.dueOffsetDays + (n - 1) * 2),
        source: { ...d, index },
      });
    }
  });
  const firstKeyFor = (planKey: string) => deliverables.find((d) => d.planKey === planKey)?.dedupeKey ?? null;

  const tasks: ProposedTask[] = [];
  plan.tasks.forEach((t, index) => {
    const total = t.repeat ?? 1;
    for (let n = 1; n <= total; n++) {
      tasks.push({
        dedupeKey: taskKey(t.key, n, total),
        planKey: t.key,
        title: total > 1 ? `${t.title} (${n} of ${total})` : t.title,
        description: t.description,
        checklist: t.checklist,
        priority: t.priority,
        dueAt: addDays(startsAt, t.dueOffsetDays + (n - 1) * 7 * (t.everyWeeks ?? 1)),
        deliverableDedupeKey: t.deliverableKey ? firstKeyFor(t.deliverableKey) : null,
        dependsOnDedupeKey: null,
        source: { ...t, index },
      });
    }
  });
  const taskByPlanKey = (k: string) => tasks.find((t) => t.planKey === k)?.dedupeKey ?? null;
  for (const t of tasks) t.dependsOnDedupeKey = t.source.dependsOnKey ? taskByPlanKey(t.source.dependsOnKey) : null;
  return { deliverables, tasks };
}

/** Ignore fields a person can edit after conversion when checking whether the PLAN entry changed. */
const planEntryFingerprint = (e: unknown) => {
  const { index: _index, ...rest } = (e ?? {}) as Record<string, unknown>;
  return JSON.stringify(rest, Object.keys(rest).sort());
};

export interface SyncItem {
  kind: "deliverable" | "task";
  id: string;
  dedupeKey: string;
  title: string;
  status: string;
  /** "changed": plan entry differs from what the item was created from. "removed": plan no longer has it. */
  change: "changed" | "removed";
  /** Work already underway or approved is never overwritten; the person decides. */
  locked: boolean;
  fields: string[];
}

export interface ExistingItem {
  kind: "deliverable" | "task";
  id: string;
  dedupeKey: string;
  title: string;
  status: string;
  source: unknown;
}

/**
 * Which existing work is affected by the current plan. Pure: callers apply the
 * accepted, unlocked ones and leave locked work alone.
 */
export function diffPlanAgainstWork(plan: StrategyPlan, startsAt: Date, existing: ExistingItem[]): {
  affected: SyncItem[];
  added: { kind: "deliverable" | "task"; dedupeKey: string; title: string }[];
} {
  const proposal = proposeExecution(plan, startsAt);
  const byKey = new Map<string, { entry: unknown; title: string }>();
  for (const d of proposal.deliverables) byKey.set(`deliverable:${d.dedupeKey}`, { entry: d.source, title: d.title });
  for (const t of proposal.tasks) byKey.set(`task:${t.dedupeKey}`, { entry: t.source, title: t.title });

  const affected: SyncItem[] = [];
  const seen = new Set<string>();
  for (const item of existing) {
    const k = `${item.kind}:${item.dedupeKey}`;
    seen.add(k);
    const locked =
      item.kind === "deliverable"
        ? (LOCKED_DELIVERABLE_STATUSES as string[]).includes(item.status)
        : item.status === "in_progress" || item.status === "done";
    const now = byKey.get(k);
    if (item.status === "cancelled") continue;
    if (!now) {
      affected.push({ ...pick(item), change: "removed", locked, fields: [] });
      continue;
    }
    if (planEntryFingerprint(now.entry) !== planEntryFingerprint(item.source)) {
      affected.push({ ...pick(item), change: "changed", locked, fields: changedFields(item.source, now.entry) });
    }
  }
  const added: { kind: "deliverable" | "task"; dedupeKey: string; title: string }[] = [];
  for (const [k, v] of byKey) {
    if (seen.has(k)) continue;
    const [kind, ...rest] = k.split(":");
    added.push({ kind: kind as "deliverable" | "task", dedupeKey: rest.join(":"), title: v.title });
  }
  return { affected, added };
}

const pick = (i: ExistingItem) => ({ kind: i.kind, id: i.id, dedupeKey: i.dedupeKey, title: i.title, status: i.status });

function changedFields(before: unknown, after: unknown): string[] {
  const a = (before ?? {}) as Record<string, unknown>;
  const b = (after ?? {}) as Record<string, unknown>;
  return Object.keys({ ...a, ...b })
    .filter((k) => k !== "index" && JSON.stringify(a[k]) !== JSON.stringify(b[k]))
    .sort();
}

/* ------------------------------- plan diffing ----------------------------- */

export interface PlanChange {
  path: string;
  label: string;
  before: string;
  after: string;
}

const SECTION_LABELS: Record<string, string> = {
  summary: "Summary",
  objective: "Objective",
  audience: "Audience",
  offer: "Offer and message",
  channels: "Channels",
  budget: "Budget",
  timeline: "Timeline",
  measurement: "Success measures",
  deliverables: "Deliverables",
  tasks: "Tasks",
  risks: "Risks and assumptions",
};

const show = (v: unknown) => (v === undefined || v === null || v === "" ? "" : typeof v === "string" ? v : JSON.stringify(v));

/** Human-readable differences between two plan versions, one entry per changed field or list. */
export function diffPlans(before: StrategyPlan, after: StrategyPlan): PlanChange[] {
  const out: PlanChange[] = [];
  for (const section of Object.keys(SECTION_LABELS)) {
    const a = (before as Record<string, unknown>)[section];
    const b = (after as Record<string, unknown>)[section];
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    if (a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b)) {
      const ao = a as Record<string, unknown>;
      const bo = b as Record<string, unknown>;
      for (const f of Object.keys({ ...ao, ...bo })) {
        if (JSON.stringify(ao[f]) === JSON.stringify(bo[f])) continue;
        out.push({ path: `${section}.${f}`, label: `${SECTION_LABELS[section]} - ${f}`, before: show(ao[f]), after: show(bo[f]) });
      }
    } else if (Array.isArray(a) && Array.isArray(b)) {
      const summarize = (x: unknown) =>
        x && typeof x === "object" ? String((x as Record<string, unknown>).title ?? (x as Record<string, unknown>).channel ?? (x as Record<string, unknown>).phase ?? (x as Record<string, unknown>).text ?? JSON.stringify(x)) : String(x);
      const keyOf = (x: unknown) => ((x as Record<string, unknown>)?.key as string) ?? summarize(x);
      const am = new Map(a.map((x) => [keyOf(x), x]));
      const bm = new Map(b.map((x) => [keyOf(x), x]));
      for (const [k, x] of bm) {
        if (!am.has(k)) out.push({ path: `${section}.${k}`, label: `${SECTION_LABELS[section]} - added`, before: "", after: summarize(x) });
        else if (JSON.stringify(am.get(k)) !== JSON.stringify(x))
          out.push({ path: `${section}.${k}`, label: `${SECTION_LABELS[section]} - changed`, before: summarize(am.get(k)), after: summarize(x) });
      }
      for (const [k, x] of am) if (!bm.has(k)) out.push({ path: `${section}.${k}`, label: `${SECTION_LABELS[section]} - removed`, before: summarize(x), after: "" });
    } else {
      out.push({ path: section, label: SECTION_LABELS[section]!, before: show(a), after: show(b) });
    }
  }
  return out;
}

/* ------------------------------ plan completeness ------------------------- */

export interface PlanWarning {
  level: "missing" | "unverified";
  text: string;
}

/** Warnings shown on the dashboard: what is missing, and what is only assumed. */
export function planWarnings(plan: StrategyPlan): PlanWarning[] {
  const w: PlanWarning[] = [];
  if (!plan.objective.metric.trim()) w.push({ level: "missing", text: "No target metric is set." });
  if (plan.objective.targetValue.trim() && plan.objective.targetBasis !== "user" && plan.objective.targetBasis !== "historical")
    w.push({ level: "unverified", text: "The target is a proposal, not based on your numbers or past results." });
  if (!plan.measurement.tracking.trim()) w.push({ level: "missing", text: "No tracking method - results cannot be tied to sales yet." });
  if (!plan.budget.proposedAmount.trim()) w.push({ level: "missing", text: "No budget proposed. Nothing will be spent unless you approve it." });
  else if (!plan.budget.spendApproved) w.push({ level: "unverified", text: "The budget is proposed only - spend is not approved." });
  if (plan.audience.toValidate.trim()) w.push({ level: "unverified", text: `Audience still to validate: ${plan.audience.toValidate}` });
  if (!plan.deliverables.length) w.push({ level: "missing", text: "No deliverables, so there is nothing to convert into work." });
  for (const r of plan.risks) if (r.kind === "missing" && r.text) w.push({ level: "missing", text: r.text });
  return w;
}

/* --------------------------------- results -------------------------------- */

export interface ResultRow {
  id: string;
  metric: string;
  value: number;
  source: ResultSource;
  channel: string | null;
  deliverableId: string | null;
  sourceNote: string | null;
  periodStart: string;
  periodEnd: string;
  enteredBy?: string | null;
}

export interface MetricSummary {
  metric: string;
  /** Totals kept per source - observed, entered and estimated numbers are never mixed. */
  bySource: Partial<Record<ResultSource, number>>;
  rows: number;
}

/** Map the plan's primary KPI text to the metric it would be recorded under, if it names one. */
export function kpiMetric(kpi: string): ResultMetric | null {
  const t = kpi.toLowerCase();
  const table: [RegExp, ResultMetric][] = [
    [/revenue|sales value|turnover/, "revenue"],
    [/order|booking|reservation|purchase|sale/, "orders"],
    [/inquir|enquir/, "inquiries"],
    [/lead|sign.?up|site visit|visit/, "leads"],
    [/click|traffic/, "clicks"],
    [/reach|impression|view/, "reach"],
    [/engage|like|comment|share/, "engagement"],
  ];
  return table.find(([re]) => re.test(t))?.[1] ?? null;
}

export function summarizeResults(rows: ResultRow[]): MetricSummary[] {
  const map = new Map<string, MetricSummary>();
  for (const r of rows) {
    const m = map.get(r.metric) ?? { metric: r.metric, bySource: {}, rows: 0 };
    m.bySource[r.source] = (m.bySource[r.source] ?? 0) + r.value;
    m.rows++;
    map.set(r.metric, m);
  }
  return [...map.values()];
}

export interface MeasurementGaps {
  gaps: string[];
  /** True only when there is something linking activity to business outcomes. */
  outcomesTracked: boolean;
}

const OUTCOME_METRICS: ResultMetric[] = ["leads", "inquiries", "orders", "revenue"];

/** What cannot be concluded yet, stated plainly. Never claims attribution. */
export function measurementGaps(plan: StrategyPlan, rows: ResultRow[]): MeasurementGaps {
  const gaps: string[] = [];
  const have = new Set(rows.map((r) => r.metric));
  const outcomesTracked = OUTCOME_METRICS.some((m) => have.has(m));
  const primary = kpiMetric(plan.measurement.primaryKpi);
  if (!plan.measurement.primaryKpi.trim()) gaps.push("No primary KPI was defined.");
  else if (primary && !have.has(primary)) gaps.push(`No "${primary}" result has been recorded for the primary KPI (${plan.measurement.primaryKpi}).`);
  if (!plan.measurement.tracking.trim()) gaps.push("No tracking method was defined, so activity cannot be linked to results.");
  if (!outcomesTracked)
    gaps.push("No leads, inquiries, orders or revenue are recorded, so the link between this campaign and sales cannot be verified yet.");
  if (!have.has("spend") && plan.budget.spendApproved) gaps.push("Spend was approved but no actual spend has been recorded.");
  gaps.push("Likes, views and reach are not sales. Sales during the campaign are not proof the campaign caused them.");
  return { gaps, outcomesTracked };
}

/* ---------------------------------- DTOs ---------------------------------- */

export interface StrategySummaryDto {
  id: string;
  brandId: string;
  title: string;
  status: StrategyStatus;
  source: StrategySource;
  version: number;
  objective: string;
  startsAt: string | null;
  approvedAt: string | null;
  convertedAt: string | null;
  progress: { deliverables: number; deliverablesDone: number; tasks: number; tasksDone: number };
  flagged: number;
  updatedAt: string;
}

export interface StrategyMessageDto {
  id: string;
  role: "user" | "assistant";
  content: string;
  changes: PlanChange[] | null;
  createdAt: string;
}

export interface StrategyReview {
  planned: string;
  happened: string;
  supported: string[];
  unknown: string[];
  changes: string[];
  /** Interpretation by the AI: never data. */
  generatedAt: string;
}

export interface StrategyDto extends StrategySummaryDto {
  plan: StrategyPlan;
  warnings: PlanWarning[];
  sourceText: string | null;
  sourceRef: { diagnosisId?: string; recommendation?: string } | null;
  canManage: boolean;
  messages: StrategyMessageDto[];
  versions: { version: number; label: string | null; createdAt: string }[];
  review: StrategyReview | null;
  reviewedAt: string | null;
}

export type PublishingState =
  | { kind: "manual"; reason: string }
  | { kind: "not_connected"; platform: string }
  | { kind: "reauth_required"; platform: string }
  | { kind: "ready"; platform: string }
  | { kind: "scheduled"; at: string | null }
  | { kind: "published"; url: string | null }
  | { kind: "failed"; error: string | null }
  | { kind: "blocked_by_approval" };

export interface ExecEventDto {
  id: string;
  kind: string;
  note: string | null;
  userId: string | null;
  userName: string | null;
  createdAt: string;
}

export interface DeliverableDto {
  id: string;
  strategyId: string;
  strategyTitle: string;
  brandId: string;
  type: DeliverableType;
  title: string;
  channel: string | null;
  format: string | null;
  brief: string;
  status: DeliverableStatus;
  dueAt: string | null;
  assignee: PersonDto | null;
  generationId: string | null;
  imageUrl: string | null;
  captionPreview: string | null;
  previousGenerationId: string | null;
  submittedBy: PersonDto | null;
  submittedAt: string | null;
  decisionNote: string | null;
  completionNote: string | null;
  externalUrl: string | null;
  blockedReason: string | null;
  flaggedForReview: boolean;
  /** Existing client approval link status for the attached content, if one was sent. */
  clientReview: { status: string; comment: string | null } | null;
  publishing: PublishingState;
  /** Manual-execution instructions when the platform cannot publish for you. */
  manualSteps: string[];
  taskIds: string[];
  overdue: boolean;
  canGenerate: boolean;
  events: ExecEventDto[];
  createdAt: string;
}

export interface PersonDto {
  id: string;
  name: string;
}

export interface ExecTaskDto {
  id: string;
  strategyId: string;
  strategyTitle: string;
  deliverableId: string | null;
  deliverableTitle: string | null;
  title: string;
  description: string;
  checklist: { text: string; done: boolean }[];
  status: TaskStatus;
  priority: TaskPriority;
  assignee: PersonDto | null;
  dueAt: string | null;
  dependsOn: { id: string; title: string; status: string } | null;
  blockedByDependency: boolean;
  blockedReason: string | null;
  flaggedForReview: boolean;
  overdue: boolean;
  events: ExecEventDto[];
}

export interface ResultsSummaryDto {
  strategyId: string;
  title: string;
  planned: { objective: string; primaryKpi: string; deliverables: number };
  execution: {
    deliverablesByStatus: Record<string, number>;
    published: number;
    scheduled: number;
    failed: number;
    completedManually: number;
    tasksDone: number;
    tasksTotal: number;
  };
  spend: { proposed: string; approved: boolean; recorded: number | null };
  metrics: MetricSummary[];
  results: ResultRow[];
  gaps: string[];
  outcomesTracked: boolean;
}

export interface ExecutionDashboardDto {
  brandId: string;
  today: {
    tasksDue: ExecTaskDto[];
    overdueTasks: ExecTaskDto[];
    review: DeliverableDto[];
    scheduled: DeliverableDto[];
    blocked: (ExecTaskDto | DeliverableDto)[];
  };
  campaigns: {
    id: string;
    title: string;
    status: StrategyStatus;
    stage: string;
    progressPct: number | null;
    nextMilestone: string | null;
    blockers: number;
    owner: string | null;
  }[];
  pipeline: { status: string; label: string; count: number }[];
  approvals: DeliverableDto[];
  tasks: ExecTaskDto[];
  deliverables: DeliverableDto[];
  results: ResultsSummaryDto[];
  members: PersonDto[];
}

export interface BcampDashboardDto {
  brandId: string;
  brandName: string;
  industry: string | null;
  active: StrategySummaryDto[];
  drafts: StrategySummaryDto[];
  archived: StrategySummaryDto[];
  objective: string | null;
  priorities: { title: string; why: string; evidence: string }[];
  recommendations: { title: string; what: string; priority: string; diagnosisId: string }[];
  warnings: (PlanWarning & { strategyTitle: string })[];
  flagged: { kind: "task" | "deliverable"; id: string; title: string; reason: string; strategyId: string; strategyTitle: string }[];
  performance: { strategyId: string; title: string; outcomesTracked: boolean; published: number; note: string }[];
  templates: StrategyTemplate[];
  hasDiagnosis: boolean;
}

/* -------------------------------- requests -------------------------------- */

export const createStrategySchema = z.object({
  brandId: z.string().uuid(),
  source: z.enum(STRATEGY_SOURCES),
  /** The goal, idea, event or instruction in the user's words. */
  text: z.string().trim().min(3).max(2000),
  diagnosisId: z.string().uuid().optional(),
  /** Title of the Guava recommendation this starts from. */
  recommendation: z.string().trim().max(300).optional(),
  templateKey: z.string().max(60).optional(),
  startsAt: z.string().datetime().optional(),
  /** Budget the user actually provides; never assumed. */
  budget: z.string().trim().max(100).optional(),
});
export type CreateStrategyRequest = z.infer<typeof createStrategySchema>;

export const updateStrategySchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  plan: strategyPlanSchema.optional(),
  startsAt: z.string().datetime().nullable().optional(),
  label: z.string().trim().max(60).optional(),
  /** Version the editor loaded; a mismatch means someone else saved first. */
  baseVersion: z.number().int().optional(),
});
export type UpdateStrategyRequest = z.infer<typeof updateStrategySchema>;

export const strategyMessageSchema = z.object({ message: z.string().trim().min(1).max(2000) });

export const strategyStatusSchema = z.object({ action: z.enum(["approve", "archive", "restore", "complete"]) });

export const convertItemSchema = z.object({
  dedupeKey: z.string().min(1).max(80),
  title: z.string().trim().min(1).max(200),
  dueAt: z.string().datetime().nullable().optional(),
  assigneeId: z.string().uuid().nullable().optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
});
export const convertSchema = z.object({
  deliverables: z.array(convertItemSchema).max(120),
  tasks: z.array(convertItemSchema).max(200),
});
export type ConvertRequest = z.infer<typeof convertSchema>;

export const syncSchema = z.object({
  /** "kind:dedupeKey" refs to apply from the plan. */
  accept: z.array(z.string().max(120)).max(300).default([]),
  /** Refs to keep exactly as they are and stop flagging. */
  dismiss: z.array(z.string().max(120)).max(300).default([]),
});

export const updateDeliverableSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  brief: z.string().trim().max(3000).optional(),
  dueAt: z.string().datetime().nullable().optional(),
  assigneeId: z.string().uuid().nullable().optional(),
});
export const deliverableActionSchema = z.object({
  action: z.enum(["submit", "approve", "request_changes", "reject", "reopen"]),
  note: z.string().trim().max(2000).optional(),
});
export const linkGenerationSchema = z.object({ generationId: z.string().uuid() });
export const manualCompleteSchema = z.object({
  note: z.string().trim().min(3).max(2000),
  externalUrl: z.string().url().max(500).optional(),
});
export const flagSchema = z.object({
  flagged: z.boolean(),
  reason: z.string().trim().max(1000).optional(),
});
export const commentSchema = z.object({ note: z.string().trim().min(1).max(2000) });

export const updateTaskSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(3000).optional(),
  status: z.enum(TASK_STATUSES).optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  dueAt: z.string().datetime().nullable().optional(),
  assigneeId: z.string().uuid().nullable().optional(),
  checklist: z.array(z.object({ text: z.string().trim().max(200), done: z.boolean() })).max(30).optional(),
  blockedReason: z.string().trim().max(1000).nullable().optional(),
});

export const createResultSchema = z
  .object({
    strategyId: z.string().uuid(),
    deliverableId: z.string().uuid().optional(),
    channel: z.string().trim().max(60).optional(),
    metric: z.enum(RESULT_METRICS),
    value: z.number().finite().min(0).max(1e12),
    source: z.enum(["user_entered", "estimate"]),
    sourceNote: z.string().trim().min(2).max(500),
    periodStart: z.string().datetime(),
    periodEnd: z.string().datetime(),
  })
  .refine((r) => new Date(r.periodEnd).getTime() >= new Date(r.periodStart).getTime(), {
    message: "periodEnd must not be before periodStart",
    path: ["periodEnd"],
  });
export type CreateResultRequest = z.infer<typeof createResultSchema>;
