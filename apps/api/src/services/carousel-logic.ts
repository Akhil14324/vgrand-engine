import { SOCIAL_MAX_CAROUSEL_IMAGES } from "@catgpt/types";

/**
 * "Make a carousel" is a request for a coordinated set of separate slides,
 * not N variations of one prompt. Pure helpers only (no DB / model calls) so
 * the routing and prompt rules are unit-testable; the planner that actually
 * writes the slide briefs lives in image-batch.ts.
 */

export const DEFAULT_CAROUSEL_SLIDES = 5;
export const MIN_CAROUSEL_SLIDES = 2;

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

/** How many slides the user asked for ("5-slide carousel"), else the default. Always 2..10. */
export function carouselSlideCount(prompt: string): number {
  const match =
    COUNT_AFTER_CAROUSEL.exec(prompt) ??
    COUNT_BEFORE_NOUN.exec(prompt) ??
    COUNT_BEFORE_CAROUSEL.exec(prompt);
  const n = match ? toNumber(match[1]!) : DEFAULT_CAROUSEL_SLIDES;
  return Math.min(Math.max(n, MIN_CAROUSEL_SLIDES), SOCIAL_MAX_CAROUSEL_IMAGES);
}

/**
 * The prompt the image model sees for one slide. Each slide is generated as
 * its own image, so the shared style line is repeated verbatim on every one -
 * that is what keeps the set looking like one series.
 */
export function composeSlidePrompt(
  style: string,
  slide: { prompt: string },
  index: number,
  total: number,
): string {
  return [
    `Slide ${index + 1} of ${total} in a social media carousel. Every slide in the set shares one visual style: ${style.trim()}`,
    slide.prompt.trim(),
  ]
    .filter(Boolean)
    .join("\n\n");
}
