"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CreateReelRequest, ReelDetailDto, ReelDto, ReelOptionsDto, UpdateReelRequest } from "@catgpt/types";
import { apiFetch } from "@/lib/api";

const busy = (s: string | undefined) => s === "queued" || s === "rendering";

export const useReelOptions = () =>
  useQuery({
    queryKey: ["shorts", "reels", "options"],
    queryFn: () => apiFetch<ReelOptionsDto>("/shorts/reels/options"),
    staleTime: 60_000,
  });

export function useReels(q: { mode?: string; status?: string }) {
  const params = new URLSearchParams();
  if (q.mode) params.set("mode", q.mode);
  if (q.status) params.set("status", q.status);
  return useQuery({
    queryKey: ["shorts", "reels", "list", q],
    queryFn: () => apiFetch<{ items: ReelDto[] }>(`/shorts/reels?${params}`),
    select: (d) => d.items,
    // Keep processing cards moving.
    refetchInterval: (query) => (query.state.data?.items.some((r) => busy(r.status)) ? 3000 : false),
  });
}

export function useReel(id: string) {
  return useQuery({
    queryKey: ["shorts", "reels", "one", id],
    queryFn: () => apiFetch<ReelDetailDto>(`/shorts/reels/${id}`),
    refetchInterval: (query) => (busy(query.state.data?.status) ? 2000 : false),
  });
}

function useReelMutation<V>(fn: (v: V) => Promise<ReelDetailDto>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (data) => {
      qc.setQueryData(["shorts", "reels", "one", data.id], data);
      void qc.invalidateQueries({ queryKey: ["shorts", "reels", "list"] });
    },
  });
}

export const useCreateReel = () => useReelMutation((body: CreateReelRequest) => apiFetch<ReelDetailDto>("/shorts/reels", { method: "POST", json: body }));

export const useUpdateReel = (id: string) =>
  useReelMutation((patch: UpdateReelRequest) => apiFetch<ReelDetailDto>(`/shorts/reels/${id}`, { method: "PATCH", json: patch }));

export const useRegenerateScript = (id: string) =>
  useReelMutation((instructions: string) => apiFetch<ReelDetailDto>(`/shorts/reels/${id}/script`, { method: "POST", json: { instructions } }));

export const useRegenerateScene = (id: string) =>
  useReelMutation((v: { sceneId: string; part: "text" | "visual" | "both"; instructions?: string }) =>
    apiFetch<ReelDetailDto>(`/shorts/reels/${id}/scenes/${v.sceneId}/regenerate`, { method: "POST", json: { part: v.part, instructions: v.instructions ?? "" } }),
  );

export const useUploadSceneVisual = (id: string) =>
  useReelMutation((v: { sceneId: string; file: File }) => {
    const fd = new FormData();
    fd.append("file", v.file);
    return apiFetch<ReelDetailDto>(`/shorts/reels/${id}/scenes/${v.sceneId}/upload`, { method: "POST", body: fd });
  });

/** A fresh take on the same brief: new script, visuals, voice and edit, as one background job. */
export const useRegenerateReel = (id: string) =>
  useReelMutation((instructions: string) => apiFetch<ReelDetailDto>(`/shorts/reels/${id}/regenerate`, { method: "POST", json: { instructions } }));

export const useRenderReel = (id: string) => useReelMutation(() => apiFetch<ReelDetailDto>(`/shorts/reels/${id}/render`, { method: "POST" }));

export function useDeleteReel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/shorts/reels/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["shorts", "reels", "list"] }),
  });
}

export function useUploadMusic() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      return apiFetch<{ key: string; options: ReelOptionsDto }>("/shorts/reels/music", { method: "POST", body: fd });
    },
    onSuccess: (d) => qc.setQueryData(["shorts", "reels", "options"], d.options),
  });
}
