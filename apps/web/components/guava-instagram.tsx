"use client";

import Link from "next/link";
import { useRef, useState, type ReactNode } from "react";
import { AlertCircle, ExternalLink, Film, Loader2 } from "lucide-react";
import {
  type BrandDto,
  type GuavaBrandFit,
  type GuavaContentAuditDto,
  type GuavaContentAuditSummaryDto,
  type GuavaContentReport,
  type GuavaPerformance,
  type GuavaReelRank,
  type GuavaReelTier,
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
import { ReviewRead, RivalRead } from "@/components/guava-instagram-read";
import { FitPill, Glance, ScoreHero, StatRow } from "@/components/guava-overview";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toaster";

const PRIORITY_LABEL = { high: "Do first", medium: "Next", low: "Later" } as const;
const PRIORITY_CLASS = {
  high: "bg-destructive/15 text-destructive",
  medium: "bg-primary/15 text-primary",
  low: "bg-muted text-muted-foreground",
} as const;
const TIER_LABEL: Record<GuavaReelTier, string> = { strong: "Did well", average: "Average", weak: "Did poorly" };
const TIER_CLASS: Record<GuavaReelTier, string> = {
  strong: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  average: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  weak: "bg-destructive/15 text-destructive",
};
const SOURCE_LABEL = { video: "Watched video", thumbnail: "Cover image only", caption: "Caption only" } as const;

function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">{children}</p>;
}

export function GuavaInstagram({ brand }: { brand: BrandDto }) {
  const setup = useInstagramSetup(brand.workspaceId);
  const audits = useGuavaContentAudits(brand.id);

  const list = audits.data ?? [];
  const lastDone = list.find((a) => a.status === "completed");
  const shown = list.find((a) => a.status === "processing") ?? lastDone ?? null;
  const latestFailed = list[0]?.status === "failed" ? list[0] : null;

  if (setup.isLoading || audits.isLoading) return <Skeleton className="h-48 w-full" />;

  // With a finished review the tabs come first and these notes sit under the numbers.
  const notes = (
    <>
      {!setup.data?.accountHandle && (
        <Empty>Add your Instagram account and up to 3 rival accounts in Brand Engine → Instagram. Results show here, brand by brand.</Empty>
      )}
      {latestFailed && shown?.id !== latestFailed.id && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <span>{latestFailed.error ?? "The latest review didn't finish."}</span>
        </div>
      )}
    </>
  );

  if (shown) return <AuditPanel key={shown.id} brandId={brand.id} summary={shown} intro={notes} />;
  return (
    <div className="space-y-4">
      {notes}
      {setup.data?.accountHandle && !latestFailed && <Empty>No review yet. Press the review button at the top.</Empty>}
    </div>
  );
}

/** The page header's action: run a review of this brand, or set Instagram up first. */
export function ReviewButton({ brand, canEdit }: { brand: BrandDto; canEdit: boolean }) {
  const setup = useInstagramSetup(brand.workspaceId);
  const audits = useGuavaContentAudits(brand.id);
  const start = useStartGuavaContentAudit(brand.id);
  if (setup.isLoading || audits.isLoading) return null;

  if (!setup.data?.accountHandle) {
    return (
      <Button asChild size="sm">
        <Link href="/instagram">Set up Instagram</Link>
      </Button>
    );
  }
  const list = audits.data ?? [];
  const busy = start.isPending || list.some((a) => a.status === "processing");
  const again = list.some((a) => a.status === "completed");
  const label = again ? `Review ${brand.name} again` : `Review ${brand.name}`;
  // Reviews this brand: its posts are picked out of your one account, rivals come from the Instagram page.
  return (
    <Button
      size="sm"
      disabled={busy || !canEdit}
      title={canEdit ? label : "Only the owner can run a review."}
      aria-label={busy ? "Reviewing" : label}
      onClick={() => start.mutate(undefined, { onError: (e) => toast.error(e.message) })}
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Film className="h-4 w-4" />}
      <span className="hidden max-w-[260px] truncate sm:inline">{busy ? "Reviewing…" : label}</span>
      <span className="sm:hidden">{busy ? "Reviewing…" : "Review"}</span>
    </Button>
  );
}

const cleanHandle = (audit: GuavaContentAuditDto): GuavaContentAuditDto => ({ ...audit, handle: audit.handle?.replace(/^@+/, "") ?? null });

function AuditPanel({ brandId, summary, intro }: { brandId: string; summary: GuavaContentAuditSummaryDto; intro: ReactNode }) {
  const { data } = useGuavaContentAudit(brandId, summary.id);
  const withIntro = (node: ReactNode) => (
    <div className="space-y-4">
      {intro}
      {node}
    </div>
  );
  if (summary.status === "processing") {
    return withIntro(
      <Card className="flex flex-col items-center gap-3 p-10 text-center">
        <Loader2 className="h-7 w-7 animate-spin text-primary" />
        <h2 className="text-base font-semibold">{summary.progress ?? "Reviewing your Instagram"}</h2>
        <p className="max-w-sm text-sm text-muted-foreground">
          Gemini is watching each reel. This takes a few minutes. You can leave this page and come back.
        </p>
      </Card>,
    );
  }
  if (summary.status === "failed") return withIntro(null);
  if (!data?.report) return withIntro(<Skeleton className="h-64 w-full" />);
  return <AuditReport audit={cleanHandle(data)} intro={intro} />;
}

function AuditReport({ audit, intro }: { audit: GuavaContentAuditDto; intro: ReactNode }) {
  const r = audit.report!;
  const own = audit.reels.filter((x) => x.isOwn);
  const verdictFor = new Map(r.reelVerdicts.map((v) => [v.mediaId, v]));
  const categoryFor = new Map(audit.split.map((p) => [p.mediaId, p.category]));
  const hasRead = r.whatWorks.length > 0 || r.whatLosesPeople.length > 0 || r.doNext.nextVideos.length > 0;
  const [tab, setTab] = useState("performance");
  const details = useRef<HTMLDivElement>(null);
  const open = (next: string) => {
    setTab(next);
    details.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div ref={details} className="scroll-mt-3">
      <Tabs value={tab} onValueChange={setTab} className="space-y-4">
        {/* One line: smaller text where space is tight, sideways swipe on phones. */}
        <TabsList className="flex w-full flex-nowrap justify-between gap-0 [&>button]:px-1.5 [&>button]:text-[13px] lg:[&>button]:px-3 lg:[&>button]:text-[15px]">
          <TabsTrigger value="performance">Performance</TabsTrigger>
          {audit.reelRanking.length > 0 && <TabsTrigger value="compare">Compare reels</TabsTrigger>}
          <TabsTrigger value="fit">Brand fit</TabsTrigger>
          {r.improvements.length > 0 && <TabsTrigger value="improve">Improve ({r.improvements.length})</TabsTrigger>}
          <TabsTrigger value="competitors">Competitors ({r.competitors.length})</TabsTrigger>
          {audit.split.length > 0 && <TabsTrigger value="split">Account split</TabsTrigger>}
          {hasRead && <TabsTrigger value="read">The read</TabsTrigger>}
        </TabsList>

        {hasRead && (
          <TabsContent value="read" className="space-y-4">
            <ReviewRead audit={audit} />
          </TabsContent>
        )}

        <TabsContent value="performance" className="space-y-4">
          <StatRow audit={audit} />
          {intro}
          <ScoreHero audit={audit} />
          <Glance audit={audit} onOpen={open} />
          {audit.skippedCompetitors.length > 0 && (
            <div role="alert" className="space-y-1 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
              {audit.skippedCompetitors.map((s) => (
                <p key={s.handle}>
                  <span className="font-medium">@{s.handle}</span>: {s.reason}
                </p>
              ))}
            </div>
          )}
          <PerformancePanel audit={audit} perf={audit.performance} />
        </TabsContent>

        {audit.reelRanking.length > 0 && (
          <TabsContent value="compare" className="space-y-4">
            <ReelComparisonPanel audit={audit} />
          </TabsContent>
        )}

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
        <RivalRead competitor={c} typical={audit.typical.find((t) => !t.isOwn && t.handle.toLowerCase() === handle)?.typical ?? null} />
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

function PerformancePanel({ audit, perf }: { audit: GuavaContentAuditDto; perf: GuavaPerformance | null }) {
  const r = audit.report!;
  const own = audit.reels.filter((x) => x.isOwn);
  const best = own.find((x) => x.mediaId === perf?.bestMediaId);
  const weakest = own.find((x) => x.mediaId === perf?.weakestMediaId);
  return (
    <>
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

/** Own reels from best to worst, with why each did what it did and what to change. */
function ReelComparisonPanel({ audit }: { audit: GuavaContentAuditDto }) {
  const c = audit.report!.reelComparison;
  const byId = new Map(audit.reels.filter((x) => x.isOwn).map((x) => [x.mediaId, x]));
  const counts = audit.reelRanking.reduce<Record<GuavaReelTier, number>>((n, r) => ({ ...n, [r.tier]: n[r.tier] + 1 }), { strong: 0, average: 0, weak: 0 });
  return (
    <>
      <div className="grid grid-cols-3 gap-3">
        {(["strong", "average", "weak"] as const).map((t) => (
          <div key={t} className={cn("rounded-lg p-3 text-center", TIER_CLASS[t])}>
            <div className="text-2xl font-semibold">{counts[t]}</div>
            <div className="text-xs">{TIER_LABEL[t]}</div>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Reels are ranked by likes + comments against this account&apos;s own average: 20% or more above = did well, 20% or more below = did poorly. Instagram doesn&apos;t
        share views here, so this is engagement, not reach.
      </p>
      {c.summary && (
        <Card className="p-4 text-sm">
          <p>{c.summary}</p>
        </Card>
      )}
      <div className="space-y-3">
        {audit.reelRanking.map((rank) => {
          const reel = byId.get(rank.mediaId);
          if (!reel) return null;
          const entry = c.reels.find((x) => x.mediaId === rank.mediaId);
          return <ComparedReel key={rank.mediaId} reel={reel} rank={rank} entry={entry} />;
        })}
      </div>
      {(c.winningPatterns.length > 0 || c.losingPatterns.length > 0) && (
        <div className="grid gap-3 md:grid-cols-2">
          <BulletList title="What the better reels do" items={c.winningPatterns} />
          <BulletList title="What the weaker reels have in common" items={c.losingPatterns} />
        </div>
      )}
      {c.nextStrategy.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Strategy for the next reels</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="list-decimal space-y-2 pl-5 text-sm">
              {c.nextStrategy.map((x, i) => (
                <li key={i}>
                  <span className="font-medium">{x.title}</span>
                  {x.what && <span>: {x.what}</span>}
                  {x.why && <span className="text-muted-foreground"> · {x.why}</span>}
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      )}
    </>
  );
}

function ComparedReel({
  reel,
  rank,
  entry,
}: {
  reel: GuavaReelInsight;
  rank: GuavaReelRank;
  entry?: { why: string; wentWrong: string[]; doNext: string };
}) {
  return (
    <div className="flex gap-3 rounded-lg border p-3 text-sm">
      <div className="w-24 shrink-0">
        <ReelThumb reel={reel} />
      </div>
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", TIER_CLASS[rank.tier])}>
            #{rank.rank} · {TIER_LABEL[rank.tier]}
          </span>
          <span className="text-xs text-muted-foreground">
            {reel.likes ?? "?"} likes · {reel.comments ?? "?"} comments
            {rank.vsAvgPct !== null ? ` · ${rank.vsAvgPct >= 0 ? "+" : ""}${rank.vsAvgPct}% vs average` : ""}
          </span>
          {reel.permalink && (
            <a href={reel.permalink} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground" aria-label="Open on Instagram">
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
        </div>
        <p className="text-xs text-muted-foreground">{reel.notes.summary}</p>
        {entry?.why && (
          <p>
            <span className="font-medium">Why: </span>
            {entry.why}
          </p>
        )}
        {entry?.wentWrong.map((t, i) => (
          <p key={i} className="text-xs text-destructive">
            − {t}
          </p>
        ))}
        {entry?.doNext && (
          <p className="text-xs">
            <span className="font-medium">Next time: </span>
            {entry.doNext}
          </p>
        )}
      </div>
    </div>
  );
}
