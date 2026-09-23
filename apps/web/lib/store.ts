"use client";

import { create } from "zustand";
import type { Quality, ThemeDto } from "@prompthub/types";

interface StudioState {
  /** Theme armed via the `/` menu — attached to every send until cleared. */
  armedTheme: ThemeDto | null;
  armTheme: (theme: ThemeDto) => void;
  disarmTheme: () => void;

  /** Chat currently open in the feed. null = fresh "new chat" screen. */
  activeConversationId: string | null;
  openConversation: (id: string | null) => void;
  startNewChat: () => void;

  /** Generation shown in the right-hand detail panel. */
  selectedId: string | null;
  select: (id: string | null) => void;

  /** Quality tier for the next generation ("low" default keeps cost down). */
  quality: Quality;
  setQuality: (q: Quality) => void;

  /** Desktop sidebar collapsed via the PanelLeft button. */
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;

  /** History filter — mirrors ?themeSlug= on GET /generations. */
  historyTheme: string | null;
  setHistoryTheme: (slug: string | null) => void;
}

export const useStudio = create<StudioState>((set) => ({
  armedTheme: null,
  armTheme: (theme) => set({ armedTheme: theme }),
  disarmTheme: () => set({ armedTheme: null }),

  activeConversationId: null,
  // Opening a chat clears the detail selection so the panel falls back to
  // the chat's latest generation.
  openConversation: (id) => set({ activeConversationId: id, selectedId: null }),
  startNewChat: () =>
    set({ activeConversationId: null, selectedId: null, armedTheme: null }),

  selectedId: null,
  select: (id) => set({ selectedId: id }),

  quality: "low",
  setQuality: (quality) => set({ quality }),

  sidebarCollapsed: false,
  toggleSidebar: () =>
    set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),

  historyTheme: null,
  setHistoryTheme: (slug) => set({ historyTheme: slug }),
}));
