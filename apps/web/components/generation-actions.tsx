"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";
import {
  Check,
  Copy,
  Download,
  FileDown,
  Link2,
  Loader2,
  RefreshCw,
  Trash2,
  UserCheck,
  Wand2,
  X,
  Volume2,
  VolumeX,
} from "lucide-react";
import type {
  GenerationDto,
  ImageSize,
  Quality,
} from "@catgpt/types";
import {
  useBrandVoice,
  useBrands,
  useCreateApprovalLink,
  useDeleteGeneration,
  useGenerationApprovals,
  useExportPdf,
  useRevokeApprovalLink,
  useRegenerate,
  useShareGeneration,
} from "@/lib/hooks";
import { resolveActiveBrand, useBrandMode } from "@/lib/brand-mode";
import { useStudio } from "@/lib/store";
import { apiFetch, apiFetchBlob } from "@/lib/api";
import { cn } from "@/lib/utils";
import { detectSpeakLanguage } from "@/lib/voice";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { CalendarApproveButton, SocialShareButton } from "@/components/social-share";
import { ApplyBrandKitButton } from "@/components/brand-kit-section";
import { ComplianceCheckButton } from "@/components/brand-compliance";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SIZE_PRESETS,
  enlarge,
  imageDimensions,
  outpaintContain,
  resizeCover,
  saveBlob,
} from "@/lib/image-tools";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

async function downloadImage(url: string, filename: string) {
  const res = await fetch(url);
  const blob = await res.blob();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
}

const REMOVE_BG_PROMPT =
  "Remove the background completely. Keep the main subject exactly as it is - same shape, colours, details and any text - and place it on a clean, plain white background.";

async function uploadImageBlob(blob: Blob, filename: string) {
  const form = new FormData();
  form.append("file", blob, filename);
  return apiFetch<{ url: string }>("/uploads", { method: "POST", body: form });
}

function InpaintDialog({
  generation,
  open,
  onOpenChange,
}: {
  generation: GenerationDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const url = generation.imageUrls[0]!;
  const regenerate = useRegenerate();
  const { select } = useStudio();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const maskRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const hasStrokeRef = useRef(false);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void fetch(url)
      .then(async (res) => createImageBitmap(await res.blob()))
      .then((img) => {
        if (cancelled) return;
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.width = img.width;
        canvas.height = img.height;
        canvas.getContext("2d")?.clearRect(0, 0, img.width, img.height);
        const mask = document.createElement("canvas");
        mask.width = img.width;
        mask.height = img.height;
        const maskCtx = mask.getContext("2d");
        if (maskCtx) {
          maskCtx.fillStyle = "#000";
          maskCtx.fillRect(0, 0, img.width, img.height);
        }
        maskRef.current = mask;
        hasStrokeRef.current = false;
        img.close();
      })
      .catch(() => setError("Could not load the image for masking"));
    return () => {
      cancelled = true;
      drawingRef.current = false;
    };
  }, [open, url]);

  const canvasPoint = (e: PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * canvas.height,
      radius: Math.max(10, (24 * canvas.width) / Math.max(1, rect.width)),
    };
  };

  const drawAt = (e: PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const mask = maskRef.current;
    const ctx = canvas?.getContext("2d");
    const maskCtx = mask?.getContext("2d");
    if (!canvas || !mask || !ctx || !maskCtx) return;
    const p = canvasPoint(e);
    for (const [target, style] of [
      [ctx, "rgba(239,68,68,0.45)"],
      [maskCtx, "#fff"],
    ] as const) {
      target.lineWidth = p.radius;
      target.lineCap = "round";
      target.lineJoin = "round";
      target.strokeStyle = style;
      target.globalCompositeOperation =
        target === maskCtx ? "destination-out" : "source-over";
      target.lineTo(p.x, p.y);
      target.stroke();
      target.beginPath();
      target.moveTo(p.x, p.y);
    }
    hasStrokeRef.current = true;
  };

  const beginStroke = (e: PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drawingRef.current = true;
    const canvas = canvasRef.current;
    const mask = maskRef.current;
    const p = canvasPoint(e);
    for (const ctx of [canvas?.getContext("2d"), mask?.getContext("2d")]) {
      ctx?.beginPath();
      ctx?.moveTo(p.x, p.y);
    }
    drawAt(e);
  };

  const submit = async () => {
    if (!hasStrokeRef.current || !maskRef.current) {
      setError("Paint over the area to change first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const maskBlob = await new Promise<Blob>((resolve, reject) =>
        maskRef.current!.toBlob(
          (blob) => (blob ? resolve(blob) : reject(new Error("Could not export mask"))),
          "image/png",
        ),
      );
      const uploaded = await uploadImageBlob(maskBlob, "mask.png");
      regenerate.mutate(
        {
          id: generation.id,
          prompt:
            prompt.trim() ||
            "Replace the painted area in a way that matches the rest of the image.",
          operation: "inpaint",
          maskImageUrl: uploaded.url,
          quality: "medium",
        },
        {
          onSuccess: (res) => {
            onOpenChange(false);
            select(res.generationId);
          },
          onError: (e) => setError(e.message),
        },
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not prepare mask");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Edit selected area</DialogTitle>
          <DialogDescription>
            Paint over the part to change, then describe the replacement. The
            transparent mask area is sent to the image model.
          </DialogDescription>
        </DialogHeader>
        <div className="relative mx-auto w-fit max-w-full overflow-hidden rounded-lg border">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt={generation.prompt}
            className="max-h-[48vh] w-auto max-w-full"
          />
          <canvas
            ref={canvasRef}
            className="absolute inset-0 h-full w-full cursor-crosshair touch-none"
            onPointerDown={beginStroke}
            onPointerMove={(e) => {
              if (drawingRef.current) drawAt(e);
            }}
            onPointerUp={() => {
              drawingRef.current = false;
            }}
            onPointerCancel={() => {
              drawingRef.current = false;
            }}
          />
        </div>
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="e.g. Replace the painted background with a marble counter"
        />
        <div className="flex items-center justify-between">
          <Button
            variant="ghost"
            onClick={() => {
              const canvas = canvasRef.current;
              const mask = maskRef.current;
              canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
              const ctx = mask?.getContext("2d");
              if (ctx && mask) {
                ctx.globalCompositeOperation = "source-over";
                ctx.fillStyle = "#000";
                ctx.fillRect(0, 0, mask.width, mask.height);
              }
              hasStrokeRef.current = false;
            }}
          >
            Clear mask
          </Button>
          <Button onClick={submit} disabled={busy || regenerate.isPending}>
            {busy || regenerate.isPending ? (
              <Loader2 className="animate-spin" />
            ) : (
              <Wand2 />
            )}
            Apply edit
          </Button>
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </DialogContent>
    </Dialog>
  );
}

const OUTPAINT_SIZES: { value: ImageSize; label: string }[] = [
  { value: "1024x1024", label: "Square" },
  { value: "1536x1024", label: "Wide" },
  { value: "1024x1536", label: "Tall" },
  { value: "1088x1360", label: "Instagram portrait" },
];

function OutpaintDialog({
  generation,
  open,
  onOpenChange,
}: {
  generation: GenerationDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const url = generation.imageUrls[0]!;
  const regenerate = useRegenerate();
  const { select } = useStudio();
  const [size, setSize] = useState<ImageSize>("1536x1024");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const [w, h] = size.split("x").map(Number) as [number, number];
      const expanded = await outpaintContain(url, w, h);
      const uploaded = await uploadImageBlob(expanded, "outpaint.png");
      regenerate.mutate(
        {
          id: generation.id,
          prompt:
            prompt.trim() ||
            "Extend the scene naturally into the transparent border while preserving the original image.",
          operation: "outpaint",
          referenceImageUrl: uploaded.url,
          size,
          quality: "medium",
        },
        {
          onSuccess: (res) => {
            onOpenChange(false);
            select(res.generationId);
          },
          onError: (e) => setError(e.message),
        },
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not prepare canvas");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Expand image</DialogTitle>
          <DialogDescription>
            Places the image on a larger transparent canvas, then asks the model
            to fill the new border.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-2">
          {OUTPAINT_SIZES.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => setSize(item.value)}
              className={cn(
                "rounded-md border px-3 py-2 text-sm",
                size === item.value
                  ? "border-primary bg-primary/15 text-primary"
                  : "text-muted-foreground",
              )}
            >
              {item.label}
              <span className="block text-[10px]">{item.value}</span>
            </button>
          ))}
        </div>
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Optional: describe what should appear in the new border"
        />
        <Button onClick={submit} disabled={busy || regenerate.isPending}>
          {busy || regenerate.isPending ? (
            <Loader2 className="animate-spin" />
          ) : (
            <Wand2 />
          )}
          Expand image
        </Button>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Basic image tools. Resize and enlarge run in the browser (free, no quota);
 * AI edits run through the image provider and count as one image.
 */
function ImageTools({ generation }: { generation: GenerationDto }) {
  const regenerate = useRegenerate();
  const { select } = useStudio();
  const [busy, setBusy] = useState(false);
  const [tool, setTool] = useState<"inpaint" | "outpaint" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const url = generation.imageUrls[0]!;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Image tools" disabled={busy}>
                {busy ? <Loader2 className="animate-spin" /> : <Wand2 />}
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>Image tools</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="start">
          <DropdownMenuLabel>AI edit suite</DropdownMenuLabel>
          <DropdownMenuItem onClick={() => setTool("inpaint")}>
            Edit selected area…
            <span className="ml-auto pl-3 text-[10px] text-muted-foreground">mask</span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setTool("outpaint")}>
            Expand image…
            <span className="ml-auto pl-3 text-[10px] text-muted-foreground">canvas</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() =>
              regenerate.mutate(
                {
                  id: generation.id,
                  prompt: REMOVE_BG_PROMPT,
                  operation: "remove_background",
                  quality: "medium",
                },
                {
                  onSuccess: (res) => select(res.generationId),
                  onError: (e) => setError(e.message),
                },
              )
            }
          >
            Remove background
            <span className="ml-auto pl-3 text-[10px] text-muted-foreground">1 image</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() =>
              run(async () => {
                const dims = await imageDimensions(url);
                const size: ImageSize =
                  dims.width === dims.height
                    ? "1024x1024"
                    : dims.width > dims.height
                      ? "1536x1024"
                      : "1024x1536";
                regenerate.mutate(
                  {
                    id: generation.id,
                    operation: "upscale",
                    size,
                    quality: "high",
                  },
                  {
                    onSuccess: (res) => select(res.generationId),
                    onError: (e) => setError(e.message),
                  },
                );
              })
            }
          >
            Enhance / upscale
            <span className="ml-auto pl-3 text-[10px] text-muted-foreground">1 image</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Resize and download</DropdownMenuLabel>
          {SIZE_PRESETS.map((p) => (
            <DropdownMenuItem
              key={p.id}
              onClick={() =>
                run(async () =>
                  saveBlob(await resizeCover(url, p.w, p.h), `catgpt-${p.id}-${p.w}x${p.h}.png`),
                )
              }
            >
              {p.label}
              <span className="ml-auto pl-3 text-[10px] text-muted-foreground">
                {p.w}×{p.h}
              </span>
            </DropdownMenuItem>
          ))}
          <DropdownMenuItem
            onClick={() =>
              run(async () => saveBlob(await enlarge(url), `catgpt-${generation.id}-2x.png`))
            }
          >
            Enlarge 2× and download
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <InpaintDialog
        generation={generation}
        open={tool === "inpaint"}
        onOpenChange={(open) => setTool(open ? "inpaint" : null)}
      />
      <OutpaintDialog
        generation={generation}
        open={tool === "outpaint"}
        onOpenChange={(open) => setTool(open ? "outpaint" : null)}
      />
      {error && <span className="px-1 text-[11px] text-destructive">{error}</span>}
    </>
  );
}

export function RegenerateButton({ generation }: { generation: GenerationDto }) {
  const regenerate = useRegenerate();
  const { select } = useStudio();
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState(generation.prompt);
  const [quality, setQuality] = useState<Quality>("medium");

  const run = () => {
    regenerate.mutate(
      { id: generation.id, prompt: prompt.trim() || undefined, quality },
      {
        onSuccess: (res) => {
          setOpen(false);
          select(res.generationId);
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DialogTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Regenerate">
              <RefreshCw />
            </Button>
          </DialogTrigger>
        </TooltipTrigger>
        <TooltipContent>Edit & regenerate</TooltipContent>
      </Tooltip>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit & regenerate</DialogTitle>
          <DialogDescription>
            Runs on gpt-image-2.5-sunburst — keeps the current image intact and
            changes only what you describe.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          className="min-h-[100px]"
          placeholder="e.g. same layout, but change the offer to 30% off"
        />
        <div className="flex items-center justify-between">
          <div className="flex gap-1">
            {(["low", "medium", "high"] as Quality[]).map((q) => (
              <button
                key={q}
                onClick={() => setQuality(q)}
                className={cn(
                  "rounded-md border px-2 py-1 text-xs capitalize transition-colors",
                  quality === q
                    ? "border-primary/60 bg-primary/15 text-primary"
                    : "border-border text-muted-foreground",
                )}
              >
                {q}
              </button>
            ))}
          </div>
          <Button onClick={run} disabled={regenerate.isPending}>
            {regenerate.isPending ? (
              <Loader2 className="animate-spin" />
            ) : (
              <RefreshCw />
            )}
            Regenerate
          </Button>
        </div>
        {regenerate.isError && (
          <p className="text-xs text-destructive">{regenerate.error.message}</p>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ApprovalMenu({ generation }: { generation: GenerationDto }) {
  const [open, setOpen] = useState(false);
  const approvals = useGenerationApprovals(generation.id, open);
  const create = useCreateApprovalLink();
  const revoke = useRevokeApprovalLink();
  const [copied, setCopied] = useState<string | null>(null);
  const items = approvals.data ?? [];
  const active = items.filter((item) => !item.revokedAt);

  const copy = (url: string, key: string) => {
    void navigator.clipboard.writeText(url);
    setCopied(key);
    setTimeout(() => setCopied(null), 1500);
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Client approval links"
            >
              <UserCheck />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>
          {active.length
            ? `${active.filter((i) => i.status === "approved").length} approved · ${active.length} links`
            : "Client approval links"}
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start" className="w-80">
        <DropdownMenuLabel>Client approvals</DropdownMenuLabel>
        <DropdownMenuItem
          onClick={() =>
            create.mutate(
              { generationId: generation.id },
              { onSuccess: (link) => copy(link.url, "new") },
            )
          }
        >
          Create and copy link
          {copied === "new" ? (
            <Check className="ml-auto text-primary" />
          ) : create.isPending ? (
            <Loader2 className="ml-auto animate-spin" />
          ) : null}
        </DropdownMenuItem>
        {items.length > 0 && <DropdownMenuSeparator />}
        {items.map((item) => (
          <div key={item.id} className="px-2 py-1.5 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium capitalize">
                {item.status.replaceAll("_", " ")}
              </span>
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  aria-label="Copy approval link"
                  onClick={() => copy(item.url, item.id)}
                >
                  {copied === item.id ? (
                    <Check className="h-3 w-3 text-primary" />
                  ) : (
                    <Link2 className="h-3 w-3" />
                  )}
                </Button>
                {!item.revokedAt && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    aria-label="Revoke approval link"
                    onClick={() =>
                      revoke.mutate({
                        generationId: generation.id,
                        approvalId: item.id,
                      })
                    }
                  >
                    <X className="h-3 w-3" />
                  </Button>
                )}
              </div>
            </div>
            <p className="text-muted-foreground">
              {item.reviewerName || "Client"}
              {item.respondedAt
                ? ` · ${new Date(item.respondedAt).toLocaleDateString()}`
                : item.revokedAt
                  ? " · revoked"
                  : " · waiting"}
            </p>
            {item.comment && (
              <p className="mt-1 line-clamp-2 text-muted-foreground">
                “{item.comment}”
              </p>
            )}
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ActionRow({
  generation,
  className,
}: {
  generation: GenerationDto;
  className?: string;
}) {
  const share = useShareGeneration();
  const del = useDeleteGeneration();
  const exportPdf = useExportPdf();
  const { select, selectedId } = useStudio();
  const [copied, setCopied] = useState(false);
  const [textCopied, setTextCopied] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [voiceLoading, setVoiceLoading] = useState(false);
  const [defaultVoiceNote, setDefaultVoiceNote] = useState(false);
  const [brandVoiceNote, setBrandVoiceNote] = useState(false);
  const [voicePlaybackBlocked, setVoicePlaybackBlocked] = useState(false);
  const speakAudioRef = useRef<HTMLAudioElement | null>(null);
  const brandAudioCacheRef = useRef(new Map<string, Blob>());
  const metadataBrandId =
    typeof generation.metadata?.brandId === "string"
      ? generation.metadata.brandId
      : null;
  const { data: brands, isLoading: brandsLoading } = useBrands();
  const { brandId: chosenBrand } = useBrandMode();
  const brandId =
    metadataBrandId ?? resolveActiveBrand(brands, chosenBrand)?.id ?? null;
  const { data: brandVoiceInfo, isLoading: brandVoiceLoading } = useBrandVoice(brandId);
  const brandSelectionLoading = !metadataBrandId && brandsLoading;
  // Bumped on manual stop — cloned speech takes tens of seconds, so an
  // in-flight fetch must not start (or fall back to TTS) after a cancel.
  const speakTurn = useRef(0);
  // Post-mount detection — a render-time `window` read would diverge from
  // server HTML and break hydration (React #418).
  const [canSpeak, setCanSpeak] = useState(false);
  useEffect(() => setCanSpeak("speechSynthesis" in window), []);
  useEffect(
    () => () => {
      speakAudioRef.current?.pause();
    },
    [],
  );
  const ready =
    generation.status === "completed" && generation.imageUrls.length > 0;
  const textReady =
    generation.status === "completed" &&
    generation.kind === "text" &&
    Boolean(generation.textResponse);

  // Browser TTS — instant and free. Markdown is flattened so the voice reads
  // prose, not syntax; fenced code collapses to "code block".
  const speak = () => {
    if (speaking || voiceLoading) {
      speakTurn.current++;
      speakAudioRef.current?.pause();
      speakAudioRef.current = null;
      window.speechSynthesis.cancel();
      setSpeaking(false);
      setVoiceLoading(false);
      return;
    }
    const plain = (generation.textResponse ?? "")
      .replace(/```[\s\S]*?```/g, " code block ")
      .replace(/`([^`]*)`/g, "$1")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/^#+\s*/gm, "")
      .replace(/[*_~>]/g, "")
      .replace(/\n{2,}/g, ". ")
      .slice(0, 4000);
    setDefaultVoiceNote(false);
    setBrandVoiceNote(false);
    setVoicePlaybackBlocked(false);
    const browserSpeak = () => {
      const utterance = new SpeechSynthesisUtterance(plain);
      utterance.onend = () => setSpeaking(false);
      utterance.onerror = () => setSpeaking(false);
      window.speechSynthesis.speak(utterance);
      setSpeaking(true);
    };
    const playBrandAudio = (blob: Blob, turn: number) => {
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      let revoked = false;
      const revokeUrl = () => {
        if (revoked) return;
        revoked = true;
        URL.revokeObjectURL(url);
      };
      const playbackFailed = () => {
        revokeUrl();
        if (speakTurn.current !== turn) return;
        setBrandVoiceNote(false);
        setSpeaking(false);
        setVoicePlaybackBlocked(true);
        setTimeout(() => setVoicePlaybackBlocked(false), 6000);
      };
      speakAudioRef.current = audio;
      audio.onended = () => {
        revokeUrl();
        setSpeaking(false);
      };
      audio.onerror = playbackFailed;
      audio.onpause = revokeUrl;
      void audio.play().then(
        () => {
          if (speakTurn.current !== turn) return;
          setBrandVoiceNote(true);
          setTimeout(() => setBrandVoiceNote(false), 4000);
          setSpeaking(true);
        },
        playbackFailed,
      );
    };
    // Use the saved clone only when the authenticated owner has a usable voice.
    // Match the model output language to the reply's writing system rather than
    // forcing the language used for the enrollment recording.
    const voice = brandVoiceInfo?.voice;
    if (brandId && voice?.status === "ready") {
      const readText = plain.slice(0, 1500);
      const outputLanguage = detectSpeakLanguage(
        readText,
        voice.sampleLanguage,
        brandVoiceInfo?.speakLanguages,
      );
      const cacheKey = JSON.stringify([
        brandId,
        voice.id,
        voice.enrolledAt ?? voice.createdAt,
        outputLanguage,
        readText,
      ]);
      const turn = ++speakTurn.current;
      const cachedAudio = brandAudioCacheRef.current.get(cacheKey);
      if (cachedAudio) {
        playBrandAudio(cachedAudio, turn);
        return;
      }
      setVoiceLoading(true);
      apiFetchBlob(`/brands/${brandId}/voice/speak`, {
        method: "POST",
        json: { text: readText, language: outputLanguage },
      })
        .then((blob) => {
          if (speakTurn.current !== turn) return; // stopped while generating
          brandAudioCacheRef.current.set(cacheKey, blob);
          if (brandAudioCacheRef.current.size > 8) {
            const oldest = brandAudioCacheRef.current.keys().next().value;
            if (oldest) brandAudioCacheRef.current.delete(oldest);
          }
          playBrandAudio(blob, turn);
        })
        .catch(() => {
          if (speakTurn.current !== turn) return; // stopped, not a failure
          setBrandVoiceNote(false);
          setDefaultVoiceNote(true);
          setTimeout(() => setDefaultVoiceNote(false), 4000);
          browserSpeak();
        })
        .finally(() => setVoiceLoading(false));
      return;
    }
    browserSpeak();
  };

  return (
    <div className={cn("flex flex-wrap items-center gap-0.5", className)}>
      {textReady && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Copy reply"
              onClick={() => {
                void navigator.clipboard.writeText(generation.textResponse!);
                setTextCopied(true);
                setTimeout(() => setTextCopied(false), 1500);
              }}
            >
              {textCopied ? <Check className="text-primary" /> : <Copy />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{textCopied ? "Copied" : "Copy reply"}</TooltipContent>
        </Tooltip>
      )}
      {textReady && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Export as PDF"
              disabled={exportPdf.isPending}
              onClick={() =>
                exportPdf.mutate(generation.id, {
                  onSuccess: ({ url }) => {
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `catgpt-${generation.id}.pdf`;
                    a.target = "_blank";
                    a.rel = "noopener noreferrer";
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                  },
                })
              }
            >
              {exportPdf.isPending ? (
                <Loader2 className="animate-spin" />
              ) : (
                <FileDown />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>Export as PDF</TooltipContent>
        </Tooltip>
      )}
      {textReady && canSpeak && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label={speaking || voiceLoading ? "Stop reading" : "Read aloud"}
              disabled={brandSelectionLoading || Boolean(brandId && brandVoiceLoading)}
              onClick={speak}
            >
              {voiceLoading ? (
                <Loader2 className="animate-spin" />
              ) : speaking ? (
                <VolumeX />
              ) : (
                <Volume2 />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {voiceLoading
              ? "Generating voice…"
              : speaking
                ? "Stop reading"
                : "Read aloud"}
          </TooltipContent>
        </Tooltip>
      )}
      {brandVoiceNote && (
        <span className="text-[10px] text-muted-foreground">brand voice</span>
      )}
      {defaultVoiceNote && (
        <span className="text-[10px] text-muted-foreground">default voice</span>
      )}
      {voicePlaybackBlocked && (
        <span className="text-[10px] text-muted-foreground">
          Saved brand audio is ready — tap Read aloud to play.
        </span>
      )}
      {ready && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Copy share link"
              onClick={() =>
                share.mutate(generation.id, {
                  onSuccess: (link) => {
                    void navigator.clipboard.writeText(link.url);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  },
                })
              }
            >
              {copied ? (
                <Check className="text-primary" />
              ) : share.isPending ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Link2 />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {copied ? "Link copied" : "Copy share link"}
          </TooltipContent>
        </Tooltip>
      )}
      {ready && <ApprovalMenu generation={generation} />}
      {ready && <ImageTools generation={generation} />}
      {ready && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Download"
              onClick={() =>
                downloadImage(
                  generation.imageUrls[0]!,
                  `catgpt-${generation.id}.png`,
                )
              }
            >
              <Download />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Download</TooltipContent>
        </Tooltip>
      )}
      {ready && <RegenerateButton generation={generation} />}
      {ready && <ApplyBrandKitButton generation={generation} />}
      {ready && <ComplianceCheckButton generation={generation} />}
      {ready && <CalendarApproveButton generation={generation} />}
      {ready && <SocialShareButton generation={generation} />}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Delete"
            className="text-muted-foreground hover:text-destructive"
            onClick={() => {
              del.mutate(generation.id);
              if (selectedId === generation.id) select(null);
            }}
          >
            <Trash2 />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Delete</TooltipContent>
      </Tooltip>
    </div>
  );
}
