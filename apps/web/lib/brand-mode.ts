"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { BrandDto } from "@catgpt/types";

/**
 * The composer's Brand toggle. `brandId` has three states:
 *  - undefined: never chosen -> follow the default (personal brand, if any)
 *  - null: explicitly OFF -> common answers
 *  - string: ON with that brand
 * Only this tiny choice is persisted; brand data itself stays server-side.
 */
interface BrandModeState {
  brandId: string | null | undefined;
  setBrandId: (id: string | null) => void;
  /** Text handed to the composer by another page (e.g. "Build my strategy"). */
  draft: string | null;
  setDraft: (text: string | null) => void;
}

export const useBrandMode = create<BrandModeState>()(
  persist(
    (set) => ({
      brandId: undefined,
      setBrandId: (brandId) => set({ brandId }),
      draft: null,
      setDraft: (draft) => set({ draft }),
    }),
    { name: "catgpt-brand-mode", partialize: (s) => ({ brandId: s.brandId }) },
  ),
);

/** The brand actually in effect right now, or null when brand mode is off. */
export function resolveActiveBrand(
  brands: BrandDto[] | undefined,
  chosen: string | null | undefined,
): BrandDto | null {
  if (!brands?.length) return null;
  if (chosen === null) return null;
  if (chosen) return brands.find((b) => b.id === chosen) ?? null;
  return brands.find((b) => b.workspaceId === null) ?? null;
}
