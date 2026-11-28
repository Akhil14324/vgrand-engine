"use client";

import { useEffect, useState } from "react";
import { ChevronDown, Search, X } from "lucide-react";
import type { IgSearchQuery, IgWordCount } from "@catgpt/types";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiRequestError } from "@/lib/api";
import { useIgSearch } from "@/lib/ig-automation-hooks";
import { cn } from "@/lib/utils";

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

const SCOPES: { value: IgSearchQuery["scope"]; label: string }[] = [
  { value: "all", label: "All messages" },
  { value: "ours", label: "With our keywords" },
  { value: "other", label: "Other words only" },
];

/** Who typed what: search by username or word, and see the words used besides our keywords. */
export function CommentSearch({ accountId }: { accountId: string }) {
  const [by, setBy] = useState<IgSearchQuery["by"]>("word");
  const [scope, setScope] = useState<IgSearchQuery["scope"]>("all");
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  const [showWords, setShowWords] = useState(false);
  // Search a moment after typing stops, not on every letter.
  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 300);
    return () => clearTimeout(t);
  }, [text]);
  const search = useIgSearch(accountId, { q, by, scope });
  const data = search.data;
  const showResults = !!q || scope !== "all";

  const look = (nextBy: IgSearchQuery["by"], value: string) => {
    setBy(nextBy);
    setScope("all");
    setText(value);
    setQ(value);
  };

  const chip = (w: IgWordCount, ours: boolean) => (
    <button
      key={w.word}
      type="button"
      onClick={() => look("word", w.word)}
      title={`${w.comments} message(s) from ${w.people} person(s)`}
      className={cn(
        "rounded-full border px-2 py-0.5 text-xs hover:bg-muted",
        ours ? "border-primary text-primary" : "text-foreground",
        by === "word" && q.toLowerCase() === w.word.toLowerCase() && "bg-muted font-semibold",
      )}
    >
      {w.word} <span className="tabular-nums text-muted-foreground">{w.people}</span>
    </button>
  );

  const wordCount = data ? data.keywords.length + data.words.length : 0;

  // Collapsed by default: one row of controls. Words and results open only when asked for.
  return (
    <Card className="space-y-2 p-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          className="w-32"
          value={by}
          onChange={(e) => {
            setBy(e.target.value as IgSearchQuery["by"]);
            setText("");
            setQ("");
          }}
          aria-label="Search by"
        >
          <option value="word">Keyword</option>
          <option value="user">Username</option>
        </Select>
        <div className="relative min-w-[180px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="px-8"
            value={text}
            maxLength={100}
            onChange={(e) => setText(e.target.value)}
            aria-label={by === "user" ? "Username" : "Keyword"}
            placeholder={by === "user" ? "Search a username" : "Search a word"}
          />
          {text && (
            <button type="button" aria-label="Clear search" onClick={() => look(by, "")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground">
              <X className="size-4" />
            </button>
          )}
        </div>
        <Select className="w-44" value={scope} onChange={(e) => setScope(e.target.value as IgSearchQuery["scope"])} aria-label="Which messages">
          {SCOPES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </Select>
        <button type="button" aria-expanded={showWords} onClick={() => setShowWords((v) => !v)} className="flex items-center gap-1 px-1 text-xs font-medium text-muted-foreground hover:text-foreground">
          Words typed <ChevronDown className={cn("size-4 transition-transform", showWords && "rotate-180")} />
        </button>
      </div>

      {search.isError && !data && <p className="px-1 text-xs text-destructive">{search.error instanceof ApiRequestError ? search.error.message : "Could not search"}</p>}

      {showWords &&
        (!data ? (
          <Skeleton className="h-8 w-full" />
        ) : !wordCount ? (
          <p className="px-1 text-xs text-muted-foreground">Nothing received yet.</p>
        ) : (
          <div className="flex max-h-24 flex-wrap items-center gap-1 overflow-y-auto px-1">
            {data.keywords.map((w) => chip(w, true))}
            {data.words.map((w) => chip(w, false))}
            <span className="text-[11px] text-muted-foreground">
              number = people{data.keywords.length ? " · coloured = our keywords" : " · no keywords set on a rule"}
            </span>
          </div>
        ))}

      {showResults && data && (
        <div className="space-y-1 px-1">
          <p className="text-xs font-medium">
            {data.total} message{data.total === 1 ? "" : "s"} from {data.people} {data.people === 1 ? "person" : "people"}
            {data.total > data.results.length && <span className="text-muted-foreground"> · latest {data.results.length} shown</span>}
            {data.truncated && <span className="text-muted-foreground"> · searched the latest {data.scanned.toLocaleString()}</span>}
          </p>
          {data.results.length > 0 && (
            <ul className="max-h-48 divide-y overflow-y-auto border-t">
              {data.results.map((r) => (
                <li key={r.id} className="flex items-baseline gap-2 py-1">
                  {r.fromUsername ? (
                    <button type="button" className="shrink-0 underline" title="Everything this person wrote" onClick={() => look("user", r.fromUsername!)}>
                      @{r.fromUsername}
                    </button>
                  ) : (
                    <span className="shrink-0 text-muted-foreground">no username</span>
                  )}
                  <span className="min-w-0 flex-1 break-words">
                    {r.text || <span className="text-muted-foreground">(no text)</span>}
                    {r.matched.length > 0 && <span className="ml-1.5 text-[11px] text-primary">{r.matched.join(", ")}</span>}
                  </span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {r.kind === "comment" ? "" : "DM · "}
                    {when(r.occurredAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}
