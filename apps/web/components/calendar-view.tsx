"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ChevronLeft, ChevronRight, Loader2, RotateCw, Send, X } from "lucide-react";
import type { SocialCalendarItemDto, SocialPlatform, SocialPostStatus } from "@catgpt/types";
import { useAuth } from "@/lib/auth";
import { useSocialCalendar, useSocialPostAction } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const PLATFORM_LABEL: Record<SocialPlatform, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  x: "X",
  youtube: "YouTube",
};

const STATUS_LABEL: Record<SocialPostStatus, string> = {
  scheduled: "Scheduled",
  pending: "Queued",
  posting: "Posting",
  posted: "Posted",
  failed: "Failed",
};

const STATUS_CLASS: Record<SocialPostStatus, string> = {
  scheduled: "bg-primary/15 text-primary",
  pending: "bg-muted text-muted-foreground",
  posting: "bg-muted text-muted-foreground",
  posted: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  failed: "bg-destructive/15 text-destructive",
};

const whenOf = (i: SocialCalendarItemDto) => new Date(i.scheduledFor ?? i.postedAt ?? i.createdAt);
const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
const time = (d: Date) => d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

function toLocalInput(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function CalendarView() {
  const router = useRouter();
  const { user, loading } = useAuth();
  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);
  if (loading) {
    return (
      <div className="flex h-dvh items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!user) return null;
  return <CalendarContent />;
}

function PostCard({ item }: { item: SocialCalendarItemDto }) {
  const { reschedule, cancel, postNow, retry } = useSocialPostAction();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(() => toLocalInput(whenOf(item)));
  const busy = reschedule.isPending || cancel.isPending || postNow.isPending || retry.isPending;
  const error = [reschedule, cancel, postNow, retry].find((m) => m.isError)?.error?.message;
  const nextTime = new Date(value);
  const valid = !Number.isNaN(nextTime.getTime()) && nextTime.getTime() > Date.now() + 60_000;

  return (
    <div className="rounded-lg border border-border p-2.5 text-sm">
      <div className="flex gap-2.5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={item.mediaUrl} alt="" className="size-14 shrink-0 rounded-md object-cover" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium">{PLATFORM_LABEL[item.platform]}</span>
            <span className={cn("rounded-full px-2 py-0.5 text-[11px]", STATUS_CLASS[item.status])}>
              {STATUS_LABEL[item.status]}
            </span>
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {item.accountHandle ?? item.accountDisplayName} · {whenOf(item).toLocaleString(undefined, {
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}
          </div>
          {item.captionPreview && <p className="mt-1 line-clamp-2 text-xs">{item.captionPreview}</p>}
          {item.status === "failed" && item.error && (
            <p className="mt-1 text-xs text-destructive">{item.error}</p>
          )}
        </div>
      </div>

      {item.status === "scheduled" && (
        <div className="mt-2 space-y-2">
          {editing && (
            <div className="flex gap-1.5">
              <Input type="datetime-local" value={value} onChange={(e) => setValue(e.target.value)} />
              <Button
                size="sm"
                disabled={!valid || busy}
                onClick={() =>
                  reschedule.mutate(
                    { id: item.id, scheduledFor: nextTime.toISOString() },
                    { onSuccess: () => setEditing(false) },
                  )
                }
              >
                Save
              </Button>
            </div>
          )}
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" variant="outline" disabled={busy} onClick={() => postNow.mutate(item.id)}>
              <Send /> Post now
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => setEditing((v) => !v)}>
              Reschedule
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-muted-foreground hover:text-destructive"
              disabled={busy}
              onClick={() => {
                if (window.confirm("Cancel this scheduled post?")) cancel.mutate(item.id);
              }}
            >
              <X /> Cancel
            </Button>
          </div>
        </div>
      )}
      {item.status === "failed" && item.retryable && (
        <Button size="sm" variant="outline" className="mt-2" disabled={busy} onClick={() => retry.mutate(item.id)}>
          <RotateCw /> Retry
        </Button>
      )}
      {item.status === "posted" && item.remoteUrl && (
        <a
          href={item.remoteUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-block text-xs text-primary hover:underline"
        >
          View post
        </a>
      )}
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}

function CalendarContent() {
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [mode, setMode] = useState<"month" | "list">("month");
  const [selectedDay, setSelectedDay] = useState<string | null>(() => dayKey(new Date()));

  // Monday-first grid covering the whole month.
  const gridStart = useMemo(() => {
    const d = new Date(cursor);
    d.setDate(1 - ((d.getDay() + 6) % 7));
    return d;
  }, [cursor]);
  const gridEnd = useMemo(() => {
    const d = new Date(gridStart);
    d.setDate(d.getDate() + 42);
    return d;
  }, [gridStart]);

  const { data: items, isLoading } = useSocialCalendar(gridStart, gridEnd);
  const byDay = useMemo(() => {
    const map = new Map<string, SocialCalendarItemDto[]>();
    for (const item of items ?? []) {
      const k = dayKey(whenOf(item));
      map.set(k, [...(map.get(k) ?? []), item]);
    }
    return map;
  }, [items]);

  const days = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart);
    d.setDate(d.getDate() + i);
    return d;
  });
  const todayKey = dayKey(new Date());
  const monthLabel = cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const shift = (n: number) => setCursor((c) => new Date(c.getFullYear(), c.getMonth() + n, 1));
  const dayItems = selectedDay ? (byDay.get(selectedDay) ?? []) : [];

  return (
    <div className="mx-auto flex min-h-dvh max-w-5xl flex-col gap-4 px-4 py-5">
      <header className="flex flex-wrap items-center gap-3">
        <Button asChild variant="ghost" size="icon" aria-label="Back to studio">
          <Link href="/">
            <ArrowLeft />
          </Link>
        </Button>
        <h1 className="text-lg font-semibold">Social Calendar</h1>
        <div className="ml-auto flex items-center gap-1">
          {(["month", "list"] as const).map((m) => (
            <Button key={m} size="sm" variant={mode === m ? "default" : "outline"} onClick={() => setMode(m)}>
              {m === "month" ? "Month" : "List"}
            </Button>
          ))}
        </div>
      </header>

      <div className="flex items-center gap-2">
        <Button variant="outline" size="icon" aria-label="Previous month" onClick={() => shift(-1)}>
          <ChevronLeft />
        </Button>
        <div className="min-w-40 text-center text-sm font-medium">{monthLabel}</div>
        <Button variant="outline" size="icon" aria-label="Next month" onClick={() => shift(1)}>
          <ChevronRight />
        </Button>
        {isLoading && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
      </div>

      {mode === "month" ? (
        <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
          <div>
            <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-muted-foreground">
              {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
                <div key={d}>{d}</div>
              ))}
            </div>
            <div className="mt-1 grid grid-cols-7 gap-1">
              {days.map((d) => {
                const k = dayKey(d);
                const list = byDay.get(k) ?? [];
                const inMonth = d.getMonth() === cursor.getMonth();
                return (
                  <button
                    key={k}
                    onClick={() => setSelectedDay(k)}
                    className={cn(
                      "flex min-h-16 flex-col items-start gap-0.5 rounded-md border p-1 text-left text-xs transition-colors hover:bg-accent",
                      inMonth ? "border-border" : "border-transparent text-muted-foreground/60",
                      k === selectedDay && "ring-2 ring-primary",
                      k === todayKey && "bg-primary/5",
                    )}
                  >
                    <span className="font-medium">{d.getDate()}</span>
                    {list.slice(0, 2).map((i) => (
                      <span
                        key={i.id}
                        className={cn("w-full truncate rounded px-1 text-[10px]", STATUS_CLASS[i.status])}
                      >
                        {PLATFORM_LABEL[i.platform]}
                      </span>
                    ))}
                    {list.length > 2 && <span className="text-[10px]">+{list.length - 2} more</span>}
                  </button>
                );
              })}
            </div>
          </div>
          <aside className="space-y-2">
            <h2 className="text-sm font-medium">
              {selectedDay ? "Posts this day" : "Select a day"}
            </h2>
            {dayItems.length === 0 && <p className="text-xs text-muted-foreground">Nothing here.</p>}
            {dayItems.map((i) => (
              <PostCard key={i.id} item={i} />
            ))}
          </aside>
        </div>
      ) : (
        <div className="space-y-2">
          {(items ?? [])
            .filter((i) => whenOf(i) >= cursor && whenOf(i) < new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))
            .map((i) => (
              <div key={i.id} className="flex gap-3">
                <div className="w-20 shrink-0 pt-2.5 text-xs text-muted-foreground">
                  {whenOf(i).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                  <br />
                  {time(whenOf(i))}
                </div>
                <div className="flex-1">
                  <PostCard item={i} />
                </div>
              </div>
            ))}
          {!isLoading && (items ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">
              No posts yet. Generate an image, choose Share, then Schedule.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
