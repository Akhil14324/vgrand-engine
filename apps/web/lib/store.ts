"use client";

import { create } from "zustand";
import type { DocumentDto, ImageSize, Quality, ThemeDto } from "@catgpt/types";

/** Optimistic copy of a just-sent turn — renders before the server answers. */
export interface PendingTurn {
  tempId: string;
  prompt: string;
  refImages: string[];
  docs: DocumentDto[];
  conversationId: string | null;
  /** Set once the POST resolves — the bubble stays until this turn is in the feed. */
  generationId?: string;
}

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

  /** Canvas for the next image — "auto" lets the provider pick a ratio. */
  size: ImageSize;
  setSize: (s: ImageSize) => void;

  /** Desktop sidebar collapsed via the PanelLeft button. */
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;

  /** Manage-memory dialog, opened from Settings or the "Memory updated" toast. */
  memoryDialogOpen: boolean;
  setMemoryDialogOpen: (open: boolean) => void;

  /** History filter — mirrors ?themeSlug= on GET /generations. */
  historyTheme: string | null;
  setHistoryTheme: (slug: string | null) => void;

  /** Optimistic user bubble shown between Send and the POST resolving. */
  pendingTurn: PendingTurn | null;
  setPendingTurn: (t: PendingTurn) => void;
  /** POST succeeded: pin the bubble to its real chat until the turn lands. */
  resolvePendingTurn: (conversationId: string, generationId: string) => void;
  clearPendingTurn: () => void;

  /** Workspace a brand-new chat should be created inside (set by "Open chat"
   * on the workspaces page, consumed by the first send). */
  workspaceContextId: string | null;
  openWorkspaceChat: (workspaceId: string) => void;
}

export const useStudio = create<StudioState>((set) => ({
  armedTheme: null,
  armTheme: (theme) => set({ armedTheme: theme }),
  disarmTheme: () => set({ armedTheme: null }),

  activeConversationId: null,
  // Opening a chat clears the detail selection so the panel falls back to
  // the chat's latest generation — and any pending workspace context.
  openConversation: (id) =>
    set({
      activeConversationId: id,
      selectedId: null,
      workspaceContextId: null,
    }),
  startNewChat: () =>
    set({
      activeConversationId: null,
      selectedId: null,
      armedTheme: null,
      workspaceContextId: null,
    }),

  selectedId: null,
  select: (id) => set({ selectedId: id }),

  quality: "low",
  setQuality: (quality) => set({ quality }),

  size: "auto",
  setSize: (size) => set({ size }),

  sidebarCollapsed: false,
  toggleSidebar: () =>
    set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),

  memoryDialogOpen: false,
  setMemoryDialogOpen: (open) => set({ memoryDialogOpen: open }),

  historyTheme: null,
  setHistoryTheme: (slug) => set({ historyTheme: slug }),

  pendingTurn: null,
  setPendingTurn: (t) => set({ pendingTurn: t }),
  resolvePendingTurn: (conversationId, generationId) => {
    const current = useStudio.getState().pendingTurn;
    if (!current) return;
    set({ pendingTurn: { ...current, conversationId, generationId } });
    // Safety net if the feed never sees the turn (user navigated away, or the
    // refetch failed) — don't leave a phantom bubble behind.
    setTimeout(() => {
      if (useStudio.getState().pendingTurn?.tempId === current.tempId) {
        set({ pendingTurn: null });
      }
    }, 20_000);
  },
  clearPendingTurn: () => set({ pendingTurn: null }),

  workspaceContextId: null,
  openWorkspaceChat: (workspaceId) =>
    set({
      activeConversationId: null,
      selectedId: null,
      armedTheme: null,
      workspaceContextId: workspaceId,
    }),
}));
