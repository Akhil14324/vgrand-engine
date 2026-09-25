"use client";

import { useEffect, useState } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type {
  BrandAssetDto,
  BrandDto,
  ConversationDto,
  CreateBrandAssetRequest,
  CreateBrandRequest,
  CreateGenerationRequest,
  DocumentDto,
  GenerationDto,
  GenerationKind,
  MemoryDto,
  Paginated,
  RegenerateGenerationRequest,
  ShareLinkDto,
  SocialAccountDto,
  SocialPlatformsDto,
  SocialPostContent,
  SocialPostDto,
  SocialPreviewRequest,
  SocialPreviewsDto,
  ThemeDto,
  UpdateBrandRequest,
  UpdateConversationRequest,
  WorkspaceDetailDto,
  WorkspaceDto,
} from "@catgpt/types";
import {
  SOCIAL_CHANNEL,
  SOCIAL_CONNECT_WINDOW,
  apiFetch,
  openSocialConnectPopup,
} from "./api";

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

/** Stop a running turn — the worker keeps whatever it already produced. */
export function useCancelGeneration() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<void>(`/generations/${id}/cancel`, { method: "POST" }),
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
        const isSearchList = Boolean(key[2]);
        // An archived-toggle moves the chat between the two lists. Search
        // results are only edited in place: a rename must not pull a chat into
        // a search it doesn't match.
        const belongs = isSearchList
          ? data.items.some((c) => c.id === id) && targetArchived === isArchivedList
          : targetArchived === isArchivedList;
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

/* --------------------------------- brands --------------------------------- */

export function useBrands() {
  return useQuery({
    queryKey: ["brands"],
    queryFn: () => apiFetch<{ items: BrandDto[] }>("/brands"),
    select: (d) => d.items,
    staleTime: 60_000,
  });
}

export function useCreateBrand() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateBrandRequest) =>
      apiFetch<BrandDto>("/brands", { method: "POST", json: body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["brands"] }),
  });
}

type BrandsCache = { items: BrandDto[] };

/** Apply an optimistic change to the cached brand list; returns the rollback snapshot. */
async function patchBrands(
  qc: ReturnType<typeof useQueryClient>,
  fn: (items: BrandDto[]) => BrandDto[],
) {
  await qc.cancelQueries({ queryKey: ["brands"] });
  const prev = qc.getQueryData<BrandsCache>(["brands"]);
  if (prev) qc.setQueryData<BrandsCache>(["brands"], { items: fn(prev.items) });
  return { prev };
}

function restoreBrands(
  qc: ReturnType<typeof useQueryClient>,
  ctx?: { prev?: BrandsCache },
) {
  if (ctx?.prev) qc.setQueryData<BrandsCache>(["brands"], ctx.prev);
}

export function useUpdateBrand() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: UpdateBrandRequest & { id: string }) =>
      apiFetch<BrandDto>(`/brands/${id}`, { method: "PATCH", json: body }),
    // Saved instantly in the UI; the server's copy (with the recomputed
    // snapshot) replaces it when it lands - no second round-trip to refetch.
    onMutate: ({ id, ...body }) =>
      patchBrands(qc, (items) =>
        items.map((b) => (b.id === id ? { ...b, ...body } : b)),
      ),
    onError: (_e, _v, ctx) => restoreBrands(qc, ctx),
    onSuccess: (saved) =>
      qc.setQueryData<BrandsCache>(["brands"], (cur) =>
        cur
          ? { items: cur.items.map((b) => (b.id === saved.id ? saved : b)) }
          : cur,
      ),
  });
}

export function useDeleteBrand() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<void>(`/brands/${id}`, { method: "DELETE" }),
    onMutate: (id) => patchBrands(qc, (items) => items.filter((b) => b.id !== id)),
    onError: (_e, _v, ctx) => restoreBrands(qc, ctx),
    onSettled: () => qc.invalidateQueries({ queryKey: ["brands"] }),
  });
}

export function useAddBrandAsset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      brandId,
      ...body
    }: CreateBrandAssetRequest & { brandId: string }) =>
      apiFetch<BrandAssetDto>(`/brands/${brandId}/assets`, {
        method: "POST",
        json: body,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["brands"] }),
  });
}

export function useDeleteBrandAsset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ brandId, assetId }: { brandId: string; assetId: string }) =>
      apiFetch<void>(`/brands/${brandId}/assets/${assetId}`, {
        method: "DELETE",
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["brands"] }),
  });
}

/** Documents in a brand's knowledge base; polls while any is still ingesting. */
export function useBrandDocuments(brandId: string | null) {
  return useQuery({
    queryKey: ["documents", "brand", brandId],
    enabled: !!brandId,
    queryFn: () =>
      apiFetch<{ items: DocumentDto[] }>(`/documents?brandId=${brandId}`),
    select: (d) => d.items,
    refetchInterval: (query) =>
      query.state.data?.items.some((doc) => doc.status === "processing")
        ? 2000
        : false,
  });
}

/* ---------------------------- social publishing --------------------------- */

const socialAccountsKey = (workspaceId: string | null) =>
  ["social", "accounts", workspaceId ?? "personal"] as const;

export function useSocialPlatforms() {
  return useQuery({
    queryKey: ["social", "platforms"],
    queryFn: () => apiFetch<SocialPlatformsDto>("/social/platforms"),
    staleTime: 60_000,
  });
}

/** Accounts usable in this scope: the workspace's shared ones plus the user's own. */
export function useSocialAccounts(workspaceId: string | null, enabled = true) {
  return useQuery({
    queryKey: socialAccountsKey(workspaceId),
    enabled,
    queryFn: () =>
      apiFetch<{ items: SocialAccountDto[] }>(
        `/social/accounts${workspaceId ? `?workspaceId=${workspaceId}` : ""}`,
      ),
    select: (d) => d.items,
  });
}

/**
 * Starts OAuth in a popup. The window is opened synchronously (popup blockers),
 * then sent to the provider URL. Closing it - or the return page broadcasting a
 * result - refreshes the account list. Falls back to a full-page redirect when
 * popups are blocked.
 */
export function useConnectSocial() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { platform: string; workspaceId: string | null }) => {
      const popup = openSocialConnectPopup();
      try {
        const { url } = await apiFetch<{ url: string }>(
          `/social/connect/${input.platform}${input.workspaceId ? `?workspaceId=${input.workspaceId}` : ""}`,
        );
        if (!popup) {
          window.location.assign(url);
          return;
        }
        popup.location.href = url;
        const timer = window.setInterval(() => {
          if (popup.closed) {
            window.clearInterval(timer);
            void qc.invalidateQueries({ queryKey: ["social", "accounts"] });
          }
        }, 800);
      } catch (e) {
        popup?.close();
        throw e;
      }
    },
  });
}

export function useDeleteSocialAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<void>(`/social/accounts/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["social"] }),
  });
}

export function useSocialPreview(generationId: string) {
  return useMutation({
    mutationFn: (body: SocialPreviewRequest) =>
      apiFetch<SocialPreviewsDto>(`/generations/${generationId}/social-preview`, {
        method: "POST",
        json: body,
      }),
  });
}

export function useCreateSocialPosts(generationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (posts: { accountId: string; content: SocialPostContent }[]) =>
      apiFetch<{ items: SocialPostDto[] }>(`/generations/${generationId}/social-posts`, {
        method: "POST",
        json: { posts },
      }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["social", "posts", generationId] }),
  });
}

/** Polls every 2.5s while any post is pending/posting, then stops. */
export function useSocialPosts(generationId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["social", "posts", generationId],
    enabled,
    queryFn: () =>
      apiFetch<{ items: SocialPostDto[] }>(`/generations/${generationId}/social-posts`),
    select: (d) => d.items,
    refetchInterval: (query) =>
      query.state.data?.items.some(
        (p) => p.status === "pending" || p.status === "posting",
      )
        ? 2500
        : false,
  });
}

export function useRetrySocialPost(generationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (postId: string) =>
      apiFetch<SocialPostDto>(`/social-posts/${postId}/retry`, { method: "POST" }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["social", "posts", generationId] }),
  });
}

/**
 * The OAuth return page lands on /?social=connected:{connector} or
 * /?social=error:{code}. This reads and strips that param, tells the opener
 * window (BroadcastChannel) and closes itself when it is the popup; the main
 * window also listens, shows the notice and refreshes accounts.
 */
export function useSocialConnectReturn() {
  const qc = useQueryClient();
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    const describe = (result: string) => {
      const [kind, value = ""] = result.split(":");
      if (kind === "connected") {
        const names: Record<string, string> = {
          meta: "Facebook / Instagram",
          x: "X",
          youtube: "YouTube",
        };
        return { ok: true, text: `${names[value] ?? "Account"} connected` };
      }
      const errors: Record<string, string> = {
        access_denied: "Connection cancelled",
        invalid_state: "That connection link expired - try again",
        expired: "That connection link expired - try again",
        consumed: "That connection link was already used - try again",
        platform_mismatch: "Connection failed - try again",
        no_pages: "No Facebook Pages were found for that login",
        no_channel: "No YouTube channel was found on that Google account",
        no_refresh_token: "Google did not grant offline access - try again",
        forbidden: "Only the workspace owner can connect shared accounts",
        not_configured: "That platform is not configured on this server",
      };
      return { ok: false, text: errors[value] ?? "Couldn't connect the account" };
    };

    const show = (result: string) => {
      setNotice(describe(result));
      void qc.invalidateQueries({ queryKey: ["social", "accounts"] });
    };

    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel(SOCIAL_CHANNEL);
      channel.onmessage = (e: MessageEvent<{ result?: string }>) => {
        if (typeof e.data?.result === "string") show(e.data.result);
      };
    } catch {
      // BroadcastChannel unavailable - the popup-closed poll still refreshes accounts.
    }

    const param = new URLSearchParams(window.location.search).get("social");
    if (param) {
      const url = new URL(window.location.href);
      url.searchParams.delete("social");
      window.history.replaceState(null, "", url.pathname + url.search + url.hash);
      channel?.postMessage({ result: param });
      if (window.name === SOCIAL_CONNECT_WINDOW) {
        window.close();
      } else {
        show(param);
      }
    }
    return () => channel?.close();
  }, [qc]);

  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(null), 6000);
    return () => window.clearTimeout(t);
  }, [notice]);

  return notice;
}
