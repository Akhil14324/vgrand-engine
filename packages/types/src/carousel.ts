import { z } from "zod";

/**
 * AI carousel: a planned set of separate, connected slide images. Shared by
 * the API (planning, per-slide jobs) and the web gallery/editor.
 */

export const CAROUSEL_MIN_SLIDES = 2;
export const CAROUSEL_MAX_SLIDES = 10;
/** Slide counts offered in the composer. */
export const CAROUSEL_SLIDE_OPTIONS = [3, 4, 5, 6, 7, 8, 9, 10] as const;

export const CAROUSEL_ASPECTS = ["square", "portrait", "landscape"] as const;
export type CarouselAspect = (typeof CAROUSEL_ASPECTS)[number];

/** Exact Instagram output size for each carousel format. */
export const CAROUSEL_DIMENSIONS: Record<
  CarouselAspect,
  { width: number; height: number; label: string }
> = {
  square: { width: 1080, height: 1080, label: "Square 1080 × 1080" },
  portrait: { width: 1080, height: 1350, label: "Portrait 1080 × 1350" },
  landscape: { width: 1080, height: 566, label: "Landscape 1080 × 566" },
};

export const CAROUSEL_SLIDE_ROLES = ["cover", "content", "cta"] as const;
export type CarouselSlideRole = (typeof CAROUSEL_SLIDE_ROLES)[number];

export const CAROUSEL_STATUSES = [
  "planning",
  "generating",
  "completed",
  "partial",
  "failed",
] as const;
export type CarouselStatus = (typeof CAROUSEL_STATUSES)[number];

export const CAROUSEL_SLIDE_STATUSES = [
  "pending",
  "generating",
  "completed",
  "failed",
] as const;
export type CarouselSlideStatus = (typeof CAROUSEL_SLIDE_STATUSES)[number];

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);

/** The one design system every slide repeats, so the set reads as a series. */
export const carouselDesignSchema = z.object({
  palette: z.array(hex).min(1).max(6),
  typography: z.string().min(1).max(300),
  background: z.string().min(1).max(300),
  visualStyle: z.string().min(1).max(400),
  layout: z.string().min(1).max(300),
});
export type CarouselDesign = z.infer<typeof carouselDesignSchema>;

export interface CarouselSlideDto {
  id: string;
  position: number;
  role: CarouselSlideRole;
  title: string;
  body: string;
  visual: string;
  productLabel: string | null;
  imageUrl: string | null;
  source: "ai" | "upload";
  status: CarouselSlideStatus;
  attempts: number;
  error: string | null;
}

export interface CarouselDto {
  id: string;
  generationId: string;
  brandId: string | null;
  prompt: string;
  title: string;
  aspect: CarouselAspect;
  width: number;
  height: number;
  design: CarouselDesign | null;
  status: CarouselStatus;
  error: string | null;
  slides: CarouselSlideDto[];
  createdAt: string;
  updatedAt: string;
}

export const updateCarouselSchema = z.object({
  title: z.string().max(160).optional(),
  design: carouselDesignSchema.partial().optional(),
  aspect: z.enum(CAROUSEL_ASPECTS).optional(),
  /** Re-render every slide with the (new) design/format. */
  regenerateAll: z.boolean().optional(),
});
export type UpdateCarouselRequest = z.infer<typeof updateCarouselSchema>;

export const updateCarouselSlideSchema = z.object({
  title: z.string().max(140).optional(),
  body: z.string().max(400).optional(),
  visual: z.string().max(800).optional(),
  /** Re-render this slide's image with the new text. */
  regenerate: z.boolean().optional(),
});
export type UpdateCarouselSlideRequest = z.infer<typeof updateCarouselSlideSchema>;

export const regenerateCarouselSlideSchema = z.object({
  /** Optional extra direction for this render only ("make the walnut bigger"). */
  instructions: z.string().max(600).optional(),
});

export const addCarouselSlideSchema = z.object({
  /** 0-based insert position; omitted = before the final CTA slide. */
  position: z.number().int().min(0).max(CAROUSEL_MAX_SLIDES).optional(),
  /** What the new slide should be about; empty = the AI picks the next point. */
  idea: z.string().max(600).optional(),
});
export type AddCarouselSlideRequest = z.infer<typeof addCarouselSlideSchema>;

export const replaceCarouselSlideImageSchema = z.object({
  imageUrl: z.string().url(),
});

export const reorderCarouselSchema = z.object({
  slideIds: z.array(z.string().uuid()).min(1).max(CAROUSEL_MAX_SLIDES),
});

/** One row of the progress list shown while a carousel is being made. */
export interface CarouselProgressStep {
  label: string;
  state: "done" | "active" | "pending" | "failed";
}

/**
 * The visible progress list, derived only from stored state - "Final
 * validation" is never done unless every requested slide has an image.
 */
export function carouselProgressSteps(c: Pick<CarouselDto, "status" | "slides">): CarouselProgressStep[] {
  const planned = c.status !== "planning" && c.slides.length > 0;
  const steps: CarouselProgressStep[] = [
    {
      label: "Planning carousel structure",
      state: c.status === "planning" ? "active" : c.status === "failed" && !planned ? "failed" : "done",
    },
  ];
  for (const s of c.slides) {
    steps.push({
      label: `Generating slide ${s.position + 1}${s.title ? ` - ${s.title}` : ""}`,
      state:
        s.status === "completed"
          ? "done"
          : s.status === "generating"
            ? "active"
            : s.status === "failed"
              ? "failed"
              : "pending",
    });
  }
  const allDone = planned && c.slides.every((s) => s.status === "completed" && s.imageUrl);
  steps.push({
    label: "Final validation",
    state: allDone && c.status === "completed" ? "done" : c.status === "partial" ? "failed" : "pending",
  });
  return steps;
}
