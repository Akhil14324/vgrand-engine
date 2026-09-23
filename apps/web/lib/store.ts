"use client";

import { create } from "zustand";
import type { Quality, ThemeDto } from "@prompthub/types";

interface StudioState {
  /** Theme armed via the `/` menu — attached to every send until cleared. */
  armedTheme: ThemeDto | null;
  armTheme: (theme: ThemeDto) => void;
  disarmTheme: () => void;

  /** Generation shown in the right-hand detail panel. */
  selectedId: string | null;
  select: (id: string | null) => void;

  /** Quality tier for the next generation ("low" default keeps cost down). */
  quality: Quality;
  setQuality: (q: Quality) => void;

  /** History filter — mirrors ?themeSlug= on GET /generations. */
  historyTheme: string | null;
  setHistoryTheme: (slug: string | null) => void;
}

export const useStudio = create<StudioState>((set) => ({
  armedTheme: null,
  armTheme: (theme) => set({ armedTheme: theme }),
  disarmTheme: () => set({ armedTheme: null }),

  selectedId: null,
  select: (id) => set({ selectedId: id }),

  quality: "low",
  setQuality: (quality) => set({ quality }),

  historyTheme: null,
  setHistoryTheme: (slug) => set({ historyTheme: slug }),
}));
