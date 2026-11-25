"use client";

import { useEffect, useRef, useState, type DragEvent } from "react";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronLeft,
  ChevronRight,
  Circle,
  Download,
  Eye,
  GripVertical,
  ImageUp,
  Loader2,
  Palette,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import {
  CAROUSEL_ASPECTS,
  CAROUSEL_DIMENSIONS,
  CAROUSEL_MAX_SLIDES,
  CAROUSEL_MIN_SLIDES,
  carouselProgressSteps,
  type CarouselAspect,
  type CarouselDesign,
  type CarouselDto,
  type CarouselSlideDto,
} from "@catgpt/types";
import {
  downloadCarouselSlide,
  downloadCarouselZip,
  useAddCarouselSlide,
  useCarousel,
  useDeleteCarouselSlide,
  useRegenerateCarouselSlide,
  useReorderCarousel,
  useReplaceCarouselSlide,
  useRetryCarousel,
  useUpdateCarousel,
  useUpdateCarouselSlide,
} from "@/lib/carousel-hooks";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/components/ui/toaster";

const STATUS_LABEL: Record<CarouselDto["status"], string> = {
  planning: "Planning",
  generating: "Generating",
  completed: "Complete",
  partial: "Incomplete",
  failed: "Failed",
};

/**
 * The AI carousel in the chat: live per-step progress, then a numbered
 * gallery of the separate slide images with per-slide edit / regenerate /
 * replace / download, drag-to-reorder, add/remove, design changes, a
 * full preview, and download-all. Success is only shown when every slide
 * has its own image.
 */
export function CarouselPanel({ carouselId }: { carouselId: string }) {
  const { data: c, isLoading, error } = useCarousel(carouselId);
  const [editing, setEditing] = useState<CarouselSlideDto | null>(null);
  const [regenFor, setRegenFor] = useState<CarouselSlideDto | null>(null);
  const [preview, setPreview] = useState<number | null>(null);
  const [designOpen, setDesignOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);

  if (isLoading || !c) {
    return (
      <div className="flex w-full max-w-2xl items-center gap-2 rounded-xl border px-4 py-3 text-xs text-muted-foreground">
        {error ? (
          <>
            <AlertCircle className="h-3.5 w-3.5 text-destructive" /> Could not load this carousel.
          </>
        ) : (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading carousel…
          </>
        )}
      </div>
    );
  }

  const done = c.slides.filter((s) => s.status === "completed" && s.imageUrl).length;
  const complete = c.status === "completed" && done === c.slides.length && c.slides.length > 0;
  const working = c.status === "planning" || c.status === "generating";
  const ratio = `${c.width} / ${c.height}`;

  return (
    <div className="flex w-full max-w-3xl flex-col gap-3 rounded-xl border bg-card p-3 sm:p-4">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{c.title || "Carousel"}</p>
          <p className="text-[11px] text-muted-foreground">
            {c.slides.length || "…"} slides · {CAROUSEL_DIMENSIONS[c.aspect].label}
            {c.brandId ? " · brand" : " · general"}
          </p>
        </div>
        <Badge
          variant={complete ? "default" : "outline"}
          className={cn(
            "text-[10px]",
            (c.status === "partial" || c.status === "failed") && "border-destructive/50 text-destructive",
          )}
        >
          {working && <Loader2 className="mr-1 h-2.5 w-2.5 animate-spin" />}
          {STATUS_LABEL[c.status]}
          {c.slides.length > 0 && ` · ${done}/${c.slides.length}`}
        </Badge>
      </div>

      {/* Live progress (hidden once everything is done) */}
      {!complete && <ProgressList c={c} />}

      {(c.status === "partial" || c.status === "failed") && c.error && (
        <FailureBanner c={c} />
      )}

      {/* Gallery */}
      {c.slides.length > 0 && (
        <SlideGrid
          c={c}
          ratio={ratio}
          onEdit={setEditing}
          onRegenerate={setRegenFor}
          onPreview={setPreview}
        />
      )}

      {/* Carousel-wide actions */}
      {c.status !== "planning" && c.slides.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-t pt-3">
          <Button size="sm" variant="outline" onClick={() => setPreview(0)}>
            <Eye /> Preview
          </Button>
          <Button
            size="sm"
            disabled={!complete || downloading}
            title={complete ? "Download every slide as a separate image (ZIP)" : "Available once every slide is generated"}
            onClick={async () => {
              setDownloading(true);
              try {
                await downloadCarouselZip(c);
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "Download failed");
              } finally {
                setDownloading(false);
              }
            }}
          >
            {downloading ? <Loader2 className="animate-spin" /> : <Download />} Download all ({c.slides.length})
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={c.slides.length >= CAROUSEL_MAX_SLIDES}
            onClick={() => setAddOpen(true)}
          >
            <Plus /> Add slide
          </Button>
          <Button size="sm" variant="outline" onClick={() => setDesignOpen(true)}>
            <Palette /> Design
          </Button>
        </div>
      )}

      {editing && <EditSlideDialog c={c} slide={editing} onClose={() => setEditing(null)} />}
      {regenFor && <RegenerateDialog c={c} slide={regenFor} onClose={() => setRegenFor(null)} />}
      {designOpen && <DesignDialog c={c} onClose={() => setDesignOpen(false)} />}
      {addOpen && <AddSlideDialog c={c} onClose={() => setAddOpen(false)} />}
      {preview !== null && (
        <PreviewDialog c={c} start={preview} onClose={() => setPreview(null)} />
      )}
    </div>
  );
}

function ProgressList({ c }: { c: CarouselDto }) {
  const steps = carouselProgressSteps(c);
  return (
    <ol className="grid gap-1 rounded-lg bg-muted/40 p-2.5 text-xs sm:grid-cols-2">
      {steps.map((s, i) => (
        <li key={i} className="flex min-w-0 items-center gap-2">
          {s.state === "done" ? (
            <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
          ) : s.state === "active" ? (
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
          ) : s.state === "failed" ? (
            <AlertCircle className="h-3.5 w-3.5 shrink-0 text-destructive" />
          ) : (
            <Circle className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
          )}
          <span className={cn("truncate", s.state === "pending" && "text-muted-foreground")}>
            {s.label}
          </span>
          <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
            {s.state === "done"
              ? "Completed"
              : s.state === "active"
                ? "Processing"
                : s.state === "failed"
                  ? "Failed"
                  : "Pending"}
          </span>
        </li>
      ))}
    </ol>
  );
}

function FailureBanner({ c }: { c: CarouselDto }) {
  const retry = useRetryCarousel(c.id);
  const failed = c.slides.filter((s) => s.status === "failed").length;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2">
      <AlertCircle className="h-4 w-4 shrink-0 text-destructive" />
      <p className="min-w-0 flex-1 text-xs leading-relaxed">{c.error}</p>
      {failed > 0 && (
        <Button size="sm" variant="outline" disabled={retry.isPending} onClick={() => retry.mutate()}>
          {retry.isPending ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          Retry {failed} failed slide{failed > 1 ? "s" : ""}
        </Button>
      )}
    </div>
  );
}

function SlideGrid({
  c,
  ratio,
  onEdit,
  onRegenerate,
  onPreview,
}: {
  c: CarouselDto;
  ratio: string;
  onEdit: (s: CarouselSlideDto) => void;
  onRegenerate: (s: CarouselSlideDto) => void;
  onPreview: (i: number) => void;
}) {
  const reorder = useReorderCarousel(c.id);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  const move = (from: number, to: number) => {
    if (to < 0 || to >= c.slides.length || from === to) return;
    const ids = c.slides.map((s) => s.id);
    const [id] = ids.splice(from, 1);
    ids.splice(to, 0, id!);
    reorder.mutate(ids);
  };

  return (
    <div
      className={cn(
        "grid gap-3",
        c.aspect === "landscape" ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-2 sm:grid-cols-3",
      )}
    >
      {c.slides.map((s, i) => (
        <div
          key={s.id}
          draggable
          onDragStart={(e: DragEvent) => {
            setDragId(s.id);
            e.dataTransfer.effectAllowed = "move";
          }}
          onDragOver={(e: DragEvent) => {
            e.preventDefault();
            setOverId(s.id);
          }}
          onDragLeave={() => setOverId((o) => (o === s.id ? null : o))}
          onDrop={(e: DragEvent) => {
            e.preventDefault();
            const from = c.slides.findIndex((x) => x.id === dragId);
            if (from >= 0) move(from, i);
            setDragId(null);
            setOverId(null);
          }}
          onDragEnd={() => {
            setDragId(null);
            setOverId(null);
          }}
          className={cn(
            "group flex min-w-0 flex-col gap-1.5 rounded-lg transition-opacity",
            dragId === s.id && "opacity-40",
            overId === s.id && dragId !== s.id && "ring-2 ring-primary ring-offset-2 ring-offset-card",
          )}
        >
          <SlideCard
            c={c}
            slide={s}
            index={i}
            ratio={ratio}
            onEdit={() => onEdit(s)}
            onRegenerate={() => onRegenerate(s)}
            onPreview={() => onPreview(i)}
            onMove={(d) => move(i, i + d)}
          />
        </div>
      ))}
    </div>
  );
}

function SlideCard({
  c,
  slide,
  index,
  ratio,
  onEdit,
  onRegenerate,
  onPreview,
  onMove,
}: {
  c: CarouselDto;
  slide: CarouselSlideDto;
  index: number;
  ratio: string;
  onEdit: () => void;
  onRegenerate: () => void;
  onPreview: () => void;
  onMove: (delta: number) => void;
}) {
  const replace = useReplaceCarouselSlide(c.id);
  const del = useDeleteCarouselSlide(c.id);
  const regen = useRegenerateCarouselSlide(c.id);
  const fileRef = useRef<HTMLInputElement>(null);
  const busy = slide.status === "generating" || replace.isPending;
  const ready = slide.status === "completed" && Boolean(slide.imageUrl);

  return (
    <>
      <div
        className="relative w-full overflow-hidden rounded-lg border bg-muted/30"
        style={{ aspectRatio: ratio }}
      >
        {/* A failed slide shows only the error - never its old image underneath. */}
        {slide.imageUrl && slide.status !== "failed" && (
          <button type="button" onClick={onPreview} className="block h-full w-full" aria-label={`Preview slide ${index + 1}`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={slide.imageUrl}
              alt={slide.title || `Slide ${index + 1}`}
              className={cn("h-full w-full object-cover", busy && "opacity-40")}
              loading="lazy"
            />
          </button>
        )}
        {!slide.imageUrl && !busy && slide.status !== "failed" && (
          <div className="absolute inset-0 flex items-center justify-center text-[11px] text-muted-foreground">
            Pending
          </div>
        )}
        {busy && (
          <div className="shimmer absolute inset-0 flex items-center justify-center">
            <span className="flex items-center gap-1.5 rounded-full bg-background/80 px-2.5 py-1 text-[11px]">
              <Loader2 className="h-3 w-3 animate-spin" />
              {replace.isPending ? "Uploading…" : `Generating${slide.attempts > 1 ? ` (try ${slide.attempts})` : ""}…`}
            </span>
          </div>
        )}
        {slide.status === "failed" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-destructive/10 p-2 text-center">
            <AlertCircle className="h-4 w-4 text-destructive" />
            <p className="line-clamp-3 text-[10px] text-muted-foreground">{slide.error ?? "Failed"}</p>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-[11px]"
              disabled={regen.isPending}
              onClick={() => regen.mutate({ slideId: slide.id })}
            >
              <RefreshCw /> Retry slide
            </Button>
          </div>
        )}
        <span className="absolute left-1.5 top-1.5 rounded-md bg-background/85 px-1.5 py-0.5 text-[10px] font-semibold">
          {index + 1}
          {slide.role === "cover" ? " · Cover" : slide.role === "cta" ? " · CTA" : ""}
        </span>
        <span
          className="absolute right-1.5 top-1.5 cursor-grab rounded-md bg-background/85 p-0.5 opacity-0 transition-opacity group-hover:opacity-100"
          title="Drag to reorder"
        >
          <GripVertical className="h-3.5 w-3.5" />
        </span>
      </div>
      <div className="min-w-0 px-0.5">
        <p className="truncate text-xs font-medium">{slide.title || `Slide ${index + 1}`}</p>
        {slide.body && <p className="line-clamp-2 text-[11px] text-muted-foreground">{slide.body}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-0.5">
        <IconBtn label="Edit text" onClick={onEdit}>
          <Pencil />
        </IconBtn>
        <IconBtn label="Regenerate this slide" disabled={busy} onClick={onRegenerate}>
          <RefreshCw />
        </IconBtn>
        <IconBtn label="Replace image" disabled={busy} onClick={() => fileRef.current?.click()}>
          <ImageUp />
        </IconBtn>
        <IconBtn
          label="Download slide"
          disabled={!ready}
          onClick={() =>
            downloadCarouselSlide(c, index, slide.imageUrl!).catch((err: Error) => toast.error(err.message))
          }
        >
          <Download />
        </IconBtn>
        <IconBtn label="Move left" disabled={index === 0} onClick={() => onMove(-1)}>
          <ArrowLeft />
        </IconBtn>
        <IconBtn label="Move right" disabled={index === c.slides.length - 1} onClick={() => onMove(1)}>
          <ArrowRight />
        </IconBtn>
        <IconBtn
          label="Delete slide"
          disabled={c.slides.length <= CAROUSEL_MIN_SLIDES || del.isPending}
          onClick={() => {
            if (window.confirm(`Delete slide ${index + 1}?`)) del.mutate(slide.id);
          }}
        >
          <Trash2 />
        </IconBtn>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) replace.mutate({ slideId: slide.id, file });
          }}
        />
      </div>
    </>
  );
}

function IconBtn({
  label,
  children,
  ...props
}: { label: string; children: React.ReactNode } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-35 [&_svg]:h-3.5 [&_svg]:w-3.5"
      {...props}
    >
      {children}
    </button>
  );
}

function EditSlideDialog({
  c,
  slide,
  onClose,
}: {
  c: CarouselDto;
  slide: CarouselSlideDto;
  onClose: () => void;
}) {
  const update = useUpdateCarouselSlide(c.id);
  const [title, setTitle] = useState(slide.title);
  const [body, setBody] = useState(slide.body);
  const [visual, setVisual] = useState(slide.visual);
  // Which button was pressed, so only that one shows the spinner.
  const [saving, setSaving] = useState<"text" | "regenerate" | null>(null);
  const save = (regenerate: boolean) => {
    setSaving(regenerate ? "regenerate" : "text");
    update.mutate(
      { slideId: slide.id, title, body, visual, regenerate },
      { onSuccess: onClose, onSettled: () => setSaving(null) },
    );
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit slide {slide.position + 1}</DialogTitle>
          <DialogDescription>
            The text is drawn into the slide image, so apply it by regenerating this slide. The other
            slides stay as they are.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-xs font-medium">
            Headline
            <Input value={title} maxLength={140} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium">
            Supporting text
            <Textarea value={body} maxLength={400} rows={3} onChange={(e) => setBody(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium">
            Visual (what the image shows)
            <Textarea value={visual} maxLength={800} rows={3} onChange={(e) => setVisual(e.target.value)} />
          </label>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" size="sm" disabled={saving !== null} onClick={() => save(false)}>
              {saving === "text" && <Loader2 className="animate-spin" />} Save text only
            </Button>
            <Button
              size="sm"
              disabled={saving !== null || slide.status === "generating"}
              onClick={() => save(true)}
            >
              {saving === "regenerate" ? <Loader2 className="animate-spin" /> : <RefreshCw />} Save & regenerate
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RegenerateDialog({
  c,
  slide,
  onClose,
}: {
  c: CarouselDto;
  slide: CarouselSlideDto;
  onClose: () => void;
}) {
  const regen = useRegenerateCarouselSlide(c.id);
  const [instructions, setInstructions] = useState("");
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Regenerate slide {slide.position + 1}</DialogTitle>
          <DialogDescription>
            Only this slide is redrawn. It is matched to the carousel&apos;s other slides so the set stays
            consistent.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          value={instructions}
          maxLength={600}
          rows={3}
          placeholder="Optional: what to change (e.g. bigger walnuts, more white space)"
          onChange={(e) => setInstructions(e.target.value)}
        />
        <div className="flex justify-end">
          <Button
            size="sm"
            disabled={regen.isPending}
            onClick={() =>
              regen.mutate(
                { slideId: slide.id, instructions: instructions.trim() || undefined },
                { onSuccess: onClose },
              )
            }
          >
            {regen.isPending ? <Loader2 className="animate-spin" /> : <RefreshCw />} Regenerate
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AddSlideDialog({ c, onClose }: { c: CarouselDto; onClose: () => void }) {
  const add = useAddCarouselSlide(c.id);
  const [idea, setIdea] = useState("");
  const [position, setPosition] = useState(Math.max(c.slides.length - 1, 1));
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add a slide</DialogTitle>
          <DialogDescription>
            The AI writes the new slide to fit this carousel and generates it in the same design.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          value={idea}
          maxLength={600}
          rows={3}
          placeholder="Optional: what the slide should cover (e.g. pistachios)"
          onChange={(e) => setIdea(e.target.value)}
        />
        <label className="flex items-center gap-2 text-xs">
          Insert as slide
          <select
            className="rounded-md border bg-background px-2 py-1"
            value={position}
            onChange={(e) => setPosition(Number(e.target.value))}
          >
            {Array.from({ length: c.slides.length }, (_, i) => i + 1).map((p) => (
              <option key={p} value={p}>
                {p + 1}
              </option>
            ))}
          </select>
        </label>
        <div className="flex justify-end">
          <Button
            size="sm"
            disabled={add.isPending}
            onClick={() =>
              add.mutate({ idea: idea.trim() || undefined, position }, { onSuccess: onClose })
            }
          >
            {add.isPending ? <Loader2 className="animate-spin" /> : <Plus />} Add & generate
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DesignDialog({ c, onClose }: { c: CarouselDto; onClose: () => void }) {
  const update = useUpdateCarousel(c.id);
  const d: CarouselDesign = c.design ?? {
    palette: ["#1F2937", "#F8FAFC", "#F59E0B"],
    typography: "",
    background: "",
    visualStyle: "",
    layout: "",
  };
  const [palette, setPalette] = useState<string[]>(d.palette);
  const [typography, setTypography] = useState(d.typography);
  const [background, setBackground] = useState(d.background);
  const [visualStyle, setVisualStyle] = useState(d.visualStyle);
  const [layout, setLayout] = useState(d.layout);
  const [aspect, setAspect] = useState<CarouselAspect>(c.aspect);
  const [title, setTitle] = useState(c.title);

  const submit = (regenerateAll: boolean) =>
    update.mutate(
      {
        title,
        aspect,
        design: {
          palette,
          ...(typography.trim() ? { typography } : {}),
          ...(background.trim() ? { background } : {}),
          ...(visualStyle.trim() ? { visualStyle } : {}),
          ...(layout.trim() ? { layout } : {}),
        },
        regenerateAll,
      },
      { onSuccess: onClose },
    );

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Carousel design</DialogTitle>
          <DialogDescription>
            One design system for every slide. Applying it regenerates all {c.slides.length} slides
            (cover first, then the rest matched to it).
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3 text-xs">
          <label className="flex flex-col gap-1 font-medium">
            Title
            <Input value={title} maxLength={160} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <div className="flex flex-col gap-1 font-medium">
            Colours{c.brandId ? " (brand colours)" : ""}
            <div className="flex flex-wrap items-center gap-2">
              {palette.map((hex, i) => (
                <span key={i} className="flex items-center gap-1 rounded-md border px-1.5 py-1">
                  <input
                    type="color"
                    value={hex}
                    aria-label={`Colour ${i + 1}`}
                    className="h-6 w-6 cursor-pointer border-0 bg-transparent p-0"
                    onChange={(e) => setPalette((p) => p.map((x, j) => (j === i ? e.target.value.toUpperCase() : x)))}
                  />
                  <span className="font-mono text-[10px]">{hex}</span>
                  {palette.length > 1 && (
                    <button
                      type="button"
                      aria-label="Remove colour"
                      onClick={() => setPalette((p) => p.filter((_, j) => j !== i))}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </span>
              ))}
              {palette.length < 6 && (
                <button
                  type="button"
                  className="rounded-md border px-2 py-1"
                  onClick={() => setPalette((p) => [...p, "#888888"])}
                >
                  <Plus className="h-3 w-3" />
                </button>
              )}
            </div>
          </div>
          <label className="flex flex-col gap-1 font-medium">
            Typography
            <Input value={typography} maxLength={300} onChange={(e) => setTypography(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 font-medium">
            Background
            <Input value={background} maxLength={300} onChange={(e) => setBackground(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 font-medium">
            Visual style
            <Input value={visualStyle} maxLength={400} onChange={(e) => setVisualStyle(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 font-medium">
            Layout & spacing
            <Input value={layout} maxLength={300} onChange={(e) => setLayout(e.target.value)} />
          </label>
          <div className="flex flex-col gap-1 font-medium">
            Format
            <div className="flex flex-wrap gap-1.5">
              {CAROUSEL_ASPECTS.map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => setAspect(a)}
                  className={cn(
                    "rounded-md border px-2 py-1",
                    a === aspect ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground",
                  )}
                >
                  {CAROUSEL_DIMENSIONS[a].label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={update.isPending || aspect !== c.aspect}
              title={aspect !== c.aspect ? "A new format needs every slide regenerated" : undefined}
              onClick={() => submit(false)}
            >
              Save without regenerating
            </Button>
            <Button size="sm" disabled={update.isPending} onClick={() => submit(true)}>
              {update.isPending ? <Loader2 className="animate-spin" /> : <RefreshCw />} Apply to all slides
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PreviewDialog({ c, start, onClose }: { c: CarouselDto; start: number; onClose: () => void }) {
  const [i, setI] = useState(Math.min(start, c.slides.length - 1));
  const slide = c.slides[i];
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") setI((x) => Math.min(x + 1, c.slides.length - 1));
      if (e.key === "ArrowLeft") setI((x) => Math.max(x - 1, 0));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [c.slides.length]);
  if (!slide) return null;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {c.title || "Carousel"} · slide {i + 1} of {c.slides.length}
          </DialogTitle>
          <DialogDescription>{CAROUSEL_DIMENSIONS[c.aspect].label} - swipe order as posted.</DialogDescription>
        </DialogHeader>
        <div className="relative">
          <div
            className="mx-auto w-full overflow-hidden rounded-lg border bg-muted/30"
            style={{ aspectRatio: `${c.width} / ${c.height}`, maxHeight: "65dvh" }}
          >
            {slide.imageUrl && slide.status !== "failed" ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={slide.imageUrl} alt={slide.title} className="h-full w-full object-contain" />
            ) : (
              <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                {slide.status === "failed" ? "This slide failed - retry it from the gallery" : "Not generated yet"}
              </div>
            )}
          </div>
          <button
            type="button"
            aria-label="Previous slide"
            disabled={i === 0}
            onClick={() => setI(i - 1)}
            className="absolute left-1 top-1/2 -translate-y-1/2 rounded-full bg-background/85 p-1.5 shadow disabled:opacity-30"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label="Next slide"
            disabled={i === c.slides.length - 1}
            onClick={() => setI(i + 1)}
            className="absolute right-1 top-1/2 -translate-y-1/2 rounded-full bg-background/85 p-1.5 shadow disabled:opacity-30"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <div className="flex justify-center gap-1.5">
          {c.slides.map((s, j) => (
            <button
              key={s.id}
              type="button"
              aria-label={`Go to slide ${j + 1}`}
              onClick={() => setI(j)}
              className={cn(
                "h-1.5 rounded-full transition-all",
                j === i ? "w-5 bg-primary" : "w-1.5 bg-muted-foreground/30",
              )}
            />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
