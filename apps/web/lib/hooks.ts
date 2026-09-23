"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type {
  BoardDto,
  ConversationDto,
  CreateGenerationRequest,
  GenerationDto,
  GenerationKind,
  MemoryDto,
  Paginated,
  RegenerateGenerationRequest,
  ShareLinkDto,
  ThemeDto,
  UpdateConversationRequest,
} from "@prompthub/types";
import { apiFetch } from "./api";

/* --------------------------------- themes --------------------------------- */

export function useThemes() {
  return useQuery({
    queryKey: ["themes"],
    queryFn: () => apiFetch<{ items: ThemeDto[] }>("/themes"),
    select: (d) => d.items,
    staleTime: 60_000,
  });
}

/* ------------------------------- generations ------------------------------ */

export function useGenerations(filter?: {
  themeSlug?: string | null;
  conversationId?: string | null;
}) {
  const themeSlug = filter?.themeSlug ?? null;
  const conversationId = filter?.conversationId ?? null;
  return useQuery({
    queryKey: ["generations", themeSlug, conversationId],
    queryFn: () =>
      apiFetch<Paginated<GenerationDto>>(
        `/generations?limit=50${themeSlug ? `&themeSlug=${themeSlug}` : ""}${conversationId ? `&conversationId=${conversationId}` : ""}`,
      ),
    refetchInterval: (query) => {
      // Poll lightly while anything is in flight — SSE covers the selected
      // card, this keeps the sidebar/feed fresh for the rest.
      const pending = query.state.data?.items.some(
        (g) => g.status === "pending" || g.status === "processing",
      );
      return pending ? 4000 : false;
    },
  });
}

export function useGeneration(id: string | null) {
  return useQuery({
    queryKey: ["generation", id],
    queryFn: () => apiFetch<GenerationDto>(`/generations/${id}`),
    enabled: Boolean(id),
  });
}

interface CreateGenerationResponse {
  generationId: string;
  conversationId: string;
  status: string;
  kind: GenerationKind;
}

export function useCreateGeneration() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateGenerationRequest) =>
      apiFetch<CreateGenerationResponse>("/generations", {
        method: "POST",
        json: body,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["generations"] });
      qc.invalidateQueries({ queryKey: ["conversations"] });
    },
  });
}

export function useRegenerate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...body
    }: RegenerateGenerationRequest & { id: string }) =>
      apiFetch<CreateGenerationResponse>(
        `/generations/${id}/regenerate`,
        { method: "POST", json: body },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["generations"] });
      qc.invalidateQueries({ queryKey: ["conversations"] });
    },
  });
}

export function useDeleteGeneration() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<void>(`/generations/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["generations"] });
      qc.invalidateQueries({ queryKey: ["conversations"] });
    },
  });
}

/* ------------------------------ conversations ----------------------------- */

export function useConversations(opts: { archived?: boolean } = {}) {
  return useQuery({
    queryKey: ["conversations", opts.archived ? "archived" : "active"],
    queryFn: () =>
      apiFetch<Paginated<ConversationDto>>(
        `/conversations?limit=50${opts.archived ? "&archived=true" : ""}`,
      ),
    refetchInterval: (query) => {
      const pending = query.state.data?.items.some(
        (c) =>
          c.preview &&
          (c.preview.status === "pending" ||
            c.preview.status === "processing"),
      );
      return pending ? 4000 : false;
    },
  });
}

export function useConversation(id: string | null) {
  return useQuery({
    queryKey: ["conversation", id],
    queryFn: () => apiFetch<ConversationDto>(`/conversations/${id}`),
    enabled: Boolean(id),
  });
}

/** Rename, pin, or archive a chat — one PATCH for all fields. */
export function useUpdateConversation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: UpdateConversationRequest & { id: string }) =>
      apiFetch<ConversationDto>(`/conversations/${id}`, {
        method: "PATCH",
        json: body,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["conversations"] }),
  });
}

export function useDeleteConversation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<void>(`/conversations/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["conversations"] });
      qc.invalidateQueries({ queryKey: ["generations"] });
    },
  });
}

export function useShareGeneration() {
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<ShareLinkDto>(`/share/${id}`, { method: "POST" }),
  });
}

/* --------------------------------- boards --------------------------------- */

export function useBoards() {
  return useQuery({
    queryKey: ["boards"],
    queryFn: () => apiFetch<{ items: BoardDto[] }>("/boards"),
    select: (d) => d.items,
  });
}

export function useCreateBoard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) =>
      apiFetch<BoardDto>("/boards", { method: "POST", json: { name } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["boards"] }),
  });
}

export function useSaveToBoard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      boardId,
      generationId,
    }: {
      boardId: string;
      generationId: string;
    }) =>
      apiFetch(`/boards/${boardId}/items`, {
        method: "POST",
        json: { generationId },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["boards"] }),
  });
}

export function useRemoveBoardItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ boardId, itemId }: { boardId: string; itemId: string }) =>
      apiFetch<void>(`/boards/${boardId}/items/${itemId}`, {
        method: "DELETE",
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["boards"] }),
  });
}

/* --------------------------------- memory --------------------------------- */

export function useMemories() {
  return useQuery({
    queryKey: ["memories"],
    queryFn: () => apiFetch<{ items: MemoryDto[] }>("/memories"),
    select: (d) => d.items,
  });
}

export function useDeleteMemory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<void>(`/memories/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["memories"] }),
  });
}
