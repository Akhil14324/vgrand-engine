"use client";

import { RequireAuth } from "@/components/require-auth";
import { useEffect, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ImageIcon,
  Loader2,
  MoreHorizontal,
  Share2,
  Trash2,
} from "lucide-react";
import type { GenerationDto } from "@catgpt/types";
import { useAuth } from "@/lib/auth";
import {
  useDeleteGeneration,
  useGenerations,
  useShareGeneration,
  useThemes,
} from "@/lib/hooks";
import { useStudio } from "@/lib/store";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function LibraryView() {
  return (
    <RequireAuth>
      <LibraryContent />
    </RequireAuth>
  );
}

function LibraryContent() {
  const router = useRouter();
  const { historyTheme, setHistoryTheme, openConversation, select } =
    useStudio();
  const { data: themes } = useThemes();
  const { data, isLoading } = useGenerations({ themeSlug: historyTheme });

  // Only finished images belong here — chat replies and failures have none.
  const images = useMemo(
    () => (data?.items ?? []).filter((g) => g.imageUrls.length > 0),
    [data],
  );

  const open = (g: GenerationDto) => {
    if (g.conversationId) openConversation(g.conversationId);
    select(g.id);
    router.push("/");
  };

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex items-center gap-3 border-b px-3 py-2.5 sm:px-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/" aria-label="Back to studio">
            <ArrowLeft />
          </Link>
        </Button>
        <h1 className="font-display text-lg font-semibold tracking-tight">
          Library
        </h1>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-6">
        <div className="mx-auto max-w-6xl">
          {themes && themes.length > 0 && (
            <div className="mb-4 flex flex-wrap gap-1.5">
              <Chip
                label="All"
                active={historyTheme === null}
                onClick={() => setHistoryTheme(null)}
              />
              {themes.map((t) => (
                <Chip
                  key={t.id}
                  label={`/${t.slug}`}
                  active={historyTheme === t.slug}
                  onClick={() =>
                    setHistoryTheme(historyTheme === t.slug ? null : t.slug)
                  }
                />
              ))}
            </div>
          )}

          {isLoading ? (
            <div className="flex justify-center py-20">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : images.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-24 text-center text-muted-foreground">
              <ImageIcon className="h-8 w-8" />
              <p className="text-sm">No generated images yet.</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {images.map((g) => (
                <LibraryTile key={g.id} generation={g} onOpen={() => open(g)} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Chip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1 text-xs transition-colors",
        active
          ? "border-primary/60 bg-primary/15 text-primary"
          : "border-border text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
}

function LibraryTile({
  generation,
  onOpen,
}: {
  generation: GenerationDto;
  onOpen: () => void;
}) {
  const del = useDeleteGeneration();
  const share = useShareGeneration();
  const { select, selectedId } = useStudio();
  return (
    <div className="group relative overflow-hidden rounded-xl border bg-muted">
      <button
        onClick={onOpen}
        className="block aspect-square w-full"
        title={generation.prompt}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={generation.imageUrls[0]}
          alt={generation.prompt}
          loading="lazy"
          className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.03]"
        />
      </button>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-2 pt-8 opacity-0 transition-opacity group-hover:opacity-100">
        <p className="truncate text-xs text-white">{generation.prompt}</p>
        {generation.theme && (
          <p className="text-[10px] text-white/70">/{generation.theme.slug}</p>
        )}
      </div>
      <div className="absolute right-1.5 top-1.5 opacity-100 md:opacity-0 md:transition-opacity md:group-hover:opacity-100 md:focus-within:opacity-100">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              aria-label="Image options"
              className="rounded-md bg-black/50 p-1 text-white hover:bg-black/70"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuItem
              onClick={() =>
                share.mutate(generation.id, {
                  onSuccess: (link) =>
                    void navigator.clipboard.writeText(link.url),
                })
              }
            >
              <Share2 className="mr-2 h-3.5 w-3.5" />
              Share
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={() => {
                del.mutate(generation.id);
                if (selectedId === generation.id) select(null);
              }}
            >
              <Trash2 className="mr-2 h-3.5 w-3.5" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
