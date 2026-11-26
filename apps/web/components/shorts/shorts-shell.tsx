"use client";

import Link from "next/link";
import { AlertTriangle, ArrowLeft, BarChart3, Clapperboard, Film, Hand, ListVideo, Wallet } from "lucide-react";
import { RequireAuth } from "@/components/require-auth";
import { Button } from "@/components/ui/button";
import { useShortsHealth } from "@/lib/shorts-hooks";
import { cn } from "@/lib/utils";

const TABS = [
  { key: "reels", href: "/shorts/reels", label: "Reel Studio", icon: Film },
  { key: "channels", href: "/shorts", label: "Channels", icon: Clapperboard },
  { key: "pipeline", href: "/shorts/pipeline", label: "Pipeline", icon: ListVideo },
  { key: "manual", href: "/shorts/manual", label: "Manual queue", icon: Hand },
  { key: "analytics", href: "/shorts/analytics", label: "Analytics", icon: BarChart3 },
  { key: "costs", href: "/shorts/costs", label: "Costs", icon: Wallet },
] as const;

export type ShortsTab = (typeof TABS)[number]["key"];

/** Frame shared by every Shorts Factory page: header, tab links, config banner. */
export function ShortsShell({ current, children }: { current: ShortsTab; children: React.ReactNode }) {
  return (
    <RequireAuth>
      <div className="app-safe-screen flex flex-col">
        <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-3 py-2.5 sm:px-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/" aria-label="Back to studio">
              <ArrowLeft />
            </Link>
          </Button>
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-lg font-semibold leading-tight tracking-tight">Shorts Factory</h1>
            <p className="truncate text-xs text-muted-foreground">AI reels for your brands and any topic, plus the 10-channel Shorts experiment</p>
          </div>
          <nav className="flex max-w-full overflow-x-auto rounded-md border p-0.5" aria-label="Shorts Factory">
            {TABS.map((t) => (
              <Link
                key={t.key}
                href={t.href}
                className={cn(
                  "flex items-center gap-1.5 whitespace-nowrap rounded px-2.5 py-1 text-sm",
                  current === t.key ? "bg-primary/15 font-medium text-primary" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <t.icon className="h-3.5 w-3.5" />
                {t.label}
              </Link>
            ))}
          </nav>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-6xl space-y-4 px-3 py-4 sm:px-4 sm:py-6">
            {/* Reel Studio shows its own setup notice; the channel banner (YouTube, Path C) doesn't apply there. */}
            {current !== "reels" && <HealthBanner />}
            {children}
          </div>
        </main>
      </div>
    </RequireAuth>
  );
}

/** Says exactly which variables or tools are missing, as the startup check does. */
function HealthBanner() {
  const { data } = useShortsHealth();
  if (!data || (data.ok && data.warnings.length === 0)) return null;
  return (
    <div
      className={cn(
        "rounded-lg border p-3 text-sm",
        data.ok ? "border-border bg-muted/40" : "border-amber-500/50 bg-amber-500/10",
      )}
    >
      {!data.ok && (
        <div className="mb-1 flex items-center gap-2 font-medium">
          <AlertTriangle className="h-4 w-4 text-amber-500" />
          Setup incomplete. Features that need these will refuse with this reason.
        </div>
      )}
      <ul className="space-y-0.5">
        {data.missingRequired.map((m) => (
          <li key={m}>
            <span className="font-mono text-xs">MISSING</span> {m}
          </li>
        ))}
        {data.invalid.map((m) => (
          <li key={m}>
            <span className="font-mono text-xs">INVALID</span> {m}
          </li>
        ))}
        {data.warnings.map((m) => (
          <li key={m} className="text-muted-foreground">
            <span className="font-mono text-xs">NOTE</span> {m}
          </li>
        ))}
      </ul>
    </div>
  );
}

export const fmtWhen = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })
    : "-";

export const fmtNum = (n: number | null | undefined, digits = 0) =>
  n === null || n === undefined || Number.isNaN(n) ? "-" : n.toLocaleString(undefined, { maximumFractionDigits: digits });
