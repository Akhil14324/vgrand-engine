"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  BcampDashboardDto,
  ConvertRequest,
  CreateResultRequest,
  CreateStrategyRequest,
  DeliverableDto,
  ExecTaskDto,
  ExecutionDashboardDto,
  PersonDto,
  PlanChange,
  ProposedDeliverable,
  ProposedTask,
  ResultsSummaryDto,
  StrategyDto,
  StrategyMessageDto,
  StrategyPlan,
  StrategyReview,
  SyncItem,
  UpdateStrategyRequest,
} from "@catgpt/types";
import { apiFetch } from "@/lib/api";
import { resolveActiveBrand, useBrandMode } from "@/lib/brand-mode";
import { useBrands } from "@/lib/hooks";

/** The business B Camp and the Execution Center work on - one choice shared by both pages. */
export function useActiveBusiness() {
  const brands = useBrands();
  const chosen = useBrandMode((s) => s.brandId);
  const setBrandId = useBrandMode((s) => s.setBrandId);
  const brand = resolveActiveBrand(brands.data, chosen) ?? brands.data?.[0] ?? null;
  return { brands: brands.data, isLoading: brands.isLoading, brand, setBrandId };
}

const KEYS = {
  dash: (b: string | null) => ["bcamp", "dashboard", b] as const,
  strategy: (id: string | null) => ["bcamp", "strategy", id] as const,
  exec: (b: string | null) => ["execution", "dashboard", b] as const,
};

/** Anything that changes work or strategy can change both pages, so refresh them together. */
function useRefreshAll() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["bcamp"] });
    qc.invalidateQueries({ queryKey: ["execution"] });
    qc.invalidateQueries({ queryKey: ["generations"] });
  };
}

export const useBcampDashboard = (brandId: string | null) =>
  useQuery({
    queryKey: KEYS.dash(brandId),
    enabled: !!brandId,
    queryFn: () => apiFetch<BcampDashboardDto>(`/bcamp/dashboard?brandId=${brandId}`),
  });

export const useStrategy = (id: string | null) =>
  useQuery({
    queryKey: KEYS.strategy(id),
    enabled: !!id,
    queryFn: () => apiFetch<StrategyDto>(`/bcamp/strategies/${id}`),
  });

export function useCreateStrategy() {
  const refresh = useRefreshAll();
  return useMutation({
    mutationFn: (body: CreateStrategyRequest) => apiFetch<StrategyDto>("/bcamp/strategies", { method: "POST", json: body }),
    onSuccess: refresh,
  });
}

export function useSaveStrategy(id: string) {
  const refresh = useRefreshAll();
  return useMutation({
    mutationFn: (body: Omit<UpdateStrategyRequest, "plan"> & { plan?: StrategyPlan }) =>
      apiFetch<StrategyDto>(`/bcamp/strategies/${id}`, { method: "PATCH", json: body }),
    onSuccess: refresh,
  });
}

export function useStrategyAction(id: string) {
  const refresh = useRefreshAll();
  return useMutation({
    mutationFn: (action: "approve" | "archive" | "restore" | "complete") =>
      apiFetch<StrategyDto>(`/bcamp/strategies/${id}/status`, { method: "POST", json: { action } }),
    onSuccess: refresh,
  });
}

export const useCompareVersions = (id: string, from: number | null, to: number | null) =>
  useQuery({
    queryKey: ["bcamp", "compare", id, from, to],
    enabled: !!from && !!to && from !== to,
    queryFn: () => apiFetch<{ changes: PlanChange[] }>(`/bcamp/strategies/${id}/compare?from=${from}&to=${to}`),
  });

export interface ConversionPreview {
  canConvert: boolean;
  reason: string | null;
  deliverables: (ProposedDeliverable & { exists: boolean })[];
  tasks: (ProposedTask & { exists: boolean })[];
  people: PersonDto[];
}

export const useConversionPreview = (id: string, enabled: boolean) =>
  useQuery({
    queryKey: ["bcamp", "convert", id],
    enabled,
    queryFn: () => apiFetch<ConversionPreview>(`/bcamp/strategies/${id}/convert`),
  });

export function useCommitConversion(id: string) {
  const refresh = useRefreshAll();
  return useMutation({
    mutationFn: (body: ConvertRequest) =>
      apiFetch<{ deliverablesCreated: number; tasksCreated: number; alreadyExisted: number }>(`/bcamp/strategies/${id}/convert`, { method: "POST", json: body }),
    onSuccess: refresh,
  });
}

export const useSyncPreview = (id: string, enabled: boolean) =>
  useQuery({
    queryKey: ["bcamp", "sync", id],
    enabled,
    queryFn: () =>
      apiFetch<{ affected: SyncItem[]; added: { kind: string; dedupeKey: string; title: string }[] }>(`/bcamp/strategies/${id}/sync`),
  });

export function useApplySync(id: string) {
  const refresh = useRefreshAll();
  return useMutation({
    mutationFn: (body: { accept: string[]; dismiss: string[] }) =>
      apiFetch<{ applied: number; dismissed: number; refusedLocked: string[] }>(`/bcamp/strategies/${id}/sync`, { method: "POST", json: body }),
    onSuccess: refresh,
  });
}

export function useAskStrategy(id: string) {
  const refresh = useRefreshAll();
  return useMutation({
    mutationFn: (message: string) => apiFetch<StrategyMessageDto>(`/bcamp/strategies/${id}/messages`, { method: "POST", json: { message } }),
    onSuccess: refresh,
  });
}

export function useReviewStrategy(id: string) {
  const refresh = useRefreshAll();
  return useMutation({
    mutationFn: () => apiFetch<StrategyReview>(`/bcamp/strategies/${id}/review`, { method: "POST" }),
    onSuccess: refresh,
  });
}

export const useResults = (strategyId: string | null) =>
  useQuery({
    queryKey: ["bcamp", "results", strategyId],
    enabled: !!strategyId,
    queryFn: () => apiFetch<ResultsSummaryDto>(`/bcamp/strategies/${strategyId}/results`),
  });

export function useAddResult() {
  const refresh = useRefreshAll();
  return useMutation({
    mutationFn: (body: CreateResultRequest) => apiFetch<ResultsSummaryDto>("/execution/results", { method: "POST", json: body }),
    onSuccess: refresh,
  });
}

export function useDeleteResult() {
  const refresh = useRefreshAll();
  return useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/execution/results/${id}`, { method: "DELETE" }),
    onSuccess: refresh,
  });
}

/* ------------------------------ Execution Center --------------------------- */

export const useExecutionDashboard = (brandId: string | null) =>
  useQuery({
    queryKey: KEYS.exec(brandId),
    enabled: !!brandId,
    queryFn: () => apiFetch<ExecutionDashboardDto>(`/execution/dashboard?brandId=${brandId}`),
    // Generated content and publishing progress arrive in the background.
    refetchInterval: (q) =>
      q.state.data?.deliverables.some((d) => d.status === "drafting" && d.generationId && !d.imageUrl) ||
      q.state.data?.deliverables.some((d) => d.publishing.kind === "scheduled")
        ? 5000
        : false,
  });

export const useDeliverable = (id: string | null) =>
  useQuery({
    queryKey: ["execution", "deliverable", id],
    enabled: !!id,
    queryFn: () => apiFetch<DeliverableDto>(`/execution/deliverables/${id}`),
  });

export const useTask = (id: string | null) =>
  useQuery({
    queryKey: ["execution", "task", id],
    enabled: !!id,
    queryFn: () => apiFetch<ExecTaskDto>(`/execution/tasks/${id}`),
  });

type DeliverableCall =
  | { path: "" ; method: "PATCH"; json: { title?: string; brief?: string; dueAt?: string | null; assigneeId?: string | null } }
  | { path: "/action"; method: "POST"; json: { action: "submit" | "approve" | "request_changes" | "reject" | "reopen"; note?: string } }
  | { path: "/manual-complete"; method: "POST"; json: { note: string; externalUrl?: string } }
  | { path: "/flag"; method: "POST"; json: { flagged: boolean; reason?: string } }
  | { path: "/comments"; method: "POST"; json: { note: string } }
  | { path: "/content"; method: "POST"; json: { generationId: string } };

export function useDeliverableMutation(id: string) {
  const refresh = useRefreshAll();
  return useMutation({
    mutationFn: (c: DeliverableCall) => apiFetch<DeliverableDto>(`/execution/deliverables/${id}${c.path}`, { method: c.method, json: c.json }),
    onSuccess: refresh,
  });
}

/** Ask the server for the composed campaign brief, start the normal generation pipeline, attach the result. */
export function useGenerateForDeliverable(id: string) {
  const refresh = useRefreshAll();
  return useMutation({
    mutationFn: async () => {
      const brief = await apiFetch<{ brandId: string; prompt: string }>(`/execution/deliverables/${id}/brief`);
      const gen = await apiFetch<{ generationId: string }>("/generations", { method: "POST", json: { prompt: brief.prompt, brandId: brief.brandId } });
      return apiFetch<DeliverableDto>(`/execution/deliverables/${id}/content`, { method: "POST", json: { generationId: gen.generationId } });
    },
    onSuccess: refresh,
  });
}

export function useTaskMutation(id: string) {
  const refresh = useRefreshAll();
  return useMutation({
    mutationFn: (c: { path: ""; method: "PATCH"; json: Record<string, unknown> } | { path: "/flag" | "/comments"; method: "POST"; json: Record<string, unknown> }) =>
      apiFetch<ExecTaskDto>(`/execution/tasks/${id}${c.path}`, { method: c.method, json: c.json }),
    onSuccess: refresh,
  });
}
