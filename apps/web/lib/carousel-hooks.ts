"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AddCarouselSlideRequest,
  CarouselDto,
  UpdateCarouselRequest,
  UpdateCarouselSlideRequest,
} from "@catgpt/types";
import { apiFetch, apiFetchBlob } from "./api";
import { toast } from "@/components/ui/toaster";

const key = (id: string) => ["carousel", id] as const;

/** How often a settled (complete / partial) carousel re-checks for changes made elsewhere. */
const SETTLED_POLL_MS = 15_000;

/**
 * Polls fast (2.5s) while the carousel is being planned or any slide is
 * rendering. Once settled it keeps a slow poll while the tab is visible and
 * refetches when the window regains focus, so edits made in another tab or
 * through the API show up without a reload.
 */
export function useCarousel(id: string | null) {
  return useQuery({
    queryKey: ["carousel", id],
    queryFn: () => apiFetch<CarouselDto>(`/carousels/${id}`),
    enabled: Boolean(id),
    // The app default (no focus refetch, 30s fresh) suits static data; a
    // carousel can change from anywhere, so always re-check on focus.
    staleTime: 0,
    refetchOnWindowFocus: "always",
    refetchIntervalInBackground: false,
    refetchInterval: (q) => {
      const c = q.state.data;
      if (!c) return 2500;
      return c.status === "planning" ||
        c.status === "generating" ||
        c.slides.some((s) => s.status === "generating" || s.status === "pending")
        ? 2500
        : SETTLED_POLL_MS;
    },
  });
}

/** Every carousel edit returns the fresh carousel; also refresh the chat turn that hosts it. */
function useCarouselMutation<V>(
  id: string,
  fn: (vars: V) => Promise<CarouselDto>,
  success?: string,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (c) => {
      qc.setQueryData(key(id), c);
      qc.invalidateQueries({ queryKey: ["generation", c.generationId] });
      qc.invalidateQueries({ queryKey: ["generations"] });
      qc.invalidateQueries({ queryKey: ["usage"] });
      if (success) toast.success(success);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Something went wrong"),
  });
}

export function useUpdateCarousel(id: string) {
  return useCarouselMutation(id, (body: UpdateCarouselRequest) =>
    apiFetch<CarouselDto>(`/carousels/${id}`, { method: "PATCH", json: body }),
  );
}

export function useUpdateCarouselSlide(id: string) {
  return useCarouselMutation(id, ({ slideId, ...body }: UpdateCarouselSlideRequest & { slideId: string }) =>
    apiFetch<CarouselDto>(`/carousels/${id}/slides/${slideId}`, { method: "PATCH", json: body }),
  );
}

export function useRegenerateCarouselSlide(id: string) {
  return useCarouselMutation(id, ({ slideId, instructions }: { slideId: string; instructions?: string }) =>
    apiFetch<CarouselDto>(`/carousels/${id}/slides/${slideId}/regenerate`, {
      method: "POST",
      json: { instructions },
    }),
  );
}

export function useReplaceCarouselSlide(id: string) {
  return useCarouselMutation(
    id,
    async ({ slideId, file }: { slideId: string; file: File }) => {
      const form = new FormData();
      form.append("file", file);
      const { url } = await apiFetch<{ url: string }>("/uploads", { method: "POST", body: form });
      return apiFetch<CarouselDto>(`/carousels/${id}/slides/${slideId}/replace`, {
        method: "POST",
        json: { imageUrl: url },
      });
    },
    "Image replaced",
  );
}

export function useDeleteCarouselSlide(id: string) {
  return useCarouselMutation(id, (slideId: string) =>
    apiFetch<CarouselDto>(`/carousels/${id}/slides/${slideId}`, { method: "DELETE" }),
  );
}

export function useAddCarouselSlide(id: string) {
  return useCarouselMutation(id, (body: AddCarouselSlideRequest) =>
    apiFetch<CarouselDto>(`/carousels/${id}/slides`, { method: "POST", json: body }),
  );
}

export function useReorderCarousel(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (slideIds: string[]) =>
      apiFetch<CarouselDto>(`/carousels/${id}/reorder`, { method: "POST", json: { slideIds } }),
    // Optimistic: the new order shows at once; a failure snaps back.
    onMutate: async (slideIds) => {
      await qc.cancelQueries({ queryKey: key(id) });
      const prev = qc.getQueryData<CarouselDto>(key(id));
      if (prev) {
        const byId = new Map(prev.slides.map((s) => [s.id, s]));
        qc.setQueryData<CarouselDto>(key(id), {
          ...prev,
          slides: slideIds.map((sid, position) => ({ ...byId.get(sid)!, position })),
        });
      }
      return { prev };
    },
    onError: (err, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(key(id), ctx.prev);
      toast.error(err instanceof Error ? err.message : "Could not reorder");
    },
    onSuccess: (c) => {
      qc.setQueryData(key(id), c);
      qc.invalidateQueries({ queryKey: ["generation", c.generationId] });
    },
  });
}

export function useRetryCarousel(id: string) {
  return useCarouselMutation(id, () =>
    apiFetch<CarouselDto>(`/carousels/${id}/retry`, { method: "POST" }),
  );
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** All slides as separate image files, zipped by the API. */
export async function downloadCarouselZip(c: CarouselDto) {
  const blob = await apiFetchBlob(`/carousels/${c.id}/download`);
  const base = (c.title || "carousel").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "carousel";
  saveBlob(blob, `${base}-carousel.zip`);
}

/** One slide as its own file. */
export async function downloadCarouselSlide(c: CarouselDto, position: number, url: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error("Could not download this slide");
  const blob = await res.blob();
  const ext = blob.type.includes("jpeg") ? "jpg" : blob.type.includes("webp") ? "webp" : "png";
  const base = (c.title || "carousel").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "carousel";
  saveBlob(blob, `${base}-slide-${String(position + 1).padStart(2, "0")}.${ext}`);
}
