import { describe, expect, it } from "vitest";
import {
  buildGenerationReferenceUrls,
  isFreshImageRequest,
  requiresOpenAIForReferences,
} from "./generation-context.js";

describe("isFreshImageRequest", () => {
  it("recognizes a new concept as a fresh image request", () => {
    expect(isFreshImageRequest("Create a completely new brand concept for summer")).toBe(true);
    expect(isFreshImageRequest("Try an alternative design with a new layout")).toBe(true);
  });

  it("does not treat an edit instruction as a new concept", () => {
    expect(isFreshImageRequest("Change the existing image to use more red")).toBe(false);
  });
});

describe("requiresOpenAIForReferences", () => {
  it("routes multiple brand references through a provider that accepts all of them", () => {
    expect(requiresOpenAIForReferences(["product.png"])).toBe(false);
    expect(requiresOpenAIForReferences(["product.png", "style.png"])).toBe(true);
  });
});

describe("buildGenerationReferenceUrls", () => {
  it("keeps the selected edit image first and excludes unrelated brand and theme refs", () => {
    expect(
      buildGenerationReferenceUrls({
        parentImageUrl: "edit-source.png",
        userReferenceUrls: ["attached-logo.png"],
        brandReferenceUrls: ["old-brand-ref.png"],
        themeReferenceUrls: ["old-theme-ref.png"],
      }),
    ).toEqual(["edit-source.png", "attached-logo.png"]);
  });

  it("uses only current brand, theme, and user refs for a fresh concept", () => {
    expect(
      buildGenerationReferenceUrls({
        userReferenceUrls: ["current-upload.png"],
        brandReferenceUrls: ["brand-product.png"],
        themeReferenceUrls: ["theme-style.png"],
      }),
    ).toEqual(["brand-product.png", "theme-style.png", "current-upload.png"]);
  });
});
