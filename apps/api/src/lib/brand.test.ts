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
  it("tells the model the REAL logo is stamped afterwards and never to draw one", () => {
    const prompt = brandImageGuidance("Acme", { colors: ["#123456"] }, true);
    expect(prompt).toContain("real logo file is placed onto the finished image afterwards in the bottom-right corner");
    expect(prompt).toContain("do not draw any logo");
    expect(prompt).toContain("Brand colours: #123456.");
    expect(prompt).toContain("#123456 (primary)");
    expect(prompt).toContain("never the brand identity");
  });

  it("falls back to the no-overlay wording when the brand opted out of the overlay", () => {
    const prompt = brandImageGuidance("Acme", { overlayDefault: false }, true);
    expect(prompt).toContain("is not added automatically");
    expect(prompt).not.toContain("placed onto the finished image");
  });

  it("does not promise a logo when the brand has none, or for raw assets", () => {
    expect(brandImageGuidance("Acme", {}, false)).not.toContain("logo file is placed");
    expect(brandImageGuidance("Acme", {}, true, null, false, false)).not.toContain("logo file is placed");
  });

  it("requires real products to stay faithful", () => {
    expect(brandImageGuidance("Acme", {}, false, null, true)).toContain("never substitute, redesign or invent");
  });
});
