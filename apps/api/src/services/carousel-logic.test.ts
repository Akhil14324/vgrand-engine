import { describe, expect, it } from "vitest";
import {
  carouselSlideCount,
  composeSlidePrompt,
  DEFAULT_CAROUSEL_SLIDES,
  isCarouselRequest,
} from "./carousel-logic.js";

describe("isCarouselRequest", () => {
  it.each([
    "build, generate a carousel",
    "generate a carousel about our new menu",
    "Make an Instagram carousel for Diwali",
    "create a 5 slide carousel on skincare tips",
    "design a LinkedIn carousel",
  ])("matches %s", (p) => expect(isCarouselRequest(p)).toBe(true));

  it.each([
    "what is a carousel?",
    "how do carousels perform on Instagram",
    "generate a biryani image",
    "make a poster",
  ])("ignores %s", (p) => expect(isCarouselRequest(p)).toBe(false));
});

describe("carouselSlideCount", () => {
  it("defaults when no count is given", () => {
    expect(carouselSlideCount("generate a carousel")).toBe(DEFAULT_CAROUSEL_SLIDES);
  });
  it("reads digits and words in the common phrasings", () => {
    expect(carouselSlideCount("make a 7-slide carousel")).toBe(7);
    expect(carouselSlideCount("make a carousel of 3")).toBe(3);
    expect(carouselSlideCount("make a carousel with four slides")).toBe(4);
    expect(carouselSlideCount("make a 6 image carousel")).toBe(6);
    expect(carouselSlideCount("make a six slide instagram carousel")).toBe(6);
  });
  it("clamps to 2..10", () => {
    expect(carouselSlideCount("make a 1 slide carousel")).toBe(2);
    expect(carouselSlideCount("make a 30 slide carousel")).toBe(10);
  });
});

describe("composeSlidePrompt", () => {
  it("puts the shared style and slide position on every slide", () => {
    const a = composeSlidePrompt("warm pastel flat illustration", { prompt: "Cover: 'Spice up lunch'" }, 0, 5);
    const b = composeSlidePrompt("warm pastel flat illustration", { prompt: "Tip 1" }, 1, 5);
    for (const p of [a, b]) expect(p).toContain("warm pastel flat illustration");
    expect(a).toContain("Slide 1 of 5");
    expect(b).toContain("Slide 2 of 5");
    expect(a).toContain("Cover: 'Spice up lunch'");
  });
});
