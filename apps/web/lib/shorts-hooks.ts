"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ShortsChannelDto,
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

/** Invalidates everything under the Shorts module after a mutation. */
export function useShortsRefresh() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ["shorts"] });
}
