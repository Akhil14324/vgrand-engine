"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, ChevronDown, Clock, Flag, Loader2 } from "lucide-react";
import {
  CATEGORY_TEXT,
  RESULT_METRIC_LABELS,
  RESULT_SOURCE_LABELS,
  type BrandDto,
  type CampaignStatusDto,
  type GoalDto,
  type GrowthDashboardDto,
  type ResultMetric,
  type SuggestionDto,
} from "@catgpt/types";
import { CampShell, fmtDay } from "@/components/camp-shell";
import { EvidenceBadge, EvidenceList } from "@/components/evidence";
import { useDecideSuggestion, useGrowthDashboard } from "@/lib/growth-hooks";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toaster";

export function GrowthView() {
  return (
    <CampShell title="Growth" subtitle="What is happening, what it means, and what to do next" current="growth">
      {(brand) => <Dashboard brand={brand} />}
    </CampShell>
  );
}

function Dashboard({ brand }: { brand: BrandDto }) {
  const { data, isLoading } = useGrowthDashboard(brand.id);
  if (isLoading || !data) return <Skeleton className="h-64 w-full" />;
  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Work progress and business results are shown separately. Finishing tasks is progress on the work, not proof the marketing brought in sales.
      </p>
      <NextActions data={data} />
      <Goals goals={data.goals} />
      <Campaigns campaigns={data.campaigns} />
      <div className="grid gap-6 md:grid-cols-2">
        <Deadlines data={data} />
        <RecentResults data={data} />
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        <Changes data={data} />
        <Missing data={data} />
      </div>
      <Card className="flex flex-wrap items-center gap-2 p-4 text-sm">
        <span className="font-medium">Campaign learnings</span>
        <span className="text-muted-foreground">
          {data.learnings.count
            ? `${data.learnings.count} recorded. New plans consider them as evidence, not rules.`
            : "None yet. After reviewing a campaign, record what you learned and it will inform future plans."}
        </span>
      </Card>
    </div>
  );
}

/* ---------------------------- next best actions ---------------------------- */

function NextActions({ data }: { data: GrowthDashboardDto }) {
  const mine = data.suggestions.filter((s) => s.actor === "owner");
  const team = data.suggestions.filter((s) => s.actor === "team");
  return (
    <section className="space-y-3">
      <h2 className="text-base font-semibold">Next best actions</h2>
      {data.suggestions.length === 0 ? (
        <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
          Nothing needs attention right now. Suggestions appear here when a campaign is stuck, missing tracking, or nearing its end.
        </p>
      ) : (
        <>
          {mine.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-medium text-muted-foreground">{data.canManage ? "Needs your decision" : "Needs the business owner"}</h3>
              {mine.map((s) => (
                <SuggestionCard key={s.key} s={s} brandId={data.brandId} canAct={data.canManage} />
              ))}
            </div>
          )}
          {team.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-medium text-muted-foreground">Team members can handle these</h3>
              {team.map((s) => (
                <SuggestionCard key={s.key} s={s} brandId={data.brandId} canAct />
              ))}
            </div>
          )}
        </>
      )}
      {data.handled.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground">Accepted or deferred ({data.handled.length})</summary>
          <ul className="mt-2 space-y-1">
            {data.handled.map((s) => (
              <li key={s.key} className="flex flex-wrap items-center gap-2">
                <Badge variant="muted">{s.status === "deferred" ? `Deferred until ${fmtDay(s.deferUntil)}` : "Accepted"}</Badge>
                <Link href={s.link} className="hover:underline">
                  {s.title}
                </Link>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

const CAT_VARIANT = { urgent: "destructive", important: "default", optional: "muted" } as const;

function SuggestionCard({ s, brandId, canAct }: { s: SuggestionDto; brandId: string; canAct: boolean }) {
  const [open, setOpen] = useState(false);
  const decide = useDecideSuggestion(brandId);
  const go = (action: "accept" | "dismiss" | "defer") =>
    decide.mutate(
      { key: s.key, action, deferDays: action === "defer" ? 7 : undefined },
      {
        onSuccess: (r) => toast.success(r.taskCreated ? "Accepted - a task was added to the Execution Center" : action === "accept" ? "Accepted" : action === "defer" ? "Deferred for a week" : "Dismissed"),
        onError: (e) => toast.error(e.message),
      },
    );
  return (
    <Card className="space-y-2 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={CAT_VARIANT[s.category]} title={CATEGORY_TEXT[s.category]}>
          {s.category}
        </Badge>
        <Badge variant="outline">{s.kind === "operational" ? "Operational" : "Strategic"}</Badge>
        <span className="min-w-0 flex-1 font-medium leading-snug">{s.title}</span>
      </div>
      <p className="text-sm text-muted-foreground">{s.what}</p>
      <button type="button" onClick={() => setOpen(!open)} className="flex items-center gap-1 text-xs text-primary hover:underline" aria-expanded={open}>
        Why and evidence <ChevronDown className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="space-y-2 rounded-md bg-muted/40 p-3 text-sm">
          <p>
            <span className="font-medium">Why it matters: </span>
            {s.why}
          </p>
          <EvidenceList items={s.evidence} />
          <p className="text-muted-foreground">
            <span className="font-medium text-foreground">Effort: </span>
            {s.effort}
            {s.dependencies.length ? ` · Needs: ${s.dependencies.join(", ")}` : ""}
          </p>
          <p className="text-muted-foreground">
            <span className="font-medium text-foreground">Measure: </span>
            {s.measure}
          </p>
          <p className="text-xs text-muted-foreground">{CATEGORY_TEXT[s.category]}.</p>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" asChild>
          <Link href={s.link}>Open</Link>
        </Button>
        {canAct ? (
          <>
            <Button size="sm" disabled={decide.isPending} onClick={() => go("accept")}>
              {decide.isPending && <Loader2 className="animate-spin" />}
              {s.createsTask ? "Accept and add a task" : "Accept"}
            </Button>
            <Button size="sm" variant="ghost" disabled={decide.isPending} onClick={() => go("defer")}>
              Defer a week
            </Button>
            <Button size="sm" variant="ghost" disabled={decide.isPending} onClick={() => go("dismiss")}>
              Dismiss
            </Button>
          </>
        ) : (
          <span className="self-center text-xs text-muted-foreground">Only the owner can decide this.</span>
        )}
      </div>
    </Card>
  );
}

/* ---------------------------------- goals ---------------------------------- */

function Goals({ goals }: { goals: GoalDto[] }) {
  return (
    <section className="space-y-2">
      <h2 className="text-base font-semibold">Growth goals</h2>
      {goals.length === 0 ? (
        <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
          No goals recorded. Add your goals and targets in{" "}
          <Link href="/guava" className="text-primary hover:underline">
            your business profile
          </Link>{" "}
          so progress can be tracked against them.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {goals.map((g) => (
            <Card key={g.key} className="space-y-2 p-4">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-muted-foreground">{g.label}</p>
                  <p className="text-sm font-medium">{g.target}</p>
                </div>
                <EvidenceBadge label="entered" />
              </div>
              {g.current && <p className="text-xs text-muted-foreground">Today, you said: {g.current}</p>}
              {g.progress ? (
                <div className="space-y-1">
                  <Progress value={Math.min(100, g.progress.pct)} />
                  <p className="text-xs">
                    {g.progress.recorded.toLocaleString()} {g.progress.metric.toLowerCase()} recorded of {g.progress.target.toLocaleString()} ({g.progress.pct}%)
                  </p>
                  <p className="text-xs text-muted-foreground">
                    <EvidenceBadge label={g.progress.evidence} /> {g.progress.note}
                  </p>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  <EvidenceBadge label="unknown" /> {g.note}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                {g.supportedBy.length ? (
                  <>
                    Supported by:{" "}
                    {g.supportedBy.map((s, i) => (
                      <span key={s.strategyId}>
                        {i > 0 && ", "}
                        <Link href={`/bcamp?strategy=${s.strategyId}&tab=insights`} className="hover:underline">
                          {s.title}
                        </Link>
                      </span>
                    ))}
                  </>
                ) : (
                  <>
                    No active campaign supports this.{" "}
                    <Link href="/bcamp" className="text-primary hover:underline">
                      Start one
                    </Link>
                  </>
                )}
              </p>
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}

/* -------------------------------- campaigns -------------------------------- */

const OUTCOME_TEXT = {
  tracked: { text: "Some business results are recorded", label: "entered" as const },
  attention_only: { text: "Only attention (likes, reach, clicks) is recorded, no sales results", label: "entered" as const },
  none: { text: "No results recorded, so effect on sales is unknown", label: "unknown" as const },
};

function Campaigns({ campaigns }: { campaigns: CampaignStatusDto[] }) {
  return (
    <section className="space-y-2">
      <h2 className="text-base font-semibold">Active campaigns</h2>
      {campaigns.length === 0 ? (
        <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
          No active campaigns.{" "}
          <Link href="/bcamp" className="text-primary hover:underline">
            Plan one in B Camp
          </Link>
          .
        </p>
      ) : (
        <div className="space-y-3">
          {campaigns.map((c) => {
            const e = c.execution;
            const total = e.deliverables.total + e.tasks.total;
            const done = e.deliverables.done + e.tasks.done;
            const o = OUTCOME_TEXT[c.outcomes.state];
            return (
              <Card key={c.id} className="space-y-3 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`/bcamp?strategy=${c.id}&tab=insights`} className="min-w-0 flex-1 font-medium hover:underline">
                    {c.title}
                  </Link>
                  {c.pendingRevision && <Badge variant="destructive">Revision awaiting decision</Badge>}
                  {c.endsAt && <span className="text-xs text-muted-foreground">Planned end {fmtDay(c.endsAt)}</span>}
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1 rounded-md border p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Work progress</p>
                    {total > 0 ? <Progress value={Math.round((done / total) * 100)} /> : null}
                    <p className="text-sm">
                      {e.deliverables.done}/{e.deliverables.total} deliverables approved or done · {e.tasks.done}/{e.tasks.total} tasks done
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {e.published} published
                      {e.deliverables.awaitingApproval ? ` · ${e.deliverables.awaitingApproval} awaiting approval` : ""}
                      {e.tasks.overdue ? ` · ${e.tasks.overdue} overdue` : ""}
                      {c.blockers ? ` · ${c.blockers} blocker(s)` : ""}
                    </p>
                  </div>
                  <div className="space-y-1 rounded-md border p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Business results</p>
                    <p className="text-sm">{o.text}</p>
                    <p className="text-xs text-muted-foreground">
                      <EvidenceBadge label={o.label} />{" "}
                      {c.outcomes.recorded.length ? c.outcomes.recorded.map((m) => RESULT_METRIC_LABELS[m as ResultMetric] ?? m).join(", ") : "Nothing recorded"}
                    </p>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </section>
  );
}

/* --------------------------------- panels ---------------------------------- */

function Deadlines({ data }: { data: GrowthDashboardDto }) {
  return (
    <Card className="space-y-3 p-4">
      <h2 className="text-sm font-semibold">Deadlines and blockers</h2>
      {data.blockers.length > 0 && (
        <ul className="space-y-1 text-sm">
          {data.blockers.map((b) => (
            <li key={`${b.kind}${b.id}`} className="flex items-start gap-2">
              {b.flagged ? <Flag className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" /> : <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />}
              <span>
                <Link href="/execution" className="font-medium hover:underline">
                  {b.title}
                </Link>{" "}
                <span className="text-muted-foreground">
                  {b.reason} ({b.strategyTitle})
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {data.deadlines.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing due in the next two weeks.</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {data.deadlines.map((d) => (
            <li key={`${d.kind}${d.id}`} className="flex items-center gap-2">
              <Clock className={`h-3.5 w-3.5 shrink-0 ${d.overdue ? "text-destructive" : "text-muted-foreground"}`} />
              <span className="min-w-0 flex-1 truncate">{d.title}</span>
              <span className="text-xs text-muted-foreground">{d.owner ?? "Unassigned"}</span>
              <span className={`text-xs ${d.overdue ? "font-medium text-destructive" : "text-muted-foreground"}`}>{fmtDay(d.dueAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function RecentResults({ data }: { data: GrowthDashboardDto }) {
  return (
    <Card className="space-y-3 p-4">
      <h2 className="text-sm font-semibold">Recent results</h2>
      {data.recentResults.length === 0 ? (
        <p className="text-sm text-muted-foreground">No results recorded yet. Record inquiries, orders or revenue from a campaign's Results tab.</p>
      ) : (
        <ul className="space-y-2 text-sm">
          {data.recentResults.map((r) => (
            <li key={r.id} className="space-y-0.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">
                  {r.value.toLocaleString()} {r.metric === "other" ? (r.label ?? "other") : (RESULT_METRIC_LABELS[r.metric as ResultMetric] ?? r.metric).toLowerCase()}
                </span>
                <EvidenceBadge label={r.source === "observed" ? "observed" : r.source === "user_entered" ? "entered" : "estimated"} />
              </div>
              <p className="text-xs text-muted-foreground">
                {r.strategyTitle} · {fmtDay(r.periodStart)} to {fmtDay(r.periodEnd)} · {RESULT_SOURCE_LABELS[r.source]}
                {r.enteredBy ? ` by ${r.enteredBy}` : ""}
                {r.sourceNote ? ` · ${r.sourceNote}` : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">Figures entered by people are not independently verified by the platform.</p>
    </Card>
  );
}

function Changes({ data }: { data: GrowthDashboardDto }) {
  return (
    <Card className="space-y-2 p-4">
      <h2 className="text-sm font-semibold">Since the last review</h2>
      <p className="text-xs text-muted-foreground">From {fmtDay(data.changes.since)}</p>
      {data.changes.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing has changed.</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {data.changes.items.map((c, i) => (
            <li key={i} className="flex gap-2">
              <span className="w-14 shrink-0 text-xs text-muted-foreground">{fmtDay(c.at)}</span>
              {c.strategyId ? (
                <Link href={`/bcamp?strategy=${c.strategyId}`} className="hover:underline">
                  {c.text}
                </Link>
              ) : (
                <span>{c.text}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Missing({ data }: { data: GrowthDashboardDto }) {
  return (
    <Card className="space-y-2 p-4">
      <h2 className="text-sm font-semibold">What stops us drawing conclusions</h2>
      {data.missing.length === 0 ? (
        <p className="text-sm text-muted-foreground">No major gaps found.</p>
      ) : (
        <ul className="space-y-1.5 text-sm">
          {data.missing.map((m, i) => (
            <li key={i} className="flex gap-2">
              <EvidenceBadge label="unknown" />
              <Link href={m.link} className="text-muted-foreground hover:underline">
                {m.text}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
