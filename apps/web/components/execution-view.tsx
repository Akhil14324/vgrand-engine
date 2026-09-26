"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, CalendarClock, Check, Clock, Flag, Loader2, Sparkles, Target } from "lucide-react";
import {
  DELIVERABLE_STATUS_LABELS,
  DELIVERABLE_TYPE_LABELS,
  type BrandDto,
  type DeliverableDto,
  type ExecTaskDto,
  type ExecutionDashboardDto,
} from "@catgpt/types";
import { CampShell, fmtDay } from "@/components/camp-shell";
import { DeliverableDialog, TaskDialog, publishingBadge } from "@/components/execution-dialogs";
import { ResultsBody } from "@/components/camp-results";
import { useExecutionDashboard } from "@/lib/bcamp-hooks";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export function ExecutionView() {
  return (
    <CampShell title="Execution Center" subtitle="What to do, what is waiting, and what has happened" current="execution">
      {(brand) => <Dashboard brand={brand} />}
    </CampShell>
  );
}

function Dashboard({ brand }: { brand: BrandDto }) {
  const { data, isLoading } = useExecutionDashboard(brand.id);
  const [deliverableId, setDeliverableId] = useState<string | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [tab, setTab] = useState("today");
  if (isLoading || !data) return <Skeleton className="h-64 w-full" />;

  if (data.campaigns.length === 0)
    return (
      <Card className="mx-auto max-w-lg space-y-2 p-6 text-center">
        <Target className="mx-auto h-8 w-8 text-primary" />
        <h2 className="text-lg font-semibold">No campaigns are running yet</h2>
        <p className="text-sm text-muted-foreground">
          Approve a strategy in B Camp and convert it into work. Its deliverables, tasks and approvals will show up here.
        </p>
        <Link href="/bcamp" className="text-sm text-primary hover:underline">
          Go to B Camp
        </Link>
      </Card>
    );

  const openD = (id: string) => setDeliverableId(id);
  const openT = (id: string) => setTaskId(id);

  return (
    <>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="today">Today</TabsTrigger>
          <TabsTrigger value="campaigns">Campaigns</TabsTrigger>
          <TabsTrigger value="content">Content</TabsTrigger>
          <TabsTrigger value="approvals">
            Approvals{data.approvals.length > 0 ? ` (${data.approvals.length})` : ""}
          </TabsTrigger>
          <TabsTrigger value="tasks">Tasks</TabsTrigger>
          <TabsTrigger value="results">Results</TabsTrigger>
        </TabsList>

        <TabsContent value="today" className="mt-4">
          <Today data={data} openD={openD} openT={openT} />
        </TabsContent>
        <TabsContent value="campaigns" className="mt-4">
          <Campaigns data={data} />
        </TabsContent>
        <TabsContent value="content" className="mt-4">
          <Pipeline data={data} openD={openD} />
        </TabsContent>
        <TabsContent value="approvals" className="mt-4">
          <Approvals items={data.approvals} openD={openD} />
        </TabsContent>
        <TabsContent value="tasks" className="mt-4">
          <Tasks tasks={data.tasks} openT={openT} />
        </TabsContent>
        <TabsContent value="results" className="mt-4 space-y-6">
          {data.results.map((r) => (
            <div key={r.strategyId} className="space-y-2">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold">{r.title}</h3>
                <Link href={`/bcamp?strategy=${r.strategyId}&tab=results`} className="text-xs text-primary hover:underline">
                  Review in B Camp
                </Link>
              </div>
              <ResultsBody data={r} canManage={false} compact />
            </div>
          ))}
        </TabsContent>
      </Tabs>

      {deliverableId && <DeliverableDialog id={deliverableId} members={data.members} canManage={data.canManage} onClose={() => setDeliverableId(null)} />}
      {taskId && <TaskDialog id={taskId} members={data.members} canManage={data.canManage} onClose={() => setTaskId(null)} />}
    </>
  );
}

/* --------------------------------- pieces ---------------------------------- */

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">{children}</p>;
}

function Section({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold">
        {title}
        {count !== undefined && <span className="ml-1.5 text-muted-foreground">{count}</span>}
      </h3>
      {children}
    </section>
  );
}

export function TaskRow({ t, onOpen }: { t: ExecTaskDto; onOpen: (id: string) => void }) {
  return (
    <button type="button" onClick={() => onOpen(t.id)} className="flex w-full items-center gap-3 rounded-md border p-3 text-left transition-colors hover:bg-accent/40">
      <span className={`h-2 w-2 shrink-0 rounded-full ${t.priority === "high" ? "bg-destructive" : t.priority === "medium" ? "bg-amber-500" : "bg-muted-foreground"}`} title={`${t.priority} priority`} />
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-sm font-medium ${t.status === "done" ? "line-through opacity-60" : ""}`}>{t.title}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {t.strategyTitle}
          {t.deliverableTitle ? ` · ${t.deliverableTitle}` : ""}
        </span>
      </span>
      {t.flaggedForReview && <Flag className="h-3.5 w-3.5 text-amber-500" aria-label="Flagged for strategic review" />}
      {t.blockedByDependency && t.dependsOn && <Badge variant="outline">Waiting on {t.dependsOn.title}</Badge>}
      {t.status === "blocked" && <Badge variant="destructive">Blocked</Badge>}
      <span className="hidden text-xs text-muted-foreground sm:block">{t.assignee?.name ?? "Unassigned"}</span>
      <span className={`text-xs ${t.overdue ? "font-medium text-destructive" : "text-muted-foreground"}`}>{fmtDay(t.dueAt)}</span>
    </button>
  );
}

export function DeliverableRow({ d, onOpen }: { d: DeliverableDto; onOpen: (id: string) => void }) {
  const pub = publishingBadge(d.publishing);
  return (
    <button type="button" onClick={() => onOpen(d.id)} className="flex w-full items-center gap-3 rounded-md border p-3 text-left transition-colors hover:bg-accent/40">
      {d.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={d.imageUrl} alt="" className="h-12 w-12 shrink-0 rounded object-cover" />
      ) : (
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded bg-muted text-muted-foreground">
          <Sparkles className="h-4 w-4" />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{d.title}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {DELIVERABLE_TYPE_LABELS[d.type]}
          {d.channel ? ` · ${d.channel}` : ""} · {d.strategyTitle}
        </span>
      </span>
      {d.flaggedForReview && <Flag className="h-3.5 w-3.5 text-amber-500" aria-label="Flagged for strategic review" />}
      <Badge variant={d.status === "awaiting_approval" ? "default" : "secondary"}>{DELIVERABLE_STATUS_LABELS[d.status]}</Badge>
      {d.status === "approved" || d.status === "completed" || d.publishing.kind === "published" || d.publishing.kind === "failed" || d.publishing.kind === "scheduled" ? (
        <Badge variant={pub.variant} className="hidden sm:inline-flex">
          {pub.label}
        </Badge>
      ) : null}
      <span className={`text-xs ${d.overdue ? "font-medium text-destructive" : "text-muted-foreground"}`}>{fmtDay(d.dueAt)}</span>
    </button>
  );
}

/* ---------------------------------- tabs ----------------------------------- */

function Today({ data, openD, openT }: { data: ExecutionDashboardDto; openD: (id: string) => void; openT: (id: string) => void }) {
  const t = data.today;
  const nothing = !t.tasksDue.length && !t.overdueTasks.length && !t.review.length && !t.scheduled.length && !t.blocked.length;
  return (
    <div className="space-y-6">
      {nothing && <Empty>Nothing needs attention today. Upcoming work is on the Tasks and Content tabs.</Empty>}
      {t.blocked.length > 0 && (
        <Section title="Blocked" count={t.blocked.length}>
          <div className="space-y-2">
            {t.blocked.map((b) =>
              "checklist" in b ? <TaskRow key={b.id} t={b} onOpen={openT} /> : <DeliverableRow key={b.id} d={b} onOpen={openD} />,
            )}
          </div>
        </Section>
      )}
      {t.overdueTasks.length > 0 && (
        <Section title="Overdue" count={t.overdueTasks.length}>
          <div className="space-y-2">
            {t.overdueTasks.map((x) => (
              <TaskRow key={x.id} t={x} onOpen={openT} />
            ))}
          </div>
        </Section>
      )}
      {t.tasksDue.length > 0 && (
        <Section title="Due today" count={t.tasksDue.length}>
          <div className="space-y-2">
            {t.tasksDue.map((x) => (
              <TaskRow key={x.id} t={x} onOpen={openT} />
            ))}
          </div>
        </Section>
      )}
      {t.review.length > 0 && (
        <Section title="Content awaiting review" count={t.review.length}>
          <div className="space-y-2">
            {t.review.map((x) => (
              <DeliverableRow key={x.id} d={x} onOpen={openD} />
            ))}
          </div>
        </Section>
      )}
      {t.scheduled.length > 0 && (
        <Section title="Scheduled to publish today" count={t.scheduled.length}>
          <div className="space-y-2">
            {t.scheduled.map((x) => (
              <DeliverableRow key={x.id} d={x} onOpen={openD} />
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

function Campaigns({ data }: { data: ExecutionDashboardDto }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {data.campaigns.map((c) => (
        <Card key={c.id} className="space-y-2 p-4">
          <div className="flex items-start gap-2">
            <Link href={`/bcamp?strategy=${c.id}`} className="min-w-0 flex-1 font-medium leading-snug hover:underline">
              {c.title}
            </Link>
            <Badge variant={c.status === "active" ? "default" : "muted"}>{c.status}</Badge>
          </div>
          <p className="text-xs text-muted-foreground">Stage: {c.stage}</p>
          {c.progressPct !== null && (
            <div className="space-y-1">
              <Progress value={c.progressPct} />
              <p className="text-xs text-muted-foreground">{c.progressPct}% of deliverables and tasks finished (counted from real status)</p>
            </div>
          )}
          {c.nextMilestone && (
            <p className="flex items-center gap-1 text-xs">
              <CalendarClock className="h-3.5 w-3.5" /> Next: {c.nextMilestone}
            </p>
          )}
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            {c.blockers > 0 ? (
              <>
                <AlertTriangle className="h-3.5 w-3.5 text-amber-500" /> {c.blockers} blocker(s)
              </>
            ) : (
              "No blockers"
            )}
            {c.owner ? ` · Owner ${c.owner}` : ""}
          </p>
        </Card>
      ))}
    </div>
  );
}

function Pipeline({ data, openD }: { data: ExecutionDashboardDto; openD: (id: string) => void }) {
  const [filter, setFilter] = useState<string | null>(null);
  const shown = data.deliverables.filter((d) => {
    if (!filter) return true;
    if (filter === "scheduled" || filter === "published") return d.publishing.kind === filter;
    return d.status === filter;
  });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setFilter(null)} className={`rounded-full border px-3 py-1 text-xs ${!filter ? "border-primary bg-primary/10 text-primary" : ""}`}>
          All {data.deliverables.length}
        </button>
        {data.pipeline
          .filter((p) => p.count > 0)
          .map((p) => (
            <button key={p.status} type="button" onClick={() => setFilter(p.status)} className={`rounded-full border px-3 py-1 text-xs ${filter === p.status ? "border-primary bg-primary/10 text-primary" : ""}`}>
              {p.label} {p.count}
            </button>
          ))}
      </div>
      {shown.length === 0 ? (
        <Empty>No content in this stage.</Empty>
      ) : (
        <div className="space-y-2">
          {shown.map((d) => (
            <DeliverableRow key={d.id} d={d} onOpen={openD} />
          ))}
        </div>
      )}
    </div>
  );
}

function Approvals({ items, openD }: { items: DeliverableDto[]; openD: (id: string) => void }) {
  if (!items.length) return <Empty>Nothing is waiting for approval.</Empty>;
  return (
    <div className="space-y-3">
      {items.map((d) => (
        <Card key={d.id} className="flex flex-wrap items-center gap-3 p-3">
          <div className="min-w-0 flex-1">
            <button type="button" className="text-left font-medium hover:underline" onClick={() => openD(d.id)}>
              {d.title}
            </button>
            <p className="text-xs text-muted-foreground">
              {d.strategyTitle} · {d.channel ?? "no channel"} · submitted by {d.submittedBy?.name ?? "someone"} {d.submittedAt ? fmtDay(d.submittedAt) : ""}
            </p>
            <p className="text-xs text-muted-foreground">
              {d.previousGenerationId ? "Replaces an earlier version of this content." : "First version."} Destination: {publishingBadge(d.publishing).label.toLowerCase()}.
            </p>
          </div>
          <button type="button" className="text-sm text-primary hover:underline" onClick={() => openD(d.id)}>
            Review
          </button>
        </Card>
      ))}
    </div>
  );
}

function Tasks({ tasks, openT }: { tasks: ExecTaskDto[]; openT: (id: string) => void }) {
  const [mine, setMine] = useState(false);
  const [hideDone, setHideDone] = useState(true);
  const shown = tasks.filter((t) => (!hideDone || t.status !== "done") && (!mine || t.assignee));
  return (
    <div className="space-y-3">
      <div className="flex gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={hideDone} onChange={(e) => setHideDone(e.target.checked)} /> Hide finished
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Assigned only
        </label>
      </div>
      {shown.length === 0 ? (
        <Empty>No tasks to show.</Empty>
      ) : (
        <div className="space-y-2">
          {shown.map((t) => (
            <TaskRow key={t.id} t={t} onOpen={openT} />
          ))}
        </div>
      )}
    </div>
  );
}
