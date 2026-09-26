import { describe, expect, it } from "vitest";
import {
  EMPTY_PLAN,
  applyRevisionFocus,
  buildInsights,
  computeSuggestions,
  comparabilityNotes,
  parseTargetNumber,
  strategyPlanSchema,
  type CampaignSnapshot,
} from "@catgpt/types";

const NOW = "2026-10-20T00:00:00.000Z";
const camp = (over: Partial<CampaignSnapshot> = {}): CampaignSnapshot => ({
  id: "c1", title: "Diwali", status: "active", updatedAt: NOW, startsAt: "2026-10-01T00:00:00.000Z", endsAt: "2026-11-30T00:00:00.000Z",
  convertedAt: NOW, reviewedAt: null, spendApproved: false, hasTrackingMethod: false, primaryMetric: "orders",
  deliverables: [], tasks: [], recordedMetrics: [], spendRecorded: false, publishedCount: 0, pendingRevision: false, ...over,
});
const snap = (campaigns: CampaignSnapshot[], goals: { key: "revenue"; label: string; target: string; supportedBy: number }[] = []) => ({ now: NOW, hasDiagnosis: true, goals, campaigns });

describe("next best actions", () => {
  it("flags published content with no outcome tracking, without claiming results", () => {
    const s = computeSuggestions(snap([camp({ publishedCount: 3 })])).find((x) => x.key === "tracking:c1")!;
    expect(s.category).toBe("important");
    expect(s.evidence.map((e) => e.label)).toEqual(["observed", "unknown"]);
    expect(s.title).toMatch(/Set up tracking/);
  });

  it("separates attention from sales", () => {
    const s = computeSuggestions(snap([camp({ recordedMetrics: ["engagement"] })])).find((x) => x.key === "attention:c1")!;
    expect(s.kind).toBe("strategic");
    expect(s.why).toMatch(/not sales/);
  });

  it("escalates approvals left waiting and lets only the owner act on them", () => {
    const d = { id: "d1", title: "Reel", status: "awaiting_approval", dueAt: null, hasOwner: true, blockedReason: null, flagged: false, reschedules: 0, submittedAt: "2026-10-10T00:00:00.000Z" };
    const s = computeSuggestions(snap([camp({ deliverables: [d] })])).find((x) => x.key === "approval:d1")!;
    expect(s.category).toBe("urgent");
    expect(s.actor).toBe("owner");
    expect(computeSuggestions(snap([camp({ deliverables: [{ ...d, submittedAt: "2026-10-19T00:00:00.000Z" }] })])).some((x) => x.key === "approval:d1")).toBe(false);
  });

  it("notices repeated deadline changes, unsupported goals and missing reviews", () => {
    const t = { id: "t1", title: "Shoot", status: "todo", dueAt: "2026-10-25T00:00:00.000Z", hasOwner: true, blockedReason: null, flagged: false, reschedules: 3 };
    const keys = computeSuggestions(snap([camp({ tasks: [t], endsAt: "2026-10-22T00:00:00.000Z" })], [{ key: "revenue", label: "Revenue target", target: "5 lakh", supportedBy: 0 }])).map((x) => x.key);
    expect(keys).toEqual(expect.arrayContaining(["delay:task:t1", "goal:revenue", "review:c1"]));
  });

  it("orders urgent before important before optional", () => {
    const list = computeSuggestions(snap([camp({ pendingRevision: true, publishedCount: 1 })]));
    const order = list.map((x) => x.category);
    expect([...order].sort((a, b) => ["urgent", "important", "optional"].indexOf(a) - ["urgent", "important", "optional"].indexOf(b))).toEqual(order);
  });
});

describe("campaign insights", () => {
  const plan = strategyPlanSchema.parse({ ...EMPTY_PLAN, objective: { ...EMPTY_PLAN.objective, targetValue: "100", targetBasis: "estimate" }, measurement: { ...EMPTY_PLAN.measurement, primaryKpi: "Orders", tracking: "POS" }, deliverables: [{ key: "a", type: "social_post", title: "A", count: 2 }] });
  const row = (metric: string, value: number, source: "observed" | "user_entered" | "estimate") => ({ id: metric + source, metric, value, source, channel: null, deliverableId: null, sourceNote: "x", periodStart: NOW, periodEnd: NOW });

  it("keeps execution progress apart from outcomes", () => {
    const r = buildInsights({ plan, startsAt: null, now: NOW, deliverables: [{ status: "approved", dueAt: null, finishedAt: null, publishing: "" }], taskCounts: { total: 4, done: 4 }, results: [] });
    expect(r.hasOutcomeData).toBe(false);
    expect(r.insights[0]!.text).toMatch(/not a business result/);
    expect(r.insights.some((i) => i.kind === "tracking" && i.evidence[0]!.label === "unknown")).toBe(true);
  });

  it("labels outcomes as entered, never as caused, and calls out proposed targets", () => {
    const r = buildInsights({ plan, startsAt: null, now: NOW, deliverables: [], taskCounts: { total: 0, done: 0 }, results: [row("orders", 40, "user_entered"), row("spend", 4000, "user_entered")] });
    const outcome = r.insights.find((i) => i.kind === "outcome" && /recorded for this campaign/.test(i.text))!;
    expect(outcome.evidence[0]!.label).toBe("entered");
    expect(outcome.text).toMatch(/does not show the campaign caused/);
    expect(r.insights.find((i) => i.kind === "cost")!.text).toMatch(/100 each/);
    expect(r.insights.some((i) => /target of 100/.test(i.text) && i.evidence.some((e) => e.label === "estimated"))).toBe(true);
  });

  it("does not count estimates toward cost or target maths", () => {
    const r = buildInsights({ plan, startsAt: null, now: NOW, deliverables: [], taskCounts: { total: 0, done: 0 }, results: [row("orders", 40, "estimate"), row("spend", 4000, "user_entered")] });
    expect(r.insights.some((i) => i.kind === "cost")).toBe(false);
  });
});

describe("revisions and learnings", () => {
  it("takes only the requested sections and never approves spend", () => {
    const current = strategyPlanSchema.parse({ ...EMPTY_PLAN, audience: { ...EMPTY_PLAN.audience, who: "old" }, offer: { ...EMPTY_PLAN.offer, promoting: "keep", message: "old msg" }, budget: { ...EMPTY_PLAN.budget, spendApproved: false } });
    const proposed = strategyPlanSchema.parse({ ...EMPTY_PLAN, audience: { ...EMPTY_PLAN.audience, who: "new" }, offer: { ...EMPTY_PLAN.offer, promoting: "changed", message: "new msg" }, budget: { ...EMPTY_PLAN.budget, spendApproved: true, proposedAmount: "9" } });
    const next = applyRevisionFocus(current, proposed, ["message", "budget"]);
    expect(next.audience.who).toBe("old");
    expect(next.offer.promoting).toBe("keep");
    expect(next.offer.message).toBe("new msg");
    expect(next.budget.proposedAmount).toBe("9");
    expect(next.budget.spendApproved).toBe(false);
  });

  it("parses only unambiguous targets", () => {
    expect(parseTargetNumber("5 lakh")).toBe(500000);
    expect(parseTargetNumber("₹1,50,000 per month")).toBe(150000);
    expect(parseTargetNumber("200 orders")).toBe(200);
    expect(parseTargetNumber("from 100 to 200")).toBeNull();
    expect(parseTargetNumber("grow a lot")).toBeNull();
  });

  it("always warns that one campaign is not a rule, and flags thin evidence", () => {
    const n = comparabilityNotes({ outcomeRows: 1, outcomeKinds: 1, windowDays: 7, hasTracking: false, published: 0, sources: ["user_entered"], reviewed: false }).join(" ");
    for (const part of ["one campaign", "thin", "no tracking method", "short time", "not independently verified"]) expect(n.toLowerCase()).toContain(part.toLowerCase());
  });
});
