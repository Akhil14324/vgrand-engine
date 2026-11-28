"use client";

import Link from "next/link";
import { ArrowLeft, Compass } from "lucide-react";
import type { BrandDto } from "@catgpt/types";
import { RequireAuth } from "@/components/require-auth";
import { GuavaInstagram, ReviewButton } from "@/components/guava-instagram";
import { resolveActiveBrand, useBrandMode } from "@/lib/brand-mode";
import { useBrands } from "@/lib/hooks";
import { useGuavaProfile } from "@/lib/guava-hooks";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

export function GuavaView() {
  return (
    <RequireAuth>
      <GuavaContent />
    </RequireAuth>
  );
}

function GuavaContent() {
  const { data: brands, isLoading } = useBrands();
  const chosen = useBrandMode((s) => s.brandId);
  const setBrandId = useBrandMode((s) => s.setBrandId);
  const brand = resolveActiveBrand(brands, chosen) ?? brands?.[0] ?? null;

  return (
    <div className="app-safe-screen flex flex-col">
      <header className="flex flex-wrap items-center justify-end gap-x-3 gap-y-2 border-b px-3 py-2.5 sm:px-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/" aria-label="Back to studio">
            <ArrowLeft />
          </Link>
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-2xl font-medium tracking-[-0.02em]">Brand Strategist</h1>
          <p className="truncate text-xs text-muted-foreground">Your Instagram reels, checked against your brand</p>
        </div>
        {brands && brands.length > 1 && brand && (
          <Select
            aria-label="Business"
            value={brand.id}
            onChange={(e) => setBrandId(e.target.value)}
            className="h-9 w-auto max-w-[45%] text-sm"
          >
            {brands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        )}
        {brand && <HeaderReview key={brand.id} brand={brand} />}
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-5xl px-3 py-4 sm:px-4 sm:py-6">
          {isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : !brand ? (
            <NoBusiness />
          ) : (
            <Workspace key={brand.id} brand={brand} />
          )}
        </div>
      </main>
    </div>
  );
}

function NoBusiness() {
  return (
    <Card className="mx-auto max-w-md p-6 text-center">
      <Compass className="mx-auto h-8 w-8 text-primary" />
      <h2 className="mt-3 text-lg font-semibold">Start with your business</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Brand Strategist reviews your Instagram reels against your brand. Create your brand first, then come back.
      </p>
      <Button asChild className="mt-4">
        <Link href="/brand">Create your brand</Link>
      </Button>
    </Card>
  );
}

function HeaderReview({ brand }: { brand: BrandDto }) {
  const profile = useGuavaProfile(brand.id);
  if (profile.isLoading) return null;
  return <ReviewButton brand={brand} canEdit={profile.data?.canEdit ?? false} />;
}

/**
 * Brand Strategist shows only the Instagram review: reels watched by Gemini,
 * judged against this brand's Brand Engine data. The older business diagnosis
 * and profile (still used by B Camp and Growth) are kept on the API, not shown here.
 */
function Workspace({ brand }: { brand: BrandDto }) {
  return <GuavaInstagram brand={brand} />;
}
