"use client";

import { RequireAuth } from "@/components/require-auth";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Loader2,
  PartyPopper,
  Plus,
  RotateCw,
  Send,
  Sparkles,
  X,
} from "lucide-react";
import type {
  CalendarPlanItemDto,
  HolidayDto,
  SocialCalendarItemDto,
  SocialPlatform,
  SocialPostStatus,
} from "@catgpt/types";
import { useAuth } from "@/lib/auth";
import {
  useCalendarPlan,
  useCalendarPlanActions,
  useHolidays,
  useRegenerateCampaignPost,
  useSocialCalendar,
  useSocialPostAction,
} from "@/lib/hooks";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { minScheduleValue } from "@/components/social-share";
import {
  DayOptions,
  FillDialog,
  ImageThumb,
  ImageViewer,
  LibraryPickerDialog,
  PapayaDialog,
  ShareById,
  scheduleValueFor,
  ymd,
} from "@/components/calendar-dialogs";

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

const PLAN_LABEL = (p: CalendarPlanItemDto) => {
  if (p.status === "scheduled") return p.planStatus === "paused" ? "Proposed" : "Generating soon";
  if (p.status === "generating") return "Generating";
  if (p.status === "ready_for_review") return "Needs approval";
  if (p.status === "approved") return "Approved";
  if (p.status === "failed") return "Failed";
  return p.status;
};

const PLAN_CLASS = (p: CalendarPlanItemDto) =>
  p.status === "failed"
    ? "bg-destructive/10 text-destructive"
    : p.status === "ready_for_review"
      ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
      : "bg-violet-500/10 text-violet-700 dark:text-violet-300";

const dayKey = (d: Date) => ymd(d);
const socialWhen = (i: SocialCalendarItemDto) => new Date(i.scheduledFor ?? i.postedAt ?? i.createdAt);
const timeOf = (d: Date) => d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

function toLocalInput(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function CalendarView() {
  return (
    <RequireAuth>
      <CalendarContent />
    </RequireAuth>
  );
}

/* ------------------------------ entry cards ------------------------------ */

function PostCard({ item }: { item: SocialCalendarItemDto }) {
  const { reschedule, cancel, postNow, retry } = useSocialPostAction();
  const [editing, setEditing] = useState(false);
  const [viewing, setViewing] = useState(false);
  const [value, setValue] = useState(() => toLocalInput(socialWhen(item)));
  const busy = reschedule.isPending || cancel.isPending || postNow.isPending || retry.isPending;
  const error = [reschedule, cancel, postNow, retry].find((m) => m.isError)?.error?.message;
  const nextTime = new Date(value);
  const valid = !Number.isNaN(nextTime.getTime()) && nextTime.getTime() > Date.now() + 60_000;

  return (
    <div className="rounded-xl border border-border bg-card p-3 text-sm shadow-sm">
      <div className="flex gap-3">
        <ImageThumb src={item.mediaUrl} className="size-16" onOpen={() => setViewing(true)} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium">{PLATFORM_LABEL[item.platform]}</span>
            <span className={cn("rounded-full px-2 py-0.5 text-[11px]", STATUS_CLASS[item.status])}>
              {STATUS_LABEL[item.status]}
            </span>
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {item.accountHandle ?? item.accountDisplayName} · {timeOf(socialWhen(item))}
          </div>
          {item.captionPreview && <p className="mt-1 line-clamp-2 text-xs">{item.captionPreview}</p>}
          {item.status === "failed" && item.error && <p className="mt-1 text-xs text-destructive">{item.error}</p>}
        </div>
      </div>

      {item.status === "scheduled" && (
        <div className="mt-2.5 space-y-2">
          {editing && (
            <div className="flex gap-1.5">
              <Input type="datetime-local" min={minScheduleValue()} value={value} onChange={(e) => setValue(e.target.value)} />
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
      <ImageViewer
        open={viewing}
        onClose={() => setViewing(false)}
        imageUrl={item.mediaUrl}
        title={`${PLATFORM_LABEL[item.platform]} · ${socialWhen(item).toLocaleString()}`}
      />
    </div>
  );
}

function PlanCard({ item, onSchedule }: { item: CalendarPlanItemDto; onSchedule: (item: CalendarPlanItemDto) => void }) {
  const { postAction } = useCalendarPlanActions();
  const regenerate = useRegenerateCampaignPost();
  const [viewing, setViewing] = useState(false);
  // Keep showing the previous image while a regeneration is in flight.
  const lastImage = useRef<string | null>(item.imageUrl);
  if (item.imageUrl) lastImage.current = item.imageUrl;
  const busy = postAction.isPending;
  const canRegenerate = ["ready_for_review", "approved", "failed"].includes(item.status);
  return (
    <div className="rounded-xl border border-dashed border-violet-400/60 bg-violet-500/5 p-3 text-sm">
      <div className="flex gap-3">
        {item.imageUrl ? (
          <ImageThumb src={item.imageUrl} className="size-16" onOpen={() => setViewing(true)} />
        ) : (
          <div className="flex size-16 shrink-0 items-center justify-center rounded-lg bg-violet-500/10 text-violet-500">
            {item.status === "generating" ? <Loader2 className="animate-spin" /> : <Sparkles />}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium">{item.platform ?? "Post"}</span>
            <span className={cn("rounded-full px-2 py-0.5 text-[11px]", PLAN_CLASS(item))}>{PLAN_LABEL(item)}</span>
          </div>
          <div className="text-xs text-muted-foreground">{timeOf(new Date(item.publishAt))}</div>
          <p className="mt-1 line-clamp-3 text-xs">{item.caption ?? item.prompt}</p>
          {item.status === "failed" && item.error && <p className="mt-1 text-xs text-destructive">{item.error}</p>}
        </div>
      </div>
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {item.imageUrl && (
          <Button size="sm" variant="outline" onClick={() => setViewing(true)}>
            View &amp; edit
          </Button>
        )}
        {item.status === "ready_for_review" && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => postAction.mutate({ postId: item.id, action: "approve" })}
          >
            Approve
          </Button>
        )}
        {(item.status === "ready_for_review" || item.status === "approved") && item.generationId && (
          <Button size="sm" onClick={() => onSchedule(item)}>
            <CalendarClock /> {item.status === "approved" ? "Schedule" : "Approve & schedule"}
          </Button>
        )}
        {item.status === "failed" && (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => postAction.mutate({ postId: item.id, action: "retry" })}>
            <RotateCw /> Retry
          </Button>
        )}
        {["scheduled", "ready_for_review", "failed"].includes(item.status) && (
          <Button
            size="sm"
            variant="ghost"
            className="text-muted-foreground hover:text-destructive"
            disabled={busy}
            onClick={() => postAction.mutate({ postId: item.id, action: "cancel" })}
          >
            <X /> Remove
          </Button>
        )}
      </div>
      {postAction.isError && <p className="mt-1 text-xs text-destructive">{postAction.error.message}</p>}
      <ImageViewer
        open={viewing}
        onClose={() => setViewing(false)}
        imageUrl={item.imageUrl ?? lastImage.current}
        title={`${item.platform ?? "Post"} · ${new Date(item.publishAt).toLocaleString()}`}
        caption={item.caption}
        busy={regenerate.isPending || item.status === "generating"}
        error={regenerate.isError ? regenerate.error.message : item.status === "failed" ? item.error : null}
        onRegenerate={
          canRegenerate || item.status === "generating"
            ? (comment) => regenerate.mutateAsync({ postId: item.id, comment })
            : undefined
        }
      />
    </div>
  );
}

/* --------------------------------- page ---------------------------------- */

function CalendarContent() {
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [mode, setMode] = useState<"month" | "list">("month");
  const [selectedDay, setSelectedDay] = useState<Date>(() => startOfDay(new Date()));
  const [papaya, setPapaya] = useState(false);
  const [library, setLibrary] = useState(false);
  const [fill, setFill] = useState(false);
  const [share, setShare] = useState<{ generationId: string; when: string; approvePostId?: string } | null>(null);
  const { generateAll, postAction } = useCalendarPlanActions();

  // Monday-first grid covering the whole month (6 weeks keeps the height stable).
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

  const { data: socialItems, isLoading } = useSocialCalendar(gridStart, gridEnd);
  const { data: planItems } = useCalendarPlan(gridStart, gridEnd);
  const { data: holidays } = useHolidays(gridStart, gridEnd);

  const scheduledGenerations = useMemo(
    () => new Set((socialItems ?? []).filter((s) => s.status !== "failed").map((s) => s.generationId)),
    [socialItems],
  );
  // A plan item that already has a scheduled/posted SocialPost is shown via that post instead.
  const visiblePlan = useMemo(
    () => (planItems ?? []).filter((p) => !(p.generationId && scheduledGenerations.has(p.generationId))),
    [planItems, scheduledGenerations],
  );

  const byDay = useMemo(() => {
    const map = new Map<string, { social: SocialCalendarItemDto[]; plan: CalendarPlanItemDto[]; holidays: HolidayDto[] }>();
    const slot = (k: string) => {
      if (!map.has(k)) map.set(k, { social: [], plan: [], holidays: [] });
      return map.get(k)!;
    };
    for (const i of socialItems ?? []) slot(dayKey(socialWhen(i))).social.push(i);
    for (const p of visiblePlan) slot(dayKey(new Date(p.publishAt))).plan.push(p);
    for (const h of holidays ?? []) slot(h.date).holidays.push(h);
    return map;
  }, [socialItems, visiblePlan, holidays]);

  const days = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart);
    d.setDate(d.getDate() + i);
    return d;
  });
  const today = startOfDay(new Date());
  const monthLabel = cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const shift = (n: number) => setCursor((c) => new Date(c.getFullYear(), c.getMonth() + n, 1));
  const selected = byDay.get(dayKey(selectedDay));
  const isPast = selectedDay < today;

  const proposedByPlan = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of planItems ?? []) {
      if (p.planStatus === "paused" && p.status === "scheduled") m.set(p.planId, (m.get(p.planId) ?? 0) + 1);
    }
    return [...m.entries()];
  }, [planItems]);

  const openPlanShare = (p: CalendarPlanItemDto) =>
    setShare({
      generationId: p.generationId!,
      when: scheduleValueFor(startOfDay(new Date(p.publishAt)), new Date(p.publishAt).getHours(), new Date(p.publishAt).getMinutes()),
      approvePostId: p.status === "ready_for_review" ? p.id : undefined,
    });

  const dayPanel = (
    <aside className="space-y-4 lg:sticky lg:top-5 lg:self-start">
      <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">
          {dayKey(selectedDay) === dayKey(today) ? "Today" : selectedDay.toLocaleDateString(undefined, { weekday: "long" })}
        </div>
        <h2 className="text-xl font-semibold">
          {selectedDay.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}
        </h2>
        {selected?.holidays.map((h) => (
          <div
            key={h.id}
            className="mt-2 flex items-center gap-2 rounded-lg bg-amber-500/10 px-2.5 py-1.5 text-sm text-amber-800 dark:text-amber-300"
          >
            <PartyPopper className="size-4 shrink-0" />
            <span className="min-w-0 flex-1 truncate">{h.name}</span>
            {h.region && <span className="text-[11px] opacity-70">{h.region}</span>}
          </div>
        ))}
      </div>

      {isPast ? (
        <p className="px-1 text-xs text-muted-foreground">This day has passed - you can&apos;t add new posts to it.</p>
      ) : (
        <div className="space-y-2">
          <h3 className="flex items-center gap-1.5 px-1 text-sm font-medium">
            <Plus className="size-4" /> Post something on this day
          </h3>
          <DayOptions onPapaya={() => setPapaya(true)} onLibrary={() => setLibrary(true)} />
        </div>
      )}

      {((selected?.social.length ?? 0) > 0 || (selected?.plan.length ?? 0) > 0) && (
        <div className="space-y-2">
          <h3 className="px-1 text-sm font-medium">On this day</h3>
          {selected!.plan.map((p) => (
            <PlanCard key={p.id} item={p} onSchedule={openPlanShare} />
          ))}
          {selected!.social.map((i) => (
            <PostCard key={i.id} item={i} />
          ))}
        </div>
      )}
    </aside>
  );

  return (
    <div className="mx-auto flex min-h-dvh max-w-[1440px] flex-col gap-5 px-4 py-6 lg:px-8">
      <header className="flex flex-wrap items-center gap-3">
        <Button asChild variant="ghost" size="icon" aria-label="Back to studio">
          <Link href="/">
            <ArrowLeft />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Social Calendar</h1>
          <p className="text-sm text-muted-foreground">Plan, generate, approve and schedule every post in one place.</p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-border p-0.5">
            {(["month", "list"] as const).map((m) => (
              <Button key={m} size="sm" variant={mode === m ? "default" : "ghost"} onClick={() => setMode(m)}>
                {m === "month" ? "Month" : "List"}
              </Button>
            ))}
          </div>
          <Button onClick={() => setFill(true)}>
            <Sparkles /> AI Fill Calendar
          </Button>
        </div>
      </header>

      {proposedByPlan.map(([planId, n]) => (
        <div
          key={planId}
          className="flex flex-wrap items-center gap-3 rounded-xl border border-violet-400/50 bg-violet-500/5 px-4 py-3 text-sm"
        >
          <Sparkles className="size-4 text-violet-500" />
          <span className="flex-1">
            <strong>{n} proposed post{n === 1 ? "" : "s"}</strong> are waiting on your calendar. Generate the images, then approve
            and schedule each one.
          </span>
          <Button size="sm" disabled={generateAll.isPending} onClick={() => generateAll.mutate(planId)}>
            {generateAll.isPending && <Loader2 className="animate-spin" />} Generate all
          </Button>
        </div>
      ))}
      {generateAll.isError && <p className="text-xs text-destructive">{generateAll.error.message}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="icon" aria-label="Previous month" onClick={() => shift(-1)}>
          <ChevronLeft />
        </Button>
        <div className="min-w-44 text-center text-lg font-medium">{monthLabel}</div>
        <Button variant="outline" size="icon" aria-label="Next month" onClick={() => shift(1)}>
          <ChevronRight />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setCursor(new Date(today.getFullYear(), today.getMonth(), 1));
            setSelectedDay(today);
          }}
        >
          Today
        </Button>
        {isLoading && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
        <div className="ml-auto hidden items-center gap-4 text-xs text-muted-foreground md:flex">
          <Legend className="bg-amber-500" label="Holiday" />
          <Legend className="bg-primary" label="Scheduled" />
          <Legend className="bg-violet-500" label="Proposed / awaiting approval" />
          <Legend className="bg-emerald-500" label="Posted" />
          <Legend className="bg-destructive" label="Failed" />
        </div>
      </div>

      {mode === "month" ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
          <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
            <div className="grid grid-cols-7 border-b border-border bg-muted/40 text-center text-xs font-medium text-muted-foreground">
              {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
                <div key={d} className="py-2">
                  {d}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {days.map((d, idx) => {
                const k = dayKey(d);
                const cell = byDay.get(k);
                const inMonth = d.getMonth() === cursor.getMonth();
                const isToday = k === dayKey(today);
                const isSel = k === dayKey(selectedDay);
                const entries = [
                  ...(cell?.plan ?? []).map((p) => ({ key: p.id, kind: "plan" as const, p })),
                  ...(cell?.social ?? []).map((s) => ({ key: s.id, kind: "social" as const, s })),
                ];
                return (
                  <button
                    key={k}
                    onClick={() => {
                      setSelectedDay(startOfDay(d));
                      if (!inMonth) setCursor(new Date(d.getFullYear(), d.getMonth(), 1));
                    }}
                    className={cn(
                      "group flex min-h-[112px] flex-col gap-1 border-b border-r border-border p-1.5 text-left transition-colors hover:bg-accent/60 xl:min-h-[132px]",
                      idx % 7 === 6 && "border-r-0",
                      idx >= 35 && "border-b-0",
                      !inMonth && "bg-muted/20 text-muted-foreground/60",
                      isSel && "bg-primary/5 ring-2 ring-inset ring-primary",
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span
                        className={cn(
                          "flex size-6 items-center justify-center rounded-full text-xs font-medium",
                          isToday && "bg-primary text-primary-foreground",
                        )}
                      >
                        {d.getDate()}
                      </span>
                      {d >= today && (
                        <Plus className="size-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                      )}
                    </div>
                    {cell?.holidays.slice(0, 1).map((h) => (
                      <span
                        key={h.id}
                        className="flex items-center gap-1 truncate rounded bg-amber-500/15 px-1 py-0.5 text-[10.5px] font-medium text-amber-800 dark:text-amber-300"
                      >
                        <PartyPopper className="size-3 shrink-0" />
                        <span className="truncate">{h.name}</span>
                      </span>
                    ))}
                    {entries.slice(0, 2).map((e) =>
                      e.kind === "plan" ? (
                        <span
                          key={e.key}
                          className="flex items-center gap-1 truncate rounded border border-dashed border-violet-400/60 px-1 py-0.5 text-[10.5px] text-violet-700 dark:text-violet-300"
                        >
                          {e.p.imageUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={e.p.imageUrl} alt="" className="size-4 shrink-0 rounded-sm object-cover" />
                          ) : (
                            <Sparkles className="size-3 shrink-0" />
                          )}
                          <span className="truncate">{PLAN_LABEL(e.p)}</span>
                        </span>
                      ) : (
                        <span
                          key={e.key}
                          className={cn(
                            "flex items-center gap-1 truncate rounded px-1 py-0.5 text-[10.5px]",
                            STATUS_CLASS[e.s.status],
                          )}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={e.s.mediaUrl} alt="" className="size-4 shrink-0 rounded-sm object-cover" />
                          <span className="truncate">
                            {timeOf(socialWhen(e.s))} {PLATFORM_LABEL[e.s.platform]}
                          </span>
                        </span>
                      ),
                    )}
                    {entries.length > 2 && (
                      <span className="px-1 text-[10.5px] text-muted-foreground">+{entries.length - 2} more</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
          {dayPanel}
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
          <ListView
            days={days.filter((d) => d.getMonth() === cursor.getMonth())}
            byDay={byDay}
            onSelect={(d) => setSelectedDay(startOfDay(d))}
            onSchedule={openPlanShare}
            loading={isLoading}
          />
          {dayPanel}
        </div>
      )}

      <PapayaDialog
        date={selectedDay}
        open={papaya}
        onClose={() => setPapaya(false)}
        onSchedule={(generationId, approvePostId) =>
          setShare({ generationId, when: scheduleValueFor(selectedDay), approvePostId })
        }
      />
      <LibraryPickerDialog
        date={selectedDay}
        open={library}
        onClose={() => setLibrary(false)}
        onPick={(generationId) => setShare({ generationId, when: scheduleValueFor(selectedDay) })}
      />
      <FillDialog
        open={fill}
        onClose={() => setFill(false)}
        onFilled={(start) => {
          setCursor(new Date(start.getFullYear(), start.getMonth(), 1));
          setSelectedDay(startOfDay(start));
        }}
      />
      {share && (
        <ShareById
          generationId={share.generationId}
          when={share.when}
          onClose={() => setShare(null)}
          onScheduled={() => {
            if (share.approvePostId) postAction.mutate({ postId: share.approvePostId, action: "approve" });
          }}
        />
      )}
    </div>
  );
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("size-2 rounded-full", className)} />
      {label}
    </span>
  );
}

function ListView({
  days,
  byDay,
  onSelect,
  onSchedule,
  loading,
}: {
  days: Date[];
  byDay: Map<string, { social: SocialCalendarItemDto[]; plan: CalendarPlanItemDto[]; holidays: HolidayDto[] }>;
  onSelect: (d: Date) => void;
  onSchedule: (p: CalendarPlanItemDto) => void;
  loading: boolean;
}) {
  const filled = days.filter((d) => {
    const c = byDay.get(dayKey(d));
    return c && (c.social.length || c.plan.length || c.holidays.length);
  });
  return (
    <div className="space-y-4">
      {filled.map((d) => {
        const c = byDay.get(dayKey(d))!;
        return (
          <section key={dayKey(d)} className="flex gap-4">
            <button onClick={() => onSelect(d)} className="w-16 shrink-0 pt-1 text-left">
              <div className="text-2xl font-semibold leading-none">{d.getDate()}</div>
              <div className="text-xs text-muted-foreground">
                {d.toLocaleDateString(undefined, { weekday: "short", month: "short" })}
              </div>
            </button>
            <div className="min-w-0 flex-1 space-y-2">
              {c.holidays.map((h) => (
                <div key={h.id} className="flex items-center gap-2 rounded-lg bg-amber-500/10 px-2.5 py-1.5 text-sm text-amber-800 dark:text-amber-300">
                  <PartyPopper className="size-4" /> {h.name}
                </div>
              ))}
              {c.plan.map((p) => (
                <PlanCard key={p.id} item={p} onSchedule={onSchedule} />
              ))}
              {c.social.map((i) => (
                <PostCard key={i.id} item={i} />
              ))}
            </div>
          </section>
        );
      })}
      {!loading && filled.length === 0 && (
        <p className="text-sm text-muted-foreground">Nothing this month yet. Pick a day, or try AI Fill Calendar.</p>
      )}
    </div>
  );
}
