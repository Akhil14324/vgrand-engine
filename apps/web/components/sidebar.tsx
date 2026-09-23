"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Building2,
  Check,
  Home,
  ImagePlus,
  LayoutGrid,
  LogOut,
  MessageSquare,
  Pencil,
  Search,
  Slash,
  Sparkles,
  Trash2,
  UtensilsCrossed,
  X,
  type LucideIcon,
} from "lucide-react";
import type { ConversationDto, GenerationDto } from "@prompthub/types";
import { useAuth } from "@/lib/auth";
import { useStudio } from "@/lib/store";
import {
  useConversations,
  useDeleteConversation,
  useDeleteMemory,
  useGenerations,
  useMemories,
  useRenameConversation,
  useThemes,
} from "@/lib/hooks";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";

const THEME_ICONS: Record<string, LucideIcon> = {
  utensils: UtensilsCrossed,
  building: Building2,
  sparkles: Sparkles,
  home: Home,
};

function ThemeIcon({ name }: { name: string | null }) {
  const Icon = (name && THEME_ICONS[name]) || Sparkles;
  return <Icon className="h-3.5 w-3.5" />;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

/** Desktop column wrapper. The same content renders inside the mobile drawer. */
export function Sidebar() {
  return (
    <aside className="hidden min-h-0 border-r md:block">
      <SidebarContent />
    </aside>
  );
}

export function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { user, signOut, isDev } = useAuth();
  const {
    armTheme,
    armedTheme,
    select,
    selectedId,
    historyTheme,
    setHistoryTheme,
    disarmTheme,
  } = useStudio();
  const { data: themes } = useThemes();
  const [tab, setTab] = useState<"chats" | "history" | "memory">("chats");
  const [search, setSearch] = useState("");
  const { data: generations } = useGenerations({ themeSlug: historyTheme });
  const { data: conversations } = useConversations();
  const { data: memories } = useMemories();
  const deleteMemory = useDeleteMemory();

  const filteredChats = useMemo(() => {
    const items = conversations?.items ?? [];
    if (!search.trim()) return items;
    const q = search.toLowerCase();
    return items.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        c.preview?.prompt.toLowerCase().includes(q),
    );
  }, [conversations, search]);

  const filtered = useMemo(() => {
    const items = generations?.items ?? [];
    if (!search.trim()) return items;
    const q = search.toLowerCase();
    return items.filter(
      (g) =>
        g.prompt.toLowerCase().includes(q) ||
        g.theme?.slug.includes(q) ||
        g.theme?.label.toLowerCase().includes(q),
    );
  }, [generations, search]);

  const newImage = () => {
    disarmTheme();
    select(null);
    onNavigate?.();
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-card">
      <div className="flex items-center justify-between px-4 pb-2 pt-4">
        <Link href="/" className="font-display text-lg font-semibold tracking-tight">
          PromptHub
        </Link>
        <Button size="sm" variant="outline" onClick={newImage}>
          <ImagePlus /> New
        </Button>
      </div>

      {/* Theme quick-launch — mirrors the composer `/` menu */}
      <div className="px-4 pb-2">
        <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Slash className="h-3 w-3" /> Themes
        </div>
        <div className="flex flex-wrap gap-1.5">
          {(themes ?? []).map((t) => (
            <button
              key={t.id}
              onClick={() => {
                armTheme(t);
                onNavigate?.();
              }}
              title={t.description ?? t.label}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors",
                armedTheme?.id === t.id
                  ? "border-primary/60 bg-primary/15 text-primary"
                  : "border-border bg-transparent text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              <ThemeIcon name={t.icon} />/{t.slug}
            </button>
          ))}
        </div>
      </div>

      <Separator />

      {/* History / Memory tabs */}
      <div className="flex items-center gap-1 px-4 py-2">
        {(["history", "memory"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "rounded-md px-2.5 py-1 text-xs font-medium capitalize transition-colors",
              tab === t
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-1">
          {tab === "history" && (
            <div className="relative">
              <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search…"
                className="h-7 w-32 pl-7 text-xs"
              />
            </div>
          )}
        </div>
      </div>

      {tab === "history" && themes && themes.length > 0 && (
        <div className="flex flex-wrap gap-1 px-4 pb-2">
          <FilterChip
            label="All"
            active={historyTheme === null}
            onClick={() => setHistoryTheme(null)}
          />
          {themes.map((t) => (
            <FilterChip
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

      <ScrollArea className="min-h-0 flex-1">
        {tab === "history" ? (
          <div className="flex flex-col gap-0.5 px-2 pb-4">
            {filtered.map((g) => (
              <HistoryRow
                key={g.id}
                generation={g}
                active={selectedId === g.id}
                onClick={() => {
                  select(g.id);
                  onNavigate?.();
                }}
              />
            ))}
            {filtered.length === 0 && (
              <p className="px-2 py-6 text-center text-xs text-muted-foreground">
                No generations yet. Type <kbd>/</kbd> in the composer to arm a
                theme, or just describe an image.
              </p>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-1.5 px-3 pb-4">
            {(memories ?? []).map((m) => (
              <div
                key={m.id}
                className="group rounded-md border bg-card/60 px-2.5 py-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <Badge variant="muted" className="text-[10px]">
                    {m.type}
                  </Badge>
                  <button
                    onClick={() => deleteMemory.mutate(m.id)}
                    className="opacity-0 transition-opacity group-hover:opacity-100"
                    aria-label="Delete memory"
                  >
                    <Trash2 className="h-3 w-3 text-muted-foreground hover:text-destructive" />
                  </button>
                </div>
                <p className="mt-1 text-xs leading-snug text-muted-foreground">
                  {m.content}
                </p>
                <p className="mt-1 text-[10px] text-muted-foreground/60">
                  {timeAgo(m.createdAt)}
                </p>
              </div>
            ))}
            {memories?.length === 0 && (
              <p className="px-2 py-6 text-center text-xs text-muted-foreground">
                Memories are recorded automatically as you generate.
              </p>
            )}
          </div>
        )}
      </ScrollArea>

      <Separator />
      <div className="flex items-center gap-2 px-4 py-3">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/boards" onClick={onNavigate}>
            <LayoutGrid /> Boards
          </Link>
        </Button>
        <div className="ml-auto flex min-w-0 items-center gap-2">
          <span className="truncate text-xs text-muted-foreground">
            {isDev ? "dev mode" : user?.email}
          </span>
          {!isDev && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => signOut()}
              aria-label="Sign out"
            >
              <LogOut />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function FilterChip({
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
        "rounded-full border px-2 py-0.5 text-[10px] transition-colors",
        active
          ? "border-primary/60 bg-primary/15 text-primary"
          : "border-border text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
}

function HistoryRow({
  generation,
  active,
  onClick,
}: {
  generation: GenerationDto;
  active: boolean;
  onClick: () => void;
}) {
  const thumb = generation.imageUrls[0];
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left transition-colors",
        active ? "bg-accent" : "hover:bg-accent/60",
      )}
    >
      <div className="h-9 w-9 shrink-0 overflow-hidden rounded-md border bg-muted">
        {thumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumb} alt="" className="h-full w-full object-cover" />
        ) : generation.status === "failed" ? (
          <div className="flex h-full items-center justify-center text-[9px] text-destructive">
            failed
          </div>
        ) : (
          <div className="shimmer h-full w-full" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs">{generation.prompt}</p>
        <div className="mt-0.5 flex items-center gap-1.5">
          {generation.theme && (
            <span className="text-[10px] text-primary">
              /{generation.theme.slug}
            </span>
          )}
          <span className="text-[10px] text-muted-foreground">
            {timeAgo(generation.createdAt)}
          </span>
          {generation.parentId && (
            <span className="text-[10px] text-muted-foreground">· edit</span>
          )}
        </div>
      </div>
    </button>
  );
}
