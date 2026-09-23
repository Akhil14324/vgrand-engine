"use client";

import { AlertCircle, Loader2 } from "lucide-react";
import type { GenerationDto } from "@prompthub/types";
import { useGenerationStream } from "@/lib/sse";
import { useStudio } from "@/lib/store";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { ActionRow } from "./generation-actions";

export function GenerationCard({ generation }: { generation: GenerationDto }) {
  const { select, selectedId } = useStudio();
  const inFlight =
    generation.status === "pending" || generation.status === "processing";
  useGenerationStream(generation.id, inFlight);

  const image = generation.imageUrls[0];
  const active = selectedId === generation.id;

  return (
    <div
      onClick={() => select(generation.id)}
      className={cn(
        "group cursor-pointer overflow-hidden rounded-xl border bg-card transition-shadow hover:shadow-md animate-fade-in",
        active && "ring-1 ring-primary",
      )}
    >
      <div className="relative aspect-square bg-muted/40">
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={image}
            alt={generation.prompt}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : generation.status === "failed" ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center">
            <AlertCircle className="h-6 w-6 text-destructive" />
            <p className="text-xs text-muted-foreground">
              {generation.error ?? "Generation failed"}
            </p>
          </div>
        ) : (
          <div className="shimmer flex h-full items-center justify-center">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {generation.status === "processing"
                ? "Generating…"
                : "Queued…"}
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2 p-3">
        <p className="line-clamp-2 text-sm leading-snug">{generation.prompt}</p>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            {generation.theme ? (
              <Badge variant="default" className="text-[10px]">
                /{generation.theme.slug}
              </Badge>
            ) : (
              <Badge variant="muted" className="text-[10px]">
                freeform
              </Badge>
            )}
            {generation.parentId && (
              <Badge variant="outline" className="text-[10px]">
                edit
              </Badge>
            )}
          </div>
          <div onClick={(e) => e.stopPropagation()}>
            <ActionRow generation={generation} />
          </div>
        </div>
      </div>
    </div>
  );
}
