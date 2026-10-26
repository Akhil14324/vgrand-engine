"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CreateReelPlanRequest,
  CreateVideoProjectRequest,
  ReelPlanItemDto,
  ReelScript,
  SourceFolderDetailDto,
  SourceFolderDto,
  VideoBudgetDto,
  VideoProjectDto,
  VideoSettingsDto,
  VideoSettingsRequest,
} from "@catgpt/types";
import { apiFetch } from "./api";

export function useSourceFolders(brandId: string | null) {
  return useQuery({
    queryKey: ["video-folders", brandId],
    queryFn: () => apiFetch<SourceFolderDto[]>(`/video/folders?brandId=${brandId}`),
    enabled: Boolean(brandId),
  });
}

export function useSourceFolder(id: string | null) {
  return useQuery({
    queryKey: ["video-folder", id],
    queryFn: () => apiFetch<SourceFolderDetailDto>(`/video/folders/${id}`),
    enabled: Boolean(id),
  });
}

export function useCreateSourceFolder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { brandId: string; name: string }) =>
      apiFetch<SourceFolderDto>("/video/folders", { method: "POST", json: body }),
    onSuccess: (folder) => qc.invalidateQueries({ queryKey: ["video-folders", folder.brandId] }),
  });
}

export function useDeleteSourceFolder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (folder: SourceFolderDto) =>
      apiFetch<void>(`/video/folders/${folder.id}`, { method: "DELETE" }),
    onSuccess: (_, folder) => qc.invalidateQueries({ queryKey: ["video-folders", folder.brandId] }),
  });
}

/** Uploads one file; the caller loops over a folder so progress and failures stay per file. */
export function useUploadSourceAsset(folderId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append("file", file);
      return apiFetch<unknown>(`/video/folders/${folderId}/assets`, { method: "POST", body: form });
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["video-folder", folderId] });
      void qc.invalidateQueries({ queryKey: ["video-folders"] });
    },
  });
}

export function useDeleteSourceAsset(folderId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (assetId: string) =>
      apiFetch<void>(`/video/folders/${folderId}/assets/${assetId}`, { method: "DELETE" }),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["video-folder", folderId] });
      void qc.invalidateQueries({ queryKey: ["video-folders"] });
    },
  });
}

export function useVideoBudget() {
  return useQuery({
    queryKey: ["video-budget"],
    queryFn: () => apiFetch<VideoBudgetDto>("/video/budget"),
    staleTime: 30_000,
  });
}

export function useVideoProjects(brandId: string | null) {
  return useQuery({
    queryKey: ["video-projects", brandId],
    queryFn: () => apiFetch<VideoProjectDto[]>(`/video/projects?brandId=${brandId}`),
    enabled: Boolean(brandId),
  });
}

/** Polls every 2s while a script is being written, then stops. */
export function useVideoProject(id: string | null) {
  return useQuery({
    queryKey: ["video-project", id],
    queryFn: () => apiFetch<VideoProjectDto>(`/video/projects/${id}`),
    enabled: Boolean(id),
    refetchInterval: (query) =>
      ["scripting", "generating", "editing"].includes(query.state.data?.status ?? "") ? 2000 : false,
  });
}

export function useCreateVideoProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateVideoProjectRequest) =>
      apiFetch<VideoProjectDto>("/video/projects", { method: "POST", json: body }),
    onSuccess: (p) => qc.invalidateQueries({ queryKey: ["video-projects", p.brandId] }),
  });
}

export function useWriteVideoScript() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<VideoProjectDto>(`/video/projects/${id}/script`, { method: "POST" }),
    onSuccess: (p) => {
      qc.setQueryData(["video-project", p.id], p);
      void qc.invalidateQueries({ queryKey: ["video-projects", p.brandId] });
    },
  });
}

export function useSaveVideoScript() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, script }: { id: string; script: ReelScript }) =>
      apiFetch<VideoProjectDto>(`/video/projects/${id}/script`, { method: "PUT", json: script }),
    onSuccess: (p) => {
      qc.setQueryData(["video-project", p.id], p);
      void qc.invalidateQueries({ queryKey: ["video-projects", p.brandId] });
    },
  });
}

export function useRenderVideoProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<VideoProjectDto>(`/video/projects/${id}/render`, { method: "POST" }),
    onSuccess: (p) => {
      qc.setQueryData(["video-project", p.id], p);
      void qc.invalidateQueries({ queryKey: ["video-projects", p.brandId] });
    },
  });
}

export function useApproveVideoProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<VideoProjectDto & { generationId: string }>(`/video/projects/${id}/approve`, { method: "POST" }),
    onSuccess: (p) => {
      qc.setQueryData(["video-project", p.id], p);
      void qc.invalidateQueries({ queryKey: ["video-projects", p.brandId] });
      void qc.invalidateQueries({ queryKey: ["generations"] });
    },
  });
}

export function useDeleteVideoProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: VideoProjectDto) => apiFetch<void>(`/video/projects/${p.id}`, { method: "DELETE" }),
    onSuccess: (_, p) => qc.invalidateQueries({ queryKey: ["video-projects", p.brandId] }),
  });
}

export function useReelPlan(brandId: string | null) {
  return useQuery({
    queryKey: ["video-plan", brandId],
    queryFn: () => apiFetch<ReelPlanItemDto[]>(`/video/plan?brandId=${brandId}`),
    enabled: Boolean(brandId),
    refetchInterval: 15_000,
  });
}

export function useCreateReelPlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateReelPlanRequest) =>
      apiFetch<{ items: ReelPlanItemDto[] }>("/video/plan", { method: "POST", json: body }),
    onSuccess: (_, body) => qc.invalidateQueries({ queryKey: ["video-plan", body.brandId] }),
  });
}

export function useRemovePlanItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (item: ReelPlanItemDto) => apiFetch<void>(`/video/plan/${item.id}`, { method: "DELETE" }),
    onSuccess: (_, item) => qc.invalidateQueries({ queryKey: ["video-plan", item.brandId] }),
  });
}

export function useSkipPlanItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (item: ReelPlanItemDto) =>
      apiFetch<ReelPlanItemDto>(`/video/plan/${item.id}/skip`, { method: "POST" }),
    onSuccess: (_, item) => qc.invalidateQueries({ queryKey: ["video-plan", item.brandId] }),
  });
}

export function useApproveBatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (projectIds: string[]) =>
      apiFetch<{ results: { projectId: string; ok: boolean; error: string | null; postQueued: boolean }[] }>(
        "/video/projects/approve-batch",
        { method: "POST", json: { projectIds } },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["video-projects"] });
      void qc.invalidateQueries({ queryKey: ["video-plan"] });
      void qc.invalidateQueries({ queryKey: ["generations"] });
    },
  });
}

export function useVideoSettings() {
  return useQuery({
    queryKey: ["video-settings"],
    queryFn: () => apiFetch<VideoSettingsDto>("/video/settings"),
  });
}

export function useSaveVideoSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: VideoSettingsRequest) =>
      apiFetch<VideoSettingsDto>("/video/settings", { method: "PUT", json: body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["video-settings"] });
      void qc.invalidateQueries({ queryKey: ["video-budget"] });
    },
  });
}
