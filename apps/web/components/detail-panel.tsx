"use client";

import { useMemo } from "react";
import { AlertCircle, Loader2, MousePointerClick, X } from "lucide-react";
import { useGeneration, useGenerations } from "@/lib/hooks";
import { useGenerationStream } from "@/lib/sse";
import { useStudio } from "@/lib/store";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { ActionRow } from "./generation-actions";

function MetaRow({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div className="flex items-center justify-between gap-3 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="truncate font-mono">{value}</span>
    </div>
  );
}

export function DetailPanel({
  id,
  onClose,
}: {
  /** Explicit id (mobile sheet). When omitted, falls back to selection → latest. */
  id?: string | null;
  /** When provided, renders a header with a close button. */
  onClose?: () => void;
}) {
  const { selectedId } = useStudio();
  // Fall back to the most recent generation so the panel is never dead space.
  const { data: list } = useGenerations();
  const effectiveId = useMemo(
    () =>
      id !== undefined ? id : (selectedId ?? list?.items[0]?.id ?? null),
    [id, selectedId, list],
  );
  const { data: gen } = useGeneration(effectiveId);

  const inFlight =
    gen?.status === "pending" || gen?.status === "processing";
  useGenerationStream(gen?.id ?? null, inFlight);

  if (!gen) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center">
        <div className="text-muted-foreground">
          <MousePointerClick className="mx-auto mb-2 h-5 w-5" />
          <p className="text-sm">Select a generation to inspect it</p>
        </div>
      </div>
    );
  }

  const meta = (gen.metadata ?? {}) as Record<string, unknown>;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {onClose && (
        <div className="flex items-center justify-between border-b px-4 py-2.5">
          <span className="font-display text-sm font-semibold">
            Generation details
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={onClose}
            aria-label="Close details"
          >
            <X />
          </Button>
        </div>
      )}
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-4 p-4">
        <div className="overflow-hidden rounded-lg border bg-muted/40">
          {gen.imageUrls[0] ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={gen.imageUrls[0]}
              alt={gen.prompt}
              className="w-full object-cover"
            />
          ) : gen.status === "failed" ? (
            <div className="flex aspect-square flex-col items-center justify-center gap-2 p-4 text-center">
              <AlertCircle className="h-6 w-6 text-destructive" />
              <p className="text-xs text-muted-foreground">{gen.error}</p>
            </div>
          ) : (
            <div className="shimmer flex aspect-square items-center justify-center">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {gen.status === "processing" ? "Generating…" : "Queued…"}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            {gen.theme ? (
              <Badge variant="default">/{gen.theme.slug}</Badge>
            ) : (
              <Badge variant="muted">freeform</Badge>
            )}
            <Badge variant="outline" className="capitalize">
              {gen.status}
            </Badge>
          </div>
          <ActionRow generation={gen} />
        </div>

        <div>
          <div className="mb-1 text-xs font-medium text-muted-foreground">
            Prompt
          </div>
          <p className="rounded-md border bg-card/60 p-2.5 text-sm leading-relaxed">
            {gen.prompt}
          </p>
        </div>

        <details className="group">
          <summary className="cursor-pointer text-xs font-medium text-muted-foreground transition-colors hover:text-foreground">
            Final prompt sent to model
          </summary>
          <p className="mt-1.5 whitespace-pre-wrap rounded-md border bg-card/60 p-2.5 font-mono text-[11px] leading-relaxed text-muted-foreground">
            {gen.finalPrompt}
          </p>
        </details>

        <Separator />

        <div className="flex flex-col gap-1.5">
          <div className="text-xs font-medium text-muted-foreground">
            Generation details
          </div>
          <MetaRow label="Provider" value={gen.provider} />
          <MetaRow label="Model" value={gen.model} />
          <MetaRow label="Quality" value={meta.quality as string | undefined} />
          <MetaRow label="Size" value={meta.size as string | undefined} />
          <MetaRow
            label="Latency"
            value={
              typeof meta.latencyMs === "number"
                ? `${(meta.latencyMs / 1000).toFixed(1)}s`
                : undefined
            }
          />
          <MetaRow
            label="Created"
            value={new Date(gen.createdAt).toLocaleString()}
          />
          {gen.parentId && <MetaRow label="Edit of" value={gen.parentId} />}
          {meta.fellBack === true && (
            <MetaRow label="Note" value="fell back to OpenAI" />
          )}
        </div>
        </div>
      </ScrollArea>
    </div>
  );
}
