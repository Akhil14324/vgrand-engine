"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import type { WebsiteConsentDto, WebsiteLeadDto, WebsiteListDto, WebsiteOverviewDto } from "@catgpt/types";
import { apiFetch, apiFetchBlob } from "@/lib/api";

/** Website to CatGPT integration: read-only data from the company website. */
const KEY = "website";

export const useWebsiteOverview = (days: number) =>
  useQuery({
    queryKey: [KEY, "overview", days],
    queryFn: () => apiFetch<WebsiteOverviewDto>(`/website/overview?days=${days}`),
    refetchInterval: 60_000,
    retry: false,
  });

export const useWebsiteLeads = (page: number, q: string) =>
  useQuery({
    queryKey: [KEY, "leads", page, q],
    queryFn: () => {
      const p = new URLSearchParams({ page: String(page) });
      if (q.trim()) p.set("q", q.trim());
      return apiFetch<WebsiteListDto<WebsiteLeadDto>>(`/website/leads?${p}`);
    },
    placeholderData: (prev) => prev,
    refetchInterval: 60_000,
    retry: false,
  });

export const useWebsiteConsents = (page: number) =>
  useQuery({
    queryKey: [KEY, "consents", page],
    queryFn: () => apiFetch<WebsiteListDto<WebsiteConsentDto>>(`/website/consents?page=${page}`),
    placeholderData: (prev) => prev,
    refetchInterval: 60_000,
    retry: false,
  });

export const useExportWebsiteLeads = () =>
  useMutation({
    mutationFn: async (q: string) => {
      const p = new URLSearchParams();
      if (q.trim()) p.set("q", q.trim());
      const url = URL.createObjectURL(await apiFetchBlob(`/website/leads/export?${p}`));
      const a = document.createElement("a");
      a.href = url;
      a.download = `website-leads-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    },
  });
