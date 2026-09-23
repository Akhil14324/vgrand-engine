"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LayoutGrid, Menu, X } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useStudio } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Sidebar, SidebarContent } from "./sidebar";
import { Composer } from "./composer";
import { GenerationFeed } from "./generation-feed";
import { DetailPanel } from "./detail-panel";

export function StudioShell() {
  const { user, loading, isDev } = useAuth();
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { selectedId, select } = useStudio();

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
    <div className="flex h-dvh flex-col">
      {/* Mobile top bar — drawer + boards shortcuts */}
      <header className="flex items-center gap-1 border-b bg-card/60 px-2 py-2 md:hidden">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setSidebarOpen(true)}
          aria-label="Open menu"
        >
          <Menu />
        </Button>
        <span className="font-display text-base font-semibold tracking-tight">
          PromptHub
        </span>
        <Button variant="ghost" size="icon" className="ml-auto" asChild>
          <Link href="/boards" aria-label="Boards">
            <LayoutGrid />
          </Link>
        </Button>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[300px_1fr] xl:grid-cols-[300px_1fr_380px]">
        <Sidebar />
        <main className="flex min-h-0 flex-col">
          <GenerationFeed />
          <Composer />
        </main>
        <aside className="hidden min-h-0 border-l xl:block">
          <DetailPanel />
        </aside>
      </div>

      {/* Sidebar drawer — mobile only */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="absolute inset-0 bg-black/60 animate-fade-in"
            onClick={() => setSidebarOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 w-[300px] max-w-[85vw] animate-slide-in-left border-r bg-card shadow-xl">
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

      {/* Detail sheet — below xl the right column becomes an overlay:
          bottom sheet on phones, right-side panel on tablets. */}
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
