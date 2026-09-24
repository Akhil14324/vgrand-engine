"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type {
  ConversationDto,
  CreateGenerationRequest,
  DocumentDto,
  GenerationDto,
  GenerationKind,
  MemoryDto,
  Paginated,
  RegenerateGenerationRequest,
  ShareLinkDto,
  ThemeDto,
  UpdateConversationRequest,
  WorkspaceDetailDto,
  WorkspaceDto,
} from "@catgpt/types";
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
      qc.invalidateQueries({ queryKey: ["usage"] });
    },
  });
}

export interface ImageUsageDto {
  used: number;
  limit: number;
  remaining: number;
  resetsAt: string;
}

export function useImageUsage() {
  return useQuery({
    queryKey: ["usage"],
    queryFn: () => apiFetch<ImageUsageDto>("/usage"),
    staleTime: 30_000,
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
      qc.invalidateQueries({ queryKey: ["usage"] });
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

export function useConversations(
  opts: { archived?: boolean; search?: string } = {},
) {
  const search = opts.search?.trim();
  return useQuery({
    queryKey: [
      "conversations",
      opts.archived ? "archived" : "active",
      search ?? "",
    ],
    queryFn: () =>
      apiFetch<Paginated<ConversationDto>>(
        `/conversations?limit=50${opts.archived ? "&archived=true" : ""}${
          search ? `&search=${encodeURIComponent(search)}` : ""
        }`,
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

/** Mirrors the server ordering: pinned first, then most recently active. */
const sortConversations = (items: ConversationDto[]) =>
  [...items].sort(
    (a, b) =>
      Number(b.pinned) - Number(a.pinned) ||
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );

type ConvoSnapshot = [readonly unknown[], Paginated<ConversationDto> | undefined][];

/** Snapshot + rollback helpers shared by the two optimistic mutations. */
const convoCaches = (qc: ReturnType<typeof useQueryClient>) =>
  qc.getQueriesData<Paginated<ConversationDto>>({
    queryKey: ["conversations"],
  }) as ConvoSnapshot;

const rollback = (
  qc: ReturnType<typeof useQueryClient>,
  snap?: ConvoSnapshot,
) => {
  for (const [key, data] of snap ?? []) qc.setQueryData(key, data);
};

/** Rename, pin, or archive a chat — one PATCH, applied optimistically. */
export function useUpdateConversation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: UpdateConversationRequest & { id: string }) =>
      apiFetch<ConversationDto>(`/conversations/${id}`, {
        method: "PATCH",
        json: body,
      }),
    onMutate: async ({ id, ...body }) => {
      await qc.cancelQueries({ queryKey: ["conversations"] });
      const prev = convoCaches(qc);
      // Find the conversation in whichever cached list holds it.
      let convo: ConversationDto | undefined;
      for (const [, data] of prev) {
        convo = convo ?? data?.items.find((c) => c.id === id);
      }
      if (!convo) return { prev };
      const patched = { ...convo, ...body };
      const targetArchived = body.archived ?? convo.archived;
      for (const [key, data] of prev) {
        if (!data) continue;
        const isArchivedList = key[1] === "archived";
        // An archived-toggle moves the chat between the two lists.
        const belongs = targetArchived === isArchivedList;
        const items = data.items.filter((c) => c.id !== id);
        if (belongs) items.push(patched);
        qc.setQueryData(key, { ...data, items: sortConversations(items) });
      }
      return { prev };
    },
    onError: (_e, _v, ctx) => rollback(qc, ctx?.prev),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["conversations"] }),
  });
}

export function useDeleteConversation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<void>(`/conversations/${id}`, { method: "DELETE" }),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ["conversations"] });
      const prev = convoCaches(qc);
      for (const [key, data] of prev) {
        if (!data) continue;
        qc.setQueryData(key, {
          ...data,
          items: data.items.filter((c) => c.id !== id),
        });
      }
      return { prev };
    },
    onError: (_e, _v, ctx) => rollback(qc, ctx?.prev),
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

/* -------------------------------- documents ------------------------------- */

/** Documents attached to a conversation — powers the doc chips on reopened chats. */
export function useDocuments(conversationId: string | null) {
  return useQuery({
    queryKey: ["documents", conversationId],
    enabled: !!conversationId,
    queryFn: () =>
      apiFetch<{ items: DocumentDto[] }>(
        `/documents?conversationId=${conversationId}`,
      ),
    select: (d) => d.items.filter((doc) => doc.status !== "failed"),
  });
}

/** Render a text reply to PDF server-side; returns the file URL. */
export function useExportPdf() {
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ url: string }>(`/generations/${id}/pdf`, { method: "POST" }),
  });
}

/* -------------------------------- workspaces ------------------------------ */

export function useWorkspaces() {
  return useQuery({
    queryKey: ["workspaces"],
    queryFn: () => apiFetch<{ items: WorkspaceDto[] }>("/workspaces"),
    select: (d) => d.items,
  });
}

/** One workspace + its documents for the detail column. */
export function useWorkspace(id: string | null) {
  return useQuery({
    queryKey: ["workspace", id],
    enabled: !!id,
    queryFn: () => apiFetch<WorkspaceDetailDto>(`/workspaces/${id}`),
    refetchInterval: (query) =>
      query.state.data?.documents.some((doc) => doc.status === "processing")
        ? 2000
        : false,
  });
}

/** Documents living in a workspace (same shape as the conversation variant). */
export function useWorkspaceDocuments(workspaceId: string | null) {
  return useQuery({
    queryKey: ["documents", "ws", workspaceId],
    enabled: !!workspaceId,
    queryFn: () =>
      apiFetch<{ items: DocumentDto[] }>(
        `/documents?workspaceId=${workspaceId}`,
      ),
    select: (d) => d.items,
  });
}

export function useCreateWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) =>
      apiFetch<WorkspaceDto>("/workspaces", {
        method: "POST",
        json: { name },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["workspaces"] }),
  });
}

export function useRenameWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      apiFetch<WorkspaceDto>(`/workspaces/${id}`, {
        method: "PATCH",
        json: { name },
      }),
    onSuccess: (_d, { id }) => {
      qc.invalidateQueries({ queryKey: ["workspaces"] });
      qc.invalidateQueries({ queryKey: ["workspace", id] });
    },
  });
}

export function useDeleteWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<void>(`/workspaces/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["workspaces"] }),
  });
}

export function useDeleteDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<void>(`/documents/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["documents"] });
      qc.invalidateQueries({ queryKey: ["workspaces"] });
      qc.invalidateQueries({ queryKey: ["workspace"] });
    },
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
