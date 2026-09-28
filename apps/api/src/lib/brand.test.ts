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
});

describe("brandImageGuidance", () => {
  it("reserves logo rendering for the exact post-generation brand overlay", () => {
    const prompt = brandImageGuidance("Acme", { colors: ["#123456"] }, true);
    expect(prompt).toContain("exact uploaded brand logo is composited");
    expect(prompt).toContain("Do not draw, recreate, alter, or add another logo");
    expect(prompt).toContain("Brand colours: #123456.");
    expect(
      brandImageGuidance("Acme", { overlayDefault: true }, false),
    ).not.toContain("exact uploaded brand logo is composited");
  });
});
