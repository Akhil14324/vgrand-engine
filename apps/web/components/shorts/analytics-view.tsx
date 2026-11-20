"use client";

import { useState } from "react";
import { ExternalLink, FileText } from "lucide-react";
import type { ShortsDashboardDto, ShortsMetric } from "@catgpt/types";
import { ShortsShell, fmtNum, fmtWhen } from "@/components/shorts/shorts-shell";
import { HBarChart, Sparkline, StatTile, fmtCompact } from "@/components/shorts/charts";
import { Markdown } from "@/components/markdown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toaster";
import { ApiRequestError } from "@/lib/api";
import { useGenerateReport, useShortsDashboard, useShortsReports } from "@/lib/shorts-hooks";

const METRIC_LABEL: Record<ShortsMetric, string> = {
  views7d: "views at 7 days",
  views: "latest views",
};

const DIM_LABEL: Record<string, string> = {
  hookType: "Hook type",
  lengthBucket: "Length",
  postingHour: "Posting hour (IST)",
  path: "Production path",
  voice: "Voice",
  synthetic: "Synthetic",
  niche: "Niche",
};

export function ShortsAnalyticsView() {
  return (
    <ShortsShell current="analytics">
      <Analytics />
    </ShortsShell>
  );
}

function Analytics() {
  const [metric, setMetric] = useState<ShortsMetric>("views7d");
  const { data, isLoading } = useShortsDashboard(metric);
  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex rounded-md border p-0.5 text-sm" role="radiogroup" aria-label="Metric">
          {(["views7d", "views"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={metric === m}
              onClick={() => setMetric(m)}
              className={metric === m ? "rounded bg-primary/15 px-2.5 py-1 font-medium text-primary" : "px-2.5 py-1 text-muted-foreground"}
            >
              {m === "views7d" ? "Views at 7 days (comparable)" : "Latest views"}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Channels with fewer than {data?.thresholds.minVideosToRank ?? 30} posted videos show &quot;too early&quot; and aren&apos;t ranked. Dry runs are
          excluded.
        </p>
      </div>
      {isLoading || !data ? <Skeleton className="h-96 w-full" /> : <Dashboard d={data} />}
    </>
  );
}

function Dashboard({ d }: { d: ShortsDashboardDto }) {
  const m = METRIC_LABEL[d.metric];
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Videos posted" value={fmtNum(d.totals.videosPosted)} />
        <StatTile label="Total views" value={fmtCompact(d.totals.totalViews)} />
        <StatTile label="Channels ranked" value={`${d.totals.channelsRanked} / ${d.overview.length}`} sub={`need ${d.thresholds.minVideosToRank}+ posted videos`} />
        <StatTile
          label="Path C spend this month"
          value={`${fmtNum(d.costs.budget.spent, 2)} ${d.costs.budget.currency ?? ""}`}
          sub={d.costs.budget.remaining !== null ? `${fmtNum(d.costs.budget.remaining, 2)} left of ${fmtNum(d.costs.budget.budget, 2)}` : "no budget set"}
        />
      </div>

      <Overview d={d} />
      <Niche d={d} metricLabel={m} />
      <Formats d={d} metricLabel={m} />
      <Outliers d={d} metricLabel={m} />
      <Reports />
    </div>
  );
}

function SectionCard({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <Card className="space-y-3 p-4">
      <div>
        <h2 className="font-semibold">{title}</h2>
        {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
      </div>
      {children}
    </Card>
  );
}

function Overview({ d }: { d: ShortsDashboardDto }) {
  const rows = [...d.overview].sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999) || b.videosPosted - a.videosPosted);
  return (
    <SectionCard title="Overview" sub="Per channel. Median views use the selected metric; subscribers and view % come from YouTube Analytics (connected channels only).">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th className="py-1 pr-3">Rank</th>
              <th className="pr-3">Channel</th>
              <th className="pr-3 text-right">Posted</th>
              <th className="pr-3 text-right">Total views</th>
              <th className="pr-3 text-right">Median views</th>
              <th className="pr-3 text-right">Median @7d</th>
              <th className="pr-3 text-right">Subs gained</th>
              <th className="pr-3 text-right">Avg view %</th>
              <th className="text-right">Viewed vs swiped</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.slug} className="border-t">
                <td className="py-1.5 pr-3">{r.confidence === "too_early" ? <Badge variant="muted">too early</Badge> : (r.rank ?? "-")}</td>
                <td className="pr-3">
                  {r.name} <span className="text-xs text-muted-foreground">· {r.path}</span>
                </td>
                <td className="pr-3 text-right tabular-nums">{r.videosPosted}</td>
                <td className="pr-3 text-right tabular-nums">{fmtNum(r.totalViews)}</td>
                <td className="pr-3 text-right tabular-nums">{fmtNum(r.medianViews)}</td>
                <td className="pr-3 text-right tabular-nums">
                  {fmtNum(r.medianViews7d)}
                  {r.videosWith7d ? <span className="text-xs text-muted-foreground"> (n={r.videosWith7d})</span> : null}
                </td>
                <td className="pr-3 text-right tabular-nums">{fmtNum(r.subscribersGained)}</td>
                <td className="pr-3 text-right tabular-nums">{r.avgViewPercentage !== null ? `${fmtNum(r.avgViewPercentage, 1)}%` : "-"}</td>
                <td className="text-right tabular-nums">{r.avgViewedPct !== null ? `${fmtNum(r.avgViewedPct, 1)}%` : "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
}

function Niche({ d, metricLabel }: { d: ShortsDashboardDto; metricLabel: string }) {
  const bars = [...d.niche.perVideo]
    .sort((a, b) => (b.viewsPerVideo ?? -1) - (a.viewsPerVideo ?? -1))
    .map((r) => ({
      key: r.slug,
      label: r.name,
      value: r.viewsPerVideo,
      muted: r.confidence === "too_early",
      note: r.confidence === "too_early" ? `too early (${r.videosPosted} posted)` : `${r.videosPosted} posted`,
      detail: [`${fmtNum(r.viewsPerVideo)} views per video`, r.subsPerVideo !== null ? `${fmtNum(r.subsPerVideo, 2)} subs per video` : "subs: no analytics", `niche: ${r.niche}`],
    }));
  const yMax = Math.max(0, ...d.niche.trend.flatMap((t) => t.points.map((p) => p.median)));
  return (
    <SectionCard title="Niche comparison" sub={`Normalised per video posted. Trend: weekly median ${metricLabel} by posting week, same scale in every panel.`}>
      <HBarChart data={bars} format={(n) => fmtCompact(n)} />
      <div className="grid grid-cols-1 gap-3 pt-2 sm:grid-cols-2 lg:grid-cols-5">
        {d.overview.map((c) => {
          const t = d.niche.trend.find((x) => x.slug === c.slug);
          return (
            <div key={c.slug} className="rounded-md border p-2">
              <div className="truncate text-xs font-medium">{c.name}</div>
              <Sparkline points={(t?.points ?? []).map((p) => ({ x: p.week, y: p.median, n: p.n }))} yMax={yMax} />
            </div>
          );
        })}
      </div>
    </SectionCard>
  );
}

function Formats({ d, metricLabel }: { d: ShortsDashboardDto; metricLabel: string }) {
  const dims = Object.keys(d.formats);
  return (
    <SectionCard
      title="Format analysis"
      sub={`Median ${metricLabel} per tag value across all channels. Grey bars have fewer than ${d.thresholds.minGroupSize} videos with data: don't conclude from them. Tags overlap with niche, so compare within a channel before changing a format.`}
    >
      <Tabs defaultValue={dims[0] ?? "hookType"}>
        <TabsList>
          {dims.map((k) => (
            <TabsTrigger key={k} value={k}>
              {DIM_LABEL[k] ?? k}
            </TabsTrigger>
          ))}
        </TabsList>
        {dims.map((k) => (
          <TabsContent key={k} value={k} className="pt-3">
            <HBarChart
              data={d.formats[k]!.map((g) => ({
                key: g.value,
                label: g.value,
                value: g.medianMetric,
                muted: !g.enough,
                note: `n=${g.withMetric}${g.enough ? "" : " (too few)"}`,
                detail: [
                  `${g.videos} videos, ${g.withMetric} with ${metricLabel}`,
                  g.avgViewPercentage !== null ? `avg view ${fmtNum(g.avgViewPercentage, 1)}%` : "avg view %: no analytics",
                  g.engagementRate !== null ? `engagement ${(g.engagementRate * 100).toFixed(1)}%` : "engagement: -",
                ],
              }))}
            />
          </TabsContent>
        ))}
      </Tabs>
    </SectionCard>
  );
}

function Outliers({ d, metricLabel }: { d: ShortsDashboardDto; metricLabel: string }) {
  return (
    <SectionCard title="Outliers" sub={`Top 10% of each channel by ${metricLabel} (channels with 10+ videos with data), and the tags they share.`}>
      {d.outliers.length === 0 ? (
        <p className="text-sm text-muted-foreground">None yet: needs at least 10 posted videos with data in a channel.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="py-1 pr-3">Video</th>
                <th className="pr-3">Channel</th>
                <th className="pr-3 text-right">Views</th>
                <th className="pr-3 text-right">x channel median</th>
                <th>Tags</th>
              </tr>
            </thead>
            <tbody>
              {d.outliers.map((o) => (
                <tr key={o.id} className="border-t align-top">
                  <td className="py-1.5 pr-3">
                    {o.youtubeUrl ? (
                      <a className="inline-flex items-center gap-1 underline" href={o.youtubeUrl} target="_blank" rel="noreferrer">
                        {o.title} <ExternalLink className="h-3 w-3" />
                      </a>
                    ) : (
                      o.title
                    )}
                  </td>
                  <td className="pr-3">{o.channelSlug}</td>
                  <td className="pr-3 text-right tabular-nums">{fmtNum(o.value)}</td>
                  <td className="pr-3 text-right tabular-nums">{o.channelMedian ? `${(o.value / o.channelMedian).toFixed(1)}x` : "-"}</td>
                  <td className="flex flex-wrap gap-1">
                    {["hookType", "lengthBucket", "postingHour", "path", "topic"].map((k) =>
                      o.dims[k] !== null && o.dims[k] !== undefined ? (
                        <Badge key={k} variant="muted">
                          {k}: {String(o.dims[k])}
                        </Badge>
                      ) : null,
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  );
}

function Reports() {
  const { data } = useShortsReports();
  const gen = useGenerateReport();
  const [open, setOpen] = useState<string | null>(null);
  const shown = data?.find((r) => r.id === open) ?? data?.[0];
  return (
    <SectionCard title="Weekly reports" sub="Written by Claude from the numbers above every Monday 09:00 IST. It is told to use only these numbers and not to rank 'too early' channels.">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={gen.isPending}
          onClick={async () => {
            try {
              await gen.mutateAsync();
              toast.success("Report queued; it appears here in a minute.");
            } catch (err) {
              toast.error(err instanceof ApiRequestError ? err.message : "Could not queue the report");
            }
          }}
        >
          <FileText /> Generate now
        </Button>
        {data?.map((r) => (
          <Button key={r.id} size="sm" variant={shown?.id === r.id ? "secondary" : "ghost"} onClick={() => setOpen(r.id)}>
            {r.weekStart}
          </Button>
        ))}
      </div>
      {shown ? (
        <div className="prose prose-sm prose-invert max-w-none">
          <p className="text-xs text-muted-foreground">Generated {fmtWhen(shown.createdAt)}</p>
          <Markdown>{shown.content}</Markdown>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No reports yet.</p>
      )}
    </SectionCard>
  );
}
