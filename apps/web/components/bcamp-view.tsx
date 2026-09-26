"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, ArrowRight, Loader2, Sparkles } from "lucide-react";
import {
  STRATEGY_SOURCES,
  type BcampDashboardDto,
  type BrandDto,
  type StrategySource,
  type StrategySummaryDto,
} from "@catgpt/types";
import { CampShell, Labeled, fmtDay } from "@/components/camp-shell";
import { StrategyDetail } from "@/components/bcamp-strategy";
import { useBcampDashboard, useCreateStrategy } from "@/lib/bcamp-hooks";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toaster";

export function BcampView() {
  return (
    <Suspense fallback={null}>
      <CampShell title="B Camp" subtitle="Turn business goals into campaign plans your team can run" current="bcamp">
        {(brand) => <Router brand={brand} />}
      </CampShell>
    </Suspense>
  );
}

function Router({ brand }: { brand: BrandDto }) {
  const id = useSearchParams().get("strategy");
  return id ? <StrategyDetail id={id} /> : <Dashboard brand={brand} />;
}

const SOURCE_LABEL: Record<StrategySource, { label: string; placeholder: string }> = {
  goal: { label: "A business goal", placeholder: "e.g. Get more qualified property inquiries for our new project in the next 60 days" },
  guava: { label: "A Guava recommendation", placeholder: "Anything you want to add or change about that recommendation" },
  idea: { label: "A campaign idea I already have", placeholder: "Describe the idea in your own words" },
  seasonal: { label: "A season or event", placeholder: "e.g. Diwali weekend offer, monsoon special, a local festival" },
  custom: { label: "My own instruction", placeholder: "Tell B Camp what you want planned" },
};

function Dashboard({ brand }: { brand: BrandDto }) {
  const { data, isLoading } = useBcampDashboard(brand.id);
  const [prefill, setPrefill] = useState<{ source: StrategySource; text: string; diagnosisId?: string; recommendation?: string } | null>(null);
  if (isLoading || !data) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="space-y-6">
      <section className="space-y-1">
        <h2 className="text-xl font-semibold">{data.brandName}</h2>
        <p className="text-sm text-muted-foreground">
          {data.objective ? (
            <>
              Current objective: <span className="text-foreground">{data.objective}</span>
            </>
          ) : (
            "No active strategy yet. Start one below - nothing is published or spent until you decide."
          )}
        </p>
      </section>

      <Creator key={prefill?.recommendation ?? "new"} brand={brand} data={data} prefill={prefill} />

      {data.flagged.length > 0 && (
        <Card className="space-y-2 border-amber-500/40 p-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <AlertTriangle className="h-4 w-4 text-amber-500" /> Blockers flagged for strategic review
          </h3>
          <ul className="space-y-1 text-sm">
            {data.flagged.map((f) => (
              <li key={f.id}>
                <Link href={`/bcamp?strategy=${f.strategyId}`} className="font-medium hover:underline">
                  {f.title}
                </Link>{" "}
                <span className="text-muted-foreground">
                  in {f.strategyTitle}: {f.reason}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <StrategyGroup title="Active strategy" items={data.active} empty="Approve a draft to make it active, then convert it into work." />
      <StrategyGroup title="Drafts" items={data.drafts} empty="No drafts." />

      <div className="grid gap-6 md:grid-cols-2">
        <Card className="space-y-3 p-4">
          <h3 className="text-sm font-semibold">Strategic priorities</h3>
          {!data.hasDiagnosis ? (
            <p className="text-sm text-muted-foreground">
              No Guava diagnosis yet. B Camp works from your profile alone until you run one.{" "}
              <Link href="/guava" className="text-primary hover:underline">
                Open Guava
              </Link>
            </p>
          ) : (
            <ul className="space-y-2 text-sm">
              {data.priorities.map((p) => (
                <li key={p.title}>
                  <span className="font-medium">{p.title}</span>{" "}
                  <Badge variant="muted" className="align-middle">
                    {p.evidence}
                  </Badge>
                  <p className="text-muted-foreground">{p.why}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="space-y-3 p-4">
          <h3 className="text-sm font-semibold">Recommended next actions</h3>
          {data.recommendations.length === 0 ? (
            <p className="text-sm text-muted-foreground">Recommendations from Guava appear here.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {data.recommendations.slice(0, 5).map((r) => (
                <li key={r.title} className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <span className="font-medium">{r.title}</span>
                    <p className="line-clamp-2 text-muted-foreground">{r.what}</p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setPrefill({ source: "guava", text: r.what || r.title, diagnosisId: r.diagnosisId, recommendation: r.title });
                      window.scrollTo({ top: 0, behavior: "smooth" });
                    }}
                  >
                    Plan it
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted-foreground">Guava's advice is a starting point. Items tagged estimate or hypothesis are not verified.</p>
        </Card>
      </div>

      {data.warnings.length > 0 && (
        <Card className="space-y-2 p-4">
          <h3 className="text-sm font-semibold">Missing information and unverified assumptions</h3>
          <ul className="space-y-1 text-sm">
            {data.warnings.map((w, i) => (
              <li key={i} className="flex gap-2">
                <Badge variant={w.level === "missing" ? "destructive" : "muted"}>{w.level === "missing" ? "Missing" : "Unverified"}</Badge>
                <span className="text-muted-foreground">
                  {w.text} <span className="opacity-70">({w.strategyTitle})</span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {data.performance.length > 0 && (
        <Card className="space-y-2 p-4">
          <h3 className="text-sm font-semibold">Performance overview</h3>
          <ul className="space-y-2 text-sm">
            {data.performance.map((p) => (
              <li key={p.strategyId}>
                <Link href={`/bcamp?strategy=${p.strategyId}&tab=results`} className="font-medium hover:underline">
                  {p.title}
                </Link>
                : {p.published} published. <span className="text-muted-foreground">{p.note}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {data.archived.length > 0 && <StrategyGroup title="Completed and archived" items={data.archived} empty="" muted />}
    </div>
  );
}

function StrategyGroup({ title, items, empty, muted }: { title: string; items: StrategySummaryDto[]; empty: string; muted?: boolean }) {
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      {items.length === 0 ? (
        empty && <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {items.map((s) => (
            <Link key={s.id} href={`/bcamp?strategy=${s.id}`}>
              <Card className={`space-y-2 p-4 transition-colors hover:bg-accent/40 ${muted ? "opacity-70" : ""}`}>
                <div className="flex items-start gap-2">
                  <span className="min-w-0 flex-1 font-medium leading-snug">{s.title}</span>
                  <Badge variant={s.status === "active" ? "default" : "muted"}>{s.status}</Badge>
                </div>
                {s.objective && <p className="line-clamp-2 text-sm text-muted-foreground">{s.objective}</p>}
                {s.convertedAt ? (
                  <div className="space-y-1">
                    <Progress value={s.progress.tasks + s.progress.deliverables ? Math.round(((s.progress.tasksDone + s.progress.deliverablesDone) / (s.progress.tasks + s.progress.deliverables)) * 100) : 0} />
                    <p className="text-xs text-muted-foreground">
                      {s.progress.deliverablesDone}/{s.progress.deliverables} deliverables approved or done · {s.progress.tasksDone}/{s.progress.tasks} tasks done
                      {s.flagged > 0 ? ` · ${s.flagged} flagged` : ""}
                    </p>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">Not converted into work · updated {fmtDay(s.updatedAt)}</p>
                )}
              </Card>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

function Creator({
  brand,
  data,
  prefill,
}: {
  brand: BrandDto;
  data: BcampDashboardDto;
  prefill: { source: StrategySource; text: string; diagnosisId?: string; recommendation?: string } | null;
}) {
  const router = useRouter();
  const create = useCreateStrategy();
  const [source, setSource] = useState<StrategySource>(prefill?.source ?? "goal");
  const [text, setText] = useState(prefill?.text ?? "");
  const [budget, setBudget] = useState("");
  const [template, setTemplate] = useState<string | undefined>();

  const go = () =>
    create.mutate(
      {
        brandId: brand.id,
        source,
        text,
        budget: budget || undefined,
        templateKey: template,
        diagnosisId: source === "guava" ? (prefill?.diagnosisId ?? data.recommendations[0]?.diagnosisId) : undefined,
        recommendation: source === "guava" ? prefill?.recommendation : undefined,
      },
      {
        onSuccess: (s) => router.push(`/bcamp?strategy=${s.id}`),
        onError: (e) => toast.error(e.message),
      },
    );

  return (
    <Card className="space-y-3 p-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <Sparkles className="h-4 w-4 text-primary" /> Start a strategy
      </h3>
      <div className="grid gap-3 sm:grid-cols-[14rem_1fr]">
        <Labeled label="Start from">
          <Select value={source} onChange={(e) => setSource(e.target.value as StrategySource)}>
            {STRATEGY_SOURCES.filter((s) => s !== "guava" || data.hasDiagnosis).map((s) => (
              <option key={s} value={s}>
                {SOURCE_LABEL[s].label}
              </option>
            ))}
          </Select>
        </Labeled>
        <Labeled label="What do you want to achieve?">
          <Textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder={SOURCE_LABEL[source].placeholder} />
        </Labeled>
      </div>
      {data.templates.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted-foreground">Suggestions for this kind of business:</span>
          {data.templates.map((t) => (
            <button
              key={t.key}
              type="button"
              className={`rounded-full border px-2.5 py-1 ${template === t.key ? "border-primary bg-primary/10 text-primary" : "hover:bg-accent"}`}
              onClick={() => {
                setTemplate(template === t.key ? undefined : t.key);
                if (!text.trim()) {
                  setText(t.goal);
                  setSource("goal");
                }
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-[14rem_1fr]">
        <Labeled label="Budget (optional)" hint="Leave empty if not decided. Nothing is spent without your approval.">
          <Input value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="e.g. ₹20,000 per month" />
        </Labeled>
        <div className="flex items-end">
          <Button onClick={go} disabled={create.isPending || text.trim().length < 3}>
            {create.isPending ? <Loader2 className="animate-spin" /> : <ArrowRight />}
            {create.isPending ? "Drafting…" : "Draft the strategy"}
          </Button>
        </div>
      </div>
    </Card>
  );
}
