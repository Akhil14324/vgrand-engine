"use client";

import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
} from "react";
import {
  Building2,
  Home,
  Image as ImageIcon,
  Loader2,
  SendHorizonal,
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

const QUALITY_LABEL: Record<Quality, string> = {
  low: "Draft · low",
  medium: "Medium",
  high: "High · costly",
};

export function Composer() {
  const { armedTheme, armTheme, disarmTheme, quality, setQuality, select } =
    useStudio();
  const { data: themes } = useThemes();
  const create = useCreateGeneration();

  const [value, setValue] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [refImage, setRefImage] = useState<{ url: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const slashQuery = value.startsWith("/") ? value.slice(1) : null;
  const filtered = useMemo(() => {
    if (slashQuery === null || !themes) return [];
    const q = slashQuery.toLowerCase();
    return themes.filter(
      (t) =>
        t.slug.startsWith(q) || t.label.toLowerCase().includes(q),
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

  const uploadFile = useCallback(async (file: File) => {
    if (!file.type.startsWith("image/")) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await apiFetch<{ url: string }>("/uploads", {
        method: "POST",
        body: form,
      });
      setRefImage(res);
    } finally {
      setUploading(false);
    }
  }, []);

  const submit = useCallback(() => {
    const prompt = value.trim();
    if (!prompt || prompt === "/" || create.isPending) return;
    create.mutate(
      {
        prompt,
        themeSlug: armedTheme?.slug,
        quality,
        referenceImageUrl: refImage?.url,
      },
      {
        onSuccess: (res) => {
          setValue("");
          setRefImage(null);
          select(res.generationId);
        },
      },
    );
  }, [value, create, armedTheme, quality, refImage, select]);

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
    const file = e.dataTransfer.files[0];
    if (file) void uploadFile(file);
  };

  const providerLabel = armedTheme
    ? ((armedTheme.styleGuide?.preferredProvider as string | undefined) ??
      "gpt-image-2.5")
    : refImage
      ? "gpt-image-2.5-sunburst"
      : "gpt-image-2.5-flare";

  return (
    <div
      className={cn(
        "border-t bg-background p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] transition-colors sm:p-4",
        dragging && "bg-accent/40",
      )}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <div className="mx-auto w-full max-w-3xl">
        <div className="rounded-xl border bg-card shadow-sm transition-shadow focus-within:ring-1 focus-within:ring-ring">
          {(armedTheme || refImage || uploading) && (
            <div className="flex flex-wrap items-center gap-2 px-3 pt-3">
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
              {uploading && (
                <Badge variant="muted" className="gap-1.5">
                  <Loader2 className="h-3 w-3 animate-spin" /> uploading…
                </Badge>
              )}
              {refImage && (
                <Badge variant="secondary" className="gap-1.5 pr-1">
                  <ImageIcon className="h-3 w-3" /> reference attached
                  <button
                    onClick={() => setRefImage(null)}
                    className="rounded-full p-0.5 hover:bg-accent"
                    aria-label="Remove reference"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              )}
            </div>
          )}

          <Popover open={menuOpen && filtered.length > 0}>
            <PopoverAnchor asChild>
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
                  const file = e.clipboardData.files[0];
                  if (file) {
                    e.preventDefault();
                    void uploadFile(file);
                  }
                }}
                placeholder={
                  armedTheme
                    ? `Describe your ${armedTheme.label.toLowerCase()} idea…`
                    : "Describe an image, or type / to arm a theme…"
                }
                className="min-h-[72px] resize-none border-0 shadow-none focus-visible:ring-0"
              />
            </PopoverAnchor>
            <PopoverContent
              align="start"
              side="top"
              className="w-[--radix-popover-trigger-width] min-w-64 p-1"
              onOpenAutoFocus={(e) => e.preventDefault()}
            >
              <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                Themes
              </div>
              {filtered.map((t, i) => {
                const Icon =
                  (t.icon && THEME_ICONS[t.icon]) || Sparkles;
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

          <div className="flex flex-wrap items-center justify-between gap-2 px-3 pb-2.5">
            <div className="flex min-w-0 items-center gap-2">
              <Badge variant="muted" className="font-mono text-[10px]">
                {providerLabel}
              </Badge>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
                    {QUALITY_LABEL[quality]}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
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
            </div>
            <Button
              size="sm"
              onClick={submit}
              disabled={!value.trim() || value === "/" || create.isPending}
            >
              {create.isPending ? (
                <Loader2 className="animate-spin" />
              ) : (
                <SendHorizonal />
              )}
              Generate
            </Button>
          </div>
        </div>
        <p className="mt-2 text-center text-[11px] text-muted-foreground">
          <kbd className="rounded border px-1 font-mono">/</kbd> arm a theme ·
          drop or paste an image to edit it ·{" "}
          <kbd className="rounded border px-1 font-mono">Enter</kbd> to generate
        </p>
        {create.isError && (
          <p className="mt-1 text-center text-xs text-destructive">
            {create.error.message}
          </p>
        )}
      </div>
    </div>
  );
}
