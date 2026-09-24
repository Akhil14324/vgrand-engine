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
  Globe,
  Megaphone,
  Store,
  Square,
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
import type { DocumentDto, GenerationDto, Quality, ThemeDto } from "@catgpt/types";
import { apiFetch, ApiRequestError } from "@/lib/api";
import { MAX_UPLOAD_MB } from "@/lib/config";
import {
  useAddBrandAsset,
  useBrands,
  useCancelGeneration,
  useCreateGeneration,
  useDocuments,
  useGenerations,
  useThemes,
} from "@/lib/hooks";
import { resolveActiveBrand, useBrandMode } from "@/lib/brand-mode";
import { useStudio } from "@/lib/store";
import { cn } from "@/lib/utils";
import { Badge, badgeVariants } from "@/components/ui/badge";
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

type MenuItem = { type: "campaign" } | { type: "theme"; theme: ThemeDto };

const QUALITY_LABEL: Record<Quality, string> = {
  low: "Draft · low",
  medium: "Medium",
  high: "High · costly",
};

/** Rotating idle placeholders — quietly demo what the composer can do. */
const PLACEHOLDERS = [
  "Ask anything, or 'create an image of…'",
  "Create an image of a neon diner at dusk…",
  "Type /campaign to plan a product launch…",
  "Drop a PDF or Word doc to ask about it…",
];

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
    pendingTurn,
    setPendingTurn,
    resolvePendingTurn,
    clearPendingTurn,
    workspaceContextId,
  } = useStudio();
  const { data: themes } = useThemes();
  const create = useCreateGeneration();
  // Brand toggle: on = answers and images use the brand; off = common answers.
  const { data: brands } = useBrands();
  const { brandId: chosenBrand, setBrandId, draft, setDraft } = useBrandMode();
  const activeBrand = resolveActiveBrand(brands, chosenBrand);
  const addBrandAsset = useAddBrandAsset();

  const [value, setValue] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [refImages, setRefImages] = useState<string[]>([]);
  const [docs, setDocs] = useState<DocumentDto[]>([]);
  // One-shot "search the web for this message" toggle; time-sensitive
  // questions are also detected server-side without it.
  const [webSearch, setWebSearch] = useState(false);
  const cancel = useCancelGeneration();
  // The in-flight generation for this chat — drives the Send -> Stop swap.
  const { data: genPage } = useGenerations({
    conversationId: activeConversationId,
  });
  const runningId = useMemo(() => {
    const inFlight = (g: GenerationDto) =>
      g.status === "pending" || g.status === "processing";
    if (pendingTurn?.generationId) {
      const g = genPage?.items.find((x) => x.id === pendingTurn.generationId);
      // Not in the cached list yet = the POST just resolved; assume running.
      if (!g || inFlight(g)) return pendingTurn.generationId;
    }
    return genPage?.items.find(inFlight)?.id ?? null;
  }, [genPage, pendingTurn]);

  // Text handed over from another page (e.g. Brand -> "Build my sales strategy").
  useEffect(() => {
    if (draft !== null) {
      setValue(draft);
      setDraft(null);
      textareaRef.current?.focus();
    }
  }, [draft, setDraft]);
  const [uploading, setUploading] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [listening, setListening] = useState(false);
  // Not-yet-final speech transcript, shown live while dictating.
  const [interim, setInterim] = useState("");
  const [phIndex, setPhIndex] = useState(0);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const recRef = useRef<{ stop: () => void } | null>(null);

  // PDFs already attached to this chat (uploaded on earlier turns).
  const { data: conversationDocs } = useDocuments(activeConversationId);

  // Browser speech recognition (Chrome/Edge/Safari) — zero API cost.
  // Detected post-mount: reading `window` during render would diverge from
  // the server HTML (no mic → mic) and break hydration.
  const [speechSupported, setSpeechSupported] = useState(false);
  useEffect(() => {
    setSpeechSupported(
      "SpeechRecognition" in window || "webkitSpeechRecognition" in window,
    );
  }, []);

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
      let interimText = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        if (ev.results[i]!.isFinal) final += ev.results[i]![0]!.transcript;
        else interimText += ev.results[i]![0]!.transcript;
      }
      if (final) {
        setValue((v) => (v ? v.replace(/\s+$/, "") + " " : "") + final.trim());
      }
      setInterim(interimText);
    };
    rec.onend = () => {
      setListening(false);
      setInterim("");
    };
    rec.onerror = () => {
      setListening(false);
      setInterim("");
    };
    rec.start();
    recRef.current = rec;
    setListening(true);
  }, [listening]);

  // Stop dictation if the composer unmounts mid-recording.
  useEffect(() => () => recRef.current?.stop(), []);

  // Cycle the idle placeholder every few seconds (skipped once typing).
  useEffect(() => {
    const t = setInterval(() => setPhIndex((i) => i + 1), 4000);
    return () => clearInterval(t);
  }, []);

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
  const filtered = useMemo<MenuItem[]>(() => {
    if (slashQuery === null) return [];
    const q = slashQuery.toLowerCase();
    const items: MenuItem[] = [];
    // /campaign is a command, not a theme — offered only while it is still
    // being typed (no space yet), so "/campaign sell honey" doesn't reopen it.
    if (!/\s/.test(q) && "campaign".startsWith(q)) items.push({ type: "campaign" });
    for (const t of themes ?? []) {
      if (t.slug.startsWith(q) || t.label.toLowerCase().includes(q)) {
        items.push({ type: "theme", theme: t });
      }
    }
    return items;
  }, [slashQuery, themes]);

  const pick = useCallback(
    (item: MenuItem) => {
      if (item.type === "campaign") {
        setValue("/campaign ");
      } else {
        armTheme(item.theme);
        setValue("");
      }
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
            // In brand mode the file also joins the brand's memory, so later
            // chats can use it. Fields must precede the file in multipart.
            if (activeBrand && isDocFile(file.type)) {
              form.append("brandId", activeBrand.id);
            }
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
              if (activeBrand) {
                // Best-effort: hitting the 20-image cap must not block the message.
                addBrandAsset.mutate({
                  brandId: activeBrand.id,
                  url: res.url,
                  kind: "reference",
                  label: file.name,
                });
              }
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
    [refImages.length, docs.length, activeBrand, addBrandAsset],
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
    setWebSearch(false);

    create.mutate(
      {
        prompt,
        themeSlug: armedTheme?.slug,
        quality,
        referenceImageUrls: refImages.length ? refImages : undefined,
        documentIds: docs.length ? docs.map((d) => d.id) : undefined,
        webSearch: webSearch || undefined,
        brandId: activeBrand?.id,
        conversationId: activeConversationId ?? undefined,
        // Only relevant on the first send — it gives the new conversation a
        // durable workspace home (server ignores it on existing chats).
        workspaceId: activeConversationId
          ? undefined
          : (workspaceContextId ?? undefined),
      },
      {
        onSuccess: (res) => {
          // Keep the bubble until the real turn shows up in the feed.
          resolvePendingTurn(res.conversationId, res.generationId);
          openConversation(res.conversationId);
          select(res.generationId);
        },
        onError: () => {
          // Send failed — give the draft back instead of losing it.
          clearPendingTurn();
          setValue(value);
          setRefImages(refImages);
          setDocs(docs);
          setWebSearch(webSearch);
        },
      },
    );
  }, [value, create, armedTheme, quality, webSearch, activeBrand, refImages, docs, activeConversationId, openConversation, select, setPendingTurn, resolvePendingTurn, clearPendingTurn, workspaceContextId]);

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
        <div className="mx-auto mb-1.5 flex max-w-4xl items-center gap-1.5 px-3 text-[11px] text-muted-foreground">
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
              "mx-auto w-full max-w-4xl rounded-[28px] border bg-card px-2.5 py-2 shadow-lg transition-shadow focus-within:ring-1 focus-within:ring-ring",
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

            {listening && (
              <div className="flex items-center gap-2.5 px-3 pt-1 text-xs text-muted-foreground animate-fade-in">
                <span className="flex h-3.5 shrink-0 items-center gap-[3px]">
                  {[0, 1, 2, 3, 4].map((i) => (
                    <span
                      key={i}
                      className="h-3 w-[3px] animate-wave rounded-full bg-primary"
                      style={{ animationDelay: `${i * 120}ms` }}
                    />
                  ))}
                </span>
                <span className="min-w-0 flex-1 truncate italic">
                  {interim || "Listening…"}
                </span>
              </div>
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
                  ? `Create an image of… (${armedTheme.label} styling)`
                  : PLACEHOLDERS[phIndex % PLACEHOLDERS.length]
              }
              rows={1}
              className="max-h-[168px] min-h-[44px] w-full resize-none overflow-y-auto border-0 bg-transparent px-2.5 py-2 leading-6 shadow-none focus-visible:ring-0"
            />

            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 shrink-0 rounded-full text-muted-foreground"
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
                    "h-9 w-9 shrink-0 rounded-full",
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

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label="Model and image quality"
                    title="Model — click to set image quality"
                    className={cn(
                      badgeVariants({ variant: "muted" }),
                      "ml-1 hidden shrink-0 font-mono text-[10px] hover:bg-accent hover:text-foreground sm:inline-flex",
                    )}
                  >
                    {providerLabel} · {quality}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuLabel>Image quality</DropdownMenuLabel>
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

              <div className="ml-auto flex shrink-0 items-center gap-1">
                {brands && brands.length > 0 && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        aria-label="Brand mode"
                        title={
                          activeBrand
                            ? `Brand mode: ${activeBrand.name}`
                            : "Brand mode off"
                        }
                        className={cn(
                          "flex max-w-[9rem] items-center gap-1 rounded-full px-2.5 py-1.5 text-xs transition-colors hover:bg-accent",
                          activeBrand
                            ? "bg-primary/15 text-primary"
                            : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        <Store className="h-3.5 w-3.5 shrink-0" />
                        <span className="hidden truncate lg:inline">
                          {activeBrand ? activeBrand.name : "Brand off"}
                        </span>
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuLabel>Answer as…</DropdownMenuLabel>
                      <DropdownMenuItem onClick={() => setBrandId(null)}>
                        Common answer (brand off)
                        {!activeBrand && (
                          <span className="ml-auto text-primary">●</span>
                        )}
                      </DropdownMenuItem>
                      {brands.map((b) => (
                        <DropdownMenuItem key={b.id} onClick={() => setBrandId(b.id)}>
                          {b.name}
                          {activeBrand?.id === b.id && (
                            <span className="ml-auto text-primary">●</span>
                          )}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
                <button
                  type="button"
                  onClick={() => setWebSearch((v) => !v)}
                  aria-pressed={webSearch}
                  aria-label="Search the web for this message"
                  title="Search the web"
                  className={cn(
                    "flex items-center gap-1 rounded-full px-2.5 py-1.5 text-xs transition-colors hover:bg-accent",
                    webSearch
                      ? "bg-primary/15 text-primary"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Globe className="h-3.5 w-3.5" />
                  <span className="hidden lg:inline">Search</span>
                </button>
                {runningId ? (
                  <Button
                    size="icon"
                    onClick={() => cancel.mutate(runningId)}
                    disabled={cancel.isPending}
                    className="h-9 w-9 rounded-full"
                    aria-label="Stop generating"
                    title="Stop"
                  >
                    {cancel.isPending ? (
                      <Loader2 className="animate-spin" />
                    ) : (
                      <Square className="fill-current" />
                    )}
                  </Button>
                ) : (
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
                )}
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
            Commands &amp; themes
          </div>
          {filtered.map((item, i) => {
            const isCampaign = item.type === "campaign";
            const t = item.type === "theme" ? item.theme : null;
            const Icon = isCampaign
              ? Megaphone
              : (t?.icon && THEME_ICONS[t.icon]) || Sparkles;
            const description = isCampaign
              ? "Plan a sales campaign — strategy, metrics, copy and creatives"
              : t?.description;
            return (
              <button
                key={isCampaign ? "campaign" : t!.id}
                onMouseEnter={() => setHighlight(i)}
                onClick={() => pick(item)}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left text-sm",
                  i === highlight && "bg-accent",
                )}
              >
                <Icon className="h-4 w-4 text-muted-foreground" />
                <div className="min-w-0">
                  <div className="font-medium">
                    /{isCampaign ? "campaign" : t!.slug}
                  </div>
                  {description && (
                    <div className="truncate text-xs text-muted-foreground">
                      {description}
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </PopoverContent>
      </Popover>

      <div className="mx-auto mt-2 flex max-w-4xl items-center justify-center gap-2 text-center text-[11px] text-muted-foreground">
        <span className="hidden sm:inline">
          <kbd className="rounded border px-1 font-mono">/</kbd> themes &amp; /campaign · drop
          an image to edit or ask about it, or a PDF/Word doc to ask about ·{" "}
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
