"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertCircle, ArrowLeft, Compass, Loader2, Sparkles } from "lucide-react";
import { getGuavaIndustry, type BrandDto, type GuavaDiagnosisSummaryDto } from "@catgpt/types";
import { RequireAuth } from "@/components/require-auth";
import { GuavaProfileEditor } from "@/components/guava-profile";
import { GuavaReport, fmtDate } from "@/components/guava-report";
import { resolveActiveBrand, useBrandMode } from "@/lib/brand-mode";
import { useBrands } from "@/lib/hooks";
import { useGuavaDiagnoses, useGuavaDiagnosis, useGuavaProfile, useStartGuavaDiagnosis } from "@/lib/guava-hooks";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toaster";

export function GuavaView() {
  return (
    <RequireAuth>
      <GuavaContent />
    </RequireAuth>
  );
}

function GuavaContent() {
  const { data: brands, isLoading } = useBrands();
  const chosen = useBrandMode((s) => s.brandId);
  const setBrandId = useBrandMode((s) => s.setBrandId);
  const brand = resolveActiveBrand(brands, chosen) ?? brands?.[0] ?? null;

  return (
    <div className="app-safe-screen flex flex-col">
      <header className="flex items-center gap-3 border-b px-3 py-2.5 sm:px-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/" aria-label="Back to studio">
            <ArrowLeft />
          </Link>
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-lg font-semibold leading-tight tracking-tight">Guava</h1>
          <p className="truncate text-xs text-muted-foreground">Your business strategist</p>
        </div>
        {brands && brands.length > 1 && brand && (
          <Select
            aria-label="Business"
            value={brand.id}
            onChange={(e) => setBrandId(e.target.value)}
            className="h-9 w-auto max-w-[45%] text-sm"
          >
            {brands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        )}
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-4xl px-3 py-4 sm:px-4 sm:py-6">
          {isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : !brand ? (
            <NoBusiness />
          ) : (
            <Workspace key={brand.id} brand={brand} />
          )}
        </div>
      </main>
    </div>
  );
}

function NoBusiness() {
  return (
    <Card className="mx-auto max-w-md p-6 text-center">
      <Compass className="mx-auto h-8 w-8 text-primary" />
      <h2 className="mt-3 text-lg font-semibold">Start with your business</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Guava works on one business at a time. Create your brand first, then come back to have Guava diagnose your
        marketing.
      </p>
      <Button asChild className="mt-4">
        <Link href="/brand">Create your brand</Link>
      </Button>
    </Card>
  );
}

function Workspace({ brand }: { brand: BrandDto }) {
  const [tab, setTab] = useState("diagnosis");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [openSection, setOpenSection] = useState<string | null>(null);

  const profile = useGuavaProfile(brand.id);
  const diagnoses = useGuavaDiagnoses(brand.id);
  const start = useStartGuavaDiagnosis(brand.id);

  const list = diagnoses.data ?? [];
  const running = list.find((d) => d.status === "processing");
  const shown =
    list.find((d) => d.id === selectedId) ??
    running ??
    list.find((d) => d.status === "completed") ??
    null;
  const latestFailed = list[0]?.status === "failed" ? list[0] : null;

  const diagnose = () =>
    start.mutate(undefined, {
      onSuccess: () => {
        setSelectedId(null);
        setTab("diagnosis");
      },
      onError: (e) => toast.error(e.message),
    });

  const goToProfile = (section?: string) => {
    setOpenSection(section ?? null);
    setTab("profile");
  };

  if (profile.isLoading || !profile.data) {
    return profile.isError ? (
      <p className="text-sm text-destructive">Couldn&apos;t load your business profile. Please refresh.</p>
    ) : (
      <Skeleton className="h-40 w-full" />
    );
  }
  const p = profile.data;
  const busy = !!running || start.isPending;
  const lastDone = list.find((d) => d.status === "completed");

  return (
    <div className="space-y-4">
      <Card className="p-4 sm:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-base font-semibold">{brand.name}</h2>
              {p.industry && <Badge variant="muted">{getGuavaIndustry(p.industry).label}</Badge>}
            </div>
            <div className="mt-2 flex items-center gap-3">
              <Progress value={p.completeness.pct} className="max-w-[240px]" />
              <span className="text-xs tabular-nums text-muted-foreground">
                {p.completeness.pct}% of key answers filled in
              </span>
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">
              {lastDone
                ? `Last diagnosed ${fmtDate(lastDone.createdAt)}. Update your answers any time and diagnose again.`
                : "Tell Guava about your business at your own pace, then ask for a diagnosis. You can improve it later."}
            </p>
          </div>
          <div className="flex shrink-0 flex-col gap-1.5 sm:items-end">
            <Button size="lg" onClick={diagnose} disabled={busy || !p.canEdit} className="w-full sm:w-auto">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {busy ? "Diagnosing…" : lastDone ? "Diagnose again" : "Diagnose My Business"}
            </Button>
            {!p.canEdit && <span className="text-xs text-muted-foreground">Only the owner can run a diagnosis.</span>}
            <button type="button" onClick={() => goToProfile()} className="text-xs text-muted-foreground underline">
              Edit business profile
            </button>
          </div>
        </div>
      </Card>

      <Tabs value={tab} onValueChange={setTab} className="space-y-4">
        <TabsList>
          <TabsTrigger value="diagnosis">Diagnosis</TabsTrigger>
          <TabsTrigger value="profile">Business profile</TabsTrigger>
          <TabsTrigger value="history">History{list.length ? ` (${list.length})` : ""}</TabsTrigger>
        </TabsList>

        <TabsContent value="diagnosis" className="space-y-4">
          {latestFailed && shown?.id !== latestFailed.id && (
            <div role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              <span>{latestFailed.error ?? "The latest diagnosis didn't finish."} Your last good diagnosis is shown below.</span>
            </div>
          )}
          {shown ? (
            <DiagnosisPanel brandId={brand.id} summary={shown} onAddInfo={() => goToProfile()} />
          ) : diagnoses.isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <FirstTime
              missing={p.completeness.missing.slice(0, 4).map((m) => m.question)}
              onProfile={() => goToProfile()}
            />
          )}
        </TabsContent>

        <TabsContent value="profile">
          <GuavaProfileEditor brand={brand} profile={p} openKey={openSection} onOpenKey={setOpenSection} />
        </TabsContent>

        <TabsContent value="history">
          <History
            items={list}
            currentId={shown?.id ?? null}
            onOpen={(id) => {
              setSelectedId(id);
              setTab("diagnosis");
            }}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function FirstTime({ missing, onProfile }: { missing: string[]; onProfile: () => void }) {
  return (
    <Card className="p-6">
      <h2 className="text-lg font-semibold">Ready when you are</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Guava studies your business, finds what&apos;s holding your marketing and sales back, and recommends what to do
        about it. It never posts or launches anything on its own. You don&apos;t need to fill in everything: start with a
        few answers and add more later.
      </p>
      {missing.length > 0 && (
        <>
          <p className="mt-4 text-sm font-medium">Good places to start:</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-muted-foreground">
            {missing.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </>
      )}
      <Button variant="outline" className="mt-4" onClick={onProfile}>
        Fill in my business profile
      </Button>
    </Card>
  );
}

function DiagnosisPanel({
  brandId,
  summary,
  onAddInfo,
}: {
  brandId: string;
  summary: GuavaDiagnosisSummaryDto;
  onAddInfo: () => void;
}) {
  const { data } = useGuavaDiagnosis(brandId, summary.id);
  if (summary.status === "processing" || (!data && !summary.error)) {
    return (
      <Card className="flex flex-col items-center gap-3 p-10 text-center">
        <Loader2 className="h-7 w-7 animate-spin text-primary" />
        <h2 className="text-base font-semibold">Guava is studying your business</h2>
        <p className="max-w-sm text-sm text-muted-foreground">
          It&apos;s reading your profile and marketing activity. This usually takes about a minute. You can leave this page
          and come back.
        </p>
      </Card>
    );
  }
  if (summary.status === "failed" || !data?.report) {
    return (
      <div role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
        <span>{summary.error ?? "This diagnosis couldn't be shown."} Use Diagnose again to retry.</span>
      </div>
    );
  }
  return <GuavaReport brandId={brandId} diagnosis={data} onAddInfo={onAddInfo} />;
}

const STATUS_LABEL = { processing: "Running", completed: "Done", failed: "Failed" } as const;

function History({
  items,
  currentId,
  onOpen,
}: {
  items: GuavaDiagnosisSummaryDto[];
  currentId: string | null;
  onOpen: (id: string) => void;
}) {
  if (!items.length) {
    return (
      <Card className="p-6 text-sm text-muted-foreground">
        Past diagnoses will appear here, so you can see how your business and Guava&apos;s advice change over time.
      </Card>
    );
  }
  return (
    <ul className="space-y-2">
      {items.map((d, i) => {
        // Each diagnosis after the first records what changed against the one before it.
        const older = items.length - i - 1;
        return (
          <li key={d.id}>
            <button
              type="button"
              onClick={() => onOpen(d.id)}
              disabled={d.status === "processing"}
              className={cn(
                "w-full rounded-lg border bg-card p-3 text-left transition-colors hover:bg-accent/50",
                d.id === currentId && "border-primary/60",
              )}
            >
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{fmtDate(d.createdAt)}</span>
                <Badge variant={d.status === "failed" ? "destructive" : d.status === "completed" ? "default" : "muted"}>
                  {STATUS_LABEL[d.status]}
                </Badge>
                {i === 0 && <Badge variant="outline">Latest</Badge>}
                <span>{d.completenessPct}% of key answers</span>
              </div>
              <div className="mt-1 text-sm">
                {d.headline || (d.status === "failed" ? (d.error ?? "Didn't finish") : "In progress…")}
              </div>
              {d.status === "completed" && (
                <div className="mt-1 text-xs text-muted-foreground">
                  {d.priorityCount} priorities · {d.recommendationCount} recommendations
                  {older > 0 && " · compared with the previous diagnosis inside"}
                </div>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
