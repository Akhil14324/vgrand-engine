"use client";

import { useState } from "react";
import { ShortsShell, fmtNum } from "@/components/shorts/shorts-shell";
import { HBarChart, StatTile } from "@/components/shorts/charts";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toaster";
import { ApiRequestError } from "@/lib/api";
import { useSaveShortsSettings, useShortsDashboard } from "@/lib/shorts-hooks";

export function ShortsCostsView() {
  return (
    <ShortsShell current="costs">
      <Costs />
    </ShortsShell>
  );
}

function Costs() {
  const { data, isLoading } = useShortsDashboard("views");
  const save = useSaveShortsSettings();
  const [price, setPrice] = useState("");
  if (isLoading || !data) return <Skeleton className="h-64 w-full" />;
  const b = data.costs.budget;
  const cur = b.currency ?? "";
  const pct = b.budget ? Math.min(100, (b.spent / b.budget) * 100) : 0;

  const savePrice = async (value: number | null) => {
    try {
      await save.mutateAsync({ pathCPricePerSecond: value });
      setPrice("");
      toast.success("Price saved");
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : "Could not save");
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Monthly Path C budget" value={b.budget !== null ? `${fmtNum(b.budget, 2)} ${cur}` : "not set"} sub="PATH_C_MONTHLY_BUDGET" />
        <StatTile label="Spent this month" value={`${fmtNum(b.spent, 2)} ${cur}`} sub={b.budget ? `${pct.toFixed(0)}% of cap` : undefined} />
        <StatTile label="Remaining" value={b.remaining !== null ? `${fmtNum(b.remaining, 2)} ${cur}` : "-"} sub="Path C falls back to B when a clip won't fit" />
        <StatTile label="Provider" value={b.provider ?? "none"} sub={b.model ?? "VIDEO_GEN_PROVIDER not set"} />
      </div>

      <Card className="space-y-2 p-4 text-sm">
        <h2 className="font-semibold">Price per generated second</h2>
        <p className="text-muted-foreground">
          Current: {b.pricePerSecond !== null ? `${b.pricePerSecond} ${cur}/s` : "unknown"} ({b.priceIsOwnerSet ? "set by you" : "built-in USD list price"}). The built-in
          prices are third-party estimates in USD; with any other BUDGET_CURRENCY, Path C refuses until you set a price here. Use your provider&apos;s real rate.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Input className="h-9 w-32" inputMode="decimal" placeholder={`e.g. 0.08`} value={price} onChange={(e) => setPrice(e.target.value)} />
          <span className="text-muted-foreground">{cur}/second</span>
          <Button
            size="sm"
            disabled={save.isPending}
            onClick={() => {
              const n = Number(price);
              if (!price.trim() || Number.isNaN(n) || n < 0) return toast.error("Enter a non-negative number");
              void savePrice(n);
            }}
          >
            Save
          </Button>
          {b.priceIsOwnerSet && (
            <Button size="sm" variant="ghost" onClick={() => void savePrice(null)}>
              Use built-in price
            </Button>
          )}
        </div>
      </Card>

      <Card className="space-y-3 p-4">
        <div>
          <h2 className="font-semibold">Spend per channel (all time, real videos)</h2>
          <p className="text-xs text-muted-foreground">Only Path C costs money in-app; Path A and B channels show 0. Dry-run spend is excluded.</p>
        </div>
        <HBarChart
          data={[...data.costs.rows]
            .sort((x, y) => y.spend - x.spend)
            .map((r) => ({ key: r.slug, label: r.name, value: r.spend, detail: [`${r.videosMade} videos made`, `cost/video ${fmtNum(r.costPerVideo, 2)} ${cur}`] }))}
          format={(n) => `${fmtNum(n, 2)} ${cur}`}
        />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="py-1 pr-3">Channel</th>
                <th className="pr-3 text-right">Spend</th>
                <th className="pr-3 text-right">Videos made</th>
                <th className="pr-3 text-right">Cost per video</th>
                <th className="text-right">Cost per 1,000 views</th>
              </tr>
            </thead>
            <tbody>
              {data.costs.rows.map((r) => (
                <tr key={r.slug} className="border-t">
                  <td className="py-1.5 pr-3">{r.name}</td>
                  <td className="pr-3 text-right tabular-nums">
                    {fmtNum(r.spend, 2)} {cur}
                  </td>
                  <td className="pr-3 text-right tabular-nums">{r.videosMade}</td>
                  <td className="pr-3 text-right tabular-nums">{r.costPerVideo !== null ? `${fmtNum(r.costPerVideo, 2)} ${cur}` : "-"}</td>
                  <td className="text-right tabular-nums">{r.costPer1kViews !== null ? `${fmtNum(r.costPer1kViews, 2)} ${cur}` : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
