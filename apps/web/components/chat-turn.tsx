"use client";

import { memo, useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import {
  AlertCircle,
  Download,
  FileText,
  Globe,
  Loader2,
  Square,
  Store,
  X,
} from "lucide-react";
import type { GenerationDto, WebSource } from "@catgpt/types";
import { useGenerationStream } from "@/lib/sse";
import { useStudio } from "@/lib/store";
import { cn } from "@/lib/utils";
import { friendlyEngineLabel } from "@/lib/model-labels";
import { Badge } from "@/components/ui/badge";
import { Markdown } from "./markdown";
import { ActionRow } from "./generation-actions";
import { SourceChips } from "./source-chips";

gsap.registerPlugin(useGSAP);

/** A file the assistant produced for this turn (e.g. an edited document). */
interface ReplyFile {
  url: string;
  filename: string;
  mimeType: string;
}

/**
 * Supabase public URLs honour ?download=<name>, which sets the saved filename;
 * stored keys are random hex, so without it the download would be unnamed.
 * Local /uploads/ URLs are used as-is.
 */
function downloadUrl(f: ReplyFile): string {
  if (!f.url.includes("/storage/v1/object/public/")) return f.url;
  return `${f.url}${f.url.includes("?") ? "&" : "?"}download=${encodeURIComponent(f.filename)}`;
}

/**
 * One chat turn: the user's prompt bubble (right) + the assistant reply
 * (left) — an image for kind="image", a text bubble for kind="text".
 * Images open a lightbox on click.
 */
/**
 * Smooth reveal for streamed replies. Deltas arrive in ~60ms bursts which
 * reads as chunky jumps — this tweens the rendered character count toward
 * the full target with an eased curve (instead of stepping linearly), and
 * re-targets the running tween whenever new deltas extend the text so it
 * never has to snap backward or restart. Once the turn finishes it snaps to
 * the complete text.
 */
function useSmoothReveal(text: string, active: boolean): string {
  const targetRef = useRef(text);
  targetRef.current = text;
  const [shown, setShown] = useState<number | null>(null); // null = fully shown
  const shownRef = useRef(0);
  const counter = useRef({ n: 0 }).current;
  const tweenRef = useRef<gsap.core.Tween | null>(null);

  useEffect(() => {
    if (!active) {
      tweenRef.current?.kill();
      tweenRef.current = null;
      setShown(null);
      return;
    }
    counter.n = shownRef.current;
    const target = targetRef.current.length;
    tweenRef.current?.kill();
    tweenRef.current = gsap.to(counter, {
      n: target,
      duration: Math.min(0.9, Math.max(0.12, (target - counter.n) / 50)),
      ease: "power2.out",
      onUpdate: () => {
        const n = Math.round(counter.n);
        shownRef.current = n;
        setShown(n);
      },
    });
    return () => {
      tweenRef.current?.kill();
    };
    // Re-targets on every new delta (text growing); `active` alone would miss them.
    // `counter` is a stable ref object (same identity for the component's
    // lifetime), so it's intentionally left out of the deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, active]);

  return active && shown !== null ? text.slice(0, shown) : text;
}

/**
 * Memoized: the store carries a dozen unrelated fields (sidebar, quality,
 * theme, ...) and each turn only cares about select/selectedId, so plain
 * `useStudio()` here used to re-render every visible turn - and re-run its
 * Markdown parse - on any of those unrelated changes. Selectors narrow the
 * subscription; memo skips the re-render entirely when this turn's own
 * generation object hasn't changed (the SSE cache patch keeps every other
 * turn's object reference stable - see lib/sse.ts).
 */
export const ChatTurn = memo(function ChatTurn({
  generation,
  priority = false,
}: {
  generation: GenerationDto;
  /**
   * True for turns near the top (the first ones a reader sees before
   * scrolling) or near the bottom (where the feed lands on open). Their
   * images load eagerly instead of lazily, so the chat isn't stuck showing
   * shimmer placeholders where a reply is actually already in view.
   * Everything else stays lazy and loads in as the reader scrolls to it.
   */
  priority?: boolean;
}) {
  const select = useStudio((s) => s.select);
  const selectedId = useStudio((s) => s.selectedId);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  // Which image of a multi-image (carousel) generation is shown big.
  const [activeImage, setActiveImage] = useState(0);
  const inFlight =
    generation.status === "pending" || generation.status === "processing";
  useGenerationStream(generation.id, inFlight);

  // Entrance: plays once, the moment this turn mounts (memo means it won't
  // re-run on later re-renders of the same turn). Replaces the old
  // animate-fade-in CSS class with an eased tween so it can be extended
  // (e.g. staggering user → assistant) without fighting a CSS animation.
  const rootRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const { contextSafe } = useGSAP(
    () => {
      gsap.from(rootRef.current, { opacity: 0, y: 10, duration: 0.4, ease: "power3.out" });
    },
    { scope: rootRef },
  );
  // Image reveal on load: a soft fade + scale-down-to-rest instead of an
  // instant pop once the generated image finishes downloading.
  const onImageLoad = contextSafe(() => {
    if (!imgRef.current) return;
    gsap.fromTo(
      imgRef.current,
      { opacity: 0, scale: 1.02 },
      { opacity: 1, scale: 1, duration: 0.55, ease: "power2.out" },
    );
  });

  // Lightbox open/close: fades the backdrop and scales the image in on open,
  // with a touch of overshoot so it settles rather than just stopping;
  // closing eases back out before unmounting, instead of the previous hard
  // cut straight to nothing.
  const lightboxRef = useRef<HTMLDivElement>(null);
  const lightboxImgRef = useRef<HTMLImageElement>(null);
  useEffect(() => {
    if (!lightboxUrl || !lightboxRef.current) return;
    gsap.fromTo(lightboxRef.current, { opacity: 0 }, { opacity: 1, duration: 0.25, ease: "power1.out" });
    if (lightboxImgRef.current) {
      gsap.fromTo(
        lightboxImgRef.current,
        { scale: 0.92, opacity: 0 },
        { scale: 1, opacity: 1, duration: 0.45, ease: "back.out(1.5)" },
      );
    }
  }, [lightboxUrl]);
  const closeLightbox = contextSafe(() => {
    if (!lightboxRef.current) {
      setLightboxUrl(null);
      return;
    }
    gsap.to(lightboxRef.current, {
      opacity: 0,
      duration: 0.15,
      ease: "power1.in",
      onComplete: () => setLightboxUrl(null),
    });
  });
  const shownText = useSmoothReveal(
    generation.textResponse ?? "",
    inFlight && generation.kind === "text",
  );

  const images = generation.imageUrls;
  const image = images[activeImage] ?? images[0];
  const meta = (generation.metadata ?? {}) as Record<string, unknown>;
  const refImages = [
    ...((meta.referenceImageUrls as string[] | undefined) ?? []),
    ...((meta.visionImageUrls as string[] | undefined) ?? []),
  ];
  const active = selectedId === generation.id;
  const sources = (meta.sources as WebSource[] | undefined) ?? [];
  const files = Array.isArray(meta.files) ? (meta.files as ReplyFile[]) : [];
  const searching = meta.searching === true;
  const creative = meta.campaignCreative as
    | { index: number; total: number; title?: string }
    | undefined;

  return (
    <div ref={rootRef} className="flex flex-col gap-3">
      {/* User turn */}
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-accent px-4 py-2.5 sm:max-w-[70%]">
          {refImages.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {refImages.map((url, i) => (
                <button
                  key={url}
                  onClick={() => setLightboxUrl(url)}
                  aria-label={`Preview reference ${i + 1}`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={url}
                    alt={`reference ${i + 1}`}
                    className="h-10 w-10 rounded-md object-cover"
                  />
                </button>
              ))}
            </div>
          )}
          {creative ? (
            <p className="text-sm leading-relaxed">
              <span className="font-medium">
                Campaign creative {creative.index}/{creative.total}
              </span>
              {creative.title ? " — " + creative.title : ""}
            </p>
          ) : (
            <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
              {generation.prompt}
            </p>
          )}
          <div className="mt-1.5 flex flex-wrap items-center justify-end gap-1.5">
            {generation.theme && (
              <Badge variant="default" className="text-[10px]">
                /{generation.theme.slug}
              </Badge>
            )}
            {typeof meta.brandId === "string" && (
              <Badge variant="outline" className="gap-1 text-[10px]">
                <Store className="h-2.5 w-2.5" />
                brand
              </Badge>
            )}
            {generation.parentId && (
              <Badge variant="outline" className="text-[10px]">
                edit
              </Badge>
            )}
            {(
              meta.attachedDocuments as
                | { id: string; filename: string; storageUrl?: string | null }[]
                | undefined
            )?.map((d) => (
              <Badge key={d.id} variant="outline" className="text-[10px]">
                <button
                  onClick={() =>
                    d.storageUrl &&
                    window.open(d.storageUrl, "_blank", "noopener")
                  }
                  className="flex items-center gap-1"
                  aria-label={`Open ${d.filename}`}
                >
                  <FileText className="h-2.5 w-2.5" />
                  {d.filename}
                </button>
              </Badge>
            ))}
          </div>
        </div>
      </div>

      {/* Assistant turn — image or text reply inline in the thread */}
      <div className="flex flex-col items-start gap-2">
        {generation.status === "failed" ? (
          <div className="flex max-w-md items-start gap-2.5 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <p className="break-words text-xs leading-relaxed text-muted-foreground">
              {generation.error ?? "Generation failed"}
            </p>
          </div>
        ) : generation.status === "cancelled" &&
          !generation.textResponse &&
          !image ? (
          <div className="flex items-center gap-2 rounded-xl border px-4 py-3 text-xs text-muted-foreground">
            <Square className="h-3.5 w-3.5" /> Stopped
          </div>
        ) : generation.kind === "text" ? (
          generation.textResponse ? (
            <div className="max-w-[85%] sm:max-w-[75%]">
              <Markdown>{shownText}</Markdown>
              {inFlight && (
                <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse rounded-sm bg-primary/70 align-text-bottom" />
              )}
              {generation.status === "cancelled" && (
                <p className="mt-1 text-[11px] italic text-muted-foreground">
                  Stopped
                </p>
              )}
              {!inFlight && sources.length > 0 && <SourceChips sources={sources} />}
              {!inFlight && files.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {files.map((f) => (
                    <a
                      key={f.url}
                      href={downloadUrl(f)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-xs transition-colors hover:bg-accent"
                    >
                      <FileText className="h-4 w-4 shrink-0 text-primary" />
                      <span className="max-w-[16rem] truncate">{f.filename}</span>
                      <Download className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    </a>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-xl border px-4 py-3 text-xs text-muted-foreground">
              {searching ? (
                <Globe className="h-3.5 w-3.5 animate-pulse text-primary" />
              ) : (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              )}
              {searching
                ? "Searching the web…"
                : generation.status === "processing"
                  ? "Answering…"
                  : "Queued…"}
            </div>
          )
        ) : image ? (
          <button
            onClick={() => {
              select(generation.id);
              setLightboxUrl(image);
            }}
            className={cn(
              "block max-w-md overflow-hidden rounded-xl border transition-shadow hover:shadow-lg",
              active && "ring-1 ring-primary",
            )}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              ref={imgRef}
              src={image}
              alt={generation.prompt}
              className="w-full object-cover"
              loading={priority ? "eager" : "lazy"}
              fetchPriority={priority ? "high" : "auto"}
              onLoad={onImageLoad}
            />
          </button>
        ) : (
          <div className="shimmer flex aspect-square w-full max-w-md items-center justify-center rounded-xl border">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {generation.status === "processing" ? "Generating…" : "Queued…"}
            </div>
          </div>
        )}
        {images.length > 1 && (
          <div className="flex max-w-md flex-wrap gap-1.5">
            {images.map((url, i) => (
              <button
                key={url}
                onClick={() => setActiveImage(i)}
                aria-label={`Show image ${i + 1} of ${images.length}`}
                className={cn(
                  "size-12 shrink-0 overflow-hidden rounded-md border transition-shadow",
                  i === activeImage
                    ? "ring-1 ring-primary"
                    : "opacity-70 hover:opacity-100",
                )}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt="" className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
        )}
        {image && creative && generation.textResponse && (
          <div className="w-full max-w-md rounded-xl border bg-card p-4">
            <Markdown>{generation.textResponse}</Markdown>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <ActionRow generation={generation} />
          <span className="text-[10px] text-muted-foreground">
            {friendlyEngineLabel(generation.model ?? generation.provider)}
            {typeof meta.latencyMs === "number" &&
              ` · ${(meta.latencyMs / 1000).toFixed(1)}s`}
          </span>
        </div>
      </div>

      {/* Full-size preview — generated image or an attached reference */}
      {lightboxUrl && (
        <div
          ref={lightboxRef}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4"
          onClick={closeLightbox}
        >
          <button
            className="absolute right-4 top-4 rounded-md p-1.5 text-white/80 hover:text-white"
            aria-label="Close preview"
          >
            <X className="h-5 w-5" />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            ref={lightboxImgRef}
            src={lightboxUrl}
            alt={generation.prompt}
            className="max-h-[90dvh] max-w-[92vw] rounded-lg object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
});
