"use client";

import { Check, Download, Loader2, RefreshCw, Sparkles } from "lucide-react";
import {
  IMAGE_SIZES,
  IMAGE_STYLES,
  type GenerationDto,
  type ImageSize,
  type ImageStyle,
  type Quality,
  type VisualBrief,
} from "@catgpt/types";
import { useCreateGeneration, useSelectImage } from "@/lib/hooks";
import { occasionLabel, STYLE_LABEL } from "@/lib/image-style";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { downloadImage } from "./generation-actions";

/**
 * The curated result of an image request: what the AI understood (occasion,
 * style, match score) plus per-image Select / Download and a "Generate again"
 * that renders a fresh variation of the same brief.
 */
export function CuratedGallery({
  generation,
  activeImage,
  onActiveImage,
}: {
  generation: GenerationDto;
  activeImage: number;
  onActiveImage: (i: number) => void;
}) {
  const create = useCreateGeneration();
  const selectImage = useSelectImage();
  const meta = (generation.metadata ?? {}) as Record<string, unknown>;
  const brief = (meta.imageBrief ?? null) as VisualBrief | null;
  const scores = Array.isArray(meta.relevanceScores)
    ? (meta.relevanceScores as (number | null)[])
    : [];
  const images = generation.imageUrls;
  const ready = generation.status === "completed" && images.length > 0;
  // Only fresh drafts are curated; edits of an exact image keep their own tools.
  if (!ready || generation.parentId || (!brief && images.length < 2)) return null;

  const occasion = occasionLabel(brief?.occasion);
  const activeScore = scores[activeImage];
  const selectedUrl = typeof meta.selectedImageUrl === "string" ? meta.selectedImageUrl : null;

  const generateAgain = () => {
    const style = IMAGE_STYLES.includes(meta.style as ImageStyle)
      ? (meta.style as ImageStyle)
      : undefined;
    const size = IMAGE_SIZES.includes(meta.size as ImageSize)
      ? (meta.size as ImageSize)
      : undefined;
    create.mutate({
      prompt: generation.prompt,
      conversationId: generation.conversationId ?? undefined,
      themeSlug: generation.theme?.slug,
      brandId: typeof meta.brandId === "string" ? meta.brandId : undefined,
      quality: (meta.quality as Quality | undefined) ?? undefined,
      size,
      style: style && style !== "auto" ? style : undefined,
      imageCount: typeof meta.imageCount === "number" ? meta.imageCount : undefined,
      recreate: true,
      variationOf: generation.id,
    });
  };

  return (
    <div className="flex w-full max-w-md flex-col gap-2">
      {brief && (
        <div className="flex flex-wrap items-center gap-1.5">
          {occasion && (
            <Badge variant="default" className="text-[10px]">
              {occasion}
            </Badge>
          )}
          <Badge variant="outline" className="text-[10px]">
            {STYLE_LABEL[brief.style] ?? brief.style}
          </Badge>
          <Badge variant="outline" className="text-[10px] capitalize">
            {brief.aspect}
          </Badge>
          {typeof activeScore === "number" && (
            <Badge
              variant="outline"
              className={cn(
                "gap-1 text-[10px]",
                activeScore >= 7 ? "border-primary/50 text-primary" : "text-muted-foreground",
              )}
              title="How closely the AI judged this image matches your request"
            >
              <Sparkles className="h-2.5 w-2.5" />
              match {Math.round(activeScore)}/10
            </Badge>
          )}
          {typeof meta.reusedFrom === "string" && (
            <Badge variant="outline" className="text-[10px] text-muted-foreground">
              reused identical result
            </Badge>
          )}
        </div>
      )}

      {images.length > 1 && (
        <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4">
          {images.map((url, i) => (
            <div
              key={url}
              className={cn(
                "group relative overflow-hidden rounded-md border transition-shadow",
                i === activeImage ? "ring-1 ring-primary" : "opacity-80 hover:opacity-100",
              )}
            >
              <button
                onClick={() => onActiveImage(i)}
                aria-label={`Preview image ${i + 1} of ${images.length}`}
                className="block aspect-square w-full"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt="" className="h-full w-full object-cover" />
              </button>
              {url === selectedUrl && (
                <span className="absolute left-1 top-1 rounded-full bg-primary p-0.5 text-primary-foreground">
                  <Check className="h-2.5 w-2.5" />
                </span>
              )}
              <div className="absolute inset-x-0 bottom-0 flex justify-end gap-0.5 bg-gradient-to-t from-black/60 to-transparent p-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                <button
                  className="rounded bg-background/90 px-1.5 py-0.5 text-[10px] font-medium hover:bg-background"
                  aria-label={`Select image ${i + 1}`}
                  title="Use this image (share, edit and download use it)"
                  disabled={selectImage.isPending}
                  onClick={() =>
                    selectImage.mutate(
                      { id: generation.id, index: i },
                      { onSuccess: () => onActiveImage(0) },
                    )
                  }
                >
                  Select
                </button>
                <button
                  className="rounded bg-background/90 p-0.5 hover:bg-background"
                  aria-label={`Download image ${i + 1}`}
                  title="Download"
                  onClick={() => void downloadImage(url, `catgpt-${generation.id}-${i + 1}.png`)}
                >
                  <Download className="h-3 w-3" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1.5 text-xs"
          onClick={generateAgain}
          disabled={create.isPending}
        >
          {create.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          Generate again
        </Button>
        {images.length === 1 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 text-xs"
            onClick={() => void downloadImage(images[0]!, `catgpt-${generation.id}.png`)}
          >
            <Download className="h-3.5 w-3.5" />
            Download
          </Button>
        )}
        {create.error && (
          <span className="text-[11px] text-destructive">
            {create.error instanceof Error ? create.error.message : "Could not start"}
          </span>
        )}
      </div>
    </div>
  );
}
