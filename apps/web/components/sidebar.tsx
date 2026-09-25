"use client";

import { useDeferredValue, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Archive,
  ArchiveRestore,
  Brain,
  Check,
  ChevronDown,
  History,
  Layers,
  LayoutGrid,
  Store,
  LogOut,
  MoreHorizontal,
  PanelLeftClose,
  Pencil,
  Pin,
  PinOff,
  Search,
  Settings,
  Share2,
  Sparkles,
  SquarePen,
  Trash2,
  X,
  type LucideIcon,
} from "lucide-react";
import type { ConversationDto, GenerationDto } from "@catgpt/types";
import { useAuth } from "@/lib/auth";
import { useStudio } from "@/lib/store";
import { THEME_ICONS } from "@/lib/theme-icons";
import {
  useConversations,
  useDeleteConversation,
  useDeleteGeneration,
  useDeleteMemory,
  useGenerations,
  useMemories,
  useShareGeneration,
  useThemes,
  useUpdateConversation,
} from "@/lib/hooks";
import { ImageUsage } from "@/components/image-usage";
import { InstallButton } from "@/components/pwa";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";

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
  const collapsed = useStudio((s) => s.sidebarCollapsed);
  return (
    <aside
      className={cn(
        "hidden w-[280px] shrink-0 border-r border-sidebar bg-sidebar md:block",
        collapsed && "md:hidden",
      )}
    >
      <SidebarContent />
    </aside>
  );
}

export function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { user, signOut } = useAuth();
  const {
    armTheme,
    armedTheme,
    select,
    selectedId,
    historyTheme,
    setHistoryTheme,
    activeConversationId,
    openConversation,
    startNewChat,
    toggleSidebar,
  } = useStudio();
  const { data: themes } = useThemes();
  const [search, setSearch] = useState("");
  const [themesOpen, setThemesOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [archivedOpen, setArchivedOpen] = useState(false);
  const { data: generations } = useGenerations({ themeSlug: historyTheme });
  // Server-side search — matches title AND generation contents inside chats.
  const deferredSearch = useDeferredValue(search.trim());
  const { data: conversations } = useConversations({
    search: deferredSearch || undefined,
  });
  const { data: memories } = useMemories();
  const deleteMemory = useDeleteMemory();

  const q = search.trim().toLowerCase();

  // Already filtered server-side — history rows below stay client-filtered.
  const filteredChats = useMemo(
    () => conversations?.items ?? [],
    [conversations],
  );

  // ChatGPT-style grouping: pinned float into their own section, the rest
  // bucket by recency. All derived from updatedAt — nothing hardcoded.
  const pinnedChats = useMemo(
    () => filteredChats.filter((c) => c.pinned),
    [filteredChats],
  );
  const chatGroups = useMemo(
    () => groupChatsByRecency(filteredChats.filter((c) => !c.pinned)),
    [filteredChats],
  );

  const filtered = useMemo(() => {
    const items = generations?.items ?? [];
    if (!q) return items;
    return items.filter(
      (g) =>
        g.prompt.toLowerCase().includes(q) ||
        g.theme?.slug.includes(q) ||
        g.theme?.label.toLowerCase().includes(q),
    );
  }, [generations, q]);

  const newChat = () => {
    startNewChat();
    onNavigate?.();
  };

  const openGeneration = (g: GenerationDto) => {
    // Jump into the chat containing this generation (ChatGPT-style),
    // then highlight the card inside it.
    if (g.conversationId) openConversation(g.conversationId);
    select(g.id);
    onNavigate?.();
  };

  return (
    <div className="flex h-full min-h-0 flex-col text-sidebar-foreground">
      {/* Header — wordmark + search */}
      <div className="flex items-center justify-between px-3 pb-1 pt-3">
        <Link
          href="/"
          onClick={onNavigate}
          aria-label="CatGPT home"
          className="flex items-center gap-2"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/catgpt-logo.png"
            alt="CatGPT"
            className="h-9 w-auto rounded-lg bg-white object-contain px-1.5 py-0.5"
          />
          <span className="font-display text-lg font-semibold tracking-tight">
            CatGPT
          </span>
        </Link>
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground"
            onClick={() => {
              // In the mobile drawer this button just closes the drawer;
              // on desktop it collapses the column.
              if (onNavigate) onNavigate();
              else toggleSidebar();
            }}
            aria-label="Close sidebar"
          >
            <PanelLeftClose />
          </Button>
        </div>
      </div>

      <div className="px-3 pb-1 pt-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search chats"
            aria-label="Search chats"
            className="h-9 rounded-lg border-transparent bg-accent/50 pl-8 text-sm placeholder:text-muted-foreground/70 focus-visible:bg-accent"
          />
        </div>
      </div>

      {/* Primary nav */}
      <nav className="flex flex-col gap-0.5 px-2 pt-1">
        <NavRow icon={SquarePen} label="New chat" onClick={newChat} />
        <NavRow
          icon={LayoutGrid}
          label="Workspace"
          href="/workspaces"
          onNavigate={onNavigate}
        />
        <NavRow
          icon={Store}
          label="Brand"
          href="/brand"
          onNavigate={onNavigate}
        />
        <button
          onClick={() => setThemesOpen((v) => !v)}
          className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-sm transition-colors hover:bg-accent"
        >
          <Layers className="h-4 w-4 text-muted-foreground" />
          <span className="flex-1 text-left">Themes</span>
          <ChevronDown
            className={cn(
              "h-3.5 w-3.5 text-muted-foreground transition-transform",
              themesOpen && "rotate-180",
            )}
          />
        </button>
        {themesOpen && (
          <div className="flex flex-wrap gap-1.5 px-2.5 pb-1 pt-1">
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
            {themes?.length === 0 && (
              <p className="px-1 text-xs text-muted-foreground">
                No themes yet — seed them in packages/db.
              </p>
            )}
          </div>
        )}
      </nav>

      {/* Sections — mirrors ChatGPT's Pinned / date-grouped stacking */}
      <ScrollArea className="min-h-0 flex-1">
        {pinnedChats.length > 0 && (
          <>
            <SectionLabel icon={Pin} label="Pinned" />
            <ChatList
              items={pinnedChats}
              activeId={activeConversationId}
              onNavigate={onNavigate}
            />
          </>
        )}
        {chatGroups.map((group) => (
          <div key={group.label}>
            <SectionLabel label={group.label} />
            <ChatList
              items={group.items}
              activeId={activeConversationId}
              onNavigate={onNavigate}
            />
          </div>
        ))}
        {filteredChats.length === 0 && (
          <p className="px-5 py-4 text-xs text-muted-foreground">
            {q ? "No chats match." : "Your conversations appear here."}
          </p>
        )}
        {/* Archived chats — hidden like ChatGPT until expanded */}
        <button
          onClick={() => setArchivedOpen((v) => !v)}
          className="mx-2 mt-1 flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Archive className="h-3 w-3" />
          <span className="flex-1 text-left">Archived</span>
          <ChevronDown
            className={cn(
              "h-3 w-3 transition-transform",
              archivedOpen && "rotate-180",
            )}
          />
        </button>
        {archivedOpen && (
          <ArchivedChats
            onNavigate={onNavigate}
            activeId={activeConversationId}
          />
        )}

        <SectionToggle
          icon={History}
          label="Image history"
          open={historyOpen}
          onToggle={() => setHistoryOpen((v) => !v)}
        />
        {historyOpen && themes && themes.length > 0 && (
          <div className="flex flex-wrap gap-1 px-3 pb-2">
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
        {historyOpen && (
        <div className="flex flex-col gap-0.5 px-2">
          {filtered.map((g) => (
            <HistoryRow
              key={g.id}
              generation={g}
              active={selectedId === g.id}
              onClick={() => openGeneration(g)}
            />
          ))}
          {filtered.length === 0 && (
            <p className="px-2.5 py-4 text-xs text-muted-foreground">
              {q ? "Nothing matches." : "No generations yet."}
            </p>
          )}
        </div>
        )}

        <SectionToggle
          icon={Brain}
          label="Memory"
          open={memoryOpen}
          onToggle={() => setMemoryOpen((v) => !v)}
        />
        {memoryOpen && (
        <div className="flex flex-col gap-1.5 px-3 pb-4">
          {(memories ?? []).map((m) => (
            <div
              key={m.id}
              className="group flex gap-2.5 rounded-md border bg-card/60 p-2.5"
            >
              <div className="h-10 w-10 shrink-0 overflow-hidden rounded-md border bg-muted">
                {m.previewImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={m.previewImage}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center">
                    <Brain className="h-3.5 w-3.5 text-muted-foreground" />
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
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
                <p className="mt-1 break-words text-xs leading-snug text-muted-foreground">
                  {m.content}
                </p>
                <p className="mt-1 text-[10px] text-muted-foreground/60">
                  {timeAgo(m.createdAt)}
                </p>
              </div>
            </div>
          ))}
          {memories?.length === 0 && (
            <p className="py-4 text-xs text-muted-foreground">
              Memories are recorded automatically as you generate.
            </p>
          )}
        </div>
        )}
        <div className="h-4" />
      </ScrollArea>

      {/* Footer — user row, like ChatGPT's account row */}
      <div className="flex items-center gap-2.5 border-t border-sidebar px-3 py-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-orange-400/80 text-xs font-semibold text-primary-foreground shadow-sm">
          {(user?.name ?? user?.email ?? "?").slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm">{user?.name ?? user?.email}</p>
          <ImageUsage />
        </div>
        <InstallButton />
        <SettingsMenu onNavigate={onNavigate} />
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground"
          onClick={() => signOut()}
          aria-label="Sign out"
        >
          <LogOut />
        </Button>
      </div>
    </div>
  );
}

/** Account settings: legal pages plus a confirmed route to the data-deletion request page. */
function SettingsMenu({ onNavigate }: { onNavigate?: () => void }) {
  const router = useRouter();
  const go = (href: string) => {
    onNavigate?.();
    router.push(href);
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground"
          aria-label="Settings"
        >
          <Settings />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => go("/privacy")}>Privacy Policy</DropdownMenuItem>
        <DropdownMenuItem onClick={() => go("/terms")}>Terms of Service</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="text-destructive focus:text-destructive"
          onClick={() => {
            if (
              window.confirm(
                "Request deletion of your data?\n\nThis opens the data deletion page, where you can email a request to delete your account and everything associated with it. Nothing is deleted until you send that request.",
              )
            ) {
              go("/data-deletion");
            }
          }}
        >
          Delete my data…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function NavRow({
  icon: Icon,
  label,
  onClick,
  href,
  onNavigate,
}: {
  icon: LucideIcon;
  label: string;
  onClick?: () => void;
  href?: string;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const cls = cn(
    "flex w-full items-center gap-3 rounded-lg px-2.5 py-2.5 text-sm transition-colors hover:bg-accent",
    href && pathname.startsWith(href) && "bg-accent font-medium",
  );
  if (href) {
    return (
      <Link href={href} onClick={onNavigate} className={cls}>
        <Icon className="h-4 w-4 text-muted-foreground" />
        {label}
      </Link>
    );
  }
  return (
    <button onClick={onClick} className={cls}>
      <Icon className="h-4 w-4 text-muted-foreground" />
      {label}
    </button>
  );
}

function SectionLabel({
  icon: Icon,
  label,
}: {
  icon?: LucideIcon;
  label: string;
}) {
  return (
    <div className="flex items-center gap-1.5 px-4 pb-1.5 pt-5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80">
      {Icon && <Icon className="h-3 w-3" />}
      {label}
    </div>
  );
}

/** Secondary sections (history, memory) stay folded so chats own the column. */
function SectionToggle({
  icon: Icon,
  label,
  open,
  onToggle,
}: {
  icon: LucideIcon;
  label: string;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      aria-expanded={open}
      className="mx-2 mt-3 flex w-[calc(100%-1rem)] items-center gap-2 rounded-md px-2.5 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    >
      <Icon className="h-3.5 w-3.5" />
      <span className="flex-1 text-left">{label}</span>
      <ChevronDown
        className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")}
      />
    </button>
  );
}

/** Buckets chats into Today / Yesterday / Previous 7 days / Older. */
function groupChatsByRecency(items: ConversationDto[]) {
  const DAY = 86_400_000;
  const now = new Date();
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();
  const groups = [
    { label: "Today", items: [] as ConversationDto[] },
    { label: "Yesterday", items: [] as ConversationDto[] },
    { label: "Previous 7 days", items: [] as ConversationDto[] },
    { label: "Older", items: [] as ConversationDto[] },
  ];
  for (const c of items) {
    const t = new Date(c.updatedAt).getTime();
    if (t >= startOfToday) groups[0]!.items.push(c);
    else if (t >= startOfToday - DAY) groups[1]!.items.push(c);
    else if (t >= startOfToday - 7 * DAY) groups[2]!.items.push(c);
    else groups[3]!.items.push(c);
  }
  return groups.filter((g) => g.items.length > 0);
}

function ChatList({
  items,
  activeId,
  onNavigate,
}: {
  items: ConversationDto[];
  activeId: string | null;
  onNavigate?: () => void;
}) {
  const { openConversation } = useStudio();
  return (
    <div className="flex flex-col gap-0.5 px-2">
      {items.map((c) => (
        <ChatRow
          key={c.id}
          conversation={c}
          active={activeId === c.id}
          onClick={() => {
            openConversation(c.id);
            onNavigate?.();
          }}
        />
      ))}
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
  const del = useDeleteGeneration();
  const share = useShareGeneration();
  const { select, selectedId } = useStudio();
  return (
    <div
      className={cn(
        "group flex w-full items-center gap-1 rounded-md px-2 py-2 transition-colors",
        active ? "bg-accent" : "hover:bg-accent/60",
      )}
    >
      <button
        onClick={onClick}
        className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
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
      <div className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              aria-label="Generation options"
              className="rounded p-1 hover:bg-accent"
              onClick={(e) => e.stopPropagation()}
            >
              <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="right" className="w-40">
            <DropdownMenuItem
              disabled={!thumb}
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

function ChatRow({
  conversation,
  active,
  onClick,
}: {
  conversation: ConversationDto;
  active: boolean;
  onClick: () => void;
}) {
  const { startNewChat } = useStudio();
  const update = useUpdateConversation();
  const del = useDeleteConversation();
  const share = useShareGeneration();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(conversation.title);
  const [copied, setCopied] = useState(false);

  const copyShareLink = () => {
    const genId = conversation.preview?.id;
    if (!genId) return;
    share.mutate(genId, {
      onSuccess: (link) => {
        void navigator.clipboard.writeText(link.url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      },
    });
  };

  const commit = () => {
    setEditing(false);
    const t = title.trim();
    if (t && t !== conversation.title) {
      update.mutate({ id: conversation.id, title: t });
    } else {
      setTitle(conversation.title);
    }
  };

  return (
    <div
      className={cn(
        "group flex w-full items-center gap-1 rounded-lg px-3 py-2.5 transition-colors",
        active ? "bg-accent" : "hover:bg-accent/60",
      )}
    >
      <button
        onClick={onClick}
        className="flex min-w-0 flex-1 items-center text-left"
      >
        <div className="min-w-0 flex-1">
          {editing ? (
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commit();
                if (e.key === "Escape") {
                  setTitle(conversation.title);
                  setEditing(false);
                }
              }}
              onBlur={commit}
              onClick={(e) => e.stopPropagation()}
              className="w-full rounded border bg-background px-1 py-0.5 text-sm outline-none focus:ring-1 focus:ring-ring"
            />
          ) : (
            <p
              className="truncate text-sm leading-snug"
              title={conversation.title}
            >
              {conversation.title}
              {conversation.pinned && (
                <Pin className="ml-1 inline h-3 w-3 rotate-45 align-[-1px] text-muted-foreground" />
              )}
            </p>
          )}
        </div>
      </button>
      <div
        className={cn(
          "flex shrink-0 items-center gap-0.5 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100",
          active && "md:opacity-100",
        )}
      >
        {editing ? (
          <>
            <button
              onClick={commit}
              aria-label="Save title"
              className="rounded p-1 hover:bg-accent"
            >
              <Check className="h-3 w-3 text-primary" />
            </button>
            <button
              onClick={() => {
                setTitle(conversation.title);
                setEditing(false);
              }}
              aria-label="Cancel rename"
              className="rounded p-1 hover:bg-accent"
            >
              <X className="h-3 w-3 text-muted-foreground" />
            </button>
          </>
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                aria-label="Chat options"
                className="rounded p-1 hover:bg-accent"
                onClick={(e) => e.stopPropagation()}
              >
                {copied ? (
                  <Check className="h-4 w-4 text-primary" />
                ) : (
                  <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
                )}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="right" className="w-44">
              <DropdownMenuItem
                disabled={!conversation.preview?.imageUrl}
                onClick={copyShareLink}
              >
                <Share2 className="mr-2 h-3.5 w-3.5" />
                Share
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  setTitle(conversation.title);
                  setEditing(true);
                }}
              >
                <Pencil className="mr-2 h-3.5 w-3.5" />
                Rename
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() =>
                  update.mutate({
                    id: conversation.id,
                    pinned: !conversation.pinned,
                  })
                }
              >
                {conversation.pinned ? (
                  <PinOff className="mr-2 h-3.5 w-3.5" />
                ) : (
                  <Pin className="mr-2 h-3.5 w-3.5" />
                )}
                {conversation.pinned ? "Unpin" : "Pin"}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() =>
                  update.mutate({
                    id: conversation.id,
                    archived: !conversation.archived,
                  })
                }
              >
                {conversation.archived ? (
                  <ArchiveRestore className="mr-2 h-3.5 w-3.5" />
                ) : (
                  <Archive className="mr-2 h-3.5 w-3.5" />
                )}
                {conversation.archived ? "Unarchive" : "Archive"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() => {
                  del.mutate(conversation.id);
                  if (active) startNewChat();
                }}
              >
                <Trash2 className="mr-2 h-3.5 w-3.5" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  );
}

/** Collapsed-by-default archived chats list. */
function ArchivedChats({
  onNavigate,
  activeId,
}: {
  onNavigate?: () => void;
  activeId: string | null;
}) {
  const { data } = useConversations({ archived: true });
  const items = data?.items ?? [];
  if (items.length === 0) {
    return (
      <p className="px-5 py-2 text-xs text-muted-foreground">
        No archived chats.
      </p>
    );
  }
  return (
    <ChatList items={items} activeId={activeId} onNavigate={onNavigate} />
  );
}
