"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ApplyBrandKitRequest, BrandAssetDto } from "@catgpt/types";
import { apiFetch } from "@/lib/api";

/** Upload a TTF / OTF / WOFF / WOFF2 font to a brand. */
export function useUploadBrandFont() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ brandId, file }: { brandId: string; file: File }) => {
      const form = new FormData();
      form.append("file", file);
      return apiFetch<BrandAssetDto>(`/brands/${brandId}/fonts`, { method: "POST", body: form });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["brands"] }),
  });
}

/** Stamp the brand's real logo (and optional text) onto a finished image; creates a new generation. */
export function useApplyBrandKit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ generationId, ...body }: ApplyBrandKitRequest & { generationId: string }) =>
      apiFetch<{ id: string; imageUrl: string }>(`/generations/${generationId}/apply-brand-kit`, {
        method: "POST",
        json: body,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["generations"] }),
  });
}
