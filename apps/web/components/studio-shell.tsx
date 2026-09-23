"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { Sidebar } from "./sidebar";
import { Composer } from "./composer";
import { GenerationFeed } from "./generation-feed";
import { DetailPanel } from "./detail-panel";

export function StudioShell() {
  const { user, loading, isDev } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user && !isDev) router.replace("/login");
  }, [loading, user, isDev, router]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="font-display text-lg text-muted-foreground">
          PromptHub
        </div>
      </div>
    );
  }
  if (!user) return null;

  return (
    <div className="grid h-screen grid-cols-1 md:grid-cols-[300px_1fr] xl:grid-cols-[300px_1fr_380px]">
      <Sidebar />
      <main className="flex min-h-0 flex-col">
        <GenerationFeed />
        <Composer />
      </main>
      <aside className="hidden min-h-0 border-l xl:block">
        <DetailPanel />
      </aside>
    </div>
  );
}
