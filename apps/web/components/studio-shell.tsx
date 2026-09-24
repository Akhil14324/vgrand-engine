"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Building2,
  Home,
  LayoutGrid,
  Megaphone,
  Menu,
  PanelLeftOpen,
  Sparkles,
  SquarePen,
  UtensilsCrossed,
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { ChatMenu } from "@/components/chat-menu";
import { PENDING_JOIN_KEY } from "@/lib/config";
import { useConversation, useThemes } from "@/lib/hooks";
import { useBrandMode } from "@/lib/brand-mode";
import { useStudio } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Sidebar, SidebarContent } from "./sidebar";
import { Composer } from "./composer";
import { GenerationFeed, PendingTurnBubble } from "./generation-feed";

const THEME_ICONS: Record<string, LucideIcon> = {
  utensils: UtensilsCrossed,
  building: Building2,
  sparkles: Sparkles,
  home: Home,
};

export function StudioShell() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { activeConversationId, sidebarCollapsed, toggleSidebar, startNewChat } =
    useStudio();
  const { data: conversation } = useConversation(activeConversationId);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
    // An invite link opened while signed out: resume it now that they are in.
    if (!loading && user) {
      try {
        const pending = localStorage.getItem(PENDING_JOIN_KEY);
        if (pending) {
          localStorage.removeItem(PENDING_JOIN_KEY);
          router.replace(`/join/${pending}`);
        }
      } catch {
        // storage unavailable - the user can reopen the link
      }
    }
  }, [loading, user, router]);

  if (loading) {
    return (
      <div className="flex h-dvh items-center justify-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/catgpt-logo.png"
          alt="CatGPT"
          className="h-14 w-auto rounded-xl bg-white object-contain px-2 py-1"
        />
      </div>
    );
  }
  if (!user) return null;

  return (
    <div className="flex h-dvh overflow-hidden">
      <Sidebar />

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Slim top bar — chat title centered, like ChatGPT's header */}
        <header className="flex h-12 shrink-0 items-center gap-2 px-3">
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0 md:hidden"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open menu"
          >
            <Menu />
          </Button>
          {/* Reopen controls when the desktop sidebar is collapsed */}
          {sidebarCollapsed && (
            <div className="hidden items-center gap-0.5 md:flex">
              <Button
                variant="ghost"
                size="icon"
                onClick={toggleSidebar}
                aria-label="Open sidebar"
              >
                <PanelLeftOpen />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={startNewChat}
                aria-label="New chat"
              >
                <SquarePen />
              </Button>
            </div>
          )}
          <div className="min-w-0 flex-1 truncate text-center text-sm font-medium">
            {conversation?.workspace ? (
              <span className="mr-2 inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 align-middle text-[10px] font-normal text-primary">
                {conversation.workspace.name}
              </span>
            ) : null}
            {conversation?.title}
          </div>
          {activeConversationId && conversation && (
            <ChatMenu conversationId={activeConversationId} title={conversation.title} />
          )}
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0 md:hidden"
            asChild
          >
            <Link href="/workspaces" aria-label="Workspaces">
              <LayoutGrid />
            </Link>
          </Button>
        </header>

        <main className="flex min-h-0 flex-1 flex-col">
          {activeConversationId ? (
            <>
              <GenerationFeed />
              <div className="border-t border-transparent">
                <Composer />
              </div>
            </>
          ) : (
            <Hero />
          )}
        </main>
      </div>

      {/* Sidebar drawer — mobile only */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="absolute inset-0 bg-black/60 animate-fade-in"
            onClick={() => setSidebarOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 w-[280px] max-w-[85vw] animate-slide-in-left border-r border-sidebar bg-sidebar shadow-xl">
            <SidebarContent onNavigate={() => setSidebarOpen(false)} />
          </div>
        </div>
      )}

    </div>
  );
}

/** Empty state — greeting + centered pill composer, like ChatGPT's home. */
function Hero() {
  const { armTheme, pendingTurn } = useStudio();
  const { setDraft } = useBrandMode();
  const { data: themes } = useThemes();
  // First message of a new chat: show it the instant Send is hit, right here,
  // until the POST resolves and the chat opens. The slot is shared with the
  // heading so Composer keeps its place in the tree (and its state).
  const sending = pendingTurn !== null && pendingTurn.conversationId === null;
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-4 pb-10">
      {sending ? (
        <div className="w-full max-w-3xl">
          <PendingTurnBubble />
        </div>
      ) : (
        <h1 className="text-gradient-brand animate-fade-in text-center font-display text-3xl font-semibold tracking-tight md:text-4xl">
          Cat is waiting for you.
        </h1>
      )}
      <div className="mt-7 w-full">
        <Composer />
      </div>
      <div
        className={`mt-5 grid w-full max-w-4xl grid-cols-1 gap-2 sm:grid-cols-3 ${sending ? "hidden" : ""}`}
      >
        {(themes ?? []).map((t) => {
          const Icon = (t.icon && THEME_ICONS[t.icon]) || Sparkles;
          return (
            <button
              key={t.id}
              onClick={() => {
                armTheme(t);
                setDraft("create an image of a ");
              }}
              className="flex items-start gap-3 rounded-xl border border-border bg-card/60 px-4 py-3 text-left transition-colors hover:border-primary/50 hover:bg-primary/5"
            >
              <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <span className="min-w-0">
                <span className="block text-sm font-medium">/{t.slug}</span>
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                  {t.description ?? t.label}
                </span>
              </span>
            </button>
          );
        })}
        <button
          onClick={() => setDraft("/campaign ")}
          className="flex items-start gap-3 rounded-xl border border-border bg-card/60 px-4 py-3 text-left transition-colors hover:border-primary/50 hover:bg-primary/5"
        >
          <Megaphone className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <span className="min-w-0">
            <span className="block text-sm font-medium">/campaign</span>
            <span className="mt-0.5 block truncate text-xs text-muted-foreground">
              Plan a sales campaign — strategy, copy, creatives
            </span>
          </span>
        </button>
      </div>
    </div>
  );
}
