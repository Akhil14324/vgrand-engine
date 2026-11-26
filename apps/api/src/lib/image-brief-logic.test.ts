import { describe, expect, it } from "vitest";
import {
  brandFirstColors,
  briefPrompt,
  detectAspect,
  detectOccasion,
  detectStyle,
  extractRequiredObjects,
  heuristicBrief,
  imageRequestHash,
  rankByScore,
  selectRelevantReferences,
  sizeForAspect,
  wantsOnImageText,
} from "./image-brief-logic.js";

describe("detectOccasion", () => {
  it.each([
    ["birthday cake for my son's 5th birthday", "birthday"],
    ["traditional Indian wedding stage decoration", "wedding"],
    ["ring ceremony engagement backdrop", "engagement"],
    ["Happy Deepavali greeting with diyas", "diwali"],
    ["Makar Sankranti kites poster", "sankranti"],
    ["Dussehra festive decor", "dasara"],
    ["christmas tree with gifts", "christmas"],
    ["New Year party background", "new_year"],
    ["corporate office team photo", "business"],
    ["a plate of hyderabadi biryani", "food"],
    ["product launch ad for headphones", "product"],
  ])("%s → %s", (prompt, id) => {
    expect(detectOccasion(prompt)?.id).toBe(id);
  });

  it("prefers engagement over wedding when both words appear", () => {
    expect(detectOccasion("engagement before the wedding")?.id).toBe("engagement");
  });

  it("returns null for an unrelated prompt", () => {
    expect(detectOccasion("a lighthouse on a cliff at dusk")).toBeNull();
  });
});

describe("style / aspect / text detection", () => {
  it("explicit style wins over the prompt", () => {
    expect(detectStyle("a realistic photo", "3d")).toBe("3d");
    expect(detectStyle("a cinematic shot", "auto")).toBe("cinematic");
    expect(detectStyle("a lighthouse")).toBeNull();
  });

  it("maps aspect words to sizes, respecting an explicit size", () => {
    expect(detectAspect("instagram story")).toBe("portrait");
    expect(detectAspect("website banner")).toBe("landscape");
    expect(sizeForAspect("auto", "portrait")).toBe("1024x1536");
    expect(sizeForAspect("1024x1024", "landscape")).toBe("1024x1024");
    expect(sizeForAspect(undefined, null)).toBe("auto");
  });

  it("only allows on-image text when asked", () => {
    expect(wantsOnImageText('birthday poster saying "Happy 5th Aarav"')).toBe(true);
    expect(wantsOnImageText("birthday cake with candles")).toBe(false);
  });
});

describe("heuristicBrief", () => {
  const prompt =
    "Create a beautiful traditional Indian wedding stage decoration with red roses, golden lighting and an elegant background.";
  const brief = heuristicBrief(prompt);

  it("keeps every specific element the user named", () => {
    expect(extractRequiredObjects(prompt)).toEqual(
      expect.arrayContaining(["red roses", "golden lighting", "elegant background."].map((s) => s.replace(/\.$/, ""))),
    );
    expect(brief.requiredObjects).toEqual(expect.arrayContaining(["red roses", "golden lighting"]));
    expect(brief.occasion).toBe("wedding");
    expect(brief.style).toBe("traditional");
  });

  it("produces a prompt that restates the requirements and bans stray text", () => {
    const out = briefPrompt(brief);
    expect(out).toContain("red roses");
    expect(out).toContain("golden lighting");
    expect(out).toContain("Occasion: Wedding");
    expect(out).toContain("Do not add any text");
  });

  it("asks for a different composition on a variation", () => {
    expect(briefPrompt(brief, { index: 1 })).toContain("fresh variation (#2)");
  });
});

describe("selectRelevantReferences", () => {
  const birthday = heuristicBrief("a chocolate birthday cake with candles and balloons");
  const candidates = [
    { url: "u/restaurant.png", kind: "theme", label: "restaurant" },
    { url: "u/unlabeled.png", kind: "reference", label: null },
    { url: "u/cake.png", kind: "reference", label: "chocolate cake" },
    { url: "u/product.png", kind: "product", label: "Hair oil bottle" },
    { url: "u/mascot.png", kind: "mascot", label: "Bolt mascot" },
  ];

  it("never picks unrelated or unlabeled images from the collection", () => {
    const { selected, rejected } = selectRelevantReferences(birthday, "a chocolate birthday cake with candles and balloons", candidates);
    expect(selected.map((c) => c.url)).toEqual(["u/cake.png"]);
    expect(rejected).toHaveLength(4);
  });

  it("uses product photos for product requests and the mascot only when named", () => {
    const prompt = "product shot of our hair oil with the mascot";
    const brief = heuristicBrief(prompt);
    const urls = selectRelevantReferences(brief, prompt, candidates).selected.map((c) => c.url);
    expect(urls).toContain("u/product.png");
    expect(urls).toContain("u/mascot.png");
    expect(urls).not.toContain("u/restaurant.png");
  });
});

describe("selectRelevantReferences in brand mode", () => {
  const prompt = "Create a beautiful Diwali promotional image with dry fruits, diyas and traditional decorations";
  const brief = heuristicBrief(prompt);
  const candidates = [
    { url: "u/cashew.png", kind: "product", label: "Cashew Pack 250g" },
    { url: "u/almond.png", kind: "product", label: "Dry Fruits Gift Box" },
    { url: "u/raisin.png", kind: "product", label: "Raisins" },
    { url: "u/office.png", kind: "theme", label: "office desk" },
  ];

  it("always uses the brand's real products, best label match first, capped at two", () => {
    const urls = selectRelevantReferences(brief, prompt, candidates, { brandMode: true }).selected.map((c) => c.url);
    expect(urls[0]).toBe("u/almond.png");
    expect(urls.filter((u) => u.startsWith("u/") && u !== "u/office.png")).toHaveLength(2);
    expect(urls).not.toContain("u/office.png");
  });

  it("does not attach unrelated products outside brand mode", () => {
    const urls = selectRelevantReferences(brief, prompt, candidates).selected.map((c) => c.url);
    expect(urls).not.toContain("u/cashew.png");
    expect(urls).not.toContain("u/raisin.png");
  });
});

describe("imageRequestHash / rankByScore", () => {
  it("is stable across whitespace/case and sensitive to settings", () => {
    const a = imageRequestHash({ prompt: "Diwali  poster", size: "auto", references: ["b", "a"] });
    const b = imageRequestHash({ prompt: "diwali poster", size: "auto", references: ["a", "b"] });
    const c = imageRequestHash({ prompt: "diwali poster", size: "1024x1024", references: ["a", "b"] });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it("orders best-first and keeps unscored items last", () => {
    expect(rankByScore(["a", "b", "c"], [4, null, 9])).toEqual(["c", "a", "b"]);
  });
});

describe("brand-mode isolation", () => {
  it("only ever selects products from the candidates it was given (the selected brand's)", () => {
    const prompt = "Christmas offer poster with our gift hamper";
    const brief = heuristicBrief(prompt);
    const own = [
      { url: "brandA/hamper.png", kind: "product", label: "Gift Hamper" },
      { url: "brandA/oil.png", kind: "product", label: "Hair Oil" },
    ];
    const urls = selectRelevantReferences(brief, prompt, own, { brandMode: true }).selected.map((c) => c.url);
    expect(urls[0]).toBe("brandA/hamper.png");
    expect(urls.every((u) => u.startsWith("brandA/"))).toBe(true);
  });

  it("selects nothing when the brand has no products (never invents)", () => {
    const brief = heuristicBrief("Diwali greeting");
    expect(selectRelevantReferences(brief, "Diwali greeting", [], { brandMode: true }).selected).toEqual([]);
  });
});

describe("brandFirstColors", () => {
  it("keeps the brand palette first and demotes occasion colours to accents", () => {
    expect(brandFirstColors(["#5a2d0c", "#f2c14e"], ["saffron", "gold", "maroon"])).toEqual([
      "#5A2D0C",
      "#F2C14E",
      "saffron (small accent only)",
      "gold (small accent only)",
    ]);
    expect(brandFirstColors(undefined, ["red"])).toEqual(["red"]);
  });
});
