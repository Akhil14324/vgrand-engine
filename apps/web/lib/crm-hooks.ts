"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CrmImportInput, CrmInstagramAccountDto, CrmInstagramRouteInput, CrmLeadCreateInput, CrmLeadDetailDto, CrmLeadListDto, CrmLeadUpdateInput, CrmNoteInput,
} from "@catgpt/types";
import { apiFetch, apiFetchBlob } from "@/lib/api";

const KEY = "crm";
const useRefresh = () => {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: [KEY] });
};

/** The viewer's calendar date, so "today" and "overdue" follow their clock. */
export function localDay(d = new Date()): string {
  const two = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
}

export interface CrmFilters {
  stage: string;
  source: string;
  owner: string;
  q: string;
  due: string;
  page: number;
}

export const useCrmLeads = (brandId: string | null, f: CrmFilters) =>
  useQuery({
    queryKey: [KEY, "leads", brandId, f],
    enabled: !!brandId,
    queryFn: () => {
      const p = new URLSearchParams({ brandId: brandId!, today: localDay(), page: String(f.page) });
      for (const key of ["stage", "source", "owner", "q", "due"] as const) if (f[key]) p.set(key, f[key]);
      return apiFetch<CrmLeadListDto>(`/crm/leads?${p}`);
    },
    // Keeps the list on screen while a filter changes, but never shows another brand's leads.
    placeholderData: (prev, query) => (query?.queryKey[2] === brandId ? prev : undefined),
    refetchInterval: 15_000,
  });

export const useCrmLead = (id: string | null) =>
  useQuery({ queryKey: [KEY, "lead", id], enabled: !!id, queryFn: () => apiFetch<CrmLeadDetailDto>(`/crm/leads/${id}`), refetchInterval: 15_000 });

export const useCreateLead = () => {
  const refresh = useRefresh();
  return useMutation({ mutationFn: (b: CrmLeadCreateInput) => apiFetch<{ id: string }>("/crm/leads", { method: "POST", json: b }), onSuccess: refresh });
};
export const useUpdateLead = (id: string) => {
  const refresh = useRefresh();
  return useMutation({ mutationFn: (b: CrmLeadUpdateInput) => apiFetch<CrmLeadDetailDto>(`/crm/leads/${id}`, { method: "PATCH", json: b }), onSuccess: refresh });
};
export const useAddLeadNote = (id: string) => {
  const refresh = useRefresh();
  return useMutation({ mutationFn: (b: CrmNoteInput) => apiFetch<{ ok: true }>(`/crm/leads/${id}/notes`, { method: "POST", json: b }), onSuccess: refresh });
};
export const useMergeLead = (id: string) => {
  const refresh = useRefresh();
  return useMutation({ mutationFn: (otherId: string) => apiFetch<CrmLeadDetailDto>(`/crm/leads/${id}/merge`, { method: "POST", json: { otherId } }), onSuccess: refresh });
};
export const useDeleteLead = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/crm/leads/${id}`, { method: "DELETE" }),
    onSuccess: (_r, id) => {
      qc.removeQueries({ queryKey: [KEY, "lead", id] });
      return qc.invalidateQueries({ queryKey: [KEY] });
    },
  });
};
export const useImportLeads = () => {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (b: CrmImportInput) => apiFetch<{ added: number; updated: number; unchanged: number; invalid: number }>("/crm/import", { method: "POST", json: b }),
    onSuccess: refresh,
  });
};

export const useExportLeads = () =>
  useMutation({
    mutationFn: async (brandId: string) => {
      const url = URL.createObjectURL(await apiFetchBlob(`/crm/export?brandId=${encodeURIComponent(brandId)}`));
      const a = document.createElement("a");
      a.href = url;
      a.download = `leads-${localDay()}.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    },
  });

export const useCrmInstagram = (brandId: string) =>
  useQuery({
    queryKey: [KEY, "instagram", brandId],
    queryFn: () => apiFetch<{ items: CrmInstagramAccountDto[] }>(`/crm/instagram?brandId=${encodeURIComponent(brandId)}`),
    select: (d) => d.items,
  });
export const useSetCrmInstagram = () => {
  const refresh = useRefresh();
  return useMutation({ mutationFn: (b: CrmInstagramRouteInput) => apiFetch<{ added: number }>("/crm/instagram", { method: "PUT", json: b }), onSuccess: refresh });
};
