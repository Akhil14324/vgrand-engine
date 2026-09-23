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
  ArrowUp,
  Building2,
  Home,
  Image as ImageIcon,
  Loader2,
  Plus,
  Sparkles,
  UtensilsCrossed,
  X,
  type LucideIcon,
} from "lucide-react";
import type { Quality, ThemeDto } from "@prompthub/types";
import { apiFetch } from "@/lib/api";
import { useCreateGeneration, useThemes } from "@/lib/hooks";
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
  } = useStudio();
  const { data: themes } = useThemes();
  const create = useCreateGeneration();

  const [value, setValue] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [refImages, setRefImages] = useState<string[]>([]);
  const [uploading, setUploading] = useState(0);
  const [dragging, setDragging] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

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

  // Uploads run in parallel, one request per file; capped at MAX_REFS total.
  const uploadFiles = useCallback(
    async (files: FileList | File[]) => {
      const images = Array.from(files).filter((f) =>
        f.type.startsWith("image/"),
      );
      const batch = images.slice(0, Math.max(MAX_REFS - refImages.length, 0));
      if (batch.length === 0) return;
      setUploading((n) => n + batch.length);
      await Promise.all(
        batch.map(async (file) => {
          try {
            const form = new FormData();
            form.append("file", file);
            const res = await apiFetch<{ url: string }>("/uploads", {
              method: "POST",
              body: form,
            });
            setRefImages((prev) =>
              prev.length < MAX_REFS ? [...prev, res.url] : prev,
            );
          } catch {
            // One failed file shouldn't drop the rest of the batch.
          } finally {
            setUploading((n) => n - 1);
          }
        }),
      );
    },
    [refImages.length],
  );

  const submit = useCallback(() => {
    const prompt = value.trim();
    if (!prompt || prompt === "/" || create.isPending) return;
    create.mutate(
      {
        prompt,
        themeSlug: armedTheme?.slug,
        quality,
        referenceImageUrls: refImages.length ? refImages : undefined,
        conversationId: activeConversationId ?? undefined,
      },
      {
        onSuccess: (res) => {
          setValue("");
          setRefImages([]);
          openConversation(res.conversationId);
          select(res.generationId);
        },
      },
    );
  }, [value, create, armedTheme, quality, refImages, activeConversationId, openConversation, select]);

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
    if (e.key === "Enter" && !e.shiftKey) {
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

  const canSend = Boolean(value.trim()) && value !== "/" && !create.isPending;

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
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files?.length) void uploadFiles(e.target.files);
          e.target.value = "";
        }}
      />

      <Popover open={menuOpen && filtered.length > 0}>
        <PopoverAnchor asChild>
          <div
            className={cn(
              "mx-auto w-full max-w-3xl rounded-[28px] border bg-card px-2.5 py-2 shadow-lg transition-shadow focus-within:ring-1 focus-within:ring-ring",
              dragging && "ring-1 ring-primary",
            )}
          >
            {(armedTheme || refImages.length > 0 || uploading > 0) && (
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
                  <Badge key={url} variant="secondary" className="gap-1.5 pr-1">
                    <ImageIcon className="h-3 w-3" /> reference {i + 1}
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
              </div>
            )}

            <div className="flex items-end gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="mb-0.5 h-9 w-9 shrink-0 rounded-full text-muted-foreground"
                onClick={() => fileRef.current?.click()}
                aria-label="Attach reference images"
                title="Attach up to 10 reference images (edit mode)"
              >
                <Plus />
              </Button>

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
                    ? `Describe your ${armedTheme.label.toLowerCase()} idea…`
                    : "Ask anything, or describe an image — / for themes"
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
          an image to edit ·{" "}
          <kbd className="rounded border px-1 font-mono">Enter</kbd> to generate
        </span>
      </div>
      {create.isError && (
        <p className="mt-1 text-center text-xs text-destructive">
          {create.error.message}
        </p>
      )}
    </div>
  );
}
