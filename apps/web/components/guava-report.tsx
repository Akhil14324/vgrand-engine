"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { ArrowRight, HelpCircle, Loader2, Send } from "lucide-react";
import {
  GUAVA_EVIDENCE_LABELS,
  getGuavaIndustry,
  type GuavaDiagnosisDto,
  type GuavaEvidence,
  type GuavaFinding,
  type GuavaRecommendation,
} from "@catgpt/types";
import { useAskGuava } from "@/lib/guava-hooks";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toaster";

export const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

const EVIDENCE_VARIANT: Record<GuavaEvidence, "default" | "secondary" | "outline" | "muted"> = {
  fact: "default",
  provided: "secondary",
  estimate: "outline",
  hypothesis: "muted",
};

/** Says how well-founded a statement is: verified, told by the owner, estimated or a guess. */
export function EvidenceBadge({ evidence }: { evidence: GuavaEvidence }) {
  const e = GUAVA_EVIDENCE_LABELS[evidence];
  return (
    <Badge variant={EVIDENCE_VARIANT[evidence]} title={e.hint} className="shrink-0">
      {e.label}
    </Badge>
  );
}

const LEVEL_LABEL = { high: "Do first", medium: "Next", low: "Later" } as const;
const LEVEL_CLASS = {
  high: "bg-destructive/15 text-destructive",
  medium: "bg-primary/15 text-primary",
  low: "bg-muted text-muted-foreground",
} as const;

function LevelPill({ level }: { level: keyof typeof LEVEL_LABEL }) {
  return (
    <span className={cn("shrink-0 rounded-md px-2 py-0.5 text-xs font-medium", LEVEL_CLASS[level])}>
      {LEVEL_LABEL[level]}
    </span>
  );
}

function Stat({ label, value, onClick }: { label: string; value: number; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg border bg-card px-3 py-2 text-left transition-colors hover:bg-accent/50"
    >
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </button>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">{children}</p>;
}

function Findings({ items, empty }: { items: GuavaFinding[]; empty: string }) {
  if (!items.length) return <Empty>{empty}</Empty>;
  return (
    <ul className="space-y-3">
      {items.map((f, i) => (
        <li key={i} className="rounded-lg border bg-card p-3">
          <div className="flex items-start justify-between gap-3">
            <h4 className="text-sm font-semibold">{f.title}</h4>
            <EvidenceBadge evidence={f.evidence} />
          </div>
          {f.detail && <p className="mt-1 text-sm text-muted-foreground">{f.detail}</p>}
        </li>
      ))}
    </ul>
  );
}

function Recommendation({ rec, defaultOpen }: { rec: GuavaRecommendation; defaultOpen: boolean }) {
  const rows: [string, ReactNode][] = [
    ["What to do", rec.what],
    ["Why it matters", rec.why],
    ["Problem it addresses", rec.problem],
    [
      "How to do it",
      rec.how.length ? (
        <ol className="list-decimal space-y-1 pl-5">
          {rec.how.map((h, i) => (
            <li key={i}>{h}</li>
          ))}
        </ol>
      ) : null,
    ],
    ["What it needs", rec.resources],
    ["How to measure it", rec.measure],
    ["Assumptions and risks", rec.risks],
  ];
  return (
    <details open={defaultOpen} className="group rounded-lg border bg-card">
      <summary className="flex cursor-pointer list-none items-center gap-3 px-3 py-3">
        <LevelPill level={rec.priority} />
        <span className="min-w-0 flex-1 text-sm font-semibold">{rec.title}</span>
        {rec.timeframe && <span className="hidden text-xs text-muted-foreground sm:inline">{rec.timeframe}</span>}
      </summary>
      <dl className="space-y-3 border-t px-3 py-3 text-sm">
        {rows
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <div key={k}>
              <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{k}</dt>
              <dd className="mt-0.5">{v}</dd>
            </div>
          ))}
      </dl>
    </details>
  );
}

/** The diagnosis dashboard: summary, actions, and separate strengths / problems / opportunities / recommendations. */
export function GuavaReport({
  brandId,
  diagnosis,
  onAddInfo,
}: {
  brandId: string;
  diagnosis: GuavaDiagnosisDto;
  onAddInfo: () => void;
}) {
  const report = diagnosis.report;
  const [tab, setTab] = useState("overview");
  if (!report) return null;
  const industry = getGuavaIndustry(diagnosis.industry);
  const problems = report.weaknesses.length + report.salesObstacles.length;
  const cmp = diagnosis.comparison;

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-3 p-4 sm:p-5">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>Diagnosed {fmtDate(diagnosis.createdAt)}</span>
            <span aria-hidden>·</span>
            <span>{industry.label}</span>
            <span aria-hidden>·</span>
            <span>Based on {diagnosis.completenessPct}% of key answers</span>
          </div>
          <h2 className="font-display text-xl font-semibold leading-snug">{report.headline || "Your business diagnosis"}</h2>
          {report.summary && <p className="text-sm leading-relaxed text-muted-foreground">{report.summary}</p>}
          <div className="grid grid-cols-2 gap-2 pt-1 sm:grid-cols-4">
            <Stat label="Strengths" value={report.strengths.length} onClick={() => setTab("strengths")} />
            <Stat label="Problems" value={problems} onClick={() => setTab("problems")} />
            <Stat label="Opportunities" value={report.opportunities.length} onClick={() => setTab("opportunities")} />
            <Stat label="Recommendations" value={report.recommendations.length} onClick={() => setTab("recommendations")} />
          </div>
          <div className="flex flex-wrap items-center gap-1.5 pt-1 text-xs text-muted-foreground">
            <span>Each finding is labelled:</span>
            {(Object.keys(GUAVA_EVIDENCE_LABELS) as GuavaEvidence[]).map((k) => (
              <EvidenceBadge key={k} evidence={k} />
            ))}
          </div>
        </CardContent>
      </Card>

      {cmp && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">What changed since {fmtDate(cmp.previousAt)}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {cmp.summary && <p>{cmp.summary}</p>}
            <div className="grid gap-3 md:grid-cols-2">
              <Bullets title="Earlier assumptions confirmed" items={cmp.confirmed.map((c) => `${c.assumption}${c.note ? `: ${c.note}` : ""}`)} />
              <Bullets title="Earlier assumptions that turned out wrong" items={cmp.disproved.map((c) => `${c.assumption}${c.note ? `: ${c.note}` : ""}`)} />
              <Bullets title="How new information changed the strategy" items={cmp.newInfoEffects.map((c) => `${c.info}${c.effect ? `: ${c.effect}` : ""}`)} />
              <Bullets title="Looks better now" items={cmp.improved} />
              <Bullets title="New concerns" items={cmp.newConcerns} />
              <Bullets
                title="Answers you updated"
                items={cmp.profileChanges.map((c) => `${c.label}: ${c.before ? `"${c.before}" → ` : "added "}"${c.after || "(cleared)"}"`)}
              />
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your priorities, in order</CardTitle>
        </CardHeader>
        <CardContent>
          {report.priorities.length ? (
            <ol className="space-y-3">
              {report.priorities.map((p, i) => (
                <li key={i} className="flex gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold">{p.title}</span>
                      <LevelPill level={p.level} />
                      <EvidenceBadge evidence={p.evidence} />
                    </div>
                    {p.why && <p className="text-sm text-muted-foreground">{p.why}</p>}
                    {p.assumptions && (
                      <p className="text-xs text-muted-foreground">
                        <span className="font-medium">Assuming:</span> {p.assumptions}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <Empty>No clear priorities yet. Add more to your profile and diagnose again.</Empty>
          )}
        </CardContent>
      </Card>

      <Tabs value={tab} onValueChange={setTab} className="space-y-3">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="strengths">Strengths ({report.strengths.length})</TabsTrigger>
          <TabsTrigger value="problems">Problems ({problems})</TabsTrigger>
          <TabsTrigger value="opportunities">Opportunities ({report.opportunities.length})</TabsTrigger>
          <TabsTrigger value="recommendations">Recommendations ({report.recommendations.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">How Guava understands your business</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 text-sm md:grid-cols-2">
              <Fact label="What you sell" value={report.understanding.sells} />
              <Fact label="Who your customers are" value={report.understanding.customers} />
              <Fact label="What you want to achieve" value={report.understanding.goals} />
              <Fact label="How customers find you today" value={report.understanding.acquisition} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Where you stand today</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {report.position.summary && <p>{report.position.summary}</p>}
              <Bullets title="Marketing channels" items={report.position.channels} />
              <Fact label="Sales process" value={report.position.salesProcess} />
              <Fact label="Performance data" value={report.position.performance} />
              {diagnosis.platform && (
                <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
                  In the last {diagnosis.platform.windowDays} days on this platform: {diagnosis.platform.posts.published} post
                  {diagnosis.platform.posts.published === 1 ? "" : "s"} published, {diagnosis.platform.campaigns.postsPlanned}{" "}
                  campaign post{diagnosis.platform.campaigns.postsPlanned === 1 ? "" : "s"} planned. This shows activity, not
                  sales results.
                </p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Recommended direction</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {report.direction.summary && <p>{report.direction.summary}</p>}
              <Bullets title="Focus on" items={report.direction.focusAreas} />
              <Bullets title="First steps (next 2 to 4 weeks)" items={report.direction.firstSteps} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="strengths">
          <Findings items={report.strengths} empty="No clear strengths could be confirmed from what Guava knows yet." />
        </TabsContent>

        <TabsContent value="problems" className="space-y-4">
          <Findings items={report.weaknesses} empty="No weaknesses identified from the information available." />
          {report.salesObstacles.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-semibold">Where customers may drop out</h3>
              <ul className="space-y-2">
                {report.salesObstacles.map((o, i) => (
                  <li key={i} className="flex items-start gap-3 rounded-lg border bg-card p-3 text-sm">
                    <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{o.stage}</div>
                      <p className="text-muted-foreground">{o.issue}</p>
                    </div>
                    <EvidenceBadge evidence={o.evidence} />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </TabsContent>

        <TabsContent value="opportunities">
          <Findings items={report.opportunities} empty="No opportunities identified yet. More detail about customers and competitors helps." />
        </TabsContent>

        <TabsContent value="recommendations" className="space-y-2">
          {report.recommendations.length ? (
            report.recommendations.map((r, i) => <Recommendation key={i} rec={r} defaultOpen={i === 0} />)
          ) : (
            <Empty>No recommendations were produced. Try again with more detail in your profile.</Empty>
          )}
        </TabsContent>
      </Tabs>

      {report.uncertainties.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <HelpCircle className="h-4 w-4" />
              What Guava is unsure about
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <ul className="space-y-2 text-sm">
              {report.uncertainties.map((u, i) => (
                <li key={i}>
                  <span className="font-medium">{u.area}.</span> <span className="text-muted-foreground">{u.why}</span>
                  {u.needed && (
                    <div className="mt-0.5 text-xs">
                      <span className="font-medium">To improve this:</span> {u.needed}
                    </div>
                  )}
                </li>
              ))}
            </ul>
            <Button variant="outline" size="sm" onClick={onAddInfo}>
              Add this to my profile
            </Button>
          </CardContent>
        </Card>
      )}

      <FollowUp brandId={brandId} diagnosis={diagnosis} />
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <p className="mt-0.5">{value}</p>
    </div>
  );
}

function Bullets({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</div>
      <ul className="mt-1 list-disc space-y-1 pl-5">
        {items.map((t, i) => (
          <li key={i}>{t}</li>
        ))}
      </ul>
    </div>
  );
}

const SUGGESTIONS = [
  "What should I do first?",
  "Which of these can I do with my budget?",
  "What information would improve this diagnosis most?",
];

/** Ask Guava about its own diagnosis. Answers are grounded in the report and profile. */
function FollowUp({ brandId, diagnosis }: { brandId: string; diagnosis: GuavaDiagnosisDto }) {
  const ask = useAskGuava(brandId, diagnosis.id);
  const [question, setQuestion] = useState("");
  const [pending, setPending] = useState<string | null>(null);

  const send = (q: string) => {
    const text = q.trim();
    if (!text || ask.isPending) return;
    setPending(text);
    setQuestion("");
    ask.mutate(text, {
      onError: (e) => {
        setQuestion(text);
        toast.error(e.message);
      },
      onSettled: () => setPending(null),
    });
  };
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    send(question);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Ask Guava about this diagnosis</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {diagnosis.messages.length === 0 && !pending && (
          <div className="flex flex-wrap gap-2">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => send(s)}
                className="rounded-full border px-3 py-1 text-xs transition-colors hover:bg-accent"
              >
                {s}
              </button>
            ))}
          </div>
        )}
        <div className="space-y-3" aria-live="polite">
          {diagnosis.messages.map((m) => (
            <Bubble key={m.id} role={m.role}>
              {m.content}
            </Bubble>
          ))}
          {pending && (
            <>
              <Bubble role="user">{pending}</Bubble>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Guava is thinking…
              </div>
            </>
          )}
        </div>
        <form onSubmit={onSubmit} className="flex items-end gap-2">
          <Textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(question);
              }
            }}
            rows={2}
            maxLength={1000}
            placeholder="e.g. Why is following up on enquiries my top priority?"
            aria-label="Your question for Guava"
          />
          <Button type="submit" size="icon" disabled={!question.trim() || ask.isPending} aria-label="Send">
            <Send className="h-4 w-4" />
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function Bubble({ role, children }: { role: "user" | "assistant"; children: ReactNode }) {
  return (
    <div className={cn("flex", role === "user" && "justify-end")}>
      <div
        className={cn(
          "max-w-[90%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm leading-relaxed",
          role === "user" ? "bg-primary text-primary-foreground" : "bg-muted",
        )}
      >
        {children}
      </div>
    </div>
  );
}
