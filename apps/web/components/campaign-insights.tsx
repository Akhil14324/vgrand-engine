"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import {
  BASIS_LABELS,
  REVISION_FOCUS,
  REVISION_FOCUS_LABELS,
  RESULT_SOURCE_LABELS,
  type Basis,
  type CampaignInsightsDto,
  type RevisionDto,
  type RevisionFocus,
} from "@catgpt/types";
import { Labeled, fmtDay } from "@/components/camp-shell";
import { EvidenceBadge, EvidenceList } from "@/components/evidence";
import {
  useDecideRevision,
  useInsights,
  useLearning,
  useProposeRevision,
  useRecordLearning,
  useRevisions,
} from "@/lib/growth-hooks";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toaster";

/* --------------------------------- insights -------------------------------- */

export function InsightsPanel({ strategyId }: { strategyId: string }) {
  const { data, isLoading } = useInsights(strategyId);
  if (isLoading || !data) return <Skeleton className="h-48 w-full" />;
  return <InsightsBody d={data} />;
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-0.5 py-1.5 text-sm">
      <span className="w-40 shrink-0 text-muted-foreground">{k}</span>
      <span className="min-w-0 flex-1">{children}</span>
    </div>
  );
}

function InsightsBody({ d }: { d: CampaignInsightsDto }) {
  const e = d.execution;
  return (
    <div className="space-y-4">
      <Card className="space-y-1 p-4">
        <h3 className="text-sm font-semibold">Intended</h3>
        <div className="divide-y">
          <Row k="Objective">{d.objective.outcome || "Not written"}</Row>
          <Row k="Measure and target">
            {d.objective.metric || "No measure defined"}
            {d.objective.target ? ` - target ${d.objective.target}` : " - no target"}
            {d.objective.target && (
              <span className="ml-2 align-middle">
                <EvidenceBadge label={d.objective.targetBasis === "user" || d.objective.targetBasis === "historical" ? "entered" : d.objective.targetBasis === "estimate" ? "estimated" : "unknown"} />
              </span>
            )}
            {d.objective.target && <span className="block text-xs text-muted-foreground">{BASIS_LABELS[d.objective.targetBasis as Basis]}</span>}
          </Row>
          <Row k="Period">{d.objective.period || "Not set"}</Row>
        </div>
      </Card>

      <Card className="space-y-1 p-4">
        <h3 className="text-sm font-semibold">Executed (operational progress, not results)</h3>
        <div className="divide-y">
          <Row k="Deliverables">
            {e.approvedOrDone} of {e.planned} planned approved or done · {e.created} created
          </Row>
          <Row k="Tasks">
            {e.tasksDone} of {e.tasksTotal} done
          </Row>
          <Row k="Published">
            {e.published} <EvidenceBadge label="observed" />
          </Row>
          <Row k="Dates">
            Planned {d.dates.plannedStart ? fmtDay(d.dates.plannedStart) : "start not set"} to {d.dates.plannedEnd ? fmtDay(d.dates.plannedEnd) : "end not set"}
            {d.dates.firstFinishedAt ? ` · first item finished ${fmtDay(d.dates.firstFinishedAt)}` : ""}
            {d.dates.lateCount ? ` · ${d.dates.lateCount} finished late (avg ${d.dates.avgLateDays} days)` : ""}
            {d.dates.overdueOpen ? ` · ${d.dates.overdueOpen} overdue and open` : ""}
          </Row>
          <Row k="Budget">
            {d.budget.proposed ? `Proposed ${d.budget.proposed} (${d.budget.approved ? "approved" : "not approved"})` : "No budget proposed"}
            {" · "}
            {d.budget.actualSpend !== null ? (
              <>
                spent {d.budget.actualSpend.toLocaleString()} <EvidenceBadge label={d.budget.evidence} />
              </>
            ) : (
              <>
                actual spend <EvidenceBadge label="unknown" />
              </>
            )}
          </Row>
        </div>
      </Card>

      <Card className="space-y-2 p-4">
        <h3 className="text-sm font-semibold">Recorded results</h3>
        {d.metrics.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing recorded. Add figures on the Results tab.</p>
        ) : (
          <ul className="divide-y text-sm">
            {d.metrics.map((m) => (
              <li key={m.metric} className="flex flex-wrap items-center gap-2 py-1.5">
                <span className="w-44 font-medium">{m.label}</span>
                {m.isOutcome ? <Badge variant="default">Business outcome</Badge> : <Badge variant="muted">Activity or attention</Badge>}
                {m.values.map((v) => (
                  <span key={v.source} className="flex items-center gap-1">
                    {v.value.toLocaleString()}
                    <EvidenceBadge label={v.evidence} />
                  </span>
                ))}
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-muted-foreground">
          Sources: {Object.values(RESULT_SOURCE_LABELS).join(" / ")}. Figures entered by people are not independently verified.
        </p>
      </Card>

      <Card className="space-y-3 p-4">
        <h3 className="text-sm font-semibold">What the evidence says</h3>
        {d.insights.map((i, n) => (
          <div key={n} className="space-y-1.5 border-l-2 pl-3">
            <p className="text-sm">{i.text}</p>
            <EvidenceList items={i.evidence} />
          </div>
        ))}
      </Card>

      <Card className="space-y-2 border-amber-500/40 p-4">
        <h3 className="text-sm font-semibold">Tracking gaps</h3>
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          {d.gaps.map((g) => (
            <li key={g}>{g}</li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

/* --------------------------------- revisions ------------------------------- */

export function RevisionPanel({ strategyId, canManage, status }: { strategyId: string; canManage: boolean; status: string }) {
  const { data } = useRevisions(strategyId);
  const propose = useProposeRevision(strategyId);
  const decide = useDecideRevision();
  const [focus, setFocus] = useState<RevisionFocus[]>([]);
  const [note, setNote] = useState("");
  const pending = data?.items.find((r) => r.status === "pending");
  const past = data?.items.filter((r) => r.status !== "pending").slice(0, 3) ?? [];
  const eligible = status === "active" || status === "completed";

  return (
    <Card className="space-y-3 p-4">
      <h3 className="text-sm font-semibold">Propose a revision</h3>
      <p className="text-xs text-muted-foreground">
        The current approved plan stays in force. A proposal only takes effect if you approve it, and even then existing work is not changed until you choose it on the Work tab.
      </p>

      {pending && <Proposal r={pending} canManage={canManage} busy={decide.isPending} onDecide={(action) => decide.mutate({ id: pending.id, action }, { onSuccess: (r) => toast.success(r.status === "approved" ? `Approved - saved as version ${r.version}. Review affected work on the Work tab.` : "Rejected"), onError: (e) => toast.error(e.message) })} />}

      {canManage && eligible && (
        <div className="space-y-2">
          <p className="text-sm font-medium">What should be reconsidered?</p>
          <div className="flex flex-wrap gap-2">
            {REVISION_FOCUS.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFocus(focus.includes(f) ? focus.filter((x) => x !== f) : [...focus, f])}
                className={`rounded-full border px-3 py-1 text-xs ${focus.includes(f) ? "border-primary bg-primary/10 text-primary" : "hover:bg-accent"}`}
                aria-pressed={focus.includes(f)}
              >
                {REVISION_FOCUS_LABELS[f]}
              </button>
            ))}
          </div>
          <Labeled label="Anything the assistant should know? (optional)">
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </Labeled>
          <Button
            size="sm"
            disabled={propose.isPending || focus.length === 0}
            onClick={() =>
              propose.mutate(
                { focus, note: note || undefined },
                { onSuccess: () => { toast.success("Revision proposed - review it below"); setFocus([]); setNote(""); }, onError: (e) => toast.error(e.message) },
              )
            }
          >
            {propose.isPending && <Loader2 className="animate-spin" />} Draft a revision
          </Button>
        </div>
      )}
      {!eligible && <p className="text-xs text-muted-foreground">Revisions are available once the strategy is approved.</p>}

      {past.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground">Earlier proposals</summary>
          <ul className="mt-2 space-y-1">
            {past.map((r) => (
              <li key={r.id} className="text-muted-foreground">
                <Badge variant="muted">{r.status}</Badge> {fmtDay(r.createdAt)} - {r.focus.map((f) => REVISION_FOCUS_LABELS[f]).join(", ")}
                {r.decisionNote ? ` - ${r.decisionNote}` : ""}
              </li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}

function Proposal({ r, canManage, busy, onDecide }: { r: RevisionDto; canManage: boolean; busy: boolean; onDecide: (a: "approve" | "reject") => void }) {
  return (
    <div className="space-y-3 rounded-md border border-primary/40 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge>Awaiting decision</Badge>
        <span className="text-xs text-muted-foreground">
          Revises {r.focus.map((f) => REVISION_FOCUS_LABELS[f]).join(", ")} · proposed {fmtDay(r.createdAt)}
          {r.createdBy ? ` by ${r.createdBy}` : ""} · based on version {r.baseVersion}
        </span>
        <EvidenceBadge label="hypothesis" />
      </div>
      {r.rationale && <p className="text-sm">{r.rationale}</p>}
      <p className="text-xs text-muted-foreground">This is a suggestion to test, not a proven improvement.</p>
      <div className="space-y-2">
        {r.changes.map((c) => (
          <div key={c.path} className="grid gap-2 rounded-md bg-muted/40 p-2 text-sm sm:grid-cols-2">
            <p className="font-medium sm:col-span-2">{c.label}</p>
            <p className="text-muted-foreground">
              <span className="text-xs uppercase">Current: </span>
              {c.before || <i>empty</i>}
            </p>
            <p>
              <span className="text-xs uppercase text-muted-foreground">Proposed: </span>
              {c.after || <i>removed</i>}
            </p>
          </div>
        ))}
      </div>
      {r.stale ? (
        <p className="text-sm text-amber-600">The plan has changed since this was proposed. Draft a fresh revision.</p>
      ) : canManage ? (
        <div className="flex gap-2">
          <Button size="sm" disabled={busy} onClick={() => onDecide("approve")}>
            Approve and replace the plan
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => onDecide("reject")}>
            Reject
          </Button>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Only the business owner can approve or reject.</p>
      )}
    </div>
  );
}

/* --------------------------------- learning -------------------------------- */

export function LearningCard({ strategyId, canManage, status }: { strategyId: string; canManage: boolean; status: string }) {
  const { data: learning } = useLearning(strategyId);
  const record = useRecordLearning(strategyId);
  const [next, setNext] = useState<string | null>(null);
  const s = learning?.snapshot;
  return (
    <Card className="space-y-3 p-4">
      <h3 className="text-sm font-semibold">What we learned</h3>
      <p className="text-xs text-muted-foreground">
        Saved for this business only. Future plans read it as evidence from one campaign, never as a rule.
      </p>
      {s && (
        <div className="space-y-2 text-sm">
          <p className="text-xs text-muted-foreground">Last saved {fmtDay(learning!.updatedAt)}</p>
          {learning!.nextStep && (
            <p>
              <span className="font-medium">Decided to try next: </span>
              {learning!.nextStep}
            </p>
          )}
          <div>
            <p className="font-medium">Why this may not apply elsewhere</p>
            <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
              {s.comparability.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
      {canManage && status !== "draft" && (
        <div className="space-y-2">
          <Labeled label="What will you try next?" hint="Optional. Written in your own words.">
            <Textarea rows={2} value={next ?? learning?.nextStep ?? ""} onChange={(e) => setNext(e.target.value)} />
          </Labeled>
          <Button
            size="sm"
            variant="outline"
            disabled={record.isPending}
            onClick={() => record.mutate(next ?? undefined, { onSuccess: () => toast.success("Learning saved"), onError: (e) => toast.error(e.message) })}
          >
            {record.isPending && <Loader2 className="animate-spin" />} {learning ? "Update learning" : "Save what we learned"}
          </Button>
        </div>
      )}
    </Card>
  );
}
