import { describe, expect, it } from "vitest";
import {
  EMPTY_PLAN,
  createResultSchema,
  diffPlanAgainstWork,
  diffPlans,
  kpiMetric,
  measurementGaps,
  planWarnings,
  proposeExecution,
  strategyPlanSchema,
  summarizeResults,
  type StrategyPlan,
} from "@catgpt/types";
import { buildContentPrompt, derivePublishing, groundTargetBasis, manualSteps } from "./execution-logic.js";

const plan = (over: Partial<StrategyPlan> = {}): StrategyPlan =>
  strategyPlanSchema.parse({
    ...EMPTY_PLAN,
    objective: { outcome: "More weekday orders", metric: "orders", targetValue: "", period: "30 days", targetBasis: "unknown" },
    offer: { promoting: "Lunch combo", benefit: "Fast and cheap", message: "Weekday lunch, sorted", cta: "Order today", requirements: "Price to be confirmed" },
    deliverables: [
      { key: "posts", type: "social_post", title: "Combo post", channel: "Instagram", count: 3, dueOffsetDays: 5, brief: "Show the combo" },
      { key: "video", type: "video", title: "Reel", channel: "instagram", count: 1, dueOffsetDays: 10, brief: "" },
    ],
    tasks: [
      { key: "track", title: "Set up order tracking", dueOffsetDays: 1, priority: "high" },
      { key: "review", title: "Weekly review", dueOffsetDays: 7, priority: "medium", repeat: 4, everyWeeks: 1, dependsOnKey: "track" },
      { key: "brief", title: "Write brief", dueOffsetDays: 2, deliverableKey: "posts" },
    ],
    ...over,
  });

const start = new Date("2026-10-01T00:00:00Z");

describe("plan -> execution conversion", () => {
  it("expands counts and repeats into uniquely keyed items", () => {
    const p = proposeExecution(plan(), start);
    expect(p.deliverables.map((d) => d.dedupeKey)).toEqual(["posts#1", "posts#2", "posts#3", "video"]);
    expect(p.tasks.map((t) => t.dedupeKey)).toEqual(["track", "review@1", "review@2", "review@3", "review@4", "brief"]);
    expect(new Set(p.deliverables.map((d) => d.dedupeKey)).size).toBe(4);
  });

  it("is deterministic, so converting twice yields the same keys (idempotent)", () => {
    const a = proposeExecution(plan(), start);
    const b = proposeExecution(plan(), start);
    expect(b.deliverables.map((d) => d.dedupeKey)).toEqual(a.deliverables.map((d) => d.dedupeKey));
    expect(b.tasks.map((t) => t.dedupeKey)).toEqual(a.tasks.map((t) => t.dedupeKey));
  });

  it("keeps the campaign context, deadlines, links and dependencies", () => {
    const p = proposeExecution(plan(), start);
    expect(p.deliverables[0]!.channel).toBe("instagram");
    expect(p.deliverables[0]!.dueAt).toBe("2026-10-06T00:00:00.000Z");
    expect(p.tasks.find((t) => t.dedupeKey === "brief")!.deliverableDedupeKey).toBe("posts#1");
    expect(p.tasks.find((t) => t.dedupeKey === "review@2")!.dependsOnDedupeKey).toBe("track");
    expect(p.tasks.find((t) => t.dedupeKey === "review@2")!.dueAt).toBe("2026-10-15T00:00:00.000Z");
  });
});

describe("plan changes vs existing work", () => {
  const existing = (p: StrategyPlan, statuses: Record<string, string> = {}) => {
    const prop = proposeExecution(p, start);
    return [
      ...prop.deliverables.map((d, i) => ({ kind: "deliverable" as const, id: `d${i}`, dedupeKey: d.dedupeKey, title: d.title, status: statuses[d.dedupeKey] ?? "planned", source: d.source })),
      ...prop.tasks.map((t, i) => ({ kind: "task" as const, id: `t${i}`, dedupeKey: t.dedupeKey, title: t.title, status: statuses[t.dedupeKey] ?? "todo", source: t.source })),
    ];
  };

  it("reports nothing when the plan is unchanged", () => {
    const p = plan();
    const r = diffPlanAgainstWork(p, start, existing(p));
    expect(r.affected).toEqual([]);
    expect(r.added).toEqual([]);
  });

  it("flags changed work and marks work in production or approved as locked", () => {
    const before = plan();
    const work = existing(before, { "video": "approved", "posts#1": "planned" });
    const after = plan({
      deliverables: before.deliverables.map((d) => ({ ...d, brief: `${d.brief} - new angle` })),
    });
    const r = diffPlanAgainstWork(after, start, work);
    const video = r.affected.find((a) => a.dedupeKey === "video")!;
    const post = r.affected.find((a) => a.dedupeKey === "posts#1")!;
    expect(video.locked).toBe(true);
    expect(post.locked).toBe(false);
    expect(post.change).toBe("changed");
    expect(post.fields).toContain("brief");
  });

  it("reports removed and newly added items", () => {
    const before = plan();
    const work = existing(before);
    const after = plan({
      deliverables: before.deliverables.filter((d) => d.key !== "video").concat({ ...before.deliverables[0]!, key: "flyer", type: "flyer", count: 1, title: "Flyer" }),
    });
    const r = diffPlanAgainstWork(after, start, work);
    expect(r.affected.find((a) => a.dedupeKey === "video")!.change).toBe("removed");
    expect(r.added.map((a) => a.dedupeKey)).toContain("flyer");
  });

  it("ignores cancelled work", () => {
    const before = plan();
    const work = existing(before, { video: "cancelled" });
    const after = plan({ deliverables: before.deliverables.filter((d) => d.key !== "video") });
    expect(diffPlanAgainstWork(after, start, work).affected.find((a) => a.dedupeKey === "video")).toBeUndefined();
  });
});

describe("plan diff and warnings", () => {
  it("describes what changed between versions", () => {
    const a = plan();
    const b = plan({ objective: { ...a.objective, period: "60 days" } });
    const d = diffPlans(a, b);
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ before: "30 days", after: "60 days" });
  });

  it("warns about missing tracking, unapproved budget and proposed targets", () => {
    const w = planWarnings(
      plan({
        objective: { ...plan().objective, targetValue: "200 orders", targetBasis: "estimate" },
        budget: { ...EMPTY_PLAN.budget, proposedAmount: "20000", spendApproved: false },
      }),
    ).map((x) => x.text);
    expect(w.some((t) => /tracking method/i.test(t))).toBe(true);
    expect(w.some((t) => /spend is not approved/i.test(t))).toBe(true);
    expect(w.some((t) => /proposal/i.test(t))).toBe(true);
  });

  it("never treats a target as established unless it came from the user's own data", () => {
    expect(groundTargetBasis("user", "200", "we get 100 orders")).toBe("estimate");
    expect(groundTargetBasis("user", "200", "we want 200 orders")).toBe("user");
    expect(groundTargetBasis("user", "", "anything")).toBe("unknown");
  });
});

describe("results honesty", () => {
  const row = (metric: string, value: number, source: "observed" | "user_entered" | "estimate") => ({
    id: metric + source, metric, value, source, channel: null, deliverableId: null, sourceNote: null,
    periodStart: "2026-10-01T00:00:00Z", periodEnd: "2026-10-31T00:00:00Z",
  });

  it("states that sales cannot be verified when only reach is recorded", () => {
    const g = measurementGaps(plan(), [row("reach", 5000, "user_entered")]);
    expect(g.outcomesTracked).toBe(false);
    expect(g.gaps.join(" ")).toMatch(/cannot be verified/);
    expect(g.gaps.join(" ")).toMatch(/not sales/);
  });

  it("flags a missing primary-KPI result even when other outcomes exist", () => {
    const withKpi = plan({ measurement: { ...EMPTY_PLAN.measurement, primaryKpi: "Weekday orders", tracking: "POS report" } });
    const g = measurementGaps(withKpi, [row("leads", 10, "user_entered")]);
    expect(g.outcomesTracked).toBe(true);
    expect(g.gaps.join(" ")).toMatch(/"orders"/);
  });

  it("keeps sources apart and maps KPI text to metrics", () => {
    const s = summarizeResults([row("orders", 10, "user_entered"), row("orders", 4, "estimate")]);
    expect(s[0]!.bySource).toEqual({ user_entered: 10, estimate: 4 });
    expect(kpiMetric("Qualified inquiries")).toBe("inquiries");
    expect(kpiMetric("Weekday orders")).toBe("orders");
  });

  it("rejects a result whose period ends before it starts, and observed data entered by hand", () => {
    const base = { strategyId: crypto.randomUUID(), metric: "orders", value: 3, source: "user_entered", sourceNote: "POS report", periodStart: "2026-10-10T00:00:00Z", periodEnd: "2026-10-01T00:00:00Z" };
    expect(createResultSchema.safeParse(base).success).toBe(false);
    expect(createResultSchema.safeParse({ ...base, periodEnd: "2026-10-20T00:00:00Z" }).success).toBe(true);
    expect(createResultSchema.safeParse({ ...base, periodEnd: "2026-10-20T00:00:00Z", source: "observed" }).success).toBe(false);
  });
});

describe("publishing state", () => {
  const base = { type: "social_post" as const, channel: "instagram", generationId: "g1", posts: [], accounts: [{ platform: "instagram", status: "active" }] };
  const post = (status: string, extra = {}) => ({ status, scheduledFor: null, remoteUrl: null, error: null, createdAt: new Date(), ...extra });

  it("blocks publishing until approved", () => {
    expect(derivePublishing({ ...base, status: "drafting" }).kind).toBe("blocked_by_approval");
    expect(derivePublishing({ ...base, status: "awaiting_approval" }).kind).toBe("blocked_by_approval");
  });

  it("is ready only with an approved item and an active account", () => {
    expect(derivePublishing({ ...base, status: "approved" })).toEqual({ kind: "ready", platform: "instagram" });
    expect(derivePublishing({ ...base, status: "approved", accounts: [] }).kind).toBe("not_connected");
    expect(derivePublishing({ ...base, status: "approved", accounts: [{ platform: "instagram", status: "reauth_required" }] }).kind).toBe("reauth_required");
  });

  it("falls back to manual for unsupported channels, types and missing content", () => {
    expect(derivePublishing({ ...base, status: "approved", channel: "whatsapp" }).kind).toBe("manual");
    expect(derivePublishing({ ...base, status: "approved", type: "video" }).kind).toBe("manual");
    expect(derivePublishing({ ...base, status: "approved", generationId: null }).kind).toBe("manual");
  });

  it("reports published only from a posted record, and failures honestly", () => {
    expect(derivePublishing({ ...base, status: "approved", posts: [post("posting")] }).kind).toBe("scheduled");
    expect(derivePublishing({ ...base, status: "approved", posts: [post("posted", { remoteUrl: "https://x/1" })] })).toEqual({ kind: "published", url: "https://x/1" });
    expect(derivePublishing({ ...base, status: "approved", posts: [post("failed", { error: "boom" })] })).toEqual({ kind: "failed", error: "boom" });
  });

  it("gives manual steps that end in recording what really happened", () => {
    const state = derivePublishing({ ...base, status: "approved", channel: "whatsapp" });
    const steps = manualSteps({ type: "social_post", channel: "whatsapp", state });
    expect(steps.join(" ")).toMatch(/Mark as done/);
    expect(manualSteps({ type: "social_post", channel: "instagram", state: { kind: "published", url: null } })).toEqual([]);
  });
});

describe("content context", () => {
  it("carries the campaign brief, audience, offer, CTA, facts and reviewer feedback", () => {
    const p = plan({ audience: { ...EMPTY_PLAN.audience, who: "Office workers nearby", location: "Hyderabad" } });
    const text = buildContentPrompt({
      plan: p,
      brandName: "Spice Route",
      deliverable: { type: "social_post", title: "Combo post", channel: "instagram", format: "carousel", brief: "Show the combo" },
      feedback: "Make the price clearer",
    });
    for (const part of ["Spice Route", "Office workers nearby", "Lunch combo", "Order today", "Price to be confirmed", "carousel", "Make the price clearer", "Do not invent"]) {
      expect(text).toContain(part);
    }
  });
});
