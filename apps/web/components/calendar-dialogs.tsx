"use client";

import { useEffect, useState } from "react";
import { CalendarDays, Check, ImageIcon, Loader2, RefreshCw, Sparkles, Wand2 } from "lucide-react";
import type { BrandDto } from "@catgpt/types";
import {
  useBrands,
  useCreateDayPost,
  useFillCalendar,
  useGeneration,
  useCalendarPlanActions,
  useGenerations,
  useRegenerateCampaignPost,
} from "@/lib/hooks";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SocialShareDialog } from "@/components/social-share";

const timezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

export const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** datetime-local value for a day: 10:00, or an hour from now when that has passed. */
export function scheduleValueFor(day: Date, hour = 10, minute = 0) {
  const d = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute);
  if (d.getTime() < Date.now() + 5 * 60_000) {
    d.setTime(Date.now() + 60 * 60_000);
    d.setMinutes(0, 0, 0);
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const shortDay = (d: Date) => d.toLocaleDateString(undefined, { month: "short", day: "numeric" });

const longDay = (d: Date) =>
  d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

function BrandSelect({
  brands,
  value,
  onChange,
}: {
  brands: BrandDto[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm"
    >
      {brands.map((b) => (
        <option key={b.id} value={b.id}>
          {b.name}
        </option>
      ))}
    </select>
  );
}

function useDefaultBrand() {
  const { data: brands, isLoading } = useBrands();
  const [brandId, setBrandId] = useState("");
  useEffect(() => {
    if (!brandId && brands?.length) setBrandId(brands[0]!.id);
  }, [brands, brandId]);
  return { brands: brands ?? [], isLoading, brandId, setBrandId };
}

/** Opens the publishing dialog for a generation id once it has loaded. */
export function ShareById({
  generationId,
  when,
  onClose,
  onScheduled,
}: {
  generationId: string;
  when: string;
  onClose: () => void;
  onScheduled?: () => void;
}) {
  const { data: generation } = useGeneration(generationId);
  if (!generation) return null;
  return (
    <SocialShareDialog
      generation={generation}
      open
      onOpenChange={(o) => !o && onClose()}
      initialWhen={when}
      onScheduled={() => {
        onScheduled?.();
        onClose();
      }}
    />
  );
}

/* ------------------------------ image viewer ------------------------------ */

/** Thumbnail that opens the full-size viewer. */
export function ImageThumb({
  src,
  className,
  onOpen,
}: {
  src: string;
  className?: string;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onOpen();
      }}
      aria-label="View full image"
      className={cn("group relative shrink-0 overflow-hidden rounded-lg", className)}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" className="size-full object-cover transition group-hover:scale-105" />
      <span className="absolute inset-0 flex items-center justify-center bg-black/0 text-[10px] font-medium text-white opacity-0 transition group-hover:bg-black/40 group-hover:opacity-100">
        View
      </span>
    </button>
  );
}

/**
 * Full-size image viewer. With onRegenerate it also shows a feedback box: the
 * comment is sent and the image is redone from it. busy covers both our own
 * pending request and the post being regenerated server-side.
 */
export function ImageViewer({
  open,
  onClose,
  imageUrl,
  title,
  caption,
  busy,
  error,
  onRegenerate,
}: {
  open: boolean;
  onClose: () => void;
  imageUrl: string | null;
  title?: string;
  caption?: string | null;
  busy?: boolean;
  error?: string | null;
  onRegenerate?: (comment: string) => Promise<unknown> | void;
}) {
  const [comment, setComment] = useState("");
  useEffect(() => {
    if (!open) setComment("");
  }, [open]);
  const submit = async () => {
    const text = comment.trim();
    if (!text || busy || !onRegenerate) return;
    try {
      await onRegenerate(text);
      setComment("");
    } catch {
      // the caller surfaces the error; keep the comment so it can be retried
    }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[94dvh] max-w-5xl overflow-y-auto p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle>{title ?? "Preview"}</DialogTitle>
          <DialogDescription className="sr-only">Full-size preview of the generated image.</DialogDescription>
        </DialogHeader>
        <div className={cn("grid gap-5", onRegenerate && "lg:grid-cols-[minmax(0,1fr)_320px]")}>
          <div className="relative flex items-center justify-center rounded-xl bg-muted/40">
            {imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={imageUrl}
                alt=""
                className={cn("max-h-[72dvh] w-full rounded-xl object-contain transition", busy && "opacity-40")}
              />
            ) : (
              <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">No image yet</div>
            )}
            {busy && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm font-medium">
                <Loader2 className="size-7 animate-spin text-primary" />
                Regenerating with your comment…
              </div>
            )}
          </div>
          {onRegenerate && (
            <div className="space-y-3">
              {caption && (
                <div>
                  <div className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">Caption</div>
                  <p className="text-sm">{caption}</p>
                </div>
              )}
              <div className="space-y-1.5">
                <label htmlFor="regen-comment" className="text-sm font-medium">
                  Not quite right? Tell Papaya what to change
                </label>
                <Textarea
                  id="regen-comment"
                  value={comment}
                  maxLength={1000}
                  disabled={busy}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="e.g. make the background warmer, add the offer text, remove the second bottle"
                  className="min-h-[110px]"
                />
                <Button className="w-full" disabled={!comment.trim() || busy} onClick={() => void submit()}>
                  {busy ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                  Regenerate with comment
                </Button>
                <p className="text-[11px] text-muted-foreground">Uses one image from your daily limit.</p>
                {error && <p className="text-xs text-destructive">{error}</p>}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* --------------------------------- Papaya ---------------------------------- */

/** "Papaya": the AI picks an idea for the day (using brand + any relevant holiday) and makes the image. */
export function PapayaDialog({
  date,
  open,
  onClose,
  onSchedule,
}: {
  date: Date;
  open: boolean;
  onClose: () => void;
  onSchedule: (generationId: string, postId?: string) => void;
}) {
  const { brands, isLoading, brandId, setBrandId } = useDefaultBrand();
  const [notes, setNotes] = useState("");
  const create = useCreateDayPost();
  const regen = useRegenerateCampaignPost();
  const { postAction } = useCalendarPlanActions();
  const [regenId, setRegenId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState("");
  const generationId = regenId ?? create.data?.generationId ?? null;
  const { data: generation } = useGeneration(generationId);
  const done = generation?.status === "completed" && generation.imageUrls.length > 0;
  const failed = generation?.status === "failed" || generation?.status === "cancelled";

  useEffect(() => {
    if (!open) {
      create.reset();
      regen.reset();
      setRegenId(null);
      setFeedback("");
      setNotes("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" /> Papaya for {longDay(date)}
          </DialogTitle>
          <DialogDescription>
            Papaya studies your brand and any relevant festival or special day, comes up with the idea and
            creates the image.
          </DialogDescription>
        </DialogHeader>

        {!generationId && (
          <div className="space-y-3">
            {isLoading ? (
              <Loader2 className="animate-spin text-muted-foreground" />
            ) : brands.length === 0 ? (
              <p className="text-sm text-muted-foreground">Create a brand first so Papaya knows your style.</p>
            ) : (
              <>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Brand</label>
                  <BrandSelect brands={brands} value={brandId} onChange={setBrandId} />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Anything Papaya should know? (optional)</label>
                  <Input
                    value={notes}
                    maxLength={800}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="e.g. promote the new menu"
                  />
                </div>
                <Button
                  className="w-full"
                  disabled={!brandId || create.isPending}
                  onClick={() =>
                    create.mutate({
                      brandId,
                      date: ymd(date),
                      timezone: timezone(),
                      instructions: notes.trim() || undefined,
                    })
                  }
                >
                  {create.isPending ? <Loader2 className="animate-spin" /> : <Wand2 />}
                  {create.isPending ? "Thinking of an idea…" : "Create with Papaya"}
                </Button>
              </>
            )}
            {create.isError && <p className="text-xs text-destructive">{create.error.message}</p>}
          </div>
        )}

        {generationId && !done && !failed && (
          <div className="flex flex-col items-center gap-3 py-8 text-sm text-muted-foreground">
            <Loader2 className="size-6 animate-spin text-primary" />
            Papaya is designing your post…
            <span className="text-xs">
              You can close this - it will be waiting on {longDay(date)} in your calendar.
            </span>
          </div>
        )}
        {failed && (
          <div className="space-y-2">
            <p className="text-sm text-destructive">{generation?.error ?? "Image generation failed."}</p>
            <Button
              variant="outline"
              onClick={() => {
                create.reset();
                setRegenId(null);
              }}
            >
              Try again
            </Button>
          </div>
        )}
        {done && generation && (
          <div className="space-y-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={generation.imageUrls[0]} alt="" className="max-h-[52dvh] w-full rounded-lg object-contain" />
            {create.data?.holiday && (
              <p className="text-xs text-muted-foreground">Themed around {create.data.holiday}.</p>
            )}
            <div className="flex gap-1.5">
              <Input
                value={feedback}
                maxLength={1000}
                onChange={(e) => setFeedback(e.target.value)}
                placeholder="Want changes? e.g. warmer colours, bigger logo"
              />
              <Button
                variant="outline"
                disabled={!feedback.trim() || regen.isPending}
                onClick={() =>
                  regen.mutate(
                    { postId: create.data!.postId, comment: feedback.trim() },
                    {
                      onSuccess: (res) => {
                        setRegenId(res.generationId);
                        setFeedback("");
                      },
                    },
                  )
                }
              >
                {regen.isPending ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                Regenerate
              </Button>
            </div>
            {regen.isError && <p className="text-xs text-destructive">{regen.error.message}</p>}
            <div className="flex flex-wrap gap-2">
              <Button
                className="flex-1"
                disabled={postAction.isPending}
                onClick={() =>
                  postAction.mutate(
                    { postId: create.data!.postId, action: "approve" },
                    { onSuccess: onClose },
                  )
                }
              >
                {postAction.isPending ? <Loader2 className="animate-spin" /> : <Check />}
                Approve for {shortDay(date)}
              </Button>
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => {
                  onSchedule(generation.id, create.data!.postId);
                  onClose();
                }}
              >
                <CalendarDays /> Approve &amp; schedule
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Approving keeps the image on {shortDay(date)} in your calendar until you pick accounts and a time.
            </p>
            {postAction.isError && <p className="text-xs text-destructive">{postAction.error.message}</p>}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------- Library -------------------------------- */

export function LibraryPickerDialog({
  date,
  open,
  onClose,
  onPick,
}: {
  date: Date;
  open: boolean;
  onClose: () => void;
  onPick: (generationId: string) => void;
}) {
  const { data, isLoading } = useGenerations();
  const images = (data?.items ?? []).filter((g) => g.status === "completed" && g.imageUrls.length > 0);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85dvh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Pick an image for {longDay(date)}</DialogTitle>
          <DialogDescription>Choose from your library, then set accounts and caption.</DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <Loader2 className="mx-auto animate-spin text-muted-foreground" />
        ) : images.length === 0 ? (
          <p className="text-sm text-muted-foreground">Your library has no finished images yet.</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {images.map((g) => (
              <button
                key={g.id}
                onClick={() => {
                  onPick(g.id);
                  onClose();
                }}
                className="group overflow-hidden rounded-lg border border-border transition hover:ring-2 hover:ring-primary"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={g.imageUrls[0]} alt={g.prompt} className="aspect-square w-full object-cover" />
              </button>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* --------------------------------- AI Fill -------------------------------- */

const FREQUENCIES = [
  { label: "Every day", days: 1 },
  { label: "Every 2 days", days: 2 },
  { label: "Every 3 days", days: 3 },
  { label: "Weekly", days: 7 },
];

const PLATFORM_NAMES = ["Instagram", "Facebook", "X", "YouTube"];

export function FillDialog({
  open,
  onClose,
  onFilled,
}: {
  open: boolean;
  onClose: () => void;
  onFilled: (start: Date) => void;
}) {
  const { brands, isLoading, brandId, setBrandId } = useDefaultBrand();
  const fill = useFillCalendar();
  const [start, setStart] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return ymd(d);
  });
  const [end, setEnd] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    return ymd(d);
  });
  const [every, setEvery] = useState(2);
  const [time, setTime] = useState("10:00");
  const [platform, setPlatform] = useState("Instagram");
  const [holidays, setHolidays] = useState<"suggest" | "ignore">("suggest");
  const [notes, setNotes] = useState("");

  const count = Math.max(
    0,
    Math.floor((new Date(`${end}T00:00:00`).getTime() - new Date(`${start}T00:00:00`).getTime()) / 86_400_000 / every) + 1,
  );
  const valid = !!brandId && count >= 1 && count <= 31;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" /> AI Fill Calendar
          </DialogTitle>
          <DialogDescription>
            Papaya proposes a content plan. Nothing is generated or posted until you say so.
          </DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <Loader2 className="mx-auto animate-spin text-muted-foreground" />
        ) : brands.length === 0 ? (
          <p className="text-sm text-muted-foreground">Create a brand first so Papaya knows your style.</p>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Brand</label>
              <BrandSelect brands={brands} value={brandId} onChange={setBrandId} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Start</label>
                <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">End</label>
                <Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Posting frequency</label>
              <div className="flex flex-wrap gap-1.5">
                {FREQUENCIES.map((f) => (
                  <Button
                    key={f.days}
                    size="sm"
                    variant={every === f.days ? "default" : "outline"}
                    onClick={() => setEvery(f.days)}
                  >
                    {f.label}
                  </Button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Posting time ({timezone()})</label>
                <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Written for</label>
                <select
                  value={platform}
                  onChange={(e) => setPlatform(e.target.value)}
                  className="h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm"
                >
                  {PLATFORM_NAMES.map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Holidays</label>
              <div className="flex gap-1.5">
                <Button size="sm" variant={holidays === "suggest" ? "default" : "outline"} onClick={() => setHolidays("suggest")}>
                  Use relevant holidays
                </Button>
                <Button size="sm" variant={holidays === "ignore" ? "default" : "outline"} onClick={() => setHolidays("ignore")}>
                  Ignore holidays
                </Button>
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Notes (optional)</label>
              <Input
                value={notes}
                maxLength={1000}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. mix of product, educational and offers"
              />
            </div>
            <Button
              className="w-full"
              disabled={!valid || fill.isPending}
              onClick={() =>
                fill.mutate(
                  {
                    brandId,
                    startDate: start,
                    endDate: end,
                    everyDays: every,
                    time,
                    timezone: timezone(),
                    platform,
                    holidays,
                    instructions: notes.trim() || undefined,
                  },
                  {
                    onSuccess: () => {
                      onFilled(new Date(`${start}T00:00:00`));
                      onClose();
                    },
                  },
                )
              }
            >
              {fill.isPending ? <Loader2 className="animate-spin" /> : <Wand2 />}
              {fill.isPending ? "Planning…" : `Plan ${count > 0 ? count : 0} post${count === 1 ? "" : "s"}`}
            </Button>
            {count > 31 && <p className="text-xs text-destructive">That makes more than 31 posts - shorten the range.</p>}
            {fill.isError && <p className="text-xs text-destructive">{fill.error.message}</p>}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** The two ways to fill a day, shown when a date is selected. */
export function DayOptions({
  onPapaya,
  onLibrary,
  disabled,
}: {
  onPapaya: () => void;
  onLibrary: () => void;
  disabled?: boolean;
}) {
  const card = "flex w-full items-start gap-3 rounded-xl border border-border p-3 text-left transition hover:border-primary hover:bg-primary/5 disabled:opacity-50";
  return (
    <div className="space-y-2">
      <button className={cn(card)} onClick={onPapaya} disabled={disabled}>
        <span className="mt-0.5 rounded-lg bg-primary/15 p-2 text-primary">
          <Sparkles className="size-4" />
        </span>
        <span>
          <span className="block text-sm font-medium">Papaya - let AI create it</span>
          <span className="block text-xs text-muted-foreground">
            Picks the idea from your brand and any special day, then makes the image.
          </span>
        </span>
      </button>
      <button className={cn(card)} onClick={onLibrary} disabled={disabled}>
        <span className="mt-0.5 rounded-lg bg-muted p-2">
          <ImageIcon className="size-4" />
        </span>
        <span>
          <span className="block text-sm font-medium">Choose from library</span>
          <span className="block text-xs text-muted-foreground">Use an image you&apos;ve already generated.</span>
        </span>
      </button>
    </div>
  );
}
