"use client";

import { useState } from "react";
import { AlertTriangle, Loader2, Plus, Trash2 } from "lucide-react";
import {
  RESULT_METRICS,
  RESULT_SOURCE_LABELS,
  type ResultsSummaryDto,
  type StrategyReview,
} from "@catgpt/types";
import { useAddResult, useDeleteResult, useResults, useReviewStrategy } from "@/lib/bcamp-hooks";
import { Labeled, fmtDay } from "@/components/camp-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toaster";

const SOURCE_VARIANT = { observed: "default", user_entered: "secondary", estimate: "muted" } as const;

/**
 * Planned vs actual for one campaign. Recorded, entered and estimated numbers
 * are always labelled apart, and what is NOT known is stated as plainly as what is.
 */
export function ResultsPanel({
  strategyId,
  canManage,
  review,
  reviewedAt,
}: {
  strategyId: string;
  canManage: boolean;
  review?: StrategyReview | null;
  reviewedAt?: string | null;
}) {
  const { data, isLoading } = useResults(strategyId);
  if (isLoading || !data) return <Skeleton className="h-40 w-full" />;
  return <ResultsBody data={data} canManage={canManage} review={review} reviewedAt={reviewedAt} />;
}

export function ResultsBody({
  data,
  canManage,
  review,
  reviewedAt,
  compact,
}: {
  data: ResultsSummaryDto;
  canManage: boolean;
  review?: StrategyReview | null;
  reviewedAt?: string | null;
  compact?: boolean;
}) {
  const del = useDeleteResult();
  const ex = data.execution;
  const statusLine = Object.entries(ex.deliverablesByStatus)
    .map(([k, v]) => `${v} ${k.replace(/_/g, " ")}`)
    .join(", ");

  return (
    <div className="space-y-4">
      <Card className="space-y-2 p-4">
        <h3 className="text-sm font-semibold">Planned</h3>
        <p className="text-sm">{data.planned.objective || "No objective written."}</p>
        <p className="text-xs text-muted-foreground">
          Main measure: {data.planned.primaryKpi || "not defined"} · {data.planned.deliverables} deliverable(s) planned
        </p>
      </Card>

      <Card className="space-y-2 p-4">
        <h3 className="text-sm font-semibold">What actually happened</h3>
        <p className="text-sm text-muted-foreground">
          Work: {statusLine || "nothing converted into work yet"}. Tasks done: {ex.tasksDone} of {ex.tasksTotal}.
        </p>
        <div className="flex flex-wrap gap-2 text-xs">
          <Badge variant={ex.published ? "default" : "muted"}>{ex.published} published (confirmed by the platform)</Badge>
          {ex.scheduled > 0 && <Badge variant="secondary">{ex.scheduled} scheduled</Badge>}
          {ex.failed > 0 && <Badge variant="destructive">{ex.failed} failed to publish</Badge>}
          {ex.completedManually > 0 && <Badge variant="secondary">{ex.completedManually} done manually (reported by a person)</Badge>}
        </div>
        <p className="text-xs text-muted-foreground">
          Spend: {data.spend.recorded !== null ? `${data.spend.recorded} recorded` : "none recorded"}
          {data.spend.proposed ? ` · proposed ${data.spend.proposed} (${data.spend.approved ? "approved" : "not approved"})` : ""}
        </p>
        <p className="text-xs text-muted-foreground">Finished tasks show effort, not success.</p>
      </Card>

      <Card className="space-y-3 p-4">
        <h3 className="text-sm font-semibold">Recorded results</h3>
        {data.results.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing recorded yet. No reach, leads, orders or revenue are collected automatically.</p>
        ) : (
          <ul className="divide-y text-sm">
            {data.results.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2 py-2">
                <span className="font-medium capitalize">{r.metric}</span>
                <span>{r.value.toLocaleString()}</span>
                <Badge variant={SOURCE_VARIANT[r.source]}>{RESULT_SOURCE_LABELS[r.source]}</Badge>
                <span className="text-xs text-muted-foreground">
                  {fmtDay(r.periodStart)} to {fmtDay(r.periodEnd)}
                  {r.channel ? ` · ${r.channel}` : ""}
                  {r.sourceNote ? ` · ${r.sourceNote}` : ""}
                </span>
                {canManage && r.source !== "observed" && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="ml-auto h-7 w-7"
                    aria-label="Remove result"
                    onClick={() => del.mutate(r.id, { onError: (e) => toast.error(e.message) })}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        {canManage && !compact && <AddResult strategyId={data.strategyId} />}
      </Card>

      <Card className="space-y-2 border-amber-500/40 p-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <AlertTriangle className="h-4 w-4 text-amber-500" /> What cannot be concluded yet
        </h3>
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          {data.gaps.map((g) => (
            <li key={g}>{g}</li>
          ))}
        </ul>
      </Card>

      {!compact && <ReviewCard strategyId={data.strategyId} canManage={canManage} review={review} reviewedAt={reviewedAt} />}
    </div>
  );
}

function AddResult({ strategyId }: { strategyId: string }) {
  const add = useAddResult();
  const today = new Date().toISOString().slice(0, 10);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ metric: "leads", value: "", source: "user_entered", note: "", start: today, end: today, channel: "" });
  if (!open)
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Plus /> Record a result you verified
      </Button>
    );
  const submit = () => {
    const value = Number(f.value);
    if (!Number.isFinite(value) || f.value === "") return toast.error("Enter a number");
    add.mutate(
      {
        strategyId,
        metric: f.metric as never,
        value,
        source: f.source as "user_entered" | "estimate",
        sourceNote: f.note,
        channel: f.channel || undefined,
        periodStart: new Date(`${f.start}T00:00:00`).toISOString(),
        periodEnd: new Date(`${f.end}T23:59:59`).toISOString(),
      },
      {
        onSuccess: () => {
          toast.success("Result recorded");
          setOpen(false);
          setF({ ...f, value: "", note: "" });
        },
        onError: (e) => toast.error(e.message),
      },
    );
  };
  return (
    <div className="grid gap-3 rounded-md border p-3 sm:grid-cols-2">
      <Labeled label="What was measured">
        <Select value={f.metric} onChange={(e) => setF({ ...f, metric: e.target.value })}>
          {RESULT_METRICS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </Select>
      </Labeled>
      <Labeled label="Amount">
        <Input inputMode="decimal" value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} />
      </Labeled>
      <Labeled label="Where does this number come from?" hint="e.g. POS report, booking sheet, call log. Required.">
        <Input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
      </Labeled>
      <Labeled label="How sure are you?">
        <Select value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })}>
          <option value="user_entered">I verified it</option>
          <option value="estimate">It is an estimate</option>
        </Select>
      </Labeled>
      <Labeled label="From">
        <Input type="date" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} />
      </Labeled>
      <Labeled label="To">
        <Input type="date" value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} />
      </Labeled>
      <Labeled label="Channel (optional)">
        <Input value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value })} placeholder="instagram, walk-in…" />
      </Labeled>
      <div className="flex items-end gap-2">
        <Button size="sm" onClick={submit} disabled={add.isPending || f.note.trim().length < 2}>
          {add.isPending && <Loader2 className="animate-spin" />} Save
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function ReviewCard({
  strategyId,
  canManage,
  review,
  reviewedAt,
}: {
  strategyId: string;
  canManage: boolean;
  review?: StrategyReview | null;
  reviewedAt?: string | null;
}) {
  const run = useReviewStrategy(strategyId);
  const shown = run.data ?? review ?? null;
  const List = ({ items }: { items: string[] }) =>
    items.length ? (
      <ul className="list-disc space-y-1 pl-5">
        {items.map((i) => (
          <li key={i}>{i}</li>
        ))}
      </ul>
    ) : (
      <p className="text-muted-foreground">Nothing to add.</p>
    );
  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold">Strategy review</h3>
        <Badge variant="muted">AI interpretation, not data</Badge>
        {canManage && (
          <Button size="sm" variant="outline" className="ml-auto" onClick={() => run.mutate(undefined, { onError: (e) => toast.error(e.message) })} disabled={run.isPending}>
            {run.isPending && <Loader2 className="animate-spin" />} {shown ? "Refresh review" : "Review this campaign"}
          </Button>
        )}
      </div>
      {!shown ? (
        <p className="text-sm text-muted-foreground">
          A review compares what was planned with what the recorded data supports, and lists what is still unknown.
        </p>
      ) : (
        <div className="space-y-3 text-sm">
          {reviewedAt && <p className="text-xs text-muted-foreground">Written {fmtDay(reviewedAt)} from the records above.</p>}
          <div>
            <h4 className="font-medium">What was planned</h4>
            <p className="text-muted-foreground">{shown.planned}</p>
          </div>
          <div>
            <h4 className="font-medium">What happened</h4>
            <p className="text-muted-foreground">{shown.happened}</p>
          </div>
          <div>
            <h4 className="font-medium">What the data supports</h4>
            <List items={shown.supported} />
          </div>
          <div>
            <h4 className="font-medium">What remains unknown</h4>
            <List items={shown.unknown} />
          </div>
          <div>
            <h4 className="font-medium">Suggested changes for next time</h4>
            <List items={shown.changes} />
          </div>
        </div>
      )}
    </Card>
  );
}
