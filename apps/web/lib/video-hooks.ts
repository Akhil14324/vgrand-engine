"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SourceFolderDetailDto, SourceFolderDto, VideoBudgetDto } from "@catgpt/types";
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
