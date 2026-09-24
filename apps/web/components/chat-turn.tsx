"use client";

import { useState } from "react";
import { AlertCircle, FileText, Loader2, X } from "lucide-react";
import type { GenerationDto } from "@catgpt/types";
import { useGenerationStream } from "@/lib/sse";
import { useStudio } from "@/lib/store";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Markdown } from "./markdown";
import { ActionRow } from "./generation-actions";

/**
 * One chat turn: the user's prompt bubble (right) + the assistant reply
 * (left) — an image for kind="image", a text bubble for kind="text".
 * Images open a lightbox on click.
 */
export function ChatTurn({ generation }: { generation: GenerationDto }) {
  const { select, selectedId } = useStudio();
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const inFlight =
    generation.status === "pending" || generation.status === "processing";
  useGenerationStream(generation.id, inFlight);

  const image = generation.imageUrls[0];
  const meta = (generation.metadata ?? {}) as Record<string, unknown>;
  const refImages = (meta.referenceImageUrls as string[] | undefined) ?? [];
  const active = selectedId === generation.id;

  return (
    <div className="flex flex-col gap-3 animate-fade-in">
      {/* User turn */}
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-accent px-4 py-2.5 sm:max-w-[70%]">
          {refImages.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {refImages.map((url, i) => (
                <button
                  key={url}
                  onClick={() => setLightboxUrl(url)}
                  aria-label={`Preview reference ${i + 1}`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={url}
                    alt={`reference ${i + 1}`}
                    className="h-10 w-10 rounded-md object-cover"
                  />
                </button>
              ))}
            </div>
          )}
          <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
            {generation.prompt}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center justify-end gap-1.5">
            {generation.theme && (
              <Badge variant="default" className="text-[10px]">
                /{generation.theme.slug}
              </Badge>
            )}
            {generation.parentId && (
              <Badge variant="outline" className="text-[10px]">
                edit
              </Badge>
            )}
            {(
              meta.attachedDocuments as
                | { id: string; filename: string; storageUrl?: string | null }[]
                | undefined
            )?.map((d) => (
              <Badge key={d.id} variant="outline" className="text-[10px]">
                <button
                  onClick={() =>
                    d.storageUrl &&
                    window.open(d.storageUrl, "_blank", "noopener")
                  }
                  className="flex items-center gap-1"
                  aria-label={`Open ${d.filename}`}
                >
                  <FileText className="h-2.5 w-2.5" />
                  {d.filename}
                </button>
              </Badge>
            ))}
          </div>
        </div>
      </div>

      {/* Assistant turn — image or text reply inline in the thread */}
      <div className="flex flex-col items-start gap-2">
        {generation.status === "failed" ? (
          <div className="flex max-w-md items-start gap-2.5 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <p className="break-words text-xs leading-relaxed text-muted-foreground">
              {generation.error ?? "Generation failed"}
            </p>
          </div>
        ) : generation.kind === "text" ? (
          generation.textResponse ? (
            <div className="max-w-[85%] sm:max-w-[75%]">
              <Markdown>{generation.textResponse}</Markdown>
              {inFlight && (
                <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse rounded-sm bg-primary/70 align-text-bottom" />
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-xl border px-4 py-3 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {generation.status === "processing" ? "Answering…" : "Queued…"}
            </div>
          )
        ) : image ? (
          <button
            onClick={() => {
              select(generation.id);
              setLightboxUrl(image);
            }}
            className={cn(
              "block max-w-md overflow-hidden rounded-xl border transition-shadow hover:shadow-lg",
              active && "ring-1 ring-primary",
            )}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={image}
              alt={generation.prompt}
              className="w-full object-cover"
              loading="lazy"
            />
          </button>
        ) : (
          <div className="shimmer flex aspect-square w-full max-w-md items-center justify-center rounded-xl border">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {generation.status === "processing" ? "Generating…" : "Queued…"}
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <ActionRow generation={generation} />
          <span className="text-[10px] text-muted-foreground">
            {generation.model ?? generation.provider}
            {typeof meta.latencyMs === "number" &&
              ` · ${(meta.latencyMs / 1000).toFixed(1)}s`}
          </span>
        </div>
      </div>

      {/* Full-size preview — generated image or an attached reference */}
      {lightboxUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 animate-fade-in"
          onClick={() => setLightboxUrl(null)}
        >
          <button
            className="absolute right-4 top-4 rounded-md p-1.5 text-white/80 hover:text-white"
            aria-label="Close preview"
          >
            <X className="h-5 w-5" />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={lightboxUrl}
            alt={generation.prompt}
            className="max-h-[90dvh] max-w-[92vw] rounded-lg object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
