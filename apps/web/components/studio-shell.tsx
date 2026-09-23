"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Building2,
  Home,
  LayoutGrid,
  Menu,
  Sparkles,
  UtensilsCrossed,
  X,
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useConversation, useThemes } from "@/lib/hooks";
import { useStudio } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Sidebar, SidebarContent } from "./sidebar";
import { Composer } from "./composer";
import { GenerationFeed } from "./generation-feed";
import { DetailPanel } from "./detail-panel";

const THEME_ICONS: Record<string, LucideIcon> = {
  utensils: UtensilsCrossed,
  building: Building2,
  sparkles: Sparkles,
  home: Home,
};

export function StudioShell() {
  const { user, loading, isDev } = useAuth();
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { selectedId, select, activeConversationId } = useStudio();
  const { data: conversation } = useConversation(activeConversationId);

  useEffect(() => {
    if (!loading && !user && !isDev) router.replace("/login");
  }, [loading, user, isDev, router]);

  if (loading) {
    return (
      <div className="flex h-dvh items-center justify-center">
        <div className="font-display text-lg text-muted-foreground">
          PromptHub
        </div>
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
            className="md:hidden"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open menu"
          >
            <Menu />
          </Button>
          <div className="min-w-0 flex-1 text-center">
            {conversation && (
              <span className="truncate text-sm font-medium">
                {conversation.title}
              </span>
            )}
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            asChild
          >
            <Link href="/boards" aria-label="Library">
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

      <aside className="hidden w-[380px] shrink-0 border-l xl:block">
        <DetailPanel />
      </aside>

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
          <button
            onClick={() => setSidebarOpen(false)}
            className="absolute right-4 top-4 rounded-md p-1.5 text-white/80 hover:text-white"
            aria-label="Close menu"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      )}

      {/* Detail sheet — below xl: bottom sheet on phones, side panel on tablets */}
      {selectedId && (
        <div className="fixed inset-0 z-50 xl:hidden">
          <div
            className="absolute inset-0 bg-black/60 animate-fade-in"
            onClick={() => select(null)}
          />
          <div className="absolute inset-x-0 bottom-0 h-[85dvh] animate-slide-in-up overflow-hidden rounded-t-2xl border-t bg-card shadow-xl sm:inset-y-0 sm:left-auto sm:h-full sm:w-[440px] sm:max-w-[90vw] sm:animate-slide-in-right sm:rounded-none sm:border-l sm:border-t-0">
            <DetailPanel id={selectedId} onClose={() => select(null)} />
          </div>
        </div>
      )}
    </div>
  );
}

/** Empty state — greeting + centered pill composer, like ChatGPT's home. */
function Hero() {
  const { armTheme } = useStudio();
  const { data: themes } = useThemes();
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-4 pb-10">
      <h1 className="text-center font-display text-2xl font-medium tracking-tight md:text-3xl">
        Ready when you are.
      </h1>
      <div className="mt-7 w-full">
        <Composer />
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-center gap-1.5">
        {(themes ?? []).map((t) => {
          const Icon = (t.icon && THEME_ICONS[t.icon]) || Sparkles;
          return (
            <button
              key={t.id}
              onClick={() => armTheme(t)}
              className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <Icon className="h-3.5 w-3.5" />/{t.slug}
            </button>
          );
        })}
      </div>
    </div>
  );
}
