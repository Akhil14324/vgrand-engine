"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ShortsChannelDto,
  ShortsVideoDetailDto,
  ShortsVideoDto,
  ShortsHealthDto,
  UpdateShortsChannelRequest,
} from "@catgpt/types";
import { apiFetch } from "@/lib/api";

export const useShortsHealth = () =>
  useQuery({
    queryKey: ["shorts", "health"],
    queryFn: () => apiFetch<ShortsHealthDto>("/shorts/health"),
    staleTime: 60_000,
  });

export const useShortsChannels = () =>
  useQuery({
    queryKey: ["shorts", "channels"],
    queryFn: () => apiFetch<{ items: ShortsChannelDto[] }>("/shorts/channels"),
    select: (d) => d.items,
  });

export function useUpdateShortsChannel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateShortsChannelRequest }) =>
      apiFetch<ShortsChannelDto>(`/shorts/channels/${id}`, { method: "PATCH", json: patch }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["shorts"] }),
  });
}

export function useGenerateShort() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ channelId, offline }: { channelId: string; offline: boolean }) =>
      apiFetch<{ id: string; status: string }>(`/shorts/channels/${channelId}/generate`, { method: "POST", json: { offline } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["shorts"] }),
  });
}

/** Invalidates everything under the Shorts module after a mutation. */
export function useShortsRefresh() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ["shorts"] });
}

export const useShortsVideos = (q: { status?: string; channelId?: string; dryRun?: boolean }) => {
  const params = new URLSearchParams();
  if (q.status) params.set("status", q.status);
  if (q.channelId) params.set("channelId", q.channelId);
  if (q.dryRun) params.set("dryRun", "1");
  return useQuery({
    queryKey: ["shorts", "videos", q],
    queryFn: () => apiFetch<{ items: ShortsVideoDto[] }>(`/shorts/videos?${params}`),
    select: (d) => d.items,
    refetchInterval: 15_000,
  });
};

export const useShortsVideo = (id: string | null) =>
  useQuery({
    queryKey: ["shorts", "video", id],
    enabled: !!id,
    queryFn: () => apiFetch<ShortsVideoDetailDto>(`/shorts/videos/${id}`),
    refetchInterval: 10_000,
  });

export const useManualQueue = () =>
  useQuery({
    queryKey: ["shorts", "manual"],
    queryFn: () => apiFetch<{ items: ShortsVideoDto[] }>("/shorts/manual"),
    select: (d) => d.items,
    refetchInterval: 30_000,
  });

/** POST /shorts/videos/:id/<action> for approve | reject | retry | sync. */
export function useVideoAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: "approve" | "reject" | "retry" | "sync" }) =>
      apiFetch<ShortsVideoDetailDto>(`/shorts/videos/${id}/${action}`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["shorts"] }),
  });
}

export function useMarkPosted() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, url }: { id: string; url: string }) =>
      apiFetch<ShortsVideoDetailDto>(`/shorts/videos/${id}/mark-posted`, { method: "POST", json: { url } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["shorts"] }),
  });
}

export function useSetViewedPct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, viewedPct }: { id: string; viewedPct: number | null }) =>
      apiFetch<ShortsVideoDetailDto>(`/shorts/videos/${id}/manual-metric`, { method: "PATCH", json: { viewedPct } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["shorts"] }),
  });
}
