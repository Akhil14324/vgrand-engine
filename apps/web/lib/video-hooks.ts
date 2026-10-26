"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CreateVideoProjectRequest,
  ReelScript,
  SourceFolderDetailDto,
  SourceFolderDto,
  VideoBudgetDto,
  VideoProjectDto,
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
      query.state.data?.status === "scripting" || query.state.data?.status === "editing" ? 2000 : false,
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

export function useDeleteVideoProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: VideoProjectDto) => apiFetch<void>(`/video/projects/${p.id}`, { method: "DELETE" }),
    onSuccess: (_, p) => qc.invalidateQueries({ queryKey: ["video-projects", p.brandId] }),
  });
}
