"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AlertTriangle, ArrowLeft, GitCompare, ListChecks, Loader2, Plus, Send, Trash2 } from "lucide-react";
import {
  BASIS,
  BASIS_LABELS,
  DELIVERABLE_TYPES,
  DELIVERABLE_TYPE_LABELS,
  TASK_PRIORITIES,
  type StrategyDto,
  type StrategyPlan,
} from "@catgpt/types";
import { Labeled, fmtDay, fmtDateTime } from "@/components/camp-shell";
import { ResultsPanel } from "@/components/camp-results";
import { InsightsPanel, LearningCard, RevisionPanel } from "@/components/campaign-insights";
import {
  useApplySync,
  useAskStrategy,
  useCommitConversion,
  useCompareVersions,
  useConversionPreview,
  useSaveStrategy,
  useStrategy,
  useStrategyAction,
  useSyncPreview,
} from "@/lib/bcamp-hooks";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toaster";

export function StrategyDetail({ id }: { id: string }) {
  const { data, isLoading, error } = useStrategy(id);
  if (isLoading) return <Skeleton className="h-64 w-full" />;
  if (error || !data)
    return (
      <Card className="p-6 text-sm">
        This strategy could not be found. <Link href="/bcamp" className="text-primary hover:underline">Back to B Camp</Link>
      </Card>
    );
  // Remount on a new version so the editor never shows stale text.
  return <Body key={`${data.id}:${data.version}`} s={data} />;
}

function Body({ s }: { s: StrategyDto }) {
  const params = useSearchParams();
  const [tab, setTab] = useState(params.get("tab") ?? "plan");
  const [plan, setPlan] = useState<StrategyPlan>(s.plan);
  const [title, setTitle] = useState(s.title);
  const [convertOpen, setConvertOpen] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const save = useSaveStrategy(s.id);
  const act = useStrategyAction(s.id);
  const dirty = title !== s.title || JSON.stringify(plan) !== JSON.stringify(s.plan);
  const editable = s.canManage && s.status !== "archived";

  const doSave = () =>
    save.mutate(
      { title, plan, baseVersion: s.version, label: "Edited" },
      { onSuccess: () => toast.success("Saved as a new version"), onError: (e) => toast.error(e.message) },
    );
  const doAct = (a: "approve" | "archive" | "restore" | "complete", msg?: string) =>
    act.mutate(a, { onSuccess: () => msg && toast.success(msg), onError: (e) => toast.error(e.message) });

  return (
    <div className="space-y-4">
      <Link href="/bcamp" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> All strategies
      </Link>

      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          {editable ? (
            <Input value={title} onChange={(e) => setTitle(e.target.value)} className="h-10 text-lg font-semibold" aria-label="Strategy name" />
          ) : (
            <h2 className="text-xl font-semibold">{s.title}</h2>
          )}
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge variant={s.status === "active" ? "default" : "muted"}>{s.status}</Badge>
            <span>Version {s.version}</span>
            {s.approvedAt && <span>Approved {fmtDay(s.approvedAt)}</span>}
            {s.sourceRef?.recommendation && <span>From Guava: {s.sourceRef.recommendation}</span>}
            {s.sourceRef?.learnings && s.sourceRef.learnings.length > 0 && (
              <span title={s.sourceRef.learnings.map((l) => l.title).join(", ")}>
                Informed by {s.sourceRef.learnings.length} earlier campaign(s), as evidence only
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => setCompareOpen(true)} disabled={s.versions.length < 2}>
            <GitCompare /> Compare versions
          </Button>
          {editable && (
            <Button size="sm" variant={dirty ? "default" : "outline"} onClick={doSave} disabled={!dirty || save.isPending}>
              {save.isPending && <Loader2 className="animate-spin" />} Save draft
            </Button>
          )}
          {s.canManage && s.status === "draft" && (
            <Button size="sm" onClick={() => (dirty ? toast.error("Save your changes first") : doAct("approve", "Strategy approved. Nothing has been published or spent."))} disabled={act.isPending}>
              Approve strategy
            </Button>
          )}
          {s.canManage && s.status === "active" && (
            <Button size="sm" onClick={() => (dirty ? toast.error("Save your changes first") : setConvertOpen(true))}>
              <ListChecks /> Convert to work
            </Button>
          )}
          {s.canManage && s.status === "active" && (
            <Button size="sm" variant="outline" onClick={() => doAct("complete", "Marked completed")}>
              Mark completed
            </Button>
          )}
          {s.canManage && (s.status === "archived" ? (
            <Button size="sm" variant="outline" onClick={() => doAct("restore", "Restored")}>Restore</Button>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => doAct("archive", "Archived")}>Archive</Button>
          ))}
        </div>
      </div>

      {s.status === "draft" && (
        <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
          This is a proposal drafted from what B Camp knows about your business. Approving it does not publish anything or spend any money.
        </p>
      )}
      {!s.canManage && <p className="text-xs text-muted-foreground">You can read this strategy. Only the business owner can change it.</p>}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="plan">Plan</TabsTrigger>
          <TabsTrigger value="assistant">Assistant</TabsTrigger>
          <TabsTrigger value="work">Work</TabsTrigger>
          <TabsTrigger value="insights">Insights</TabsTrigger>
          <TabsTrigger value="results">Results and review</TabsTrigger>
        </TabsList>
        <TabsContent value="plan" className="mt-4">
          <PlanEditor plan={plan} onChange={setPlan} disabled={!editable} warnings={s.warnings} />
        </TabsContent>
        <TabsContent value="assistant" className="mt-4">
          <Assistant s={s} dirty={dirty} />
        </TabsContent>
        <TabsContent value="work" className="mt-4">
          <WorkTab s={s} onConvert={() => setConvertOpen(true)} />
        </TabsContent>
        <TabsContent value="insights" className="mt-4">
          <InsightsPanel strategyId={s.id} />
        </TabsContent>
        <TabsContent value="results" className="mt-4 space-y-4">
          <ResultsPanel strategyId={s.id} canManage={s.canManage} review={s.review} reviewedAt={s.reviewedAt} />
          <RevisionPanel strategyId={s.id} canManage={s.canManage} status={s.status} />
          <LearningCard strategyId={s.id} canManage={s.canManage} status={s.status} />
        </TabsContent>
      </Tabs>

      {convertOpen && <ConvertDialog s={s} onClose={() => setConvertOpen(false)} />}
      {compareOpen && <CompareDialog s={s} onClose={() => setCompareOpen(false)} />}
    </div>
  );
}

/* --------------------------------- editor --------------------------------- */

function Field({ label, value, onChange, disabled, long, hint }: { label: string; value: string; onChange: (v: string) => void; disabled?: boolean; long?: boolean; hint?: string }) {
  return (
    <Labeled label={label} hint={hint}>
      {long ? (
        <Textarea rows={3} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <Input value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
      )}
    </Labeled>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <Card className="space-y-3 p-4">
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </Card>
  );
}

function BasisSelect({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <Labeled label="Where does the target come from?">
      <Select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        {BASIS.map((b) => (
          <option key={b} value={b}>
            {BASIS_LABELS[b]}
          </option>
        ))}
      </Select>
    </Labeled>
  );
}

function PlanEditor({ plan, onChange, disabled, warnings }: { plan: StrategyPlan; onChange: (p: StrategyPlan) => void; disabled: boolean; warnings: StrategyDto["warnings"] }) {
  const set = <K extends keyof StrategyPlan>(k: K, v: StrategyPlan[K]) => onChange({ ...plan, [k]: v });
  const patch = <K extends "objective" | "audience" | "offer" | "budget" | "measurement">(k: K, p: Partial<StrategyPlan[K]>) => onChange({ ...plan, [k]: { ...plan[k], ...p } });
  const o = plan.objective;

  return (
    <div className="space-y-4">
      {warnings.length > 0 && (
        <Card className="space-y-1 border-amber-500/40 p-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <AlertTriangle className="h-4 w-4 text-amber-500" /> Check before you rely on this plan
          </h3>
          <ul className="list-disc space-y-0.5 pl-5 text-sm text-muted-foreground">
            {warnings.map((w, i) => (
              <li key={i}>{w.text}</li>
            ))}
          </ul>
        </Card>
      )}

      <Section title="Objective" hint="The outcome, why it matters, and how you will know.">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field long label="Outcome" value={o.outcome} disabled={disabled} onChange={(v) => patch("objective", { outcome: v })} />
          <Field long label="Why it matters" value={o.why} disabled={disabled} onChange={(v) => patch("objective", { why: v })} />
          <Field label="Target metric" value={o.metric} disabled={disabled} onChange={(v) => patch("objective", { metric: v })} />
          <Field label="Target value" hint="Leave empty if you do not have one." value={o.targetValue} disabled={disabled} onChange={(v) => patch("objective", { targetValue: v })} />
          <Field label="Time period" value={o.period} disabled={disabled} onChange={(v) => patch("objective", { period: v })} />
          <BasisSelect value={o.targetBasis} disabled={disabled} onChange={(v) => patch("objective", { targetBasis: v as never })} />
        </div>
      </Section>

      <Section title="Target audience">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field long label="Who" value={plan.audience.who} disabled={disabled} onChange={(v) => patch("audience", { who: v })} />
          <Field long label="What they need" value={plan.audience.needs} disabled={disabled} onChange={(v) => patch("audience", { needs: v })} />
          <Field label="Location or market" value={plan.audience.location} disabled={disabled} onChange={(v) => patch("audience", { location: v })} />
          <Field long label="What supports this choice" value={plan.audience.evidence} disabled={disabled} onChange={(v) => patch("audience", { evidence: v })} />
          <Field long label="Still to validate" value={plan.audience.toValidate} disabled={disabled} onChange={(v) => patch("audience", { toValidate: v })} />
        </div>
      </Section>

      <Section title="Offer and message">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field long label="What is being promoted" value={plan.offer.promoting} disabled={disabled} onChange={(v) => patch("offer", { promoting: v })} />
          <Field long label="Main customer benefit" value={plan.offer.benefit} disabled={disabled} onChange={(v) => patch("offer", { benefit: v })} />
          <Field long label="Central message" value={plan.offer.message} disabled={disabled} onChange={(v) => patch("offer", { message: v })} />
          <Field label="Action customers should take" value={plan.offer.cta} disabled={disabled} onChange={(v) => patch("offer", { cta: v })} />
          <Field long label="Facts, proof and images needed" hint="Prices, availability and claims must be verified by you." value={plan.offer.requirements} disabled={disabled} onChange={(v) => patch("offer", { requirements: v })} />
        </div>
      </Section>

      <Section title="Channels" hint="Where to reach people, and what needs manual work.">
        <ListEditor
          items={plan.channels}
          disabled={disabled}
          blank={{ channel: "", why: "", formats: [], manualWork: "" }}
          addLabel="Add channel"
          onChange={(v) => set("channels", v)}
          render={(c, up) => (
            <div className="grid gap-2 sm:grid-cols-2">
              <Field label="Channel" value={c.channel} disabled={disabled} onChange={(v) => up({ ...c, channel: v })} />
              <Field label="Formats (comma separated)" value={c.formats.join(", ")} disabled={disabled} onChange={(v) => up({ ...c, formats: v.split(",").map((x) => x.trim()).filter(Boolean) })} />
              <Field label="Why it fits" value={c.why} disabled={disabled} onChange={(v) => up({ ...c, why: v })} />
              <Field label="Manual work or outside services" value={c.manualWork} disabled={disabled} onChange={(v) => up({ ...c, manualWork: v })} />
            </div>
          )}
        />
      </Section>

      <Section title="Budget and resources" hint="A proposed budget is not approved spend.">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Proposed budget" value={plan.budget.proposedAmount} disabled={disabled} onChange={(v) => patch("budget", { proposedAmount: v })} />
          <Labeled label="Spend approved?">
            <Select
              value={plan.budget.spendApproved ? "yes" : "no"}
              disabled={disabled}
              onChange={(e) => patch("budget", { spendApproved: e.target.value === "yes" })}
            >
              <option value="no">No - proposed only</option>
              <option value="yes">Yes - I approve this spend</option>
            </Select>
          </Labeled>
          <Field label="Resources" value={plan.budget.resources} disabled={disabled} onChange={(v) => patch("budget", { resources: v })} />
          <Field label="People responsible" value={plan.budget.people} disabled={disabled} onChange={(v) => patch("budget", { people: v })} />
          <Field long label="Constraints and dependencies" value={plan.budget.constraints} disabled={disabled} onChange={(v) => patch("budget", { constraints: v })} />
        </div>
      </Section>

      <Section title="Timeline" hint="Days counted from the start date.">
        <ListEditor
          items={plan.timeline}
          disabled={disabled}
          blank={{ phase: "", startOffsetDays: 0, endOffsetDays: 7, description: "" }}
          addLabel="Add phase"
          onChange={(v) => set("timeline", v)}
          render={(t, up) => (
            <div className="grid gap-2 sm:grid-cols-4">
              <Field label="Phase" value={t.phase} disabled={disabled} onChange={(v) => up({ ...t, phase: v })} />
              <NumField label="From day" value={t.startOffsetDays} disabled={disabled} onChange={(v) => up({ ...t, startOffsetDays: v })} />
              <NumField label="To day" value={t.endOffsetDays} disabled={disabled} onChange={(v) => up({ ...t, endOffsetDays: v })} />
              <Field label="What happens" value={t.description} disabled={disabled} onChange={(v) => up({ ...t, description: v })} />
            </div>
          )}
        />
      </Section>

      <Section title="Success measurement">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Primary KPI" value={plan.measurement.primaryKpi} disabled={disabled} onChange={(v) => patch("measurement", { primaryKpi: v })} />
          <Field label="Supporting KPIs (comma separated)" value={plan.measurement.supportingKpis.join(", ")} disabled={disabled} onChange={(v) => patch("measurement", { supportingKpis: v.split(",").map((x) => x.trim()).filter(Boolean) })} />
          <Field long label="How it will be tracked" hint="e.g. coupon code, lead form, call log. Without this, sales cannot be linked to the campaign." value={plan.measurement.tracking} disabled={disabled} onChange={(v) => patch("measurement", { tracking: v })} />
          <Field label="How often to check" value={plan.measurement.frequency} disabled={disabled} onChange={(v) => patch("measurement", { frequency: v })} />
          <Field long label="What result would change the plan" value={plan.measurement.changeTrigger} disabled={disabled} onChange={(v) => patch("measurement", { changeTrigger: v })} />
        </div>
      </Section>

      <Section title="Deliverables" hint="What must be produced. Each becomes a tracked piece of work.">
        <ListEditor
          items={plan.deliverables}
          disabled={disabled}
          blank={{ key: `d-${Math.random().toString(36).slice(2, 7)}`, type: "social_post" as const, title: "", channel: "instagram", format: "", count: 1, dueOffsetDays: 7, brief: "" }}
          addLabel="Add deliverable"
          onChange={(v) => set("deliverables", v)}
          render={(d, up) => (
            <div className="grid gap-2 sm:grid-cols-4">
              <Field label="Title" value={d.title} disabled={disabled} onChange={(v) => up({ ...d, title: v })} />
              <Labeled label="Type">
                <Select value={d.type} disabled={disabled} onChange={(e) => up({ ...d, type: e.target.value as never })}>
                  {DELIVERABLE_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {DELIVERABLE_TYPE_LABELS[t]}
                    </option>
                  ))}
                </Select>
              </Labeled>
              <Field label="Channel" value={d.channel} disabled={disabled} onChange={(v) => up({ ...d, channel: v })} />
              <div className="grid grid-cols-2 gap-2">
                <NumField label="How many" value={d.count} disabled={disabled} onChange={(v) => up({ ...d, count: Math.max(1, v) })} />
                <NumField label="Due day" value={d.dueOffsetDays} disabled={disabled} onChange={(v) => up({ ...d, dueOffsetDays: v })} />
              </div>
              <div className="sm:col-span-4">
                <Field label="Brief" value={d.brief} disabled={disabled} onChange={(v) => up({ ...d, brief: v })} />
              </div>
            </div>
          )}
        />
      </Section>

      <Section title="Tasks" hint="Operational steps, owners are chosen when converting to work.">
        <ListEditor
          items={plan.tasks}
          disabled={disabled}
          blank={{ key: `t-${Math.random().toString(36).slice(2, 7)}`, title: "", description: "", dueOffsetDays: 3, priority: "medium" as const, deliverableKey: "", dependsOnKey: "", checklist: [] as string[] }}
          addLabel="Add task"
          onChange={(v) => set("tasks", v)}
          render={(t, up) => (
            <div className="grid gap-2 sm:grid-cols-4">
              <div className="sm:col-span-2">
                <Field label="Task" value={t.title} disabled={disabled} onChange={(v) => up({ ...t, title: v })} />
              </div>
              <NumField label="Due day" value={t.dueOffsetDays} disabled={disabled} onChange={(v) => up({ ...t, dueOffsetDays: v })} />
              <Labeled label="Priority">
                <Select value={t.priority} disabled={disabled} onChange={(e) => up({ ...t, priority: e.target.value as never })}>
                  {TASK_PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </Select>
              </Labeled>
              <div className="sm:col-span-4">
                <Field label="Details" value={t.description} disabled={disabled} onChange={(v) => up({ ...t, description: v })} />
              </div>
            </div>
          )}
        />
      </Section>

      <Section title="Risks, assumptions and missing information">
        <ListEditor
          items={plan.risks}
          disabled={disabled}
          blank={{ kind: "assumption" as const, text: "" }}
          addLabel="Add"
          onChange={(v) => set("risks", v)}
          render={(r, up) => (
            <div className="grid gap-2 sm:grid-cols-[10rem_1fr]">
              <Select value={r.kind} disabled={disabled} onChange={(e) => up({ ...r, kind: e.target.value as never })}>
                <option value="risk">Risk</option>
                <option value="assumption">Assumption</option>
                <option value="missing">Missing information</option>
              </Select>
              <Input value={r.text} disabled={disabled} onChange={(e) => up({ ...r, text: e.target.value })} />
            </div>
          )}
        />
      </Section>
    </div>
  );
}

function NumField({ label, value, onChange, disabled }: { label: string; value: number; onChange: (v: number) => void; disabled?: boolean }) {
  return (
    <Labeled label={label}>
      <Input type="number" min={0} value={value} disabled={disabled} onChange={(e) => onChange(Math.max(0, Math.floor(Number(e.target.value) || 0)))} />
    </Labeled>
  );
}

function ListEditor<T>({ items, onChange, render, blank, addLabel, disabled }: { items: T[]; onChange: (v: T[]) => void; render: (item: T, update: (n: T) => void) => React.ReactNode; blank: T; addLabel: string; disabled?: boolean }) {
  return (
    <div className="space-y-3">
      {items.length === 0 && <p className="text-sm text-muted-foreground">Nothing here yet.</p>}
      {items.map((item, i) => (
        <div key={i} className="flex items-start gap-2 rounded-md border p-3">
          <div className="min-w-0 flex-1">{render(item, (n) => onChange(items.map((x, j) => (j === i ? n : x))))}</div>
          {!disabled && (
            <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Remove" onClick={() => onChange(items.filter((_, j) => j !== i))}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      ))}
      {!disabled && (
        <Button variant="outline" size="sm" onClick={() => onChange([...items, { ...blank }])}>
          <Plus /> {addLabel}
        </Button>
      )}
    </div>
  );
}

/* -------------------------------- assistant -------------------------------- */

function Assistant({ s, dirty }: { s: StrategyDto; dirty: boolean }) {
  const ask = useAskStrategy(s.id);
  const [text, setText] = useState("");
  const send = () => {
    const message = text.trim();
    if (!message) return;
    ask.mutate(message, { onSuccess: () => setText(""), onError: (e) => toast.error(e.message) });
  };
  return (
    <Card className="space-y-4 p-4">
      <p className="text-sm text-muted-foreground">
        Ask about this campaign only: challenge an assumption, fit it to a budget, compare approaches, or tell the assistant something has changed. If the plan needs to change, the change is shown below and saved as a new version.
      </p>
      {dirty && <p className="text-xs text-amber-600">You have unsaved edits. Save them first so the assistant works from your latest plan.</p>}
      <div className="space-y-3">
        {s.messages.length === 0 && <p className="text-sm text-muted-foreground">No conversation yet.</p>}
        {s.messages.map((m) => (
          <div key={m.id} className={m.role === "user" ? "ml-8 rounded-md bg-primary/10 p-3 text-sm" : "mr-8 rounded-md border p-3 text-sm"}>
            <p className="whitespace-pre-wrap">{m.content}</p>
            {m.changes && m.changes.length > 0 && (
              <div className="mt-2 space-y-1 border-t pt-2 text-xs">
                <p className="font-medium">Plan changed ({m.changes.length})</p>
                {m.changes.map((c) => (
                  <p key={c.path} className="text-muted-foreground">
                    <span className="text-foreground">{c.label}:</span> {c.before ? <s>{c.before}</s> : <i>empty</i>} → {c.after || <i>removed</i>}
                  </p>
                ))}
                <p className="text-muted-foreground">Existing work is not changed automatically. Review it on the Work tab.</p>
              </div>
            )}
            <p className="mt-1 text-[11px] text-muted-foreground">{fmtDateTime(m.createdAt)}</p>
          </div>
        ))}
      </div>
      {s.canManage && s.status !== "archived" && (
        <div className="flex gap-2">
          <Textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. Our budget is now ₹10,000 - what should we drop?" onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send(); }} />
          <Button onClick={send} disabled={ask.isPending || !text.trim()} aria-label="Send">
            {ask.isPending ? <Loader2 className="animate-spin" /> : <Send />}
          </Button>
        </div>
      )}
    </Card>
  );
}

/* ----------------------------------- work ---------------------------------- */

function WorkTab({ s, onConvert }: { s: StrategyDto; onConvert: () => void }) {
  const converted = !!s.convertedAt;
  const sync = useSyncPreview(s.id, converted);
  const apply = useApplySync(s.id);
  const [picked, setPicked] = useState<Record<string, "accept" | "dismiss">>({});
  const affected = sync.data?.affected ?? [];
  const added = sync.data?.added ?? [];

  return (
    <div className="space-y-4">
      <Card className="space-y-2 p-4">
        <h3 className="text-sm font-semibold">Execution</h3>
        {!converted ? (
          <>
            <p className="text-sm text-muted-foreground">
              {s.status === "active" ? "Turn this plan into tracked deliverables and tasks you can review first." : "Approve the strategy to convert it into work."}
            </p>
            {s.canManage && s.status === "active" && (
              <Button size="sm" onClick={onConvert}>
                <ListChecks /> Review and convert
              </Button>
            )}
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              {s.progress.deliverables} deliverables, {s.progress.tasks} tasks created. {s.progress.deliverablesDone} deliverables approved or done, {s.progress.tasksDone} tasks done.
              {s.flagged > 0 ? ` ${s.flagged} item(s) flagged for review.` : ""}
            </p>
            <div className="flex gap-2">
              <Button size="sm" asChild>
                <Link href="/execution">Open in Execution Center</Link>
              </Button>
              {s.canManage && s.status === "active" && (
                <Button size="sm" variant="outline" onClick={onConvert}>
                  Add newly planned items
                </Button>
              )}
            </div>
          </>
        )}
      </Card>

      {converted && (
        <Card className="space-y-3 p-4">
          <h3 className="text-sm font-semibold">Plan changes that affect existing work</h3>
          {sync.isLoading ? (
            <Skeleton className="h-16 w-full" />
          ) : affected.length === 0 && added.length === 0 ? (
            <p className="text-sm text-muted-foreground">The work matches the current plan.</p>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">
                Work in production or approved is never overwritten. You can apply a change to work that has not started, or keep the work exactly as it is.
              </p>
              <ul className="space-y-2 text-sm">
                {affected.map((a) => {
                  const ref = `${a.kind}:${a.dedupeKey}`;
                  return (
                    <li key={ref} className="flex flex-wrap items-center gap-2 rounded-md border p-2">
                      <span className="min-w-0 flex-1">
                        <span className="font-medium">{a.title}</span>{" "}
                        <span className="text-muted-foreground">
                          ({a.status.replace(/_/g, " ")}) - {a.change === "removed" ? "no longer in the plan" : `plan changed: ${a.fields.join(", ")}`}
                        </span>
                        {a.locked && <Badge variant="muted" className="ml-2">In progress or approved - kept as is</Badge>}
                      </span>
                      {s.canManage && (
                        <>
                          {!a.locked && (
                            <Button size="sm" variant={picked[ref] === "accept" ? "default" : "outline"} onClick={() => setPicked({ ...picked, [ref]: "accept" })}>
                              Apply change
                            </Button>
                          )}
                          <Button size="sm" variant={picked[ref] === "dismiss" ? "default" : "outline"} onClick={() => setPicked({ ...picked, [ref]: "dismiss" })}>
                            Keep as is
                          </Button>
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>
              {added.length > 0 && (
                <p className="text-sm text-muted-foreground">New in the plan: {added.map((a) => a.title).join(", ")}. Use “Add newly planned items” to create them.</p>
              )}
              {s.canManage && Object.keys(picked).length > 0 && (
                <Button
                  size="sm"
                  disabled={apply.isPending}
                  onClick={() =>
                    apply.mutate(
                      { accept: Object.keys(picked).filter((k) => picked[k] === "accept"), dismiss: Object.keys(picked).filter((k) => picked[k] === "dismiss") },
                      {
                        onSuccess: (r) => {
                          toast.success(`${r.applied} applied, ${r.dismissed} kept as is`);
                          setPicked({});
                        },
                        onError: (e) => toast.error(e.message),
                      },
                    )
                  }
                >
                  Confirm choices
                </Button>
              )}
            </>
          )}
        </Card>
      )}
    </div>
  );
}

/* --------------------------------- dialogs --------------------------------- */

function ConvertDialog({ s, onClose }: { s: StrategyDto; onClose: () => void }) {
  const preview = useConversionPreview(s.id, true);
  const commit = useCommitConversion(s.id);
  const [edits, setEdits] = useState<Record<string, { title?: string; due?: string; assigneeId?: string; priority?: string; off?: boolean }>>({});
  const p = preview.data;
  const upd = (k: string, v: object) => setEdits((e) => ({ ...e, [k]: { ...e[k], ...v } }));
  const fresh = useMemo(() => ({ d: p?.deliverables.filter((x) => !x.exists) ?? [], t: p?.tasks.filter((x) => !x.exists) ?? [] }), [p]);

  const submit = () => {
    const pick = (list: typeof fresh.d | typeof fresh.t) =>
      list
        .filter((x) => !edits[x.dedupeKey]?.off)
        .map((x) => {
          const e = edits[x.dedupeKey] ?? {};
          return {
            dedupeKey: x.dedupeKey,
            title: (e.title ?? x.title).trim() || x.title,
            dueAt: new Date(`${e.due ?? x.dueAt.slice(0, 10)}T09:00:00`).toISOString(),
            assigneeId: e.assigneeId || null,
            priority: e.priority as never,
          };
        });
    commit.mutate(
      { deliverables: pick(fresh.d), tasks: pick(fresh.t) },
      {
        onSuccess: (r) => {
          toast.success(`Created ${r.deliverablesCreated} deliverable(s) and ${r.tasksCreated} task(s)${r.alreadyExisted ? ` (${r.alreadyExisted} already existed)` : ""}`);
          onClose();
        },
        onError: (e) => toast.error(e.message),
      },
    );
  };

  const row = (x: { dedupeKey: string; title: string; dueAt: string; exists: boolean }) => {
    const e = edits[x.dedupeKey] ?? {};
    return (
      <li key={x.dedupeKey} className={`grid gap-2 rounded-md border p-2 sm:grid-cols-[auto_1fr_9rem_10rem] ${x.exists ? "opacity-60" : ""}`}>
        <input type="checkbox" aria-label="Include" className="mt-2" disabled={x.exists} checked={!x.exists && !e.off} onChange={(ev) => upd(x.dedupeKey, { off: !ev.target.checked })} />
        <div>
          <Input value={e.title ?? x.title} disabled={x.exists} onChange={(ev) => upd(x.dedupeKey, { title: ev.target.value })} aria-label="Title" />
          {x.exists && <span className="text-xs text-muted-foreground">Already created - will not be duplicated</span>}
        </div>
        <Input type="date" value={e.due ?? x.dueAt.slice(0, 10)} disabled={x.exists} onChange={(ev) => upd(x.dedupeKey, { due: ev.target.value })} aria-label="Due date" />
        <Select value={e.assigneeId ?? ""} disabled={x.exists} onChange={(ev) => upd(x.dedupeKey, { assigneeId: ev.target.value })} aria-label="Owner">
          <option value="">Unassigned</option>
          {p?.people.map((pp) => (
            <option key={pp.id} value={pp.id}>
              {pp.name}
            </option>
          ))}
        </Select>
      </li>
    );
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Convert plan into work</DialogTitle>
          <DialogDescription>Review, edit or untick anything before it is created. Nothing is published or spent.</DialogDescription>
        </DialogHeader>
        {!p ? (
          <Skeleton className="h-40 w-full" />
        ) : !p.canConvert ? (
          <p className="text-sm text-muted-foreground">{p.reason}</p>
        ) : (
          <div className="space-y-4">
            <section className="space-y-2">
              <h4 className="text-sm font-semibold">Deliverables ({p.deliverables.length})</h4>
              <ul className="space-y-2">{p.deliverables.map((d) => row(d))}</ul>
            </section>
            <section className="space-y-2">
              <h4 className="text-sm font-semibold">Tasks ({p.tasks.length})</h4>
              <ul className="space-y-2">{p.tasks.map((t) => row(t))}</ul>
            </section>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button onClick={submit} disabled={commit.isPending || (fresh.d.length + fresh.t.length === 0)}>
                {commit.isPending && <Loader2 className="animate-spin" />}
                {fresh.d.length + fresh.t.length === 0 ? "Everything already created" : "Create work"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function CompareDialog({ s, onClose }: { s: StrategyDto; onClose: () => void }) {
  const vs = s.versions.map((v) => v.version);
  const [to, setTo] = useState(vs[0]!);
  const [from, setFrom] = useState(vs[1] ?? vs[0]!);
  const diff = useCompareVersions(s.id, from, to);
  const label = (v: number) => {
    const x = s.versions.find((y) => y.version === v);
    return `v${v} - ${x?.label ?? "saved"} (${fmtDay(x?.createdAt)})`;
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Compare versions</DialogTitle>
          <DialogDescription>Every save keeps the earlier version. Nothing is lost.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Labeled label="Earlier">
            <Select value={from} onChange={(e) => setFrom(Number(e.target.value))}>
              {vs.map((v) => (
                <option key={v} value={v}>
                  {label(v)}
                </option>
              ))}
            </Select>
          </Labeled>
          <Labeled label="Later">
            <Select value={to} onChange={(e) => setTo(Number(e.target.value))}>
              {vs.map((v) => (
                <option key={v} value={v}>
                  {label(v)}
                </option>
              ))}
            </Select>
          </Labeled>
        </div>
        <div className="mt-3 space-y-2 text-sm">
          {from === to ? (
            <p className="text-muted-foreground">Choose two different versions.</p>
          ) : diff.isLoading ? (
            <Skeleton className="h-20 w-full" />
          ) : diff.data?.changes.length === 0 ? (
            <p className="text-muted-foreground">No differences.</p>
          ) : (
            diff.data?.changes.map((c) => (
              <div key={c.path} className="rounded-md border p-2">
                <p className="font-medium">{c.label}</p>
                <p className="text-muted-foreground">{c.before ? <s>{c.before}</s> : <i>empty</i>}</p>
                <p>{c.after || <i>removed</i>}</p>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
