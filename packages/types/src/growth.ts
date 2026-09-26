import { z } from "zod";
import {
  ATTENTION_METRIC_LIST,
  OUTCOME_METRIC_LIST,
  RESULT_METRIC_LABELS,
  kpiMetric,
  measurementGaps,
  summarizeResults,
  type MetricSummary,
  type PlanChange,
  type ResultMetric,
  type ResultRow,
  type ResultSource,
  type StrategyPlan,
  type StrategyStatus,
} from "./bcamp";
import type { GuavaValues } from "./guava";

/**
 * Growth Intelligence: pure rules that turn recorded campaign data into goals
 * progress, insights, next best actions and learnings. Nothing here calls a
 * model or invents a number - every statement carries an evidence label.
 */

/* -------------------------------- evidence -------------------------------- */

export const EVIDENCE_LABELS = ["observed", "entered", "calculated", "estimated", "hypothesis", "unknown"] as const;
export type EvidenceLabel = (typeof EVIDENCE_LABELS)[number];

export const EVIDENCE_TEXT: Record<EvidenceLabel, { label: string; hint: string }> = {
  observed: { label: "Observed by platform", hint: "Recorded by this platform itself, e.g. a post that was published." },
  entered: { label: "Entered by a person", hint: "Typed in by someone. The platform has not verified it." },
  calculated: { label: "Calculated from recorded data", hint: "Worked out from the records shown. Only as reliable as those records." },
  estimated: { label: "Estimated", hint: "A rough figure or a proposal, not a measurement." },
  hypothesis: { label: "Hypothesis", hint: "A reasoned guess that has not been tested." },
  unknown: { label: "Unknown", hint: "Nothing recorded, so nothing can be said." },
};

export interface EvidenceItem {
  label: EvidenceLabel;
  text: string;
}

export const evidenceForSource = (s: ResultSource): EvidenceLabel => (s === "observed" ? "observed" : s === "user_entered" ? "entered" : "estimated");

/* ----------------------------------- goals -------------------------------- */

export type GoalKey = "main" | "revenue" | "sales" | "customers";

export interface GoalSeed {
  key: GoalKey;
  label: string;
  target: string;
  /** Result metrics that would show progress toward it. Empty = no single measure. */
  metrics: string[];
}

/** Growth goals are what the owner wrote in Guava's Goals section - nothing is made up. */
export function deriveGoals(values: GuavaValues): GoalSeed[] {
  const g = values.goals ?? {};
  const out: GoalSeed[] = [];
  const add = (key: GoalKey, label: string, target: string | undefined, metrics: string[]) => {
    if (target?.trim()) out.push({ key, label, target: target.trim(), metrics });
  };
  add("main", "Main goal", g.main, []);
  add("revenue", "Revenue target", g.revenueTarget, ["revenue"]);
  add("sales", "Sales target", g.salesTarget, ["orders", "bookings", "reservations"]);
  add("customers", "New customers", g.customerTarget, ["leads", "qualified_leads", "inquiries", "orders"]);
  return out;
}

/** A single clear number in a sentence ("₹5 lakh", "200 orders", "1.5k"), else null. */
export function parseTargetNumber(text: string): number | null {
  const found = [...text.replace(/,/g, "").matchAll(/(\d+(?:\.\d+)?)\s*(k|thousand|lakhs?|lacs?|l|crores?|cr|million|m)?\b/gi)];
  const values = found.map((m) => {
    const n = Number(m[1]);
    const unit = (m[2] ?? "").toLowerCase();
    const mult = /^(k|thousand)$/.test(unit) ? 1e3 : /^(l|lakhs?|lacs?)$/.test(unit) ? 1e5 : /^(cr|crores?)$/.test(unit) ? 1e7 : /^(m|million)$/.test(unit) ? 1e6 : 1;
    return n * mult;
  });
  const distinct = [...new Set(values)];
  return distinct.length === 1 && distinct[0]! > 0 ? distinct[0]! : null;
}

export interface GoalDto {
  key: GoalKey;
  label: string;
  target: string;
  /** Where the owner says the business is today (their words). */
  current: string | null;
  timeline: string | null;
  supportedBy: { strategyId: string; title: string }[];
  /** Present only when a number can honestly be compared. */
  progress: { recorded: number; metric: string; target: number; pct: number; evidence: EvidenceLabel; note: string } | null;
  note: string;
}

/* ------------------------------- campaign state --------------------------- */

export interface SnapshotItem {
  id: string;
  title: string;
  status: string;
  dueAt: string | null;
  hasOwner: boolean;
  blockedReason: string | null;
  flagged: boolean;
  /** How many times the deadline was moved (from the audit log). */
  reschedules: number;
  submittedAt?: string | null;
  publishing?: string;
}

export interface CampaignSnapshot {
  id: string;
  title: string;
  status: StrategyStatus;
  updatedAt: string;
  startsAt: string | null;
  endsAt: string | null;
  convertedAt: string | null;
  reviewedAt: string | null;
  spendApproved: boolean;
  hasTrackingMethod: boolean;
  primaryMetric: string | null;
  deliverables: SnapshotItem[];
  tasks: SnapshotItem[];
  recordedMetrics: string[];
  spendRecorded: boolean;
  publishedCount: number;
  pendingRevision: boolean;
}

export interface GrowthSnapshot {
  now: string;
  hasDiagnosis: boolean;
  goals: { key: GoalKey; label: string; target: string; supportedBy: number }[];
  campaigns: CampaignSnapshot[];
}

/* ------------------------------ next best actions ------------------------- */

export const SUGGESTION_CATEGORIES = ["urgent", "important", "optional"] as const;
export type SuggestionCategory = (typeof SUGGESTION_CATEGORIES)[number];
export const CATEGORY_TEXT: Record<SuggestionCategory, string> = {
  urgent: "Urgent - something is stuck or at risk now",
  important: "Important - worth doing this week",
  optional: "Optional - useful when you have time",
};

export interface Suggestion {
  /** Stable per subject, so a decision on it sticks. */
  key: string;
  category: SuggestionCategory;
  /** operational = get work moving; strategic = a decision about direction. */
  kind: "operational" | "strategic";
  /** Who has to act: the owner decides, or a team member can handle it. */
  actor: "owner" | "team";
  title: string;
  what: string;
  why: string;
  evidence: EvidenceItem[];
  effort: string;
  dependencies: string[];
  measure: string;
  strategyId: string | null;
  link: string;
}

export type SuggestionStatus = "open" | "accepted" | "deferred" | "dismissed";
export interface SuggestionDto extends Suggestion {
  status: SuggestionStatus;
  deferUntil: string | null;
  /** True when accepting will also create a task in the Execution Center. */
  createsTask: boolean;
}

const DAY = 86_400_000;
const days = (from: string | null | undefined, to: number) => (from ? Math.floor((to - Date.parse(from)) / DAY) : 0);
const label = (m: string | null) => (m ? (RESULT_METRIC_LABELS[m as ResultMetric] ?? m).toLowerCase() : "the main result");

export function computeSuggestions(s: GrowthSnapshot): Suggestion[] {
  const now = Date.parse(s.now);
  const out: Suggestion[] = [];
  const active = s.campaigns.filter((c) => c.status === "active");

  for (const c of active) {
    const link = `/execution`;
    const base = { strategyId: c.id };

    // Waiting for a decision.
    for (const d of c.deliverables.filter((x) => x.status === "awaiting_approval")) {
      const waited = days(d.submittedAt, now);
      if (waited < 2) continue;
      out.push({
        ...base, key: `approval:${d.id}`, category: waited >= 5 ? "urgent" : "important", kind: "operational", actor: "owner",
        title: `Approve or return "${d.title}"`,
        what: "Open it, then approve it or ask for specific changes.",
        why: `"${c.title}" cannot move on while this waits, and later deadlines slip with it.`,
        evidence: [{ label: "observed", text: `Submitted ${waited} days ago and still awaiting a decision.` }],
        effort: "Small - about 5 minutes", dependencies: [], measure: "Time from submission to decision; content going out on its planned date.", link,
      });
    }

    // Blocked or flagged work.
    for (const t of c.tasks.filter((x) => x.status === "blocked")) {
      out.push({
        ...base, key: `blocked:${t.id}`, category: "important", kind: "operational", actor: "team",
        title: `Unblock "${t.title}"`,
        what: "Resolve what is stopping this task, or say who can.",
        why: "Blocked work delays everything that depends on it.",
        evidence: [{ label: "entered", text: `A team member marked it blocked${t.blockedReason ? `: ${t.blockedReason}` : "."}` }],
        effort: "Depends on the blocker", dependencies: [], measure: "The task moving to in progress or done.", link,
      });
    }
    for (const kind of ["deliverable", "task"] as const) {
      for (const i of (kind === "deliverable" ? c.deliverables : c.tasks).filter((x) => x.flagged)) {
        out.push({
          ...base, key: `flag:${kind}:${i.id}`, category: "important", kind: "strategic", actor: "owner",
          title: `Decide what to do about "${i.title}"`,
          what: "Read the reason it was flagged, then keep the plan, change it, or drop the item.",
          why: "Someone doing the work believes the plan may need to change.",
          evidence: [{ label: "entered", text: i.blockedReason ? `Flagged by a team member: ${i.blockedReason}` : "Flagged for strategic review." }],
          effort: "Small to medium", dependencies: ["The flag's reason"], measure: "A decision recorded, and the flag cleared.", link: `/bcamp?strategy=${c.id}`,
        });
      }
    }

    // Deadlines that keep slipping or have no owner.
    for (const kind of ["deliverable", "task"] as const) {
      for (const i of (kind === "deliverable" ? c.deliverables : c.tasks)) {
        if (["done", "completed", "cancelled", "approved"].includes(i.status) || i.publishing === "published") continue;
        const overdue = i.dueAt ? days(i.dueAt, now) : 0;
        const soon = i.dueAt && Date.parse(i.dueAt) - now < 7 * DAY && Date.parse(i.dueAt) - now > -DAY;
        const repeated = i.reschedules >= 2;
        if (!(repeated || overdue > 3 || (!i.hasOwner && soon))) continue;
        const reasons: EvidenceItem[] = [];
        if (repeated) reasons.push({ label: "calculated", text: `The deadline has been moved ${i.reschedules} times.` });
        if (overdue > 3) reasons.push({ label: "observed", text: `It is ${overdue} days past its due date.` });
        if (!i.hasOwner) reasons.push({ label: "observed", text: "Nobody is assigned to it." });
        out.push({
          ...base, key: `delay:${kind}:${i.id}`, category: overdue > 7 ? "urgent" : "important", kind: "operational", actor: "owner",
          title: `"${i.title}" needs an owner or a realistic deadline`,
          what: "Assign someone, set a deadline the team can meet, or drop it from the plan.",
          why: "Work that keeps slipping usually has no clear owner or is bigger than planned.",
          evidence: reasons, effort: "Small - about 10 minutes", dependencies: [], measure: "Finished on the new date.", link,
        });
      }
    }

    // Tracking and outcomes.
    const outcomes = c.recordedMetrics.filter((m) => OUTCOME_METRIC_LIST.includes(m));
    const attention = c.recordedMetrics.filter((m) => ATTENTION_METRIC_LIST.includes(m));
    if (c.publishedCount > 0 && outcomes.length === 0) {
      out.push({
        ...base, key: `tracking:${c.id}`, category: "important", kind: "operational", actor: "owner",
        title: c.hasTrackingMethod ? `Record ${label(c.primaryMetric)} for "${c.title}"` : `Set up tracking for "${c.title}"`,
        what: c.hasTrackingMethod
          ? "Enter the numbers you have counted (from your sheet, POS or call log) with where they came from."
          : "Decide how inquiries or orders from this campaign will be counted - a form, coupon code or call log - and write it into the plan.",
        why: "Content is live, but without counting results nobody can tell whether it is helping sales.",
        evidence: [
          { label: "observed", text: `${c.publishedCount} post(s) confirmed published by the platform.` },
          { label: "unknown", text: "No inquiries, leads, orders or revenue have been recorded." },
        ],
        effort: c.hasTrackingMethod ? "Small - about 10 minutes" : "Medium - needs a small process",
        dependencies: c.hasTrackingMethod ? [] : ["A way to count inquiries or orders"],
        measure: `Recorded ${label(c.primaryMetric)} for the campaign period.`, link: `/bcamp?strategy=${c.id}&tab=results`,
      });
    } else if (attention.length > 0 && outcomes.length === 0) {
      out.push({
        ...base, key: `attention:${c.id}`, category: "important", kind: "strategic", actor: "owner",
        title: `Attention is recorded for "${c.title}", but no sales results`,
        what: "Start recording inquiries, orders or revenue alongside it.",
        why: "Likes and views show attention, not sales.",
        evidence: [
          { label: "entered", text: `Recorded: ${attention.map(label).join(", ")}.` },
          { label: "unknown", text: "Whether that attention led to inquiries or sales." },
        ],
        effort: "Small to medium", dependencies: [], measure: "At least one outcome measure recorded for the same period.", link: `/bcamp?strategy=${c.id}&tab=results`,
      });
    }

    // Approaching or past the end date.
    if (c.endsAt) {
      const left = Math.ceil((Date.parse(c.endsAt) - now) / DAY);
      if (left <= 7 && (!c.reviewedAt || Date.parse(c.reviewedAt) < Date.parse(c.endsAt) - 14 * DAY)) {
        out.push({
          ...base, key: `review:${c.id}`, category: left < 0 ? "urgent" : "important", kind: "strategic", actor: "owner",
          title: `Review "${c.title}"`,
          what: "Run the campaign review, record what you learned, and decide what to try next.",
          why: left < 0 ? "The planned end date has passed and no review has been done." : `The planned end date is ${left <= 0 ? "today" : `in ${left} day(s)`}.`,
          evidence: [{ label: "calculated", text: `Planned end date: ${c.endsAt.slice(0, 10)}.` }, { label: c.reviewedAt ? "observed" : "unknown", text: c.reviewedAt ? `Last reviewed ${c.reviewedAt.slice(0, 10)}.` : "It has not been reviewed yet." }],
          effort: "Medium - about 30 minutes", dependencies: ["Results entered for the period"], measure: "A recorded learning and a decision about the next campaign.", link: `/bcamp?strategy=${c.id}&tab=results`,
        });
      }
    }

    if (c.pendingRevision) {
      out.push({
        ...base, key: `revision:${c.id}`, category: "urgent", kind: "strategic", actor: "owner",
        title: `Decide on the proposed changes to "${c.title}"`,
        what: "Compare the proposal with the current plan, then approve or reject it.",
        why: "Nothing changes until you decide, and the team keeps working from the current plan meanwhile.",
        evidence: [{ label: "observed", text: "A revision is waiting for a decision." }],
        effort: "Small to medium", dependencies: [], measure: "A decision recorded.", link: `/bcamp?strategy=${c.id}&tab=results`,
      });
    }

    if (c.spendRecorded && !c.spendApproved) {
      out.push({
        ...base, key: `spend:${c.id}`, category: "important", kind: "strategic", actor: "owner",
        title: `Spend is recorded for "${c.title}" but the plan says it was never approved`,
        what: "Confirm the budget in the plan so the record matches reality.",
        why: "Plans and spending should agree, otherwise cost results are hard to trust.",
        evidence: [{ label: "entered", text: "A spend figure was entered." }, { label: "observed", text: "The plan's budget is still marked as not approved." }],
        effort: "Small", dependencies: [], measure: "Budget approval matches recorded spend.", link: `/bcamp?strategy=${c.id}`,
      });
    }
  }

  // Drafts that were never decided.
  for (const c of s.campaigns.filter((x) => x.status === "draft")) {
    const idle = days(c.updatedAt, now);
    if (idle >= 14) {
      out.push({
        key: `draft:${c.id}`, category: "optional", kind: "strategic", actor: "owner", strategyId: c.id,
        title: `Approve or archive the draft "${c.title}"`,
        what: "Either approve it so it can become work, or archive it.",
        why: "Old drafts make it unclear what the current strategy is.",
        evidence: [{ label: "observed", text: `Not edited for ${idle} days.` }],
        effort: "Small", dependencies: [], measure: "One clear active strategy.", link: `/bcamp?strategy=${c.id}`,
      });
    }
  }

  // Goals with nothing behind them.
  for (const g of s.goals) {
    if (g.supportedBy === 0) {
      out.push({
        key: `goal:${g.key}`, category: "important", kind: "strategic", actor: "owner", strategyId: null,
        title: `No active campaign supports your ${g.label.toLowerCase()}`,
        what: "Start a campaign aimed at this goal in B Camp.",
        why: "A goal without a plan behind it rarely moves on its own.",
        evidence: [{ label: "entered", text: `You wrote: "${g.target.slice(0, 120)}".` }, { label: "observed", text: "No active campaign measures this." }],
        effort: "Medium - about 20 minutes", dependencies: [], measure: "Progress recorded toward the goal.", link: "/bcamp",
      });
    }
  }

  if (s.campaigns.length === 0) {
    out.push({
      key: "first-strategy", category: "important", kind: "strategic", actor: "owner", strategyId: null,
      title: "Start your first campaign strategy",
      what: "Pick a goal in B Camp and get a plan you can review and edit.",
      why: "Everything else here - tracking, insights, next actions - builds on a plan.",
      evidence: [{ label: "observed", text: "No strategy exists yet." }],
      effort: "Medium - about 20 minutes", dependencies: [], measure: "An approved plan with tasks assigned.", link: "/bcamp",
    });
  }
  if (!s.hasDiagnosis) {
    out.push({
      key: "diagnose", category: "optional", kind: "strategic", actor: "owner", strategyId: null,
      title: "Run a Guava diagnosis",
      what: "Tell Guava about the business and get a diagnosis to plan from.",
      why: "Plans are stronger when they start from a diagnosis of where sales are lost.",
      evidence: [{ label: "observed", text: "No diagnosis has been completed." }],
      effort: "Medium", dependencies: [], measure: "A completed diagnosis.", link: "/guava",
    });
  }

  const order = { urgent: 0, important: 1, optional: 2 } as const;
  return out.map((x, i) => ({ x, i })).sort((a, b) => order[a.x.category] - order[b.x.category] || a.i - b.i).map((v) => v.x);
}

/* ------------------------------ campaign insights ------------------------- */

export interface InsightItem {
  kind: "execution" | "outcome" | "tracking" | "timing" | "cost";
  text: string;
  evidence: EvidenceItem[];
}

export interface InsightDeliverable {
  status: string;
  dueAt: string | null;
  /** When it was approved, completed or published - whichever happened. */
  finishedAt: string | null;
  publishing: string;
}

export interface CampaignInsightsInput {
  plan: StrategyPlan;
  startsAt: string | null;
  now: string;
  deliverables: InsightDeliverable[];
  taskCounts: { total: number; done: number };
  results: ResultRow[];
}

export interface MetricLine {
  metric: string;
  label: string;
  isOutcome: boolean;
  values: { source: ResultSource; evidence: EvidenceLabel; value: number }[];
}

export interface CampaignInsightsDto {
  strategyId: string;
  title: string;
  objective: { outcome: string; metric: string; target: string; targetBasis: string; period: string };
  execution: { planned: number; created: number; approvedOrDone: number; published: number; tasksDone: number; tasksTotal: number };
  dates: { plannedStart: string | null; plannedEnd: string | null; firstFinishedAt: string | null; lateCount: number; avgLateDays: number | null; overdueOpen: number };
  budget: { proposed: string; approved: boolean; actualSpend: number | null; evidence: EvidenceLabel };
  metrics: MetricLine[];
  gaps: string[];
  insights: InsightItem[];
  hasOutcomeData: boolean;
}

export function plannedEnd(plan: StrategyPlan, startsAt: string | null): string | null {
  if (!startsAt || !plan.timeline.length) return null;
  const last = Math.max(...plan.timeline.map((t) => t.endOffsetDays));
  return new Date(Date.parse(startsAt) + last * DAY).toISOString();
}

export function buildInsights(input: CampaignInsightsInput): Omit<CampaignInsightsDto, "strategyId" | "title"> {
  const { plan, results } = input;
  const now = Date.parse(input.now);
  const summary: MetricSummary[] = summarizeResults(results);
  const metrics: MetricLine[] = summary.map((m) => ({
    metric: m.metric,
    label: m.metric === "other" ? (results.find((r) => r.metric === "other" && r.label)?.label ?? "Other") : (RESULT_METRIC_LABELS[m.metric as ResultMetric] ?? m.metric),
    isOutcome: OUTCOME_METRIC_LIST.includes(m.metric),
    values: (Object.entries(m.bySource) as [ResultSource, number][]).map(([source, value]) => ({ source, evidence: evidenceForSource(source), value })),
  }));
  const { gaps, outcomesTracked } = measurementGaps(plan, results);

  const ds = input.deliverables.filter((d) => d.status !== "cancelled");
  const finished = ds.filter((d) => d.finishedAt && d.dueAt);
  const late = finished.filter((d) => Date.parse(d.finishedAt!) - Date.parse(d.dueAt!) > DAY / 2);
  const avgLate = late.length ? Math.round((late.reduce((n, d) => n + (Date.parse(d.finishedAt!) - Date.parse(d.dueAt!)), 0) / late.length / DAY) * 10) / 10 : null;
  const overdueOpen = ds.filter((d) => !d.finishedAt && d.dueAt && now - Date.parse(d.dueAt) > DAY / 2 && !["completed"].includes(d.status)).length;
  const approvedOrDone = ds.filter((d) => ["approved", "completed"].includes(d.status)).length;
  const published = ds.filter((d) => d.publishing === "published").length;
  const firsts = ds.map((d) => d.finishedAt).filter((x): x is string => !!x).sort();

  const spendRows = results.filter((r) => r.metric === "spend" && r.source !== "estimate");
  const actualSpend = spendRows.length ? spendRows.reduce((n, r) => n + r.value, 0) : null;
  const spendEvidence: EvidenceLabel = spendRows.length ? "entered" : "unknown";

  const insights: InsightItem[] = [];
  insights.push({
    kind: "execution",
    text: `${approvedOrDone} of ${plan.deliverables.reduce((n, d) => n + d.count, 0)} planned deliverables are approved or done, and ${input.taskCounts.done} of ${input.taskCounts.total} tasks are finished. This is progress on the work, not a business result.`,
    evidence: [{ label: "calculated", text: "Counted from deliverable and task status in the Execution Center." }],
  });
  if (published > 0) {
    insights.push({ kind: "execution", text: `${published} piece(s) of content were published.`, evidence: [{ label: "observed", text: "Confirmed by the publishing service." }] });
  }
  if (late.length > 0) {
    insights.push({
      kind: "timing",
      text: `${late.length} deliverable(s) finished after their due date, by ${avgLate} day(s) on average.`,
      evidence: [{ label: "calculated", text: "Due date compared with the date it was approved, completed or published." }],
    });
  }
  if (overdueOpen > 0) {
    insights.push({ kind: "timing", text: `${overdueOpen} deliverable(s) are past their due date and not finished.`, evidence: [{ label: "observed", text: "Due dates and status recorded in the Execution Center." }] });
  }

  const outcomeLines = metrics.filter((m) => m.isOutcome);
  for (const m of outcomeLines) {
    const v = m.values[0]!;
    insights.push({
      kind: "outcome",
      text: `${v.value.toLocaleString()} ${m.label.toLowerCase()} were recorded for this campaign's period. That does not show the campaign caused them.`,
      evidence: [{ label: v.evidence, text: v.evidence === "estimated" ? "This figure is marked as an estimate." : "Entered by a person; the platform has not verified it." }, { label: "unknown", text: "How many would have happened without the campaign." }],
    });
  }
  if (!outcomesTracked) {
    const attention = metrics.filter((m) => ATTENTION_METRIC_LIST.includes(m.metric));
    insights.push({
      kind: "tracking",
      text: attention.length
        ? `Attention was recorded (${attention.map((m) => m.label.toLowerCase()).join(", ")}) but no sales results. Whether it turned into customers is not known.`
        : "No results of any kind are recorded yet, so what this campaign achieved is not known.",
      evidence: [{ label: "unknown", text: "No inquiries, leads, bookings, orders or revenue recorded." }],
    });
  }

  // Cost per result: only when both figures exist, and never as proof of cause.
  const primary = kpiMetric(plan.measurement.primaryKpi);
  const primaryLine = primary ? metrics.find((m) => m.metric === primary && m.metric !== "avg_order_value") : undefined;
  const primaryTotal = primaryLine?.values.filter((v) => v.source !== "estimate").reduce((n, v) => n + v.value, 0);
  if (actualSpend && primaryLine && primaryTotal && primary && OUTCOME_METRIC_LIST.includes(primary)) {
    insights.push({
      kind: "cost",
      text: `Recorded spend divided by recorded ${primaryLine.label.toLowerCase()} is about ${Math.round(actualSpend / primaryTotal).toLocaleString()} each. Treat it as a rough guide.`,
      evidence: [{ label: "calculated", text: "Spend and results were entered separately and may not cover exactly the same period." }],
    });
  }

  // Target vs recorded, only when both are plain numbers.
  const target = parseTargetNumber(plan.objective.targetValue);
  if (target && primaryLine && primaryTotal) {
    const basis = plan.objective.targetBasis;
    insights.push({
      kind: "outcome",
      text: `Recorded ${primaryLine.label.toLowerCase()}: ${primaryTotal.toLocaleString()} against a target of ${target.toLocaleString()}.`,
      evidence: [
        { label: "calculated", text: "Recorded total (entered or observed) compared with the target in the plan." },
        { label: basis === "user" || basis === "historical" ? "entered" : "estimated", text: basis === "user" || basis === "historical" ? "The target came from you or from past results." : "The target was a proposal, so falling short does not mean the campaign failed." },
      ],
    });
  }

  return {
    objective: {
      outcome: plan.objective.outcome,
      metric: plan.objective.metric || plan.measurement.primaryKpi,
      target: plan.objective.targetValue,
      targetBasis: plan.objective.targetBasis,
      period: plan.objective.period,
    },
    execution: {
      planned: plan.deliverables.reduce((n, d) => n + d.count, 0),
      created: ds.length,
      approvedOrDone,
      published,
      tasksDone: input.taskCounts.done,
      tasksTotal: input.taskCounts.total,
    },
    dates: {
      plannedStart: input.startsAt,
      plannedEnd: plannedEnd(plan, input.startsAt),
      firstFinishedAt: firsts[0] ?? null,
      lateCount: late.length,
      avgLateDays: avgLate,
      overdueOpen,
    },
    budget: { proposed: plan.budget.proposedAmount, approved: plan.budget.spendApproved, actualSpend, evidence: spendEvidence },
    metrics,
    gaps,
    insights,
    hasOutcomeData: outcomesTracked,
  };
}

/* -------------------------------- learnings ------------------------------- */

export interface LearningSnapshot {
  objective: string;
  metric: string;
  audience: string;
  location: string;
  offer: string;
  message: string;
  channels: string[];
  formats: string[];
  execution: { deliverablesPlanned: number; approvedOrDone: number; published: number; tasksDone: number; tasksTotal: number };
  outcomes: { metric: string; label: string; values: { source: ResultSource; value: number }[] }[];
  dataSources: string[];
  period: { start: string | null; end: string | null };
  review: { supported: string[]; unknown: string[]; keep: string[]; stop: string[]; change: string[]; nextTest: string[] } | null;
  comparability: string[];
  planVersion: number;
}

/** Why a single campaign's result should not be treated as a rule. Always at least one note. */
export function comparabilityNotes(i: { outcomeRows: number; outcomeKinds: number; windowDays: number | null; hasTracking: boolean; published: number; sources: string[]; reviewed: boolean }): string[] {
  const n: string[] = ["This is one campaign for one business. It shows what happened here, not what works in general."];
  if (i.outcomeRows === 0) n.push("No business outcomes were recorded, so nothing about results can be concluded.");
  else if (i.outcomeRows < 3) n.push("Only a few outcome figures were recorded, so the evidence is thin.");
  if (!i.hasTracking) n.push("There was no tracking method, so results cannot be tied to this campaign's activity.");
  if (i.windowDays !== null && i.windowDays < 14) n.push("The campaign ran for a short time; results may not be representative.");
  if (i.published === 0) n.push("Nothing was confirmed published from the platform, so the activity itself is uncertain.");
  if (i.sources.includes("estimate")) n.push("Some figures are estimates.");
  if (i.sources.length && !i.sources.includes("observed")) n.push("All figures were entered by people and are not independently verified.");
  n.push("Seasonality, offers and other activity may differ next time, so results may not be comparable.");
  if (!i.reviewed) n.push("No review was written, so the conclusions here are not yet interpreted.");
  return n;
}

export interface CampaignLearningDto {
  id: string;
  strategyId: string;
  title: string;
  status: StrategyStatus;
  snapshot: LearningSnapshot;
  nextStep: string | null;
  updatedAt: string;
}

/* -------------------------------- revisions ------------------------------- */

export const REVISION_FOCUS = ["audience", "offer", "message", "channels", "formats", "timeline", "budget", "tracking"] as const;
export type RevisionFocus = (typeof REVISION_FOCUS)[number];
export const REVISION_FOCUS_LABELS: Record<RevisionFocus, string> = {
  audience: "Audience",
  offer: "Offer",
  message: "Message",
  channels: "Channels",
  formats: "Creative formats",
  timeline: "Timeline",
  budget: "Budget",
  tracking: "Tracking",
};

/**
 * Take from `proposed` only the parts of the plan the user asked to revise.
 * Everything else stays exactly as the current plan, and spend can never be
 * approved by a revision.
 */
export function applyRevisionFocus(current: StrategyPlan, proposed: StrategyPlan, focus: readonly RevisionFocus[]): StrategyPlan {
  const next: StrategyPlan = JSON.parse(JSON.stringify(current)) as StrategyPlan;
  const f = new Set(focus);
  if (f.has("audience")) next.audience = proposed.audience;
  if (f.has("offer")) {
    next.offer = { ...next.offer, promoting: proposed.offer.promoting, benefit: proposed.offer.benefit, requirements: proposed.offer.requirements };
  }
  if (f.has("message")) next.offer = { ...next.offer, message: proposed.offer.message, cta: proposed.offer.cta };
  if (f.has("channels")) next.channels = proposed.channels;
  if (f.has("formats")) next.deliverables = proposed.deliverables;
  if (f.has("timeline")) next.timeline = proposed.timeline;
  if (f.has("budget")) {
    next.budget = { ...next.budget, proposedAmount: proposed.budget.proposedAmount, currency: proposed.budget.currency, resources: proposed.budget.resources, people: proposed.budget.people, constraints: proposed.budget.constraints };
  }
  if (f.has("tracking")) next.measurement = proposed.measurement;
  return next;
}

export interface RevisionDto {
  id: string;
  strategyId: string;
  baseVersion: number;
  currentVersion: number;
  /** The plan changed after this was proposed, so it must be re-proposed. */
  stale: boolean;
  rationale: string;
  focus: RevisionFocus[];
  changes: PlanChange[];
  status: "pending" | "approved" | "rejected" | "superseded";
  createdAt: string;
  createdBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
}

/* ------------------------------ dashboard DTO ----------------------------- */

export interface CampaignStatusDto {
  id: string;
  title: string;
  status: StrategyStatus;
  execution: {
    deliverables: { total: number; done: number; awaitingApproval: number };
    tasks: { total: number; done: number; overdue: number; blocked: number };
    published: number;
  };
  outcomes: { state: "tracked" | "attention_only" | "none"; recorded: string[] };
  endsAt: string | null;
  blockers: number;
  pendingRevision: boolean;
}

export interface GrowthDashboardDto {
  brandId: string;
  brandName: string;
  industry: string | null;
  canManage: boolean;
  goals: GoalDto[];
  campaigns: CampaignStatusDto[];
  deadlines: { kind: "task" | "deliverable"; id: string; title: string; dueAt: string; overdue: boolean; strategyId: string; strategyTitle: string; owner: string | null }[];
  blockers: { kind: "task" | "deliverable"; id: string; title: string; reason: string; strategyId: string; strategyTitle: string; flagged: boolean }[];
  recentResults: (ResultRow & { strategyId: string; strategyTitle: string })[];
  changes: { since: string; items: { text: string; at: string; strategyId: string | null }[] };
  missing: { text: string; link: string }[];
  suggestions: SuggestionDto[];
  handled: SuggestionDto[];
  learnings: { count: number };
}

/* -------------------------------- requests -------------------------------- */

export const decideSuggestionSchema = z.object({
  key: z.string().min(1).max(160),
  action: z.enum(["accept", "dismiss", "defer"]),
  deferDays: z.number().int().min(1).max(90).optional(),
  note: z.string().trim().max(500).optional(),
});
export const proposeRevisionSchema = z.object({
  focus: z.array(z.enum(REVISION_FOCUS)).min(1).max(8),
  note: z.string().trim().max(1000).optional(),
});
export const decideRevisionSchema = z.object({
  action: z.enum(["approve", "reject"]),
  note: z.string().trim().max(1000).optional(),
});
export const recordLearningSchema = z.object({ nextStep: z.string().trim().max(1500).optional() });
