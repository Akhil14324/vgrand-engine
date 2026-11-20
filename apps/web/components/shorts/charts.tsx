"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Small inline-SVG charts for the Shorts dashboards. Single series only (one
 * hue, validated on this app's dark surface #111114: #3987e5, 3:1+). Bars that
 * aren't comparable yet are drawn muted AND labelled, never colour alone.
 */
export const VIZ = {
  series: "#3987e5",
  muted: "hsl(240 4% 40%)",
  grid: "hsl(240 4% 22%)",
};

export const fmtCompact = (n: number | null | undefined, digits = 1) =>
  n === null || n === undefined || Number.isNaN(n)
    ? "-"
    : Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: digits }).format(n);

export interface BarDatum {
  key: string;
  label: string;
  value: number | null;
  /** Not comparable yet (too few videos): drawn muted with `note`. */
  muted?: boolean;
  note?: string;
  /** Extra lines for the tooltip. */
  detail?: string[];
}

/** Horizontal bars from a zero baseline, value labelled at the bar end, hover tooltip per row. */
export function HBarChart({ data, format = fmtCompact, emptyLabel = "No data yet" }: { data: BarDatum[]; format?: (n: number) => string; emptyLabel?: string }) {
  const [hover, setHover] = useState<string | null>(null);
  const max = Math.max(0, ...data.map((d) => d.value ?? 0));
  if (!data.length) return <p className="text-sm text-muted-foreground">{emptyLabel}</p>;
  return (
    <div className="space-y-1.5" role="list">
      {data.map((d) => {
        const pct = d.value !== null && max > 0 ? Math.max(0.5, (d.value / max) * 100) : 0;
        return (
          <div
            key={d.key}
            role="listitem"
            className="group relative grid grid-cols-[minmax(0,9rem)_1fr] items-center gap-2 text-xs"
            onMouseEnter={() => setHover(d.key)}
            onMouseLeave={() => setHover(null)}
          >
            <span className="truncate text-muted-foreground" title={d.label}>
              {d.label}
            </span>
            <div className="flex h-5 items-center gap-2">
              {d.value !== null && d.value > 0 ? (
                <div
                  className="h-3.5 rounded-r-[4px]"
                  style={{ width: `${pct}%`, background: d.muted ? VIZ.muted : VIZ.series, minWidth: 2 }}
                  aria-label={`${d.label}: ${format(d.value)}`}
                />
              ) : null}
              <span className="whitespace-nowrap tabular-nums text-foreground">
                {d.value !== null ? format(d.value) : "no data"}
                {d.note && <span className="ml-1.5 text-muted-foreground">{d.note}</span>}
              </span>
            </div>
            {hover === d.key && d.detail?.length ? (
              <div className="pointer-events-none absolute left-36 top-6 z-10 rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-lg">
                <div className="font-medium">{d.label}</div>
                {d.detail.map((l) => (
                  <div key={l} className="text-muted-foreground">
                    {l}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/** One small line per entity (small multiples), shared y-scale so panels compare. Crosshair tooltip on hover. */
export function Sparkline({
  points,
  yMax,
  width = 220,
  height = 56,
}: {
  points: { x: string; y: number; n: number }[];
  yMax: number;
  width?: number;
  height?: number;
}) {
  const [hi, setHi] = useState<number | null>(null);
  if (!points.length) return <div className="flex h-14 items-center text-xs text-muted-foreground">no data</div>;
  const pad = 4;
  const xs = (i: number) => (points.length === 1 ? width / 2 : pad + (i / (points.length - 1)) * (width - pad * 2));
  const ys = (v: number) => height - pad - (yMax > 0 ? (v / yMax) * (height - pad * 2) : 0);
  const d = points.map((p, i) => `${i ? "L" : "M"}${xs(i).toFixed(1)},${ys(p.y).toFixed(1)}`).join(" ");
  const h = hi !== null ? points[hi] : null;
  return (
    <div className="relative">
      <svg
        width="100%"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="h-14 w-full"
        onMouseLeave={() => setHi(null)}
        onMouseMove={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const rel = ((e.clientX - r.left) / r.width) * width;
          let best = 0;
          points.forEach((_, i) => {
            if (Math.abs(xs(i) - rel) < Math.abs(xs(best) - rel)) best = i;
          });
          setHi(best);
        }}
      >
        <line x1={0} x2={width} y1={height - pad} y2={height - pad} stroke={VIZ.grid} strokeWidth={1} />
        <path d={d} fill="none" stroke={VIZ.series} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        {points.length === 1 && <circle cx={xs(0)} cy={ys(points[0]!.y)} r={4} fill={VIZ.series} />}
        {hi !== null && (
          <>
            <line x1={xs(hi)} x2={xs(hi)} y1={0} y2={height} stroke={VIZ.grid} strokeWidth={1} vectorEffect="non-scaling-stroke" />
            <circle cx={xs(hi)} cy={ys(points[hi]!.y)} r={4} fill={VIZ.series} stroke="hsl(240 7% 7%)" strokeWidth={2} vectorEffect="non-scaling-stroke" />
          </>
        )}
      </svg>
      {h && (
        <div className="pointer-events-none absolute right-0 top-0 rounded border bg-popover px-2 py-1 text-[11px] shadow">
          week of {h.x}: <span className="font-medium tabular-nums">{fmtCompact(h.y)}</span> ({h.n} video{h.n === 1 ? "" : "s"})
        </div>
      )}
    </div>
  );
}

export function StatTile({ label, value, sub, className }: { label: string; value: string; sub?: string; className?: string }) {
  return (
    <div className={cn("rounded-lg border p-3", className)}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-2xl font-semibold tabular-nums">{value}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}
