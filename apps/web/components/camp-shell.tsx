"use client";

import Link from "next/link";
import { ArrowLeft, ListChecks, Target } from "lucide-react";
import type { BrandDto } from "@catgpt/types";
import { RequireAuth } from "@/components/require-auth";
import { useActiveBusiness } from "@/lib/bcamp-hooks";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Shared frame for B Camp and the Execution Center, so they read as one
 * workspace: same business selector, and a one-click hop between the two.
 */
export function CampShell({
  title,
  subtitle,
  current,
  children,
}: {
  title: string;
  subtitle: string;
  current: "bcamp" | "execution";
  children: (brand: BrandDto) => React.ReactNode;
}) {
  return (
    <RequireAuth>
      <ShellInner title={title} subtitle={subtitle} current={current}>
        {children}
      </ShellInner>
    </RequireAuth>
  );
}

function ShellInner({
  title,
  subtitle,
  current,
  children,
}: {
  title: string;
  subtitle: string;
  current: "bcamp" | "execution";
  children: (brand: BrandDto) => React.ReactNode;
}) {
  const { brands, isLoading, brand, setBrandId } = useActiveBusiness();
  const tabs = [
    { key: "bcamp", href: "/bcamp", label: "Strategy", icon: Target },
    { key: "execution", href: "/execution", label: "Execution", icon: ListChecks },
  ] as const;

  return (
    <div className="app-safe-screen flex flex-col">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-3 py-2.5 sm:px-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/" aria-label="Back to studio">
            <ArrowLeft />
          </Link>
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-lg font-semibold leading-tight tracking-tight">{title}</h1>
          <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
        </div>
        <nav className="flex rounded-md border p-0.5" aria-label="Campaign workspace">
          {tabs.map((t) => (
            <Link
              key={t.key}
              href={t.href}
              className={cn(
                "flex items-center gap-1.5 rounded px-2.5 py-1 text-sm",
                current === t.key ? "bg-primary/15 font-medium text-primary" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <t.icon className="h-3.5 w-3.5" />
              {t.label}
            </Link>
          ))}
        </nav>
        {brands && brands.length > 1 && brand && (
          <Select aria-label="Business" value={brand.id} onChange={(e) => setBrandId(e.target.value)} className="h-9 w-auto max-w-[45%] text-sm">
            {brands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        )}
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-5xl px-3 py-4 sm:px-4 sm:py-6">
          {isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : !brand ? (
            <Card className="mx-auto max-w-md p-6 text-center">
              <h2 className="text-lg font-semibold">Start with your business</h2>
              <p className="mt-1 text-sm text-muted-foreground">Campaigns work on one business at a time. Create your brand first.</p>
              <Button asChild className="mt-4">
                <Link href="/brand">Create your brand</Link>
              </Button>
            </Card>
          ) : (
            <div key={brand.id}>{children(brand)}</div>
          )}
        </div>
      </main>
    </div>
  );
}

export const fmtDay = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "No date";

export const fmtDateTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "";

/** A label above content, used for small, dense forms. */
export function Labeled({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium">{label}</span>
      {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
      {children}
    </label>
  );
}
