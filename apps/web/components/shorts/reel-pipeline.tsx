"use client";

import { CheckCircle2, Circle, Loader2, MinusCircle, XCircle } from "lucide-react";
import { reelPipelineSteps, type ReelCostEstimate, type ReelDetailDto } from "@catgpt/types";
import { cn } from "@/lib/utils";

/** Step-by-step progress of a reel render: script, voiceover, stock, AI images, subtitles, editing, final render. */
export function ReelPipelineSteps({ reel }: { reel: ReelDetailDto }) {
  const steps = reelPipelineSteps(reel);
  return (
    <ol className="space-y-1.5" aria-label="Generation progress">
      {steps.map((s) => (
        <li key={s.key} className="rounded-md border bg-background/60 px-2.5 py-1.5">
          <div className="flex items-center gap-2 text-xs">
            {s.state === "done" ? (
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
            ) : s.state === "active" ? (
              <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
            ) : s.state === "failed" ? (
              <XCircle className="h-4 w-4 shrink-0 text-destructive" />
            ) : s.state === "skipped" ? (
              <MinusCircle className="h-4 w-4 shrink-0 text-muted-foreground" />
            ) : (
              <Circle className="h-4 w-4 shrink-0 text-muted-foreground/50" />
            )}
            <span className={cn("font-medium", s.state === "pending" && "text-muted-foreground", s.state === "skipped" && "text-muted-foreground line-through")}>{s.label}</span>
            <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">
              {s.state === "active" ? `${s.pct}%` : s.state === "done" ? "Done" : s.state === "failed" ? "Failed" : s.state === "skipped" ? "Skipped" : ""}
            </span>
          </div>
          {s.state === "active" && (
            <div className="mt-1 h-1 overflow-hidden rounded bg-muted">
              <div className="h-full bg-primary transition-all" style={{ width: `${s.pct}%` }} />
            </div>
          )}
          {s.note && s.state !== "pending" && <p className="mt-0.5 truncate pl-6 text-[11px] text-muted-foreground" title={s.note}>{s.note}</p>}
        </li>
      ))}
    </ol>
  );
}

const usd = (x: number) => (x === 0 ? "$0" : x < 0.01 ? "< $0.01" : `$${x.toFixed(2)}`);

/** Estimated cost of the next render, shown before anything runs. */
export function ReelCostEstimateView({ estimate, title = "Estimated cost" }: { estimate: ReelCostEstimate; title?: string }) {
  const range = estimate.minUsd === estimate.maxUsd ? usd(estimate.maxUsd) : `${usd(estimate.minUsd)} – ${usd(estimate.maxUsd)}`;
  return (
    <details className="rounded-md border bg-muted/30 p-2 text-xs">
      <summary className="flex cursor-pointer items-center justify-between gap-2">
        <span className="text-muted-foreground">{title}</span>
        <span className="font-semibold tabular-nums">{range}</span>
      </summary>
      <ul className="mt-2 space-y-1">
        {estimate.lines.length === 0 && <li className="text-muted-foreground">Nothing paid: everything needed is cached or free.</li>}
        {estimate.lines.map((l) => (
          <li key={l.label} className="flex justify-between gap-2">
            <span>
              {l.label} <span className="text-muted-foreground">· {l.note}</span>
            </span>
            <span className="shrink-0 tabular-nums">{l.minUsd === l.maxUsd ? usd(l.maxUsd) : `${usd(l.minUsd)}–${usd(l.maxUsd)}`}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[11px] text-muted-foreground">Free: {estimate.free.join(", ")}. Approximate list prices in USD; AI images are only made where stock doesn’t fit.</p>
    </details>
  );
}
