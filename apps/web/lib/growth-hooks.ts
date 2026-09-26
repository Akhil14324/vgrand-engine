"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CampaignInsightsDto,
  CampaignLearningDto,
  GrowthDashboardDto,
  RevisionDto,
  RevisionFocus,
  StrategyPlan,
} from "@catgpt/types";
import { apiFetch } from "@/lib/api";

/** Growth data depends on strategy, execution and results, so any change refreshes all of it. */
function useRefreshAll() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["growth"] });
    qc.invalidateQueries({ queryKey: ["bcamp"] });
    qc.invalidateQueries({ queryKey: ["execution"] });
  };
}

export const useGrowthDashboard = (brandId: string | null) =>
  useQuery({
    queryKey: ["growth", "dashboard", brandId],
    enabled: !!brandId,
    queryFn: () => apiFetch<GrowthDashboardDto>(`/growth/dashboard?brandId=${brandId}`),
  });

export function useDecideSuggestion(brandId: string) {
  const refresh = useRefreshAll();
  return useMutation({
    mutationFn: (body: { key: string; action: "accept" | "dismiss" | "defer"; deferDays?: number }) =>
      apiFetch<{ status: string; taskCreated: boolean }>(`/growth/suggestions?brandId=${brandId}`, { method: "POST", json: body }),
    onSuccess: refresh,
  });
}

export const useInsights = (strategyId: string) =>
  useQuery({
    queryKey: ["growth", "insights", strategyId],
    queryFn: () => apiFetch<CampaignInsightsDto>(`/bcamp/strategies/${strategyId}/insights`),
  });

export const useLearning = (strategyId: string) =>
  useQuery({
    queryKey: ["growth", "learning", strategyId],
    queryFn: () => apiFetch<{ item: CampaignLearningDto | null }>(`/bcamp/strategies/${strategyId}/learning`),
    select: (d) => d.item,
  });

export function useRecordLearning(strategyId: string) {
  const refresh = useRefreshAll();
  return useMutation({
    mutationFn: (nextStep?: string) => apiFetch<CampaignLearningDto>(`/bcamp/strategies/${strategyId}/learning`, { method: "POST", json: { nextStep } }),
    onSuccess: refresh,
  });
}

export const useLearnings = (brandId: string | null) =>
  useQuery({
    queryKey: ["growth", "learnings", brandId],
    enabled: !!brandId,
    queryFn: () => apiFetch<{ items: CampaignLearningDto[] }>(`/growth/learnings?brandId=${brandId}`),
    select: (d) => d.items,
  });

export const useRevisions = (strategyId: string) =>
  useQuery({
    queryKey: ["growth", "revisions", strategyId],
    queryFn: () => apiFetch<{ items: RevisionDto[]; currentPlan: StrategyPlan }>(`/bcamp/strategies/${strategyId}/revisions`),
  });

export function useProposeRevision(strategyId: string) {
  const refresh = useRefreshAll();
  return useMutation({
    mutationFn: (body: { focus: RevisionFocus[]; note?: string }) => apiFetch<RevisionDto>(`/bcamp/strategies/${strategyId}/revisions`, { method: "POST", json: body }),
    onSuccess: refresh,
  });
}

export function useDecideRevision() {
  const refresh = useRefreshAll();
  return useMutation({
    mutationFn: (v: { id: string; action: "approve" | "reject"; note?: string }) =>
      apiFetch<{ status: string; version: number }>(`/bcamp/revisions/${v.id}/decision`, { method: "POST", json: { action: v.action, note: v.note } }),
    onSuccess: refresh,
  });
}
