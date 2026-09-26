"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ConsentRecordDto,
  CreateConsentRequest,
  DeleteWorkspaceDataDto,
  WorkspacePrivacyDto,
} from "@catgpt/types";
import { apiFetch, apiFetchBlob } from "@/lib/api";

const privacyKey = (id: string) => ["workspace-privacy", id] as const;
const consentKey = (id: string) => ["workspace-consents", id] as const;

export function useWorkspacePrivacy(workspaceId: string) {
  return useQuery({
    queryKey: privacyKey(workspaceId),
    queryFn: () => apiFetch<WorkspacePrivacyDto>(`/workspaces/${workspaceId}/privacy`),
  });
}

export function useSetRetention(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (retentionDays: number | null) =>
      apiFetch<WorkspacePrivacyDto>(`/workspaces/${workspaceId}/privacy`, { method: "PATCH", json: { retentionDays } }),
    onSuccess: (res) => qc.setQueryData(privacyKey(workspaceId), res),
  });
}

/** Downloads the export JSON (built on demand, never stored server-side). */
export function useExportWorkspace(workspaceId: string) {
  return useMutation({
    mutationFn: () => apiFetchBlob(`/workspaces/${workspaceId}/export`),
  });
}

export function useDeleteWorkspaceContent(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (confirm: string) =>
      apiFetch<DeleteWorkspaceDataDto>(`/workspaces/${workspaceId}/data`, { method: "DELETE", json: { confirm } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["conversations"] });
      void qc.invalidateQueries({ queryKey: ["generations"] });
      void qc.invalidateQueries({ queryKey: ["workspace", workspaceId] });
    },
  });
}

export function useConsents(workspaceId: string) {
  return useQuery({
    queryKey: consentKey(workspaceId),
    queryFn: () => apiFetch<{ items: ConsentRecordDto[] }>(`/workspaces/${workspaceId}/consents`),
    select: (d) => d.items,
  });
}

export function useAddConsent(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateConsentRequest) =>
      apiFetch<ConsentRecordDto>(`/workspaces/${workspaceId}/consents`, { method: "POST", json: body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: consentKey(workspaceId) }),
  });
}

export function useRevokeConsent(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (consentId: string) =>
      apiFetch<ConsentRecordDto>(`/workspaces/${workspaceId}/consents/${consentId}/revoke`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: consentKey(workspaceId) }),
  });
}
