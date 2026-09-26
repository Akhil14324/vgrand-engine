"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  ComplianceCheckDto,
  ComplianceCheckRequest,
  RewriteCaptionDto,
  RewriteCaptionRequest,
} from "@catgpt/types";
import { apiFetch } from "@/lib/api";

export function useComplianceCheck() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ brandId, ...body }: ComplianceCheckRequest & { brandId: string }) =>
      apiFetch<ComplianceCheckDto>(`/brands/${brandId}/compliance/check`, { method: "POST", json: body }),
    onSuccess: (_r, v) => qc.invalidateQueries({ queryKey: ["brand-compliance", v.brandId] }),
  });
}

/** Rewrites a caption so it follows the brand rules; the response includes a fresh rule check of the result. */
export function useRewriteCaption() {
  return useMutation({
    mutationFn: ({ brandId, ...body }: RewriteCaptionRequest & { brandId: string }) =>
      apiFetch<RewriteCaptionDto>(`/brands/${brandId}/compliance/rewrite-caption`, { method: "POST", json: body }),
  });
}
