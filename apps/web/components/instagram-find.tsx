"use client";

import { useState } from "react";
import { BadgeCheck, ExternalLink, Loader2, Plus, Search } from "lucide-react";
import type { GuavaFindKind, GuavaFindResultDto } from "@catgpt/types";
import { useFindInstagramAccounts } from "@/lib/guava-hooks";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toaster";

const fmt = (n: number | null) => (n === null ? "–" : n.toLocaleString());

/**
 * "I search Instagram" + "I find creators": describe what you're looking for,
 * get real accounts back with their numbers, add a rival in one click.
 */
export function InstagramFind({
  workspaceId,
  canEdit,
  onAddRival,
  rivalsFull,
}: {
  workspaceId: string | null;
  canEdit: boolean;
  onAddRival: (handle: string) => void;
  rivalsFull: boolean;
}) {
  const [kind, setKind] = useState<GuavaFindKind>("rivals");
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<GuavaFindResultDto | null>(null);
  const find = useFindInstagramAccounts();

  const run = () =>
    find.mutate(
      { workspaceId, kind, query },
      { onSuccess: setResult, onError: (e) => toast.error(e.message) },
    );

  return (
    <Card className="space-y-4 p-4 sm:p-6">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Search className="h-5 w-5 text-primary" /> Search Instagram
      </div>
      <div className="flex gap-1 rounded-lg bg-muted p-1 text-sm" role="tablist">
        {(
          [
            ["rivals", "Find rivals"],
            ["creators", "Find creators"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            role="tab"
            aria-selected={kind === k}
            onClick={() => setKind(k)}
            className={cn("flex-1 rounded-md px-3 py-1.5", kind === k ? "bg-background font-medium shadow-sm" : "text-muted-foreground")}
          >
            {label}
          </button>
        ))}
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (query.trim().length >= 3) run();
        }}
      >
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={kind === "rivals" ? "e.g. construction companies in Ongole" : "e.g. home and interior creators in Andhra Pradesh"}
          maxLength={300}
        />
        <Button type="submit" disabled={find.isPending || query.trim().length < 3}>
          {find.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Search
        </Button>
      </form>
      <p className="text-xs text-muted-foreground">
        Searches the web for matching accounts, then checks each one on Instagram. Only public Business or Creator accounts can be checked. Takes
        about a minute.
      </p>

      {result && (
        <div className="space-y-2">
          {result.accounts.length === 0 && <p className="text-sm text-muted-foreground">No accounts found. Try naming the place or the niche.</p>}
          {result.accounts.map((a) => (
            <div key={a.handle} className={cn("rounded-lg border p-3 text-sm", !a.verified && "opacity-70")}>
              <div className="flex flex-wrap items-center gap-2">
                <a href={`https://www.instagram.com/${a.handle}/`} target="_blank" rel="noreferrer" className="font-semibold underline">
                  @{a.handle}
                </a>
                {a.verified && <BadgeCheck className="h-4 w-4 text-emerald-600" aria-label="Checked on Instagram" />}
                {a.name && <span className="text-muted-foreground">{a.name}</span>}
                <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                {result.kind === "rivals" && a.verified && canEdit && (
                  <Button size="sm" variant="outline" className="ml-auto" disabled={rivalsFull} onClick={() => onAddRival(a.handle)}>
                    <Plus className="h-4 w-4" /> {rivalsFull ? "Rivals full" : "Add as rival"}
                  </Button>
                )}
              </div>
              {a.why && <p className="mt-1">{a.why}</p>}
              {a.verified ? (
                <p className="mt-1 text-xs tabular-nums text-muted-foreground">
                  {fmt(a.followers)} followers · {fmt(a.mediaCount)} posts · typical post {fmt(a.typical)} likes + comments
                  {a.engagementPct !== null ? ` (${a.engagementPct}% of followers)` : ""}
                </p>
              ) : (
                <p className="mt-1 text-xs text-muted-foreground">{a.note}</p>
              )}
              {a.biography && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{a.biography}</p>}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
