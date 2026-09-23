"use client";

import { useGenerations } from "@/lib/hooks";
import { ScrollArea } from "@/components/ui/scroll-area";
import { GenerationCard } from "./generation-card";

export function GenerationFeed() {
  const { data, isLoading } = useGenerations();
  const items = data?.items ?? [];

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="mx-auto w-full max-w-5xl p-4 md:p-6">
        {isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="aspect-square rounded-xl border shimmer"
              />
            ))}
          </div>
        ) : items.length === 0 ? (
          <EmptyFeed />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((g) => (
              <GenerationCard key={g.id} generation={g} />
            ))}
          </div>
        )}
      </div>
    </ScrollArea>
  );
}

function EmptyFeed() {
  return (
    <div className="flex h-[60vh] flex-col items-center justify-center text-center">
      <div className="font-display text-2xl font-semibold tracking-tight">
        What are we making?
      </div>
      <p className="mt-2 max-w-sm text-sm text-muted-foreground">
        Type <kbd className="rounded border px-1 font-mono text-xs">/</kbd> to
        arm a themed template like <code>/restaurant</code> or{" "}
        <code>/infra</code> — or just describe any image and generate it
        freeform.
      </p>
    </div>
  );
}
