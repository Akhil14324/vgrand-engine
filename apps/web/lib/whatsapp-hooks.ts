"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  WaBroadcastDto, WaBroadcastInput, WaConnectInput, WaContactDto, WaMessageDto, WaNumberDto, WaSettingsInput, WaTemplateDto, WaTemplateInput, WaWebhookStatusDto,
} from "@catgpt/types";
import { apiFetch } from "@/lib/api";

const KEY = "whatsapp";
const useRefresh = () => {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: [KEY] });
};

export const useWaStatus = () => useQuery({ queryKey: [KEY, "status"], queryFn: () => apiFetch<WaWebhookStatusDto>("/whatsapp/status"), staleTime: 60_000 });

export const useWaNumbers = () =>
  useQuery({ queryKey: [KEY, "numbers"], queryFn: () => apiFetch<{ items: WaNumberDto[] }>("/whatsapp/numbers"), select: (d) => d.items });

export const useConnectWa = () => {
  const refresh = useRefresh();
  return useMutation({ mutationFn: (b: WaConnectInput) => apiFetch<WaNumberDto>("/whatsapp/numbers", { method: "POST", json: b }), onSuccess: refresh });
};
export const useSaveWaSettings = (id: string) => {
  const refresh = useRefresh();
  return useMutation({ mutationFn: (b: WaSettingsInput) => apiFetch<WaNumberDto>(`/whatsapp/numbers/${id}`, { method: "PATCH", json: b }), onSuccess: refresh });
};
export const useReplaceWaToken = (id: string) => {
  const refresh = useRefresh();
  return useMutation({ mutationFn: (accessToken: string) => apiFetch<WaNumberDto>(`/whatsapp/numbers/${id}/token`, { method: "PUT", json: { accessToken } }), onSuccess: refresh });
};
export const useDisconnectWa = () => {
  const refresh = useRefresh();
  return useMutation({ mutationFn: (id: string) => apiFetch<void>(`/whatsapp/numbers/${id}`, { method: "DELETE" }), onSuccess: refresh });
};

export const useWaContacts = (numberId: string | null, f: { stage: string; kind: string; q: string; unread: boolean }) =>
  useQuery({
    queryKey: [KEY, "contacts", numberId, f],
    enabled: !!numberId,
    queryFn: () => {
      const p = new URLSearchParams({ limit: "200" });
      if (f.stage) p.set("stage", f.stage);
      if (f.kind) p.set("kind", f.kind);
      if (f.q) p.set("q", f.q);
      if (f.unread) p.set("unread", "1");
      return apiFetch<{ items: WaContactDto[] }>(`/whatsapp/numbers/${numberId}/contacts?${p}`);
    },
    select: (d) => d.items,
    refetchInterval: 10_000,
  });

export const useWaThread = (contactId: string | null) =>
  useQuery({
    queryKey: [KEY, "thread", contactId],
    enabled: !!contactId,
    queryFn: () => apiFetch<{ contact: WaContactDto; items: WaMessageDto[] }>(`/whatsapp/contacts/${contactId}/messages`),
    refetchInterval: 5_000,
  });

export const usePatchWaContact = () => {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Record<string, unknown> }) => apiFetch<WaContactDto>(`/whatsapp/contacts/${id}`, { method: "PATCH", json: patch }),
    onSuccess: refresh,
  });
};
export const useSendWaMessage = () => {
  const refresh = useRefresh();
  return useMutation({ mutationFn: ({ id, text }: { id: string; text: string }) => apiFetch<{ ok: true }>(`/whatsapp/contacts/${id}/messages`, { method: "POST", json: { text } }), onSuccess: refresh });
};
export const useImportWaContacts = (numberId: string) => {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (b: { kind: string; consent: true; consentSource: string; tags: string[]; rows: { phone: string; name?: string }[] }) =>
      apiFetch<{ added: number; updated: number; invalid: number }>(`/whatsapp/numbers/${numberId}/contacts/import`, { method: "POST", json: b }),
    onSuccess: refresh,
  });
};

export const useWaTemplates = (numberId: string | null) =>
  useQuery({
    queryKey: [KEY, "templates", numberId],
    enabled: !!numberId,
    queryFn: () => apiFetch<{ items: WaTemplateDto[] }>(`/whatsapp/numbers/${numberId}/templates`),
    select: (d) => d.items,
    refetchInterval: 60_000,
  });
export const useCreateWaTemplate = (numberId: string) => {
  const refresh = useRefresh();
  return useMutation({ mutationFn: (b: WaTemplateInput) => apiFetch<WaTemplateDto>(`/whatsapp/numbers/${numberId}/templates`, { method: "POST", json: b }), onSuccess: refresh });
};
export const useSyncWaTemplates = (numberId: string) => {
  const refresh = useRefresh();
  return useMutation({ mutationFn: () => apiFetch<{ items: WaTemplateDto[] }>(`/whatsapp/numbers/${numberId}/templates/sync`, { method: "POST" }), onSuccess: refresh });
};
export const useDeleteWaTemplate = () => {
  const refresh = useRefresh();
  return useMutation({ mutationFn: (id: string) => apiFetch<void>(`/whatsapp/templates/${id}`, { method: "DELETE" }), onSuccess: refresh });
};

export const useWaBroadcasts = (numberId: string | null) =>
  useQuery({
    queryKey: [KEY, "broadcasts", numberId],
    enabled: !!numberId,
    queryFn: () => apiFetch<{ items: WaBroadcastDto[] }>(`/whatsapp/numbers/${numberId}/broadcasts`),
    select: (d) => d.items,
    refetchInterval: 10_000,
  });
export const useWaAudience = (numberId: string, audience: WaBroadcastInput["audience"]) =>
  useQuery({
    queryKey: [KEY, "audience", numberId, audience],
    queryFn: () => apiFetch<{ eligible: number; skippedNoConsent: number }>(`/whatsapp/numbers/${numberId}/audience`, { method: "POST", json: { audience } }),
  });
export const useCreateWaBroadcast = (numberId: string) => {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: async (b: WaBroadcastInput & { sendNow: boolean }) => {
      const { sendNow, ...input } = b;
      const { id } = await apiFetch<{ id: string }>(`/whatsapp/numbers/${numberId}/broadcasts`, { method: "POST", json: input });
      return apiFetch<{ queued: boolean }>(`/whatsapp/broadcasts/${id}/send`, { method: "POST" }).then((r) => ({ ...r, sendNow }));
    },
    onSuccess: refresh,
  });
};
export const useCancelWaBroadcast = () => {
  const refresh = useRefresh();
  return useMutation({ mutationFn: (id: string) => apiFetch<{ cancelled: boolean }>(`/whatsapp/broadcasts/${id}/cancel`, { method: "POST" }), onSuccess: refresh });
};
