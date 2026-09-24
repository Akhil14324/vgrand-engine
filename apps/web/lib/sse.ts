"use client";

import { useEffect } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import type {
  GenerationDto,
  GenerationEvent,
  Paginated,
} from "@catgpt/types";
import { API_URL } from "./config";
import { useAuth } from "./auth";

/**
 * In-flight stream buffers. The generations list polls every 4s while a turn
 * is pending — the DB row has textResponse=null mid-stream, so a refetch would
 * wipe accumulated tokens. Buffering here makes the stream survive refetches.
 */
const streamBuffers = new Map<string, string>();

function cachedText(qc: QueryClient, generationId: string): string | null {
  const single = qc.getQueryData<GenerationDto>(["generation", generationId]);
  if (single?.textResponse) return single.textResponse;
  const lists = qc.getQueriesData<Paginated<GenerationDto>>({
    queryKey: ["generations"],
  });
  for (const [, data] of lists) {
    const hit = data?.items.find((g) => g.id === generationId);
    if (hit?.textResponse) return hit.textResponse;
  }
  return null;
}

/** Append a streamed token to every cached copy of the generation. */
function appendDelta(qc: QueryClient, generationId: string, delta: string) {
  const acc =
    (streamBuffers.get(generationId) ?? cachedText(qc, generationId) ?? "") +
    delta;
  streamBuffers.set(generationId, acc);

  const apply = (g: GenerationDto): GenerationDto =>
    g.id === generationId ? { ...g, textResponse: acc } : g;

  qc.setQueryData<GenerationDto>(["generation", generationId], (old) =>
    old ? apply(old) : old,
  );
  qc.setQueriesData<Paginated<GenerationDto>>(
    { queryKey: ["generations"] },
    (old) =>
      old ? { ...old, items: old.items.map(apply) } : old,
  );
}

/** Flag a turn as "searching the web" until its first answer token lands. */
function markSearching(qc: QueryClient, generationId: string) {
  const apply = (g: GenerationDto): GenerationDto =>
    g.id === generationId
      ? { ...g, metadata: { ...(g.metadata ?? {}), searching: true } }
      : g;
  qc.setQueryData<GenerationDto>(["generation", generationId], (old) =>
    old ? apply(old) : old,
  );
  qc.setQueriesData<Paginated<GenerationDto>>(
    { queryKey: ["generations"] },
    (old) => (old ? { ...old, items: old.items.map(apply) } : old),
  );
}

/** Show a progressive preview while the final image still renders — the
 * partial lands in imageUrls[0] so the card displays it instantly. */
function applyPartialImage(qc: QueryClient, generationId: string, dataUrl: string) {
  const apply = (g: GenerationDto): GenerationDto =>
    g.id === generationId
      ? { ...g, imageUrls: [dataUrl, ...g.imageUrls.slice(1)] }
      : g;
  qc.setQueryData<GenerationDto>(["generation", generationId], (old) =>
    old ? apply(old) : old,
  );
  qc.setQueriesData<Paginated<GenerationDto>>(
    { queryKey: ["generations"] },
    (old) =>
      old ? { ...old, items: old.items.map(apply) } : old,
  );
}

/**
 * Streams /generations/:id/events while a generation is pending/processing so
 * cards flip from shimmer to image without polling — and chat replies render
 * token-by-token via delta events. EventSource can't set headers, so the
 * token travels as ?token= (the API accepts both).
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
      // Signed out (or session not ready): an anonymous stream would only 401 and retry.
      if (cancelled || !token) return;
      const url = `${API_URL}/generations/${id}/events?token=${encodeURIComponent(token)}`;
      es = new EventSource(url);
      // EventSource retries forever by itself; give up on a dead stream (the
      // list polling covers status) instead of hammering the API.
      es.onerror = () => {
        if (es?.readyState === EventSource.CLOSED) return;
        es?.close();
      };
      es.onmessage = (msg) => {
        try {
          const evt = JSON.parse(msg.data) as GenerationEvent;
          if (evt.delta) {
            appendDelta(qc, evt.generationId, evt.delta);
          } else if (evt.partialImage) {
            applyPartialImage(qc, evt.generationId, evt.partialImage);
          } else if (evt.searching) {
            markSearching(qc, evt.generationId);
          } else {
            qc.invalidateQueries({ queryKey: ["generation", id] });
            qc.invalidateQueries({ queryKey: ["generations"] });
            qc.invalidateQueries({ queryKey: ["conversations"] });
          }
          if (
            evt.status === "completed" ||
            evt.status === "failed" ||
            evt.status === "cancelled"
          ) {
            streamBuffers.delete(evt.generationId);
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
