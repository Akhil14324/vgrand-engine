"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  IgAccountDto,
  IgAccountStatusDto,
  IgEventDto,
  IgMediaDto,
  IgRuleDto,
  IgRuleInput,
  IgTestResultDto,
} from "@catgpt/types";
import { apiFetch } from "@/lib/api";

const KEY = "ig-automation";

export const useIgAccounts = () =>
  useQuery({
    queryKey: [KEY, "accounts"],
    queryFn: () => apiFetch<{ items: IgAccountDto[] }>("/ig-automation/accounts"),
    select: (d) => d.items,
  });

export const useIgStatus = (accountId: string | null) =>
  useQuery({
    queryKey: [KEY, "status", accountId],
    enabled: !!accountId,
    queryFn: () => apiFetch<IgAccountStatusDto>(`/ig-automation/accounts/${accountId}/status`),
    staleTime: 60_000,
    retry: false,
  });

export const useIgRules = (accountId: string | null) =>
  useQuery({
    queryKey: [KEY, "rules", accountId],
    enabled: !!accountId,
    queryFn: () => apiFetch<{ items: IgRuleDto[] }>(`/ig-automation/accounts/${accountId}/rules`),
    select: (d) => d.items,
    refetchInterval: 30_000,
  });

export const useIgEvents = (accountId: string | null, status: string) =>
  useQuery({
    queryKey: [KEY, "events", accountId, status],
    enabled: !!accountId,
    queryFn: () => apiFetch<{ items: IgEventDto[] }>(`/ig-automation/accounts/${accountId}/events?limit=100${status ? `&status=${status}` : ""}`),
    select: (d) => d.items,
    refetchInterval: 15_000,
  });

export const useIgMedia = (accountId: string | null, enabled: boolean) =>
  useQuery({
    queryKey: [KEY, "media", accountId],
    enabled: !!accountId && enabled,
    queryFn: () => apiFetch<{ items: IgMediaDto[] }>(`/ig-automation/accounts/${accountId}/media`),
    select: (d) => d.items,
    staleTime: 5 * 60_000,
    retry: false,
  });

function useRefresh() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: [KEY] });
}

export function useSaveIgRule(accountId: string) {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: ({ id, input }: { id: string | null; input: IgRuleInput }) =>
      id
        ? apiFetch<IgRuleDto>(`/ig-automation/rules/${id}`, { method: "PATCH", json: input })
        : apiFetch<IgRuleDto>(`/ig-automation/accounts/${accountId}/rules`, { method: "POST", json: input }),
    onSuccess: refresh,
  });
}

export function usePatchIgRule() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<IgRuleInput> }) =>
      apiFetch<IgRuleDto>(`/ig-automation/rules/${id}`, { method: "PATCH", json: patch }),
    onSuccess: refresh,
  });
}

export function useDeleteIgRule() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/ig-automation/rules/${id}`, { method: "DELETE" }),
    onSuccess: refresh,
  });
}

export function useSubscribeIgPage() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (accountId: string) => apiFetch<{ subscribed: boolean; fields: string[] }>(`/ig-automation/accounts/${accountId}/subscribe`, { method: "POST" }),
    onSuccess: refresh,
  });
}

export function useTestIgRules(accountId: string) {
  return useMutation({
    mutationFn: (body: { trigger: "comment" | "dm"; text: string; mediaId: string | null; username: string | null }) =>
      apiFetch<IgTestResultDto>(`/ig-automation/accounts/${accountId}/test`, { method: "POST", json: body }),
  });
}

export function useRetryIgEvent() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (id: string) => apiFetch<{ ok: boolean }>(`/ig-automation/events/${id}/retry`, { method: "POST" }),
    onSuccess: refresh,
  });
}
