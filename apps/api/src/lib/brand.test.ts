import { describe, expect, it } from "vitest";
import { brandImageGuidance, brandReferenceUrls } from "./brand.js";

describe("brandReferenceUrls", () => {
  it("keeps the exact logo out of model inputs and preserves product references", () => {
    expect(
      brandReferenceUrls([
        { kind: "logo", url: "brand-logo.png" },
        { kind: "product", url: "product-photo.png" },
        { kind: "reference", url: "brand-style.png" },
      ]),
    ).toEqual(["product-photo.png", "brand-style.png"]);
  });

  it("uses only the explicitly selected product image among product assets", () => {
    expect(
      brandReferenceUrls(
        [
          { kind: "product", url: "chicken.png" },
          { kind: "product", url: "mutton.png" },
          { kind: "reference", url: "brand-style.png" },
        ],
        null,
        "mutton.png",
      ),
    ).toEqual(["mutton.png", "brand-style.png"]);
  });

  it("sends the newest product photos, not the oldest, when a brand has many", () => {
    // loadBrandContext returns assets oldest-first.
    const assets = [
      { kind: "product", url: "p1.png" },
      { kind: "product", url: "p2.png" },
      { kind: "product", url: "p3.png" },
      { kind: "product", url: "p4.png" },
      { kind: "product", url: "p5.png" },
      { kind: "product", url: "p6.png" },
    ];
    expect(brandReferenceUrls(assets)).toEqual(["p6.png", "p5.png"]);
  });

  it("keeps the mascot and a reference in the cap when the brand has many products", () => {
    expect(
      brandReferenceUrls([
        { kind: "product", url: "p1.png" },
        { kind: "product", url: "p2.png" },
        { kind: "product", url: "p3.png" },
        { kind: "product", url: "p4.png" },
        { kind: "mascot", url: "mascot.png" },
        { kind: "reference", url: "style-1.png" },
        { kind: "reference", url: "style-2.png" },
      ]),
    ).toEqual(["p4.png", "p3.png", "mascot.png", "style-2.png"]);
  });
});

describe("brandImageGuidance", () => {
  it("reserves logo rendering for the exact post-generation brand overlay", () => {
    const prompt = brandImageGuidance("Acme", { colors: ["#123456"] }, true);
    expect(prompt).toContain("is not added automatically");
    expect(prompt).toContain("Do not draw, recreate, alter, or add a logo");
    expect(prompt).toContain("Brand colours: #123456.");
    expect(
      brandImageGuidance("Acme", { overlayDefault: true }, false),
    ).not.toContain("is not added automatically");
  });
});
