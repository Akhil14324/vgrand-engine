"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { AlertCircle, ArrowLeft, Loader2, RefreshCw, Sparkles } from "lucide-react";
import type { IgDemographicRow, IgInsightsDto, IgInsightsReel, IgStrategyDto } from "@catgpt/types";
import { RequireAuth } from "@/components/require-auth";
import { fmtDate } from "@/components/guava-report";
import { resolveActiveBrand, useBrandMode } from "@/lib/brand-mode";
import { useBrands, useSocialAccounts } from "@/lib/hooks";
import { useInstagramInsights, useInstagramSetup, useInstagramStrategy, useRefreshInstagramInsights } from "@/lib/guava-hooks";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toaster";

const fmt = (n: number | null | undefined) => (n === null || n === undefined ? "–" : n.toLocaleString());

/**
 * Brand Engine → Instagram Insights: the saved Instagram account's real numbers
 * (views, reach, watch time...) straight from Instagram, plus an AI "next
 * strategy" for the active brand.
 */
export function InstagramInsightsView() {
  return (
    <RequireAuth>
      <div className="app-safe-screen flex flex-col">
        <header className="flex items-center gap-3 border-b px-3 py-2.5 sm:px-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/" aria-label="Back to studio">
              <ArrowLeft />
            </Link>
          </Button>
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-2xl font-medium tracking-[-0.02em]">Instagram Insights</h1>
            <p className="truncate text-xs text-muted-foreground">Views, reach and watch time from Instagram, and what to post next</p>
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-4xl space-y-4 px-3 py-4 sm:px-4 sm:py-6">
            <Insights />
          </div>
        </main>
      </div>
    </RequireAuth>
  );
}

function Insights() {
  const { data: brands, isLoading: brandsLoading } = useBrands();
  const chosen = useBrandMode((s) => s.brandId);
  const brand = resolveActiveBrand(brands, chosen) ?? brands?.[0] ?? null;
  const workspaceId = brand?.workspaceId ?? null;
  const accounts = useSocialAccounts(workspaceId, !brandsLoading);
  const setup = useInstagramSetup(brandsLoading ? null : workspaceId);
  const igAccounts = (accounts.data ?? []).filter((a) => a.platform === "instagram");
  // Any connected account can be viewed; the one saved on the Instagram page is the default.
  const [picked, setPicked] = useState("");
  const accountId = picked || setup.data?.accountId || igAccounts[0]?.id || null;
  const ready = !brandsLoading && !accounts.isLoading && !setup.isLoading;
  const insights = useInstagramInsights(workspaceId, accountId, ready);

  if (!ready || insights.isLoading) return <Skeleton className="h-72 w-full" />;
  const picker =
    igAccounts.length > 1 ? (
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">Account</span>
        <Select className="w-auto min-w-[220px]" value={accountId ?? ""} onChange={(e) => setPicked(e.target.value)}>
          {igAccounts.map((a) => (
            <option key={a.id} value={a.id}>
              @{(a.handle ?? a.displayName ?? "instagram").replace(/^@/, "")}
              {a.status !== "active" ? " (reconnect needed)" : ""}
            </option>
          ))}
        </Select>
      </div>
    ) : null;
  const wrap = (node: ReactNode) => (
    <>
      {picker}
      {node}
    </>
  );
  if (insights.error || !insights.data) {
    return wrap(<Notice tone="error">Couldn&apos;t load Instagram insights. Please try again.</Notice>);
  }
  const d = insights.data;
  if (d.status === "no_account") {
    return wrap(
      <Notice>
        Add your Instagram account first.{" "}
        <Link href="/instagram" className="underline">
          Open Instagram setup
        </Link>
      </Notice>,
    );
  }
  if (d.status === "needs_permission") {
    return wrap(
      <Notice tone="warn">
        {d.message}{" "}
        <Link href="/instagram" className="underline">
          Open Instagram setup
        </Link>
      </Notice>,
    );
  }
  if (d.status === "error" || !d.account) {
    return wrap(<Notice tone="error">{d.message ?? "Couldn't read Instagram insights."}</Notice>);
  }
  return wrap(
    <InsightsBody dto={d} workspaceId={workspaceId} accountId={accountId} brand={brand ? { id: brand.id, name: brand.name } : null} />,
  );
}

function Notice({ children, tone }: { children: ReactNode; tone?: "warn" | "error" }) {
  return (
    <Card
      className={
        tone === "error"
          ? "flex items-start gap-2 border-destructive/40 bg-destructive/5 p-4 text-sm"
          : tone === "warn"
            ? "flex items-start gap-2 border-amber-500/40 bg-amber-500/10 p-4 text-sm"
            : "flex items-start gap-2 p-4 text-sm"
      }
    >
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <div>{children}</div>
    </Card>
  );
}

function InsightsBody({
  dto,
  workspaceId,
  accountId,
  brand,
}: {
  dto: IgInsightsDto;
  workspaceId: string | null;
  accountId: string | null;
  brand: { id: string; name: string } | null;
}) {
  const a = dto.account!;
  const refresh = useRefreshInstagramInsights(workspaceId, accountId);
  const reachTotal = (a.reachFollowers ?? 0) + (a.reachNonFollowers ?? 0);
  const followerPct = reachTotal > 0 ? Math.round(((a.reachFollowers ?? 0) / reachTotal) * 100) : null;
  return (
    <>
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>
          @{a.handle} · last {dto.days} days
          {dto.fetchedAt ? ` · updated ${new Date(dto.fetchedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}
        </span>
        <Button
          size="sm"
          variant="outline"
          disabled={refresh.isPending}
          onClick={() => refresh.mutate(undefined, { onError: () => toast.error("Couldn't refresh insights") })}
        >
          {refresh.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Refresh
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label="Views" value={fmt(a.views)} />
        <Tile label="Accounts reached" value={fmt(a.reach)} />
        <Tile label="Interactions" value={fmt(a.interactions)} hint="likes, comments, shares, saves" />
        <Tile label="Followers" value={fmt(a.followers)} />
      </div>

      {followerPct !== null && (
        <Card className="space-y-2 p-4 text-sm">
          <div className="font-medium">Who you reach</div>
          <div className="flex h-3 overflow-hidden rounded-full bg-muted">
            <div className="bg-primary" style={{ width: `${followerPct}%` }} />
          </div>
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>
              Followers {followerPct}% ({fmt(a.reachFollowers)})
            </span>
            <span>
              New people {100 - followerPct}% ({fmt(a.reachNonFollowers)})
            </span>
          </div>
        </Card>
      )}

      <ReelsTable reels={dto.reels} />

      {dto.demographics && (
        <div className="grid gap-3 md:grid-cols-2">
          <Demo title="Gender" rows={dto.demographics.gender} />
          <Demo title="Age" rows={dto.demographics.age} />
        </div>
      )}

      <Strategy brand={brand} accountId={accountId} />
    </>
  );
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg bg-muted/60 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl font-semibold">{value}</div>
      {hint && <div className="text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

function ReelsTable({ reels }: { reels: IgInsightsReel[] }) {
  if (!reels.length) return <Notice>No reels found on this account yet.</Notice>;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Your reels</CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="text-xs text-muted-foreground">
            <tr>
              <th className="py-2 pr-3 font-medium">Reel</th>
              <th className="px-2 font-medium">Views</th>
              <th className="px-2 font-medium">Reach</th>
              <th className="px-2 font-medium">Likes</th>
              <th className="px-2 font-medium">Comments</th>
              <th className="px-2 font-medium">Shares</th>
              <th className="px-2 font-medium">Saves</th>
              <th className="px-2 font-medium">Avg watch</th>
              <th className="px-2 font-medium">Skip</th>
            </tr>
          </thead>
          <tbody>
            {reels.map((r) => (
              <tr key={r.mediaId} className="border-t">
                <td className="py-2 pr-3">
                  <div className="flex items-center gap-2">
                    {r.thumbnailUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={r.thumbnailUrl} alt="" className="h-12 w-9 shrink-0 rounded object-cover" />
                    ) : (
                      <div className="h-12 w-9 shrink-0 rounded bg-muted" />
                    )}
                    <div className="min-w-0">
                      {r.permalink ? (
                        <a href={r.permalink} target="_blank" rel="noreferrer" className="line-clamp-1 max-w-[160px] underline-offset-2 hover:underline">
                          {r.caption || "Open reel"}
                        </a>
                      ) : (
                        <span className="line-clamp-1 max-w-[160px]">{r.caption || "Reel"}</span>
                      )}
                      <div className="text-xs text-muted-foreground">{r.timestamp ? fmtDate(r.timestamp) : ""}</div>
                    </div>
                  </div>
                </td>
                <td className="px-2 font-medium">{fmt(r.views)}</td>
                <td className="px-2">{fmt(r.reach)}</td>
                <td className="px-2">{fmt(r.likes)}</td>
                <td className="px-2">{fmt(r.comments)}</td>
                <td className="px-2">{fmt(r.shares)}</td>
                <td className="px-2">{fmt(r.saves)}</td>
                <td className="px-2">{r.avgWatchSec === null ? "–" : `${r.avgWatchSec}s`}</td>
                <td className="px-2">{r.skipRatePct === null ? "–" : `${r.skipRatePct}%`}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-muted-foreground">
          Reel numbers are for each reel&apos;s whole life, while the tiles above cover the last 30 days. Instagram can lag by up to 48 hours. A dash means Instagram
          didn&apos;t return it.
        </p>
      </CardContent>
    </Card>
  );
}

function Demo({ title, rows }: { title: string; rows: IgDemographicRow[] }) {
  if (!rows.length) return null;
  const total = rows.reduce((n, r) => n + r.value, 0) || 1;
  return (
    <Card className="space-y-2 p-4 text-sm">
      <div className="font-medium">{title}</div>
      {rows.slice(0, 5).map((r) => (
        <div key={r.label}>
          <div className="flex justify-between text-xs">
            <span>{r.label}</span>
            <span className="text-muted-foreground">{Math.round((r.value / total) * 100)}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-primary" style={{ width: `${Math.round((r.value / total) * 100)}%` }} />
          </div>
        </div>
      ))}
    </Card>
  );
}

function Strategy({ brand, accountId }: { brand: { id: string; name: string } | null; accountId: string | null }) {
  const gen = useInstagramStrategy(brand?.id ?? null, accountId);
  const [result, setResult] = useState<IgStrategyDto | null>(null);
  if (!brand) return null;
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">Next strategy for {brand.name}</CardTitle>
        <Button
          size="sm"
          disabled={gen.isPending}
          onClick={() => gen.mutate(undefined, { onSuccess: setResult, onError: (e) => toast.error(e.message) })}
        >
          {gen.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} {result ? "Write again" : "Write strategy"}
        </Button>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {!result && !gen.isPending && (
          <p className="text-muted-foreground">
            Gemini reads these numbers together with {brand.name}&apos;s Brand Engine data and tells you what to post next and why.
          </p>
        )}
        {gen.isPending && <p className="text-muted-foreground">Reading your insights... this takes about a minute.</p>}
        {result && <StrategyResult s={result} />}
      </CardContent>
    </Card>
  );
}

function List({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div>
      <div className="mb-1 font-medium">{title}</div>
      <ul className="list-disc space-y-1 pl-5">
        {items.map((t, i) => (
          <li key={i}>{t}</li>
        ))}
      </ul>
    </div>
  );
}

function StrategyResult({ s }: { s: IgStrategyDto }) {
  const x = s.strategy;
  return (
    <div className="space-y-3">
      {x.headline && <p className="text-base font-medium">{x.headline}</p>}
      {x.summary && <p>{x.summary}</p>}
      <div className="grid gap-3 md:grid-cols-2">
        <List title="What works" items={x.whatWorks} />
        <List title="What doesn't" items={x.whatDoesNot} />
      </div>
      {x.nextReels.length > 0 && (
        <div>
          <div className="mb-1 font-medium">Reels to make next</div>
          <ol className="space-y-2">
            {x.nextReels.map((r, i) => (
              <li key={i} className="rounded-lg border p-3">
                <div className="font-medium">
                  {i + 1}. {r.title}
                </div>
                {r.hook && (
                  <p>
                    <span className="text-muted-foreground">Hook: </span>
                    {r.hook}
                  </p>
                )}
                {r.format && (
                  <p>
                    <span className="text-muted-foreground">Format: </span>
                    {r.format}
                  </p>
                )}
                {r.why && <p className="text-xs text-muted-foreground">{r.why}</p>}
              </li>
            ))}
          </ol>
        </div>
      )}
      <List title="Audience" items={x.audience} />
      <List title="Posting" items={x.posting} />
      <List title="Keep in mind" items={x.watchOut} />
    </div>
  );
}
