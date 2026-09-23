"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { GenerationEvent } from "@prompthub/types";
import { API_URL } from "./config";
import { useAuth } from "./auth";

/**
 * Streams /generations/:id/events while a generation is pending/processing so
 * cards flip from shimmer to image without polling. EventSource can't set
 * headers, so the token travels as ?token= (the API accepts both).
 */
export function useGenerationStream(
  id: string | null | undefined,
  enabled: boolean,
) {
  const qc = useQueryClient();
  const { getToken } = useAuth();

  useEffect(() => {
    if (!id || !enabled) return;
    let es: EventSource | null = null;
    let cancelled = false;

    getToken().then((token) => {
      if (cancelled) return;
      const url = `${API_URL}/generations/${id}/events?token=${encodeURIComponent(token ?? "")}`;
      es = new EventSource(url);
      es.onmessage = (msg) => {
        try {
          const evt = JSON.parse(msg.data) as GenerationEvent;
          qc.invalidateQueries({ queryKey: ["generation", id] });
          qc.invalidateQueries({ queryKey: ["generations"] });
          if (evt.status === "completed" || evt.status === "failed") {
            es?.close();
          }
        } catch {
          // ignore malformed frames
        }
      };
    });

    return () => {
      cancelled = true;
      es?.close();
    };
  }, [id, enabled, getToken, qc]);
}
