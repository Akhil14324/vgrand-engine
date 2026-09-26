"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { BrandGuidelinesDto, BrandGuidelinesSaveDto } from "@catgpt/types";
import { apiFetch } from "@/lib/api";

const key = (brandId: string) => ["brand-guidelines", brandId] as const;

export function useBrandGuidelines(brandId: string) {
  return useQuery({
    queryKey: key(brandId),
    queryFn: () => apiFetch<{ item: BrandGuidelinesDto | null }>(`/brands/${brandId}/guidelines`),
    select: (d) => d.item,
  });
}

/** Returns a draft only; nothing is saved until the user saves. */
export function useGenerateGuidelines() {
  return useMutation({
    mutationFn: (brandId: string) =>
      apiFetch<{ content: string }>(`/brands/${brandId}/guidelines/generate`, { method: "POST" }),
  });
}

/** Saving also updates the brand profile (tone, colours, forbidden words...), so refresh brands too. */
export function useSaveGuidelines() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ brandId, content }: { brandId: string; content: string }) =>
      apiFetch<BrandGuidelinesSaveDto>(`/brands/${brandId}/guidelines`, { method: "PUT", json: { content } }),
    onSuccess: (saved) => {
      qc.setQueryData(key(saved.brandId), { item: saved });
      qc.invalidateQueries({ queryKey: ["brands"] });
    },
  });
}

export function useExportGuidelines() {
  return useMutation({
    mutationFn: ({ brandId, format }: { brandId: string; format: "pdf" | "docx" }) =>
      apiFetch<{ url: string }>(`/brands/${brandId}/guidelines/export`, { method: "POST", json: { format } }),
  });
}
