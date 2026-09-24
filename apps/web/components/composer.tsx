"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
} from "react";
import {
  AlertCircle,
  ArrowUp,
  Building2,
  FileText,
  Home,
  Loader2,
  Mic,
  MicOff,
  Plus,
  Sparkles,
  UtensilsCrossed,
  X,
  type LucideIcon,
} from "lucide-react";
import type { DocumentDto, Quality, ThemeDto } from "@catgpt/types";
import { apiFetch, ApiRequestError } from "@/lib/api";
import { MAX_UPLOAD_MB } from "@/lib/config";
import { useCreateGeneration, useDocuments, useThemes } from "@/lib/hooks";
import { useStudio } from "@/lib/store";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";

const THEME_ICONS: Record<string, LucideIcon> = {
  utensils: UtensilsCrossed,
  building: Building2,
  sparkles: Sparkles,
  home: Home,
};

const MAX_REFS = 10;

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
/** Files routed to /documents for RAG — PDFs and Word docs. */
const isDocFile = (type: string) =>
  type === "application/pdf" || type === DOCX_MIME;

const QUALITY_LABEL: Record<Quality, string> = {
  low: "Draft · low",
  medium: "Medium",
  high: "High · costly",
};

export function Composer() {
  const {
    armedTheme,
    armTheme,
    disarmTheme,
    quality,
    setQuality,
    select,
    activeConversationId,
    openConversation,
    setPendingTurn,
    clearPendingTurn,
    workspaceContextId,
  } = useStudio();
  const { data: themes } = useThemes();
  const create = useCreateGeneration();

  const [value, setValue] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [refImages, setRefImages] = useState<string[]>([]);
  const [docs, setDocs] = useState<DocumentDto[]>([]);
  const [uploading, setUploading] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [listening, setListening] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const recRef = useRef<{ stop: () => void } | null>(null);

  // PDFs already attached to this chat (uploaded on earlier turns).
  const { data: conversationDocs } = useDocuments(activeConversationId);

  // Browser speech recognition (Chrome/Edge/Safari) — zero API cost.
  const speechSupported =
    typeof window !== "undefined" &&
    (("SpeechRecognition" in window || "webkitSpeechRecognition" in window) as
      | boolean
      | undefined);

  const toggleMic = useCallback(() => {
    if (listening) {
      recRef.current?.stop();
      return;
    }
    const w = window as unknown as Record<string, unknown>;
    const SR = (w.SpeechRecognition ?? w.webkitSpeechRecognition) as
      | (new () => {
          continuous: boolean;
          interimResults: boolean;
          onresult: ((e: unknown) => void) | null;
          onend: (() => void) | null;
          onerror: (() => void) | null;
          start: () => void;
          stop: () => void;
        })
      | undefined;
    if (!SR) return;
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e: unknown) => {
      const ev = e as {
        resultIndex: number;
        results: { isFinal: boolean; 0: { transcript: string } }[];
      };
      let final = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        if (ev.results[i]!.isFinal) final += ev.results[i]![0]!.transcript;
      }
      if (final) {
        setValue((v) => (v ? v.replace(/\s+$/, "") + " " : "") + final.trim());
      }
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    rec.start();
    recRef.current = rec;
    setListening(true);
  }, [listening]);

  // Stop dictation if the composer unmounts mid-recording.
  useEffect(() => () => recRef.current?.stop(), []);

  // Auto-grow the textarea: one line at rest, expands with content up to
  // ~7 lines (168px), then scrolls — same behavior as ChatGPT/Claude.
  const autosize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 168)}px`;
  }, []);
  useEffect(autosize, [value, autosize]);

  const slashQuery = value.startsWith("/") ? value.slice(1) : null;
  const filtered = useMemo(() => {
    if (slashQuery === null || !themes) return [];
    const q = slashQuery.toLowerCase();
    return themes.filter(
      (t) => t.slug.startsWith(q) || t.label.toLowerCase().includes(q),
    );
  }, [slashQuery, themes]);

  const pick = useCallback(
    (theme: ThemeDto) => {
      armTheme(theme);
      setValue("");
      setMenuOpen(false);
      setHighlight(0);
      textareaRef.current?.focus();
    },
    [armTheme],
  );

  // Uploads run in parallel, one request per file. Images go to /uploads
  // (reference/edit), PDFs to /documents (RAG). Caps: 10 images, 4 docs.
  const uploadFiles = useCallback(
    async (files: FileList | File[]) => {
      setUploadError(null);
      const maxBytes = MAX_UPLOAD_MB * 1024 * 1024;
      const fmtMb = (b: number) => `${(b / (1024 * 1024)).toFixed(1)} MB`;

      // Pre-validate so failures explain *why* instantly, before any upload.
      const legacy = Array.from(files).filter(
        (f) => f.type === "application/msword",
      );
      if (legacy.length) {
        setUploadError(
          "Legacy .doc isn't supported — please save as .docx and re-upload.",
        );
        return;
      }
      const rejected = Array.from(files).filter(
        (f) => !(f.type.startsWith("image/") || isDocFile(f.type)),
      );
      if (rejected.length) {
        setUploadError(
          `"${rejected[0]!.name}" isn't supported — attach images, PDFs, or Word docs only.`,
        );
        return;
      }
      const oversized = Array.from(files).filter((f) => f.size > maxBytes);
      if (oversized.length) {
        setUploadError(
          `"${oversized[0]!.name}" is ${fmtMb(oversized[0]!.size)} — the upload limit is ${MAX_UPLOAD_MB} MB.`,
        );
        return;
      }

      const list = Array.from(files);
      const images = list
        .filter((f) => f.type.startsWith("image/"))
        .slice(0, Math.max(MAX_REFS - refImages.length, 0));
      const pdfs = list
        .filter((f) => isDocFile(f.type))
        .slice(0, Math.max(4 - docs.length, 0));
      const batch = [...images, ...pdfs];
      if (list.length > batch.length) {
        setUploadError(
          `Some files were skipped — you can attach up to ${MAX_REFS} images and 4 documents per message.`,
        );
      }
      if (batch.length === 0) return;
      setUploading((n) => n + batch.length);
      await Promise.all(
        batch.map(async (file) => {
          try {
            const form = new FormData();
            form.append("file", file);
            if (isDocFile(file.type)) {
              const doc = await apiFetch<DocumentDto>("/documents", {
                method: "POST",
                body: form,
              });
              setDocs((prev) => (prev.length < 4 ? [...prev, doc] : prev));
            } else {
              const res = await apiFetch<{ url: string }>("/uploads", {
                method: "POST",
                body: form,
              });
              setRefImages((prev) =>
                prev.length < MAX_REFS ? [...prev, res.url] : prev,
              );
            }
          } catch (err) {
            // Surface the reason — one bad file shouldn't drop the batch.
            setUploadError(
              err instanceof ApiRequestError && err.status === 413
                ? `"${file.name}" exceeds the ${MAX_UPLOAD_MB} MB upload limit.`
                : err instanceof Error
                  ? err.message
                  : "Upload failed",
            );
          } finally {
            setUploading((n) => n - 1);
          }
        }),
      );
    },
    [refImages.length, docs.length],
  );

  // Attached docs ingest async now — POST /documents returns "processing",
  // so poll until each attached doc flips to ready/failed.
  useEffect(() => {
    if (!docs.some((d) => d.status === "processing")) return;
    const t = setInterval(async () => {
      try {
        const { items } = await apiFetch<{ items: DocumentDto[] }>(
          "/documents",
        );
        setDocs((prev) =>
          prev.map((d) => items.find((x) => x.id === d.id) ?? d),
        );
      } catch {
        // transient — next tick retries
      }
    }, 2000);
    return () => clearInterval(t);
  }, [docs]);

  const submit = useCallback(() => {
    // A PDF on its own is a valid send — default to a summary request.
    const prompt =
      value.trim() || (docs.length ? "Summarize the attached document." : "");
    if (!prompt || prompt === "/" || create.isPending) return;

    // Optimistic: the bubble appears the instant Send is hit — no waiting on
    // the POST → GET round-trip to see your own message.
    setPendingTurn({
      tempId: crypto.randomUUID(),
      prompt,
      refImages: [...refImages],
      docs: [...docs],
      conversationId: activeConversationId,
    });
    setValue("");
    setRefImages([]);
    setDocs([]);

    create.mutate(
      {
        prompt,
        themeSlug: armedTheme?.slug,
        quality,
        referenceImageUrls: refImages.length ? refImages : undefined,
        documentIds: docs.length ? docs.map((d) => d.id) : undefined,
        conversationId: activeConversationId ?? undefined,
        // Only relevant on the first send — it gives the new conversation a
        // durable workspace home (server ignores it on existing chats).
        workspaceId: activeConversationId
          ? undefined
          : (workspaceContextId ?? undefined),
      },
      {
        onSuccess: (res) => {
          clearPendingTurn();
          openConversation(res.conversationId);
          select(res.generationId);
        },
        onError: () => clearPendingTurn(),
      },
    );
  }, [value, create, armedTheme, quality, refImages, docs, activeConversationId, openConversation, select, setPendingTurn, clearPendingTurn, workspaceContextId]);

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (menuOpen && filtered.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlight((h) => (h + 1) % filtered.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlight((h) => (h - 1 + filtered.length) % filtered.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        pick(filtered[highlight]!);
        return;
      }
      if (e.key === "Escape") {
        setMenuOpen(false);
        return;
      }
    }
    if (
      e.key === "Enter" &&
      !e.shiftKey &&
      !e.nativeEvent.isComposing &&
      e.keyCode !== 229
    ) {
      e.preventDefault();
      submit();
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length) void uploadFiles(e.dataTransfer.files);
  };

  const providerLabel = armedTheme
    ? ((armedTheme.styleGuide?.preferredProvider as string | undefined) ??
      "gpt-image-2.5")
    : refImages.length
      ? "gpt-image-2.5-sunburst"
      : "gpt-image-2.5-flare";

  const canSend =
    (Boolean(value.trim()) || docs.length > 0) &&
    value !== "/" &&
    !create.isPending &&
    uploading === 0;

  return (
    <div
      className={cn(
        "w-full px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] transition-colors sm:px-4",
        dragging && "bg-accent/30",
      )}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <input
        ref={fileRef}
        type="file"
        accept={`image/*,application/pdf,${DOCX_MIME},application/msword,.doc,.docx`}
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files?.length) void uploadFiles(e.target.files);
          e.target.value = "";
        }}
      />

      {conversationDocs && conversationDocs.length > 0 && (
        <div className="mx-auto mb-1.5 flex max-w-3xl items-center gap-1.5 px-3 text-[11px] text-muted-foreground">
          <FileText className="h-3 w-3 shrink-0" />
          <span className="truncate">
            {conversationDocs.map((d) => d.filename).join(" · ")} — answers
            use {conversationDocs.length === 1 ? "this file" : "these files"}
          </span>
        </div>
      )}

      <Popover open={menuOpen && filtered.length > 0}>
        <PopoverAnchor asChild>
          <div
            className={cn(
              "mx-auto w-full max-w-3xl rounded-[28px] border bg-card px-2.5 py-2 shadow-lg transition-shadow focus-within:ring-1 focus-within:ring-ring",
              dragging && "ring-1 ring-primary",
            )}
          >
            {(armedTheme || refImages.length > 0 || docs.length > 0 || uploading > 0) && (
              <div className="flex flex-wrap items-center gap-2 px-2 pb-1.5 pt-0.5">
                {armedTheme && (
                  <Badge variant="default" className="gap-1.5 pr-1">
                    /{armedTheme.slug}
                    <button
                      onClick={disarmTheme}
                      className="rounded-full p-0.5 hover:bg-primary/20"
                      aria-label="Clear theme"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                )}
                {uploading > 0 && (
                  <Badge variant="muted" className="gap-1.5">
                    <Loader2 className="h-3 w-3 animate-spin" /> uploading{" "}
                    {uploading}…
                  </Badge>
                )}
                {refImages.map((url, i) => (
                  <Badge key={url} variant="secondary" className="gap-1.5 py-0.5 pl-0.5 pr-1">
                    <button
                      onClick={() => setPreviewImage(url)}
                      aria-label={`Preview reference ${i + 1}`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={url}
                        alt={`reference ${i + 1}`}
                        className="h-7 w-7 rounded object-cover"
                      />
                    </button>
                    <button
                      onClick={() =>
                        setRefImages((prev) => prev.filter((u) => u !== url))
                      }
                      className="rounded-full p-0.5 hover:bg-accent"
                      aria-label={`Remove reference ${i + 1}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
                {docs.map((d) => (
                  <Badge key={d.id} variant="secondary" className="gap-1.5 pr-1">
                    <button
                      onClick={() =>
                        d.storageUrl &&
                        window.open(d.storageUrl, "_blank", "noopener")
                      }
                      className="flex items-center gap-1.5"
                      aria-label={`Open ${d.filename}`}
                      title={
                        d.status === "failed"
                          ? (d.error ?? `Couldn't read ${d.filename}`)
                          : d.status === "processing"
                            ? `Reading ${d.filename}…`
                            : d.storageUrl
                              ? `Open ${d.filename}`
                              : d.filename
                      }
                    >
                      {d.status === "processing" ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : d.status === "failed" ? (
                        <AlertCircle className="h-3 w-3 text-destructive" />
                      ) : (
                        <FileText className="h-3 w-3" />
                      )}
                      <span className="max-w-40 truncate">{d.filename}</span>
                    </button>
                    <button
                      onClick={() =>
                        setDocs((prev) => prev.filter((x) => x.id !== d.id))
                      }
                      className="rounded-full p-0.5 hover:bg-accent"
                      aria-label={`Remove ${d.filename}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}

            <div className="flex items-end gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="mb-0.5 h-9 w-9 shrink-0 rounded-full text-muted-foreground"
                onClick={() => fileRef.current?.click()}
                aria-label="Attach images or PDFs"
                title="Attach images (edit refs) or PDFs (ask questions about them)"
              >
                <Plus />
              </Button>

              {speechSupported && (
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn(
                    "mb-0.5 h-9 w-9 shrink-0 rounded-full",
                    listening
                      ? "text-destructive"
                      : "text-muted-foreground",
                  )}
                  onClick={toggleMic}
                  aria-label={listening ? "Stop dictation" : "Dictate"}
                  title={listening ? "Stop dictation" : "Dictate"}
                >
                  {listening ? (
                    <MicOff className="animate-pulse" />
                  ) : (
                    <Mic />
                  )}
                </Button>
              )}

              <Textarea
                ref={textareaRef}
                value={value}
                onChange={(e) => {
                  setValue(e.target.value);
                  setMenuOpen(e.target.value.startsWith("/"));
                  setHighlight(0);
                }}
                onKeyDown={onKeyDown}
                onPaste={(e) => {
                  if (e.clipboardData.files.length) {
                    e.preventDefault();
                    void uploadFiles(e.clipboardData.files);
                  }
                }}
                placeholder={
                  armedTheme
                    ? `Create an image of… (${armedTheme.label} styling) — / for themes`
                    : "Ask anything, or 'create an image of…' — / for themes"
                }
                rows={1}
                className="max-h-[168px] min-h-[40px] flex-1 resize-none overflow-y-auto border-0 bg-transparent py-2.5 leading-5 shadow-none focus-visible:ring-0"
              />

              <div className="mb-0.5 flex shrink-0 items-center gap-1">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="hidden rounded-full px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground sm:block">
                      {QUALITY_LABEL[quality]}
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuLabel>Quality tier</DropdownMenuLabel>
                    {(Object.keys(QUALITY_LABEL) as Quality[]).map((q) => (
                      <DropdownMenuItem key={q} onClick={() => setQuality(q)}>
                        {QUALITY_LABEL[q]}
                        {q === quality && (
                          <span className="ml-auto text-primary">●</span>
                        )}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button
                  size="icon"
                  onClick={submit}
                  disabled={!canSend}
                  className="h-9 w-9 rounded-full"
                  aria-label="Send"
                >
                  {create.isPending ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <ArrowUp />
                  )}
                </Button>
              </div>
            </div>
          </div>
        </PopoverAnchor>
        <PopoverContent
          align="start"
          side="top"
          sideOffset={8}
          className="w-[--radix-popover-trigger-width] min-w-64 p-1"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
            Themes
          </div>
          {filtered.map((t, i) => {
            const Icon = (t.icon && THEME_ICONS[t.icon]) || Sparkles;
            return (
              <button
                key={t.id}
                onMouseEnter={() => setHighlight(i)}
                onClick={() => pick(t)}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left text-sm",
                  i === highlight && "bg-accent",
                )}
              >
                <Icon className="h-4 w-4 text-muted-foreground" />
                <div className="min-w-0">
                  <div className="font-medium">/{t.slug}</div>
                  {t.description && (
                    <div className="truncate text-xs text-muted-foreground">
                      {t.description}
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </PopoverContent>
      </Popover>

      <div className="mx-auto mt-2 flex max-w-3xl items-center justify-center gap-2 text-center text-[11px] text-muted-foreground">
        <Badge variant="muted" className="font-mono text-[10px]">
          {providerLabel}
        </Badge>
        <span className="hidden sm:inline">
          <kbd className="rounded border px-1 font-mono">/</kbd> themes · drop
          an image to edit or a PDF/Word doc to ask about ·{" "}
          <kbd className="rounded border px-1 font-mono">Enter</kbd> to send
        </span>
      </div>
      {(create.isError || uploadError) && (
        <p className="mt-1 text-center text-xs text-destructive">
          {uploadError ?? create.error?.message}
        </p>
      )}

      {previewImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 animate-fade-in"
          onClick={() => setPreviewImage(null)}
        >
          <button
            className="absolute right-4 top-4 rounded-md p-1.5 text-white/80 hover:text-white"
            aria-label="Close preview"
          >
            <X className="h-5 w-5" />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={previewImage}
            alt="Reference preview"
            className="max-h-[90dvh] max-w-[92vw] rounded-lg object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
