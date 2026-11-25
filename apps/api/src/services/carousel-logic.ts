import {
  CAROUSEL_MAX_SLIDES,
  CAROUSEL_MIN_SLIDES,
  CAROUSEL_SLIDE_ROLES,
  type CarouselAspect,
  type CarouselDesign,
  type CarouselSlideRole,
  type CarouselSlideStatus,
  type CarouselStatus,
  type ImageSize,
} from "@catgpt/types";

/**
 * A carousel is a coordinated set of SEPARATE slide images, never N
 * variations of one prompt and never one image holding several slides. Pure
 * helpers only (no DB / model calls) so planning rules, prompts, status and
 * retry decisions are unit-testable; services/carousel.ts does the I/O.
 */

export const DEFAULT_CAROUSEL_SLIDES = 5;
export const MIN_CAROUSEL_SLIDES = CAROUSEL_MIN_SLIDES;
/** First try + 2 automatic retries per slide before it is marked failed. */
export const MAX_SLIDE_ATTEMPTS = 3;

/**
 * An action verb followed (within one clause) by "carousel" - so "generate a
 * carousel" / "build an Instagram carousel for Diwali" match, while a question
 * like "what is a carousel?" does not and keeps flowing through the normal
 * intent routing.
 */
const CAROUSEL_TRIGGER =
  /\b(?:crea[ts]e?d?|make|makes|generate?[sd]?|gen(?:erat)?e|build|design(?:ed)?|produce[sd]?|render(?:ed)?|draft|prepare|put together)\b[^.?!\n]{0,60}?\bcarousels?\b/i;

export function isCarouselRequest(prompt: string): boolean {
  return CAROUSEL_TRIGGER.test(prompt);
}

const NUMBER_WORDS: Record<string, number> = {
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

const COUNT = String.raw`(\d{1,2}|two|three|four|five|six|seven|eight|nine|ten)`;
const SLIDE_NOUN = String.raw`(?:slides?|pages?|cards?|panels?|images?|frames?|posts?)`;
const COUNT_BEFORE_NOUN = new RegExp(String.raw`\b${COUNT}[\s-]*${SLIDE_NOUN}\b`, "i");
const COUNT_AFTER_CAROUSEL = new RegExp(String.raw`\bcarousel\s+(?:of|with)\s+${COUNT}\b`, "i");
const COUNT_BEFORE_CAROUSEL = new RegExp(String.raw`\b${COUNT}[\s-]*(?:\w+\s+)?carousel\b`, "i");

function toNumber(raw: string): number {
  const n = Number(raw);
  return Number.isFinite(n) ? n : (NUMBER_WORDS[raw.toLowerCase()] ?? DEFAULT_CAROUSEL_SLIDES);
}

export function clampSlideCount(n: number): number {
  return Math.min(Math.max(Math.round(n), MIN_CAROUSEL_SLIDES), CAROUSEL_MAX_SLIDES);
}

/** How many slides the user asked for ("5-slide carousel"), else the default. Always 2..10. */
export function carouselSlideCount(prompt: string): number {
  const match =
    COUNT_AFTER_CAROUSEL.exec(prompt) ??
    COUNT_BEFORE_NOUN.exec(prompt) ??
    COUNT_BEFORE_CAROUSEL.exec(prompt);
  return clampSlideCount(match ? toNumber(match[1]!) : DEFAULT_CAROUSEL_SLIDES);
}

/**
 * The slide count for a request: an explicit count picked in the composer
 * wins, then a count written in a carousel prompt. 0 = not a carousel.
 */
export function requestedCarouselSlides(opts: {
  prompt: string;
  imageCount?: number;
  promptAsksCarousel: boolean;
}): number {
  if (opts.imageCount && opts.imageCount > 1) return clampSlideCount(opts.imageCount);
  if (opts.promptAsksCarousel) return carouselSlideCount(opts.prompt);
  return 0;
}

// ---------------------------------------------------------------------------
// Formats

/**
 * The native render size closest to each carousel format; the worker then
 * crops/resizes to the exact Instagram dimensions (CAROUSEL_DIMENSIONS).
 */
export function renderSizeForAspect(aspect: CarouselAspect): ImageSize {
  if (aspect === "portrait") return "1088x1360";
  if (aspect === "landscape") return "1536x1024";
  return "1024x1024";
}

/** Centered "cover" crop: the largest source rect with the target's ratio. */
export function coverCropRect(srcW: number, srcH: number, dstW: number, dstH: number) {
  const target = dstW / dstH;
  if (srcW / srcH > target) {
    const sw = Math.round(srcH * target);
    return { sx: Math.round((srcW - sw) / 2), sy: 0, sw, sh: srcH };
  }
  const sh = Math.round(srcW / target);
  return { sx: 0, sy: Math.round((srcH - sh) / 2), sw: srcW, sh };
}

// ---------------------------------------------------------------------------
// Plan validation

export interface PlannedSlide {
  role: CarouselSlideRole;
  title: string;
  body: string;
  visual: string;
  productLabel: string | null;
}

export interface CarouselPlan {
  title: string;
  design: CarouselDesign;
  slides: PlannedSlide[];
}

const HEX = /^#[0-9a-f]{6}$/i;
export const FALLBACK_PALETTE = ["#1F2937", "#F8FAFC", "#F59E0B"];

const str = (v: unknown, max: number) =>
  typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "";

export function normalizeDesign(
  raw: unknown,
  brand?: { colors?: string[]; typography?: string; visualStyle?: string } | null,
): CarouselDesign {
  const d = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const brandColors = (brand?.colors ?? []).filter((c) => HEX.test(c));
  const planned = Array.isArray(d.palette)
    ? d.palette.filter((c): c is string => typeof c === "string" && HEX.test(c.trim())).map((c) => c.trim())
    : [];
  return {
    // Brand mode: the brand's own colours, exactly - never AI-picked ones.
    palette: (brandColors.length ? brandColors : planned.length ? planned : FALLBACK_PALETTE).slice(0, 6),
    typography:
      str(brand?.typography, 300) ||
      str(d.typography, 300) ||
      "Bold geometric sans-serif headlines, clean sans-serif body text",
    background: str(d.background, 300) || "Clean, light, softly textured background",
    visualStyle:
      str(brand?.visualStyle, 400) ||
      str(d.visualStyle, 400) ||
      "Modern, polished editorial design with high-quality imagery",
    layout:
      str(d.layout, 300) ||
      "Generous margins, headline at the top, imagery in the centre, short supporting line below",
  };
}

/**
 * Turns the planner's JSON into exactly `count` slides, or null when it did
 * not produce enough usable ones - never padded with invented content.
 * Slide 1 is always the cover and the last slide the call to action.
 */
export function normalizeCarouselPlan(
  raw: unknown,
  count: number,
  opts: {
    fallbackTitle: string;
    productLabels?: string[];
    brand?: { colors?: string[]; typography?: string; visualStyle?: string } | null;
  },
): CarouselPlan | null {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const labels = opts.productLabels ?? [];
  const slides = (Array.isArray(r.slides) ? r.slides : [])
    .map((s): PlannedSlide | null => {
      const o = (s && typeof s === "object" ? s : {}) as Record<string, unknown>;
      const title = str(o.title, 140);
      const visual = str(o.visual, 800);
      if (!title && !visual) return null;
      const product = str(o.product ?? o.productLabel, 120);
      const role = (CAROUSEL_SLIDE_ROLES as readonly string[]).includes(String(o.role))
        ? (o.role as CarouselSlideRole)
        : "content";
      return {
        role,
        title,
        body: str(o.body, 400),
        visual: visual || title,
        // Only a real saved Product Photo label may be referenced.
        productLabel:
          labels.find((l) => l.toLowerCase() === product.toLowerCase()) ?? null,
      };
    })
    .filter((s): s is PlannedSlide => s !== null)
    .slice(0, count);
  if (slides.length < count) return null;
  slides.forEach((s, i) => {
    if (i === 0) s.role = "cover";
    else if (i === slides.length - 1) s.role = "cta";
    else if (s.role !== "content") s.role = "content";
  });
  return {
    title: str(r.title, 160) || opts.fallbackTitle,
    design: normalizeDesign(r.design, opts.brand),
    slides,
  };
}

// ---------------------------------------------------------------------------
// Slide prompt

export interface SlidePromptOptions {
  aspect: CarouselAspect;
  carouselTitle: string;
  /** Brand mode: the brand name; null in general mode (no branding at all). */
  brandName: string | null;
  /** Where the real logo file is stamped afterwards (brand mode with logo overlay). */
  logoCorner: string | null;
  /** A finished slide of this set is attached as the style reference. */
  hasStyleReference: boolean;
  /** A real brand Product Photo is attached for this slide. */
  hasProductReference: boolean;
  instructions?: string;
}

const ASPECT_TEXT: Record<CarouselAspect, string> = {
  square: "square 1:1",
  portrait: "portrait 4:5",
  landscape: "landscape 1.91:1",
};

const ROLE_TEXT: Record<CarouselSlideRole, string> = {
  cover:
    "This is the COVER slide: a scroll-stopping hero composition that introduces the topic, with the headline as the dominant element.",
  content:
    "This is a CONTENT slide: one clear point, with imagery that directly shows the subject of this slide.",
  cta: "This is the FINAL slide: a short summary and a clear call to action, visually conclusive.",
};

/**
 * The full prompt the image model sees for one slide. The shared design
 * system is repeated verbatim on every slide (that is what keeps the set one
 * series); only the content and composition change per slide.
 */
export function composeCarouselSlidePrompt(
  design: CarouselDesign,
  slide: Pick<PlannedSlide, "role" | "title" | "body" | "visual" | "productLabel">,
  index: number,
  total: number,
  o: SlidePromptOptions,
): string {
  const text = [
    slide.title ? `Headline: "${slide.title}"` : null,
    slide.body ? `Supporting text: "${slide.body}"` : null,
  ].filter(Boolean);
  return [
    `Design ONE single slide (slide ${index + 1} of ${total}) of a professional Instagram carousel titled "${o.carouselTitle}". The output is exactly one slide filling the whole ${ASPECT_TEXT[o.aspect]} canvas - never a grid, collage, mockup or several slides in one image, and do not print slide numbers or page dots.`,
    ROLE_TEXT[slide.role],
    `Shared design system (identical on every slide of this carousel): colour palette ${design.palette.join(", ")} - use these exact colours for backgrounds, shapes and text; typography: ${design.typography}; background: ${design.background}; visual style: ${design.visualStyle}; layout grid and spacing: ${design.layout}. Keep the same margins, text sizes and image quality as the rest of the set.`,
    `Slide visual: ${slide.visual}`,
    text.length
      ? `On-image text, spelled exactly as written, crisp and highly legible, and nothing else written on the slide: ${text.join(" / ")}.`
      : "No text on this slide.",
    o.aspect === "square"
      ? null
      : "Keep every word and the key subject well inside the central safe area, away from the edges, because the slide is trimmed to exact Instagram dimensions.",
    o.hasStyleReference
      ? "The LAST attached image is another slide of this same carousel: match its colour palette, typography, background treatment, spacing and finish exactly so the slides look like one series, but create a NEW composition for this slide's own content - do not copy its text, subject or layout."
      : null,
    o.hasProductReference && slide.productLabel
      ? `The FIRST attached image is the brand's real product "${slide.productLabel}": show it exactly as photographed (shape, colours, packaging, labels) as the clear hero of this slide; never redesign or substitute it.`
      : null,
    o.brandName
      ? o.logoCorner
        ? `The real ${o.brandName} logo file is placed on the finished slide afterwards in the ${o.logoCorner} corner: do not draw any logo, watermark or brand lettering, and keep that corner clear.`
        : "Do not draw, invent or approximate any logo or watermark."
      : "This is a general (unbranded) design: no logos, watermarks or invented brand names.",
    o.instructions?.trim() ? `Extra direction for this slide: ${o.instructions.trim()}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

// ---------------------------------------------------------------------------
// Status

export interface SlideState {
  position: number;
  /** A CarouselSlideStatus (stored as plain text). */
  status: CarouselSlideStatus | (string & {});
  imageUrl: string | null;
}

/**
 * A carousel is "completed" only when EVERY slide has its own image. Any
 * slide still pending/generating keeps it "generating"; once nothing is in
 * flight, missing slides make it "partial" - never a success.
 */
export function deriveCarouselStatus(slides: SlideState[]): CarouselStatus {
  if (slides.length === 0) return "failed";
  if (slides.some((s) => s.status === "pending" || s.status === "generating")) {
    return "generating";
  }
  return slides.every((s) => s.status === "completed" && s.imageUrl) ? "completed" : "partial";
}

/** What reconcile should do with a slide whose render job has settled. */
export function settleSlide(opts: {
  generationStatus: string | null;
  imageUrl: string | null;
  attempts: number;
  error: string | null;
  stopped: boolean;
}): "complete" | "retry" | "fail" | "wait" {
  const g = opts.generationStatus;
  if (g === "pending" || g === "processing") return "wait";
  if (g === "completed" && opts.imageUrl) return "complete";
  if (opts.stopped) return "fail";
  // Quota and content-policy refusals will fail the same way again.
  if (opts.error && /daily image limit|disallowed content|safety|moderation/i.test(opts.error)) {
    return "fail";
  }
  return opts.attempts < MAX_SLIDE_ATTEMPTS ? "retry" : "fail";
}

/**
 * Which pending slides may start now. The cover renders first so the other
 * slides can take it as their style reference; once it has settled (or when
 * another finished slide can serve as the reference) the rest go in parallel.
 */
export function startableSlides<T extends SlideState>(slides: T[]): T[] {
  const pending = slides.filter((s) => s.status === "pending");
  if (pending.length === 0) return [];
  const cover = slides.reduce((a, b) => (b.position < a.position ? b : a));
  const coverSettled = cover.status === "completed" || cover.status === "failed";
  const otherReference = slides.some(
    (s) => s !== cover && s.status === "completed" && s.imageUrl,
  );
  if (coverSettled || otherReference) return pending;
  return pending.filter((s) => s === cover);
}

/** "slide-03" style filenames for the download. */
export function slideFileName(base: string, position: number, ext = "png"): string {
  const slug =
    base
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "carousel";
  return `${slug}-slide-${String(position + 1).padStart(2, "0")}.${ext}`;
}
