"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  InstagramSetupDto,
  InstagramSetupUpdate,
  GuavaContentAuditDto,
  GuavaContentAuditRequest,
  GuavaContentAuditSummaryDto,
  GuavaDiagnosisDto,
  GuavaDiagnosisSummaryDto,
  GuavaMessageDto,
  GuavaProfileDto,
  GuavaProfileUpdate,
} from "@catgpt/types";
import { apiFetch } from "@/lib/api";

const base = (brandId: string) => `/guava/brands/${brandId}`;

export function useGuavaProfile(brandId: string | null) {
  return useQuery({
    queryKey: ["guava", "profile", brandId],
    enabled: !!brandId,
    queryFn: () => apiFetch<GuavaProfileDto>(`${base(brandId!)}/profile`),
  });
}

export function useSaveGuavaProfile(brandId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (update: GuavaProfileUpdate) =>
      apiFetch<GuavaProfileDto>(`${base(brandId)}/profile`, { method: "PATCH", json: update }),
    onSuccess: (dto) => qc.setQueryData(["guava", "profile", brandId], dto),
  });
}

/** History list; polls while a diagnosis is still being written. */
export function useGuavaDiagnoses(brandId: string | null) {
  return useQuery({
    queryKey: ["guava", "diagnoses", brandId],
    enabled: !!brandId,
    queryFn: () => apiFetch<{ items: GuavaDiagnosisSummaryDto[] }>(`${base(brandId!)}/diagnoses`),
    select: (d) => d.items,
    refetchInterval: (q) => (q.state.data?.items.some((d) => d.status === "processing") ? 3000 : false),
  });
}

export function useGuavaDiagnosis(brandId: string | null, id: string | null) {
  return useQuery({
    queryKey: ["guava", "diagnosis", brandId, id],
    enabled: !!brandId && !!id,
    queryFn: () => apiFetch<GuavaDiagnosisDto>(`${base(brandId!)}/diagnoses/${id}`),
    refetchInterval: (q) => (q.state.data?.status === "processing" ? 3000 : false),
  });
}

export function useStartGuavaDiagnosis(brandId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<GuavaDiagnosisSummaryDto>(`${base(brandId)}/diagnoses`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["guava", "diagnoses", brandId] }),
  });
}

export function useAskGuava(brandId: string, diagnosisId: string) {
  const qc = useQueryClient();
  const key = ["guava", "diagnosis", brandId, diagnosisId];
  return useMutation({
    mutationFn: (question: string) =>
      apiFetch<GuavaMessageDto>(`${base(brandId)}/diagnoses/${diagnosisId}/messages`, {
        method: "POST",
        json: { question },
      }),
    // The server stores both turns; refetch so the thread matches it exactly.
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });
}

/* --------------------------- Instagram content review --------------------------- */

/** Review list; polls while Gemini is still watching reels. */
export function useGuavaContentAudits(brandId: string | null) {
  return useQuery({
    queryKey: ["guava", "content-audits", brandId],
    enabled: !!brandId,
    queryFn: () => apiFetch<{ items: GuavaContentAuditSummaryDto[] }>(`${base(brandId!)}/content-audits`),
    select: (d) => d.items,
    refetchInterval: (q) => (q.state.data?.items.some((d) => d.status === "processing") ? 3000 : false),
  });
}

export function useGuavaContentAudit(brandId: string | null, id: string | null) {
  return useQuery({
    queryKey: ["guava", "content-audit", brandId, id],
    enabled: !!brandId && !!id,
    queryFn: () => apiFetch<GuavaContentAuditDto>(`${base(brandId!)}/content-audits/${id}`),
    refetchInterval: (q) => (q.state.data?.status === "processing" ? 3000 : false),
  });
}

export function useStartGuavaContentAudit(brandId: string) {
  const qc = useQueryClient();
  return useMutation({
    /** No argument: run with the brand's saved Instagram setup. */
    mutationFn: (req?: GuavaContentAuditRequest) =>
      apiFetch<GuavaContentAuditSummaryDto>(`${base(brandId)}/content-audits`, { method: "POST", json: req ?? {} }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["guava", "content-audits", brandId] }),
  });
}

/** Your one Instagram account and rival accounts (set on the Instagram page), shared by all brands in a scope. */
export function useInstagramSetup(workspaceId: string | null) {
  return useQuery({
    queryKey: ["guava", "instagram-setup", workspaceId],
    queryFn: () =>
      apiFetch<InstagramSetupDto>(`/guava/instagram-setup${workspaceId ? `?workspaceId=${workspaceId}` : ""}`),
  });
}

export function useSaveInstagramSetup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (update: InstagramSetupUpdate) =>
      apiFetch<InstagramSetupDto>("/guava/instagram-setup", { method: "PUT", json: update }),
    onSuccess: (dto) => qc.setQueryData(["guava", "instagram-setup", dto.workspaceId], dto),
  });
}
