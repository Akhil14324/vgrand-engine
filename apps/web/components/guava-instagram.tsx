"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { AlertCircle, ExternalLink, Film, Instagram, Loader2 } from "lucide-react";
import {
  type BrandDto,
  type GuavaBrandFit,
  type GuavaContentAuditDto,
  type GuavaContentAuditSummaryDto,
  type GuavaContentReport,
  type GuavaPerformance,
  type GuavaSplitPost,
  type GuavaReelInsight,
} from "@catgpt/types";
import {
  useInstagramSetup,
  useGuavaContentAudit,
  useGuavaContentAudits,
  useStartGuavaContentAudit,
} from "@/lib/guava-hooks";
import { cn } from "@/lib/utils";
import { EvidenceBadge, fmtDate } from "@/components/guava-report";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toaster";

const FIT_LABEL: Record<GuavaBrandFit, string> = { on_brand: "On brand", partly: "Partly on brand", off_brand: "Off brand" };
const FIT_CLASS: Record<GuavaBrandFit, string> = {
  on_brand: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  partly: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  off_brand: "bg-destructive/15 text-destructive",
};
const PRIORITY_LABEL = { high: "Do first", medium: "Next", low: "Later" } as const;
const PRIORITY_CLASS = {
  high: "bg-destructive/15 text-destructive",
  medium: "bg-primary/15 text-primary",
  low: "bg-muted text-muted-foreground",
} as const;
const SOURCE_LABEL = { video: "Watched video", thumbnail: "Cover image only", caption: "Caption only" } as const;

function FitPill({ fit, className }: { fit: GuavaBrandFit; className?: string }) {
  return <span className={cn("shrink-0 rounded-md px-2 py-0.5 text-xs font-medium", FIT_CLASS[fit], className)}>{FIT_LABEL[fit]}</span>;
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">{children}</p>;
}

export function GuavaInstagram({ brand, canEdit }: { brand: BrandDto; canEdit: boolean }) {
  const setup = useInstagramSetup(brand.workspaceId);
  const audits = useGuavaContentAudits(brand.id);
  const start = useStartGuavaContentAudit(brand.id);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const list = audits.data ?? [];
  const running = list.find((a) => a.status === "processing");
  const shown = list.find((a) => a.id === selectedId) ?? running ?? list.find((a) => a.status === "completed") ?? null;
  const latestFailed = list[0]?.status === "failed" ? list[0] : null;
  const lastDone = list.find((a) => a.status === "completed");

  // Reviews this brand: its posts are picked out of your one account, rivals come from the Instagram page.
  const run = () => start.mutate(undefined, { onSuccess: () => setSelectedId(null), onError: (e) => toast.error(e.message) });

  if (setup.isLoading || audits.isLoading) return <Skeleton className="h-48 w-full" />;
  const s = setup.data;
  const busy = !!running || start.isPending;

  return (
    <div className="space-y-4">
      <Card className="p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Instagram className="h-5 w-5 shrink-0 text-primary" />
          <div className="min-w-0 flex-1 text-sm">
            {s?.accountHandle ? (
              <>
                <div className="font-semibold">Reviewing {brand.name} from @{s.accountHandle}</div>
                <div className="text-muted-foreground">
                  {s.competitors.length ? `Rivals: ${s.competitors.map((h) => `@${h}`).join(", ")}` : "No rival accounts added"}
                  {" · "}
                  <Link href="/instagram" className="underline">
                    Change in Instagram
                  </Link>
                </div>
              </>
            ) : (
              <>
                <div className="font-semibold">Add your Instagram account first</div>
                <div className="text-muted-foreground">
                  Add your account and up to 3 rival accounts in Brand Engine → Instagram. Results show here, brand by brand.
                </div>
              </>
            )}
          </div>
          {s?.accountHandle ? (
            <div className="flex shrink-0 flex-col gap-1 sm:items-end">
              <Button onClick={run} disabled={busy || !canEdit}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Film className="h-4 w-4" />}
                {busy ? "Reviewing…" : lastDone ? `Review ${brand.name} again` : `Review ${brand.name}`}
              </Button>
              {lastDone && <span className="text-xs text-muted-foreground">Last reviewed {fmtDate(lastDone.createdAt)}</span>}
              {!canEdit && <span className="text-xs text-muted-foreground">Only the owner can run a review.</span>}
            </div>
          ) : (
            <Button asChild className="shrink-0">
              <Link href="/instagram">Set up Instagram</Link>
            </Button>
          )}
        </div>
      </Card>

      {latestFailed && shown?.id !== latestFailed.id && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <span>{latestFailed.error ?? "The latest review didn't finish."}</span>
        </div>
      )}

      {shown && <AuditPanel brandId={brand.id} summary={shown} />}

      {list.length > 1 && <AuditHistory items={list} currentId={shown?.id ?? null} onOpen={setSelectedId} />}
    </div>
  );
}

function AuditPanel({ brandId, summary }: { brandId: string; summary: GuavaContentAuditSummaryDto }) {
  const { data } = useGuavaContentAudit(brandId, summary.id);
  if (summary.status === "processing") {
    return (
      <Card className="flex flex-col items-center gap-3 p-10 text-center">
        <Loader2 className="h-7 w-7 animate-spin text-primary" />
        <h2 className="text-base font-semibold">{summary.progress ?? "Reviewing your Instagram"}</h2>
        <p className="max-w-sm text-sm text-muted-foreground">
          Gemini is watching each reel. This takes a few minutes. You can leave this page and come back.
        </p>
      </Card>
    );
  }
  if (summary.status === "failed") return null;
  if (!data?.report) return <Skeleton className="h-64 w-full" />;
  return <AuditReport audit={data} />;
}

function AuditReport({ audit }: { audit: GuavaContentAuditDto }) {
  const r = audit.report!;
  const own = audit.reels.filter((x) => x.isOwn);
  const verdictFor = new Map(r.reelVerdicts.map((v) => [v.mediaId, v]));
  const categoryFor = new Map(audit.split.map((p) => [p.mediaId, p.category]));
  const [tab, setTab] = useState("performance");

  return (
    <div className="space-y-4">
      <Card className="p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-2">
          <FitPill fit={r.brandFit.verdict} className="text-sm" />
          <span className="text-sm tabular-nums text-muted-foreground">Brand fit {Math.round(r.brandFit.score)}/100</span>
          <span className="text-xs text-muted-foreground">· @{audit.handle} · {fmtDate(audit.createdAt)}</span>
        </div>
        <h2 className="mt-2 text-lg font-semibold">{r.headline}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{r.summary}</p>
        {r.brandFit.why && <p className="mt-2 text-sm">{r.brandFit.why}</p>}
        {r.brandBasis === "inferred" && (
          <p className="mt-3 rounded-lg bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-300">
            Your brand details in Brand Engine are thin, so the brand was read from your content itself.{" "}
            {r.brandBasisNote}
          </p>
        )}
      </Card>

      {audit.skippedCompetitors.length > 0 && (
        <div role="alert" className="space-y-1 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
          {audit.skippedCompetitors.map((s) => (
            <p key={s.handle}>
              <span className="font-medium">@{s.handle}</span>: {s.reason}
            </p>
          ))}
        </div>
      )}

      <Tabs value={tab} onValueChange={setTab} className="space-y-4">
        <TabsList className="flex-wrap">
          <TabsTrigger value="performance">Performance</TabsTrigger>
          <TabsTrigger value="fit">Brand fit</TabsTrigger>
          <TabsTrigger value="improve">Improve ({r.improvements.length})</TabsTrigger>
          <TabsTrigger value="competitors">Competitors ({r.competitors.length})</TabsTrigger>
          {audit.split.length > 0 && <TabsTrigger value="split">Account split</TabsTrigger>}
        </TabsList>

        <TabsContent value="performance" className="space-y-4">
          <PerformancePanel audit={audit} perf={audit.performance} />
        </TabsContent>

        {audit.split.length > 0 && (
          <TabsContent value="split" className="space-y-4">
            <SplitPanel audit={audit} />
          </TabsContent>
        )}

        <TabsContent value="fit" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Your reels</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {own.map((reel) => (
                <ReelCard key={reel.mediaId} reel={reel} verdict={verdictFor.get(reel.mediaId)} category={categoryFor.get(reel.mediaId)} />
              ))}
            </CardContent>
          </Card>

          {r.brandGaps.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Where content and brand don&apos;t match</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {r.brandGaps.map((g, i) => (
                  <div key={i} className="grid gap-2 rounded-lg border p-3 text-sm sm:grid-cols-3">
                    <div>
                      <div className="text-xs font-medium text-muted-foreground">Your brand says</div>
                      {g.brandSays}
                    </div>
                    <div>
                      <div className="text-xs font-medium text-muted-foreground">Your reels show</div>
                      {g.contentShows}
                    </div>
                    <div>
                      <div className="text-xs font-medium text-muted-foreground">Fix</div>
                      {g.fix}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <FindingList title="What's working" items={r.ownContent.strengths} empty="Nothing clear yet." />
            <FindingList title="What's holding it back" items={r.ownContent.weaknesses} empty="Nothing clear yet." />
          </div>
          {r.ownContent.themes.length > 0 && (
            <div className="flex flex-wrap gap-2">
              <span className="text-sm text-muted-foreground">Recurring themes:</span>
              {r.ownContent.themes.map((t) => (
                <Badge key={t} variant="muted">
                  {t}
                </Badge>
              ))}
            </div>
          )}
          {r.uncertainties.length > 0 && (
            <Card className="p-4 text-sm">
              <div className="font-medium">To make this review sharper</div>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted-foreground">
                {r.uncertainties.map((u, i) => (
                  <li key={i}>
                    <span className="text-foreground">{u.area}:</span> {u.needed}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="improve" className="space-y-3">
          {r.improvements.length ? (
            r.improvements.map((imp, i) => (
              <Card key={i} className="p-4 text-sm">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="font-semibold">{imp.title}</h3>
                  <span className={cn("shrink-0 rounded-md px-2 py-0.5 text-xs font-medium", PRIORITY_CLASS[imp.priority])}>
                    {PRIORITY_LABEL[imp.priority]}
                  </span>
                </div>
                <p className="mt-1">{imp.what}</p>
                {imp.why && <p className="mt-1 text-muted-foreground">Why: {imp.why}</p>}
                {imp.example && (
                  <p className="mt-2 rounded-md bg-muted/60 p-2">
                    <span className="font-medium">Reel idea: </span>
                    {imp.example}
                  </p>
                )}
                {imp.measure && <p className="mt-2 text-xs text-muted-foreground">How to tell it worked: {imp.measure}</p>}
              </Card>
            ))
          ) : (
            <Empty>No suggestions this time.</Empty>
          )}
        </TabsContent>

        <TabsContent value="competitors" className="space-y-4">
          {r.competitors.length ? (
            r.competitors.map((c) => <CompetitorCard key={c.handle} audit={audit} competitor={c} />)
          ) : (
            <Empty>
              {audit.competitors.length
                ? "None of the competitors could be compared. See the notes above."
                : "Add competitor Instagram accounts above and review again to compare your content with theirs."}
            </Empty>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function FindingList({
  title,
  items,
  empty,
}: {
  title: string;
  items: GuavaContentReport["ownContent"]["strengths"];
  empty: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {items.length ? (
          items.map((f, i) => (
            <div key={i} className="text-sm">
              <div className="flex items-start justify-between gap-2">
                <span className="font-medium">{f.title}</span>
                <EvidenceBadge evidence={f.evidence} />
              </div>
              <p className="text-muted-foreground">{f.detail}</p>
            </div>
          ))
        ) : (
          <Empty>{empty}</Empty>
        )}
      </CardContent>
    </Card>
  );
}

function ReelThumb({ reel }: { reel: { thumbnailUrl: string | null } }) {
  const [broken, setBroken] = useState(false);
  // Instagram CDN links expire after a while; fall back to an icon.
  if (!reel.thumbnailUrl || broken) {
    return (
      <div className="flex aspect-[9/16] max-h-48 w-full items-center justify-center rounded-md bg-muted">
        <Film className="h-6 w-6 text-muted-foreground" />
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={reel.thumbnailUrl}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setBroken(true)}
      className="aspect-[9/16] max-h-48 w-full rounded-md object-cover"
    />
  );
}

function ReelCard({
  reel,
  verdict,
  category,
}: {
  reel: GuavaReelInsight;
  verdict?: { fit: GuavaBrandFit; note: string; positives?: string[]; negatives?: string[] };
  category?: string;
}) {
  return (
    <div className="flex gap-3 rounded-lg border p-2 text-sm">
      <div className="w-20 shrink-0">
        <ReelThumb reel={reel} />
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-1.5">
          {verdict && <FitPill fit={verdict.fit} />}
          {category && <Badge variant="muted">{category}</Badge>}
          {reel.permalink && (
            <a href={reel.permalink} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground" aria-label="Open on Instagram">
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
        </div>
        <p className="line-clamp-3">{verdict?.note || reel.notes.summary}</p>
        {verdict?.positives?.map((t, i) => (
          <p key={`p${i}`} className="text-xs text-emerald-700 dark:text-emerald-400">+ {t}</p>
        ))}
        {verdict?.negatives?.map((t, i) => (
          <p key={`n${i}`} className="text-xs text-destructive">− {t}</p>
        ))}
        <p className="text-xs text-muted-foreground">
          {reel.likes !== null ? `${reel.likes} likes` : "likes hidden"} · {reel.comments ?? "?"} comments
          {reel.timestamp ? ` · ${fmtDate(reel.timestamp)}` : ""}
        </p>
        <p className="text-[11px] text-muted-foreground">{SOURCE_LABEL[reel.analysedFrom]}</p>
      </div>
    </div>
  );
}

function avg(reels: GuavaReelInsight[], key: "likes" | "comments") {
  const xs = reels.flatMap((r) => (r[key] === null ? [] : [r[key] as number]));
  return xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null;
}

function CompetitorCard({
  audit,
  competitor: c,
}: {
  audit: GuavaContentAuditDto;
  competitor: GuavaContentReport["competitors"][number];
}) {
  const handle = c.handle.replace(/^@/, "").toLowerCase();
  const ownInfo = audit.accounts[0];
  const theirInfo = audit.accounts.find((a, i) => i > 0 && a.handle.toLowerCase() === handle);
  const ownReels = audit.reels.filter((r) => r.isOwn);
  const theirReels = audit.reels.filter((r) => !r.isOwn && r.handle.toLowerCase() === handle);
  const fmt = (n: number | null | undefined) => (n === null || n === undefined ? "–" : n.toLocaleString());

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          You vs <a href={`https://www.instagram.com/${handle}/`} target="_blank" rel="noreferrer" className="underline">@{handle}</a>
        </CardTitle>
        <p className="text-sm text-muted-foreground">{c.summary}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="py-2 pr-3 font-medium">Aspect</th>
                <th className="py-2 pr-3 font-medium">You (@{audit.handle})</th>
                <th className="py-2 font-medium">@{handle}</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b align-top">
                <td className="py-2 pr-3 font-medium">Followers</td>
                <td className="py-2 pr-3 tabular-nums">{fmt(ownInfo?.followers)}</td>
                <td className="py-2 tabular-nums">{fmt(theirInfo?.followers)}</td>
              </tr>
              <tr className="border-b align-top">
                <td className="py-2 pr-3 font-medium">Avg likes / comments (reviewed posts)</td>
                <td className="py-2 pr-3 tabular-nums">
                  {fmt(avg(ownReels, "likes"))} / {fmt(avg(ownReels, "comments"))}
                </td>
                <td className="py-2 tabular-nums">
                  {fmt(avg(theirReels, "likes"))} / {fmt(avg(theirReels, "comments"))}
                </td>
              </tr>
              {c.differences.map((d, i) => (
                <tr key={i} className="border-b align-top last:border-0">
                  <td className="py-2 pr-3 font-medium">{d.aspect}</td>
                  <td className="py-2 pr-3">{d.you}</td>
                  <td className="py-2">{d.them}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <BulletList title="They do better" items={c.theyDoBetter} />
          <BulletList title="You do better" items={c.youDoBetter} />
          <BulletList title="Ideas to try (your way)" items={c.ideasToTry} />
        </div>
        {theirReels.length > 0 && (
          <div>
            <div className="mb-2 text-xs font-medium text-muted-foreground">Their reels that were reviewed</div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {theirReels.map((reel) => (
                <ReelCard key={reel.mediaId} reel={reel} />
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function BulletList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="text-sm">
      <div className="font-medium">{title}</div>
      {items.length ? (
        <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted-foreground">
          {items.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-muted-foreground">–</p>
      )}
    </div>
  );
}

function AuditHistory({
  items,
  currentId,
  onOpen,
}: {
  items: GuavaContentAuditSummaryDto[];
  currentId: string | null;
  onOpen: (id: string) => void;
}) {
  return (
    <Card className="p-4">
      <div className="mb-2 text-sm font-medium">Past reviews</div>
      <ul className="space-y-1.5">
        {items.map((a) => (
          <li key={a.id}>
            <button
              type="button"
              disabled={a.status !== "completed"}
              onClick={() => onOpen(a.id)}
              className={cn(
                "flex w-full flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-left text-xs transition-colors hover:bg-accent/50 disabled:opacity-60",
                a.id === currentId && "border-primary/60",
              )}
            >
              <span className="font-medium">{fmtDate(a.createdAt)}</span>
              {a.verdict ? <FitPill fit={a.verdict} /> : <Badge variant="muted">{a.status === "failed" ? "Failed" : "Running"}</Badge>}
              {a.score !== null && <span className="tabular-nums text-muted-foreground">{a.score}/100</span>}
              {a.competitors.length > 0 && <span className="text-muted-foreground">vs {a.competitors.map((h) => `@${h}`).join(", ")}</span>}
              <span className="w-full truncate text-sm sm:w-auto sm:flex-1">{a.headline || a.error}</span>
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border bg-card px-3 py-2" title={hint}>
      <div className="text-xl font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function PerformancePanel({ audit, perf }: { audit: GuavaContentAuditDto; perf: GuavaPerformance | null }) {
  const r = audit.report!;
  const own = audit.reels.filter((x) => x.isOwn);
  const best = own.find((x) => x.mediaId === perf?.bestMediaId);
  const weakest = own.find((x) => x.mediaId === perf?.weakestMediaId);
  const fmt = (n: number | null | undefined) => (n === null || n === undefined ? "–" : n.toLocaleString());
  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Followers" value={fmt(perf?.followers)} />
        <StatTile label="Avg likes per post" value={fmt(perf?.avgLikes)} />
        <StatTile label="Avg comments per post" value={fmt(perf?.avgComments)} />
        <StatTile
          label="Engagement rate"
          value={perf?.engagementRatePct !== null && perf?.engagementRatePct !== undefined ? `${perf.engagementRatePct}%` : "–"}
          hint="(average likes + comments) ÷ followers"
        />
      </div>
      <p className="text-xs text-muted-foreground">
        From the {perf?.postsReviewed ?? 0} {audit.split.length ? "posts about this brand" : "latest posts"} on @{audit.handle}. Views and
        reach are not included: Instagram only shares them with an extra insights permission.
      </p>
      {(r.performance.summary || r.performance.whatWorks || r.performance.whatDoesNot) && (
        <Card className="space-y-2 p-4 text-sm">
          {r.performance.summary && <p>{r.performance.summary}</p>}
          {r.performance.whatWorks && (
            <p>
              <span className="font-medium text-emerald-700 dark:text-emerald-400">What works: </span>
              {r.performance.whatWorks}
            </p>
          )}
          {r.performance.whatDoesNot && (
            <p>
              <span className="font-medium text-destructive">What doesn&apos;t: </span>
              {r.performance.whatDoesNot}
            </p>
          )}
        </Card>
      )}
      {(best || weakest) && (
        <div className="grid gap-3 md:grid-cols-2">
          {best && (
            <div>
              <div className="mb-1 text-xs font-medium text-muted-foreground">Best performing</div>
              <ReelCard reel={best} verdict={r.reelVerdicts.find((v) => v.mediaId === best.mediaId)} />
            </div>
          )}
          {weakest && (
            <div>
              <div className="mb-1 text-xs font-medium text-muted-foreground">Weakest</div>
              <ReelCard reel={weakest} verdict={r.reelVerdicts.find((v) => v.mediaId === weakest.mediaId)} />
            </div>
          )}
        </div>
      )}
      {r.reachTips.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">How to reach more people</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="list-decimal space-y-2 pl-5 text-sm">
              {r.reachTips.map((t, i) => (
                <li key={i}>
                  <span className="font-medium">{t.tip}</span>
                  {t.why && <span className="text-muted-foreground"> · {t.why}</span>}
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      )}
    </>
  );
}

/** Which brand each recent post on the account belongs to, and its content category. */
function SplitPanel({ audit }: { audit: GuavaContentAuditDto }) {
  const [filter, setFilter] = useState<string>("this");
  const ownIds = new Set(audit.reels.filter((r) => r.isOwn).map((r) => r.mediaId));
  const thisBrandId = audit.split.find((p) => ownIds.has(p.mediaId))?.brandId ?? null;
  const byBrand = new Map<string, { name: string; count: number }>();
  for (const p of audit.split) {
    const key = p.brandId ?? "none";
    const cur = byBrand.get(key) ?? { name: p.brandName ?? "Not about any brand", count: 0 };
    cur.count += 1;
    byBrand.set(key, cur);
  }
  const want = filter === "this" ? (thisBrandId ?? "none") : filter;
  const shown: GuavaSplitPost[] = filter === "all" ? audit.split : audit.split.filter((p) => (p.brandId ?? "none") === want);
  const categories = new Map<string, number>();
  for (const p of shown) categories.set(p.category, (categories.get(p.category) ?? 0) + 1);

  return (
    <>
      <p className="text-sm text-muted-foreground">
        @{audit.handle} posts for more than one of your brands. Gemini sorted its last {audit.split.length} posts by brand, and only this
        brand&apos;s posts were reviewed.
      </p>
      <div className="flex flex-wrap gap-2">
        <FilterChip active={filter === "this"} onClick={() => setFilter("this")}>
          This brand ({thisBrandId ? (byBrand.get(thisBrandId)?.count ?? 0) : 0})
        </FilterChip>
        {[...byBrand].map(([id, b]) =>
          id === thisBrandId ? null : (
            <FilterChip key={id} active={filter === id} onClick={() => setFilter(id)}>
              {b.name} ({b.count})
            </FilterChip>
          ),
        )}
        <FilterChip active={filter === "all"} onClick={() => setFilter("all")}>
          All ({audit.split.length})
        </FilterChip>
      </div>
      {categories.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">Content categories:</span>
          {[...categories]
            .sort((a, b) => b[1] - a[1])
            .map(([c, n]) => (
              <Badge key={c} variant="muted">
                {c} · {n}
              </Badge>
            ))}
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {shown.map((p) => (
          <div key={p.mediaId} className="flex gap-3 rounded-lg border p-2 text-sm">
            <div className="w-16 shrink-0">
              <ReelThumb reel={p} />
            </div>
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant={p.brandId ? "secondary" : "muted"}>{p.brandName ?? "No brand"}</Badge>
                {p.permalink && (
                  <a href={p.permalink} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground" aria-label="Open on Instagram">
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                )}
              </div>
              <div className="text-xs font-medium">
                {p.category}
                {p.isReel ? " · reel" : ""}
              </div>
              <p className="line-clamp-2 text-xs text-muted-foreground">{p.caption || p.reason}</p>
              <p className="text-[11px] text-muted-foreground">
                {p.likes ?? "?"} likes · {p.comments ?? "?"} comments
              </p>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1 text-xs transition-colors",
        active ? "border-primary bg-primary/10 text-primary" : "hover:bg-accent/50",
      )}
    >
      {children}
    </button>
  );
}
