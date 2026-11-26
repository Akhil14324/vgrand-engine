import { describe, expect, it } from "vitest";
import {
  carouselSlideCount,
  composeCarouselSlidePrompt,
  coverCropRect,
  DEFAULT_CAROUSEL_SLIDES,
  deriveCarouselStatus,
  isCarouselRequest,
  MAX_SLIDE_ATTEMPTS,
  normalizeCarouselPlan,
  renderSizeForAspect,
  requestedCarouselSlides,
  settleSlide,
  slideFileName,
  startableSlides,
  type SlideState,
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

describe("requestedCarouselSlides", () => {
  it("an explicit composer count wins and every count 2..10 is exact", () => {
    for (const n of [3, 5, 7, 10]) {
      expect(requestedCarouselSlides({ prompt: "dry fruits", imageCount: n, promptAsksCarousel: false })).toBe(n);
    }
    expect(
      requestedCarouselSlides({ prompt: "make a 4 slide carousel", imageCount: 7, promptAsksCarousel: true }),
    ).toBe(7);
  });
  it("falls back to the count in a carousel prompt, else not a carousel", () => {
    expect(requestedCarouselSlides({ prompt: "make a 6 slide carousel", promptAsksCarousel: true })).toBe(6);
    expect(requestedCarouselSlides({ prompt: "a cat", imageCount: 1, promptAsksCarousel: false })).toBe(0);
  });
});

const rawPlan = (n: number) => ({
  title: "Benefits of dry fruits",
  design: {
    palette: ["#123456", "nope", "#ABCDEF"],
    typography: "Serif",
    background: "Cream paper",
    visualStyle: "Photo",
    layout: "Centered",
  },
  slides: Array.from({ length: n }, (_, i) => ({
    role: "content",
    title: `Point ${i + 1}`,
    body: "Short text",
    visual: `Visual ${i + 1}`,
    product: i === 1 ? "almond pack" : "Made-up product",
  })),
});

describe("normalizeCarouselPlan", () => {
  it("keeps exactly the requested count, cover first and CTA last", () => {
    for (const n of [3, 5, 7, 10]) {
      const plan = normalizeCarouselPlan(rawPlan(n + 2), n, { fallbackTitle: "x" })!;
      expect(plan.slides).toHaveLength(n);
      expect(plan.slides[0]!.role).toBe("cover");
      expect(plan.slides[n - 1]!.role).toBe("cta");
      expect(plan.slides.slice(1, -1).every((s) => s.role === "content")).toBe(true);
    }
  });
  it("refuses a plan with too few slides instead of padding it", () => {
    expect(normalizeCarouselPlan(rawPlan(4), 5, { fallbackTitle: "x" })).toBeNull();
    expect(normalizeCarouselPlan("garbage", 3, { fallbackTitle: "x" })).toBeNull();
  });
  it("only references real product labels and uses brand colours exactly", () => {
    const plan = normalizeCarouselPlan(rawPlan(3), 3, {
      fallbackTitle: "x",
      productLabels: ["Almond Pack"],
      brand: { colors: ["#FF0000", "#00FF00"] },
    })!;
    expect(plan.slides[1]!.productLabel).toBe("Almond Pack");
    expect(plan.slides[0]!.productLabel).toBeNull();
    expect(plan.design.palette).toEqual(["#FF0000", "#00FF00"]);
  });
  it("drops invalid planner colours in general mode", () => {
    const plan = normalizeCarouselPlan(rawPlan(3), 3, { fallbackTitle: "x" })!;
    expect(plan.design.palette).toEqual(["#123456", "#ABCDEF"]);
  });
});

describe("composeCarouselSlidePrompt", () => {
  const design = {
    palette: ["#111111", "#EEEEEE"],
    typography: "Bold sans",
    background: "Cream",
    visualStyle: "Flat",
    layout: "Centered",
  };
  const base = {
    aspect: "portrait" as const,
    carouselTitle: "Dry fruits",
    brandName: null,
    logoCorner: null,
    hasStyleReference: false,
    hasProductReference: false,
  };
  it("repeats the shared design system verbatim and asks for one slide only", () => {
    const a = composeCarouselSlidePrompt(
      design,
      { role: "cover", title: "Go nuts", body: "", visual: "Bowl of nuts", productLabel: null },
      0,
      5,
      base,
    );
    const b = composeCarouselSlidePrompt(
      design,
      { role: "content", title: "Almonds", body: "Vitamin E", visual: "Almonds", productLabel: null },
      1,
      5,
      base,
    );
    for (const p of [a, b]) {
      expect(p).toContain("#111111, #EEEEEE");
      expect(p).toContain("typography: Bold sans");
      expect(p).toMatch(/never a grid, collage/);
    }
    expect(a).toContain("slide 1 of 5");
    expect(b).toContain(`"Almonds" / Supporting text: "Vitamin E"`);
    expect(a).toMatch(/no logos/);
  });
  it("brand mode keeps the logo corner clear and features the real product", () => {
    const p = composeCarouselSlidePrompt(
      design,
      { role: "content", title: "Almonds", body: "", visual: "Almonds", productLabel: "Almond Pack" },
      1,
      5,
      { ...base, brandName: "Nutty", logoCorner: "top-right", hasStyleReference: true, hasProductReference: true },
    );
    expect(p).toContain("top-right corner");
    expect(p).toContain(`real product "Almond Pack"`);
    expect(p).toMatch(/LAST attached image is another slide/);
  });
});

describe("formats", () => {
  it("renders at the closest native size", () => {
    expect(renderSizeForAspect("square")).toBe("1024x1024");
    expect(renderSizeForAspect("portrait")).toBe("1088x1360");
    expect(renderSizeForAspect("landscape")).toBe("1536x1024");
  });
  it("crops to the target ratio, centered", () => {
    expect(coverCropRect(1536, 1024, 1080, 566)).toEqual({ sx: 0, sy: 110, sw: 1536, sh: 805 });
    expect(coverCropRect(1088, 1360, 1080, 1350)).toEqual({ sx: 0, sy: 0, sw: 1088, sh: 1360 });
    expect(coverCropRect(1536, 1024, 1080, 1080)).toEqual({ sx: 256, sy: 0, sw: 1024, sh: 1024 });
  });
});

const slide = (
  position: number,
  status: SlideState["status"],
  imageUrl: string | null = null,
): SlideState => ({ position, status, imageUrl });

describe("deriveCarouselStatus", () => {
  it("is completed only when every slide has an image", () => {
    expect(deriveCarouselStatus([slide(0, "completed", "a"), slide(1, "completed", "b")])).toBe("completed");
    expect(deriveCarouselStatus([slide(0, "completed", "a"), slide(1, "completed", null)])).toBe("partial");
    expect(deriveCarouselStatus([slide(0, "completed", "a"), slide(1, "failed")])).toBe("partial");
    expect(deriveCarouselStatus([slide(0, "completed", "a"), slide(1, "generating")])).toBe("generating");
    expect(deriveCarouselStatus([])).toBe("failed");
  });
});

describe("settleSlide", () => {
  const s = { imageUrl: null, attempts: 1, error: "boom", stopped: false };
  it("waits on in-flight jobs and completes on an image", () => {
    expect(settleSlide({ ...s, generationStatus: "processing" })).toBe("wait");
    expect(settleSlide({ ...s, generationStatus: "completed", imageUrl: "u" })).toBe("complete");
  });
  it("retries a failed slide until the attempt cap", () => {
    expect(settleSlide({ ...s, generationStatus: "failed" })).toBe("retry");
    expect(settleSlide({ ...s, generationStatus: "failed", attempts: MAX_SLIDE_ATTEMPTS })).toBe("fail");
    expect(settleSlide({ ...s, generationStatus: null })).toBe("retry");
  });
  it("never retries quota/policy failures or a stopped carousel", () => {
    expect(settleSlide({ ...s, generationStatus: "failed", error: "Daily image limit reached" })).toBe("fail");
    expect(settleSlide({ ...s, generationStatus: "cancelled", stopped: true })).toBe("fail");
  });
});

describe("startableSlides", () => {
  it("starts the cover first, then the rest once it settles", () => {
    const fresh = [slide(0, "pending"), slide(1, "pending"), slide(2, "pending")];
    expect(startableSlides(fresh).map((x) => x.position)).toEqual([0]);
    expect(startableSlides([slide(0, "generating"), slide(1, "pending")])).toEqual([]);
    const coverDone = [slide(0, "completed", "c"), slide(1, "pending"), slide(2, "pending")];
    expect(startableSlides(coverDone).map((x) => x.position)).toEqual([1, 2]);
    expect(startableSlides([slide(0, "failed"), slide(1, "pending")]).map((x) => x.position)).toEqual([1]);
  });
  it("a single regenerated slide starts at once when another slide is the reference", () => {
    expect(
      startableSlides([slide(0, "pending"), slide(1, "completed", "b")]).map((x) => x.position),
    ).toEqual([0]);
    expect(
      startableSlides([slide(0, "generating"), slide(1, "completed", "b"), slide(2, "pending")]).map(
        (x) => x.position,
      ),
    ).toEqual([2]);
  });
});

describe("slideFileName", () => {
  it("numbers files in slide order", () => {
    expect(slideFileName("Benefits of Dry Fruits!", 0)).toBe("benefits-of-dry-fruits-slide-01.png");
    expect(slideFileName("", 9)).toBe("carousel-slide-10.png");
  });
});
