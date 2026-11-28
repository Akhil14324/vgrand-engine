"use client";

import { useState } from "react";
import { AlertTriangle, ArrowRight, Heart, ListChecks, MessageCircle, ThumbsUp, TrendingUp, Users, type LucideIcon } from "lucide-react";
import type { GuavaBrandFit, GuavaContentAuditDto } from "@catgpt/types";
import { fmtDate } from "@/components/guava-report";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * The top of a review, readable at a glance: the account's numbers, the brand-fit
 * score, and the few things to keep, fix and do next. Details stay in the tabs.
 */

const FIT_LABEL: Record<GuavaBrandFit, string> = { on_brand: "On brand", partly: "Partly on brand", off_brand: "Off brand" };
const FIT_CLASS: Record<GuavaBrandFit, string> = {
  on_brand: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  partly: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  off_brand: "bg-destructive/15 text-destructive",
};
const FIT_RING: Record<GuavaBrandFit, string> = {
  on_brand: "text-emerald-600 dark:text-emerald-400",
  partly: "text-amber-500",
  off_brand: "text-destructive",
};

export function FitPill({ fit, className }: { fit: GuavaBrandFit; className?: string }) {
  return <span className={cn("shrink-0 rounded-md px-2 py-0.5 text-xs font-medium", FIT_CLASS[fit], className)}>{FIT_LABEL[fit]}</span>;
}

/* --------------------------------- numbers --------------------------------- */

function Stat({ icon: Icon, label, value, hint, tone }: { icon: LucideIcon; label: string; value: string; hint: string; tone: string }) {
  return (
    <Card className="flex flex-col items-start gap-2 p-3 sm:flex-row sm:gap-3 sm:p-4">
      <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-full", tone)}>
        <Icon className="size-4" />
      </span>
      <div className="min-w-0">
        <div className="text-2xl font-semibold leading-tight tabular-nums">{value}</div>
        <div className="text-sm font-medium leading-snug">{label}</div>
        <div className="text-xs text-muted-foreground">{hint}</div>
      </div>
    </Card>
  );
}

export function StatRow({ audit }: { audit: GuavaContentAuditDto }) {
  const p = audit.performance;
  if (!p) return null;
  const fmt = (n: number | null | undefined) => (n === null || n === undefined ? "–" : n.toLocaleString());
  return (
    <section aria-label="Account numbers" className="space-y-1.5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={Users} label="Followers" value={fmt(p.followers)} hint={audit.handle ? `on @${audit.handle}` : "on your account"} tone="bg-primary/15 text-primary" />
        <Stat icon={Heart} label="Likes" value={fmt(p.avgLikes)} hint="average per post" tone="bg-destructive/15 text-destructive" />
        <Stat icon={MessageCircle} label="Comments" value={fmt(p.avgComments)} hint="average per post" tone="bg-amber-500/15 text-amber-700 dark:text-amber-400" />
        <Stat
          icon={TrendingUp}
          label="Engagement rate"
          value={p.engagementRatePct === null || p.engagementRatePct === undefined ? "–" : `${p.engagementRatePct}%`}
          hint="(likes + comments) ÷ followers"
          tone="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
        />
      </div>
      <p className="px-1 text-xs text-muted-foreground">
        From {p.postsReviewed} {audit.split.length ? "posts about this brand" : "latest posts"}, reviewed {fmtDate(audit.createdAt)}. Views and reach are
        not included: Instagram only shares them with an extra insights permission.
      </p>
    </section>
  );
}

/* ---------------------------------- score ---------------------------------- */

function ScoreRing({ score, fit }: { score: number; fit: GuavaBrandFit }) {
  const value = Math.max(0, Math.min(100, Math.round(score)));
  const r = 42;
  const around = 2 * Math.PI * r;
  return (
    <div className="relative size-28 shrink-0" role="img" aria-label={`Brand fit ${value} out of 100`}>
      <svg viewBox="0 0 100 100" className="size-full -rotate-90">
        <circle cx="50" cy="50" r={r} fill="none" strokeWidth="9" className="stroke-muted" />
        <circle cx="50" cy="50" r={r} fill="none" stroke="currentColor" strokeWidth="9" strokeLinecap="round" strokeDasharray={`${(value / 100) * around} ${around}`} className={FIT_RING[fit]} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-semibold leading-none tabular-nums">{value}</span>
        <span className="text-[11px] text-muted-foreground">out of 100</span>
      </div>
    </div>
  );
}

export function ScoreHero({ audit }: { audit: GuavaContentAuditDto }) {
  const r = audit.report!;
  const [more, setMore] = useState(false);
  return (
    <Card className="flex flex-col items-center gap-4 p-4 sm:flex-row sm:items-start sm:p-5">
      <div className="flex flex-col items-center gap-1.5">
        <ScoreRing score={r.brandFit.score} fit={r.brandFit.verdict} />
        <span className="text-xs font-medium">Brand fit</span>
      </div>
      <div className="min-w-0 flex-1 space-y-2 text-center sm:text-left">
        <FitPill fit={r.brandFit.verdict} className="text-sm" />
        <h2 className="text-xl font-semibold leading-snug">{r.headline}</h2>
        <p className={cn("text-sm text-muted-foreground", !more && "line-clamp-2")}>{r.summary}</p>
        {more && r.brandFit.why && <p className="text-sm">{r.brandFit.why}</p>}
        <button type="button" aria-expanded={more} onClick={() => setMore((v) => !v)} className="text-sm font-medium text-primary underline-offset-4 hover:underline">
          {more ? "Show less" : "Why this score?"}
        </button>
        {r.brandBasis === "inferred" && (
          <p className="rounded-lg bg-amber-500/10 p-3 text-left text-xs text-amber-800 dark:text-amber-300">
            Your brand details in Brand Engine are thin, so the brand was read from your content itself. {r.brandBasisNote}
          </p>
        )}
      </div>
    </Card>
  );
}

/* --------------------------------- glance ---------------------------------- */

export interface GlanceItem {
  title: string;
  detail: string;
}

function GlanceCard({ icon: Icon, title, tone, items, onMore }: { icon: LucideIcon; title: string; tone: string; items: GlanceItem[]; onMore: () => void }) {
  return (
    <Card className="flex flex-col gap-3 p-4">
      <h3 className={cn("flex items-center gap-2 text-sm font-semibold", tone)}>
        <Icon className="size-4" /> {title}
      </h3>
      {items.length ? (
        <ol className="flex-1 space-y-2.5">
          {items.slice(0, 3).map((item, i) => (
            <li key={i} className="flex gap-2 text-sm">
              <span className={cn("mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold", tone)}>{i + 1}</span>
              <div className="min-w-0">
                <div className="font-medium leading-snug">{item.title}</div>
                {item.detail && <p className="line-clamp-2 text-xs text-muted-foreground">{item.detail}</p>}
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="flex-1 text-sm text-muted-foreground">Nothing clear yet.</p>
      )}
      {items.length > 0 && (
        <button type="button" onClick={onMore} className="flex items-center gap-1 self-start text-xs font-medium text-primary underline-offset-4 hover:underline">
          See details <ArrowRight className="size-3.5" />
        </button>
      )}
    </Card>
  );
}

const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 } as const;

/** Keep doing, fix, do next: three short lists taken from the full review. */
export function Glance({ audit, onOpen }: { audit: GuavaContentAuditDto; onOpen: (tab: string) => void }) {
  const r = audit.report!;
  const good: GlanceItem[] = r.whatWorks.length ? r.whatWorks : r.ownContent.strengths;
  const bad: GlanceItem[] = r.whatLosesPeople.length ? r.whatLosesPeople : r.ownContent.weaknesses;
  const next: GlanceItem[] = r.improvements.length
    ? [...r.improvements].sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]).map((i) => ({ title: i.title, detail: i.what }))
    : r.doNext.nextVideos.map((v) => ({ title: v.title, detail: v.why }));
  const readTab = r.whatWorks.length || r.whatLosesPeople.length ? "read" : "fit";
  return (
    <div className="grid gap-3 md:grid-cols-3">
      <GlanceCard icon={ThumbsUp} title="What's working" tone="text-emerald-700 dark:text-emerald-400" items={good} onMore={() => onOpen(readTab)} />
      <GlanceCard icon={AlertTriangle} title="What to fix" tone="text-destructive" items={bad} onMore={() => onOpen(readTab)} />
      <GlanceCard icon={ListChecks} title="Do this next" tone="text-primary" items={next} onMore={() => onOpen(r.improvements.length ? "improve" : readTab)} />
    </div>
  );
}
