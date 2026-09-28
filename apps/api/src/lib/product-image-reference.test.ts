import { describe, expect, it } from "vitest";
import {
  normalizeProductImageName,
  requestsImageFromProductImage,
  resolveProductImageReference,
} from "./product-image-reference.js";

const products = [
  { id: "chicken", label: "Chicken Biryani", url: "/brand/chicken.png" },
  { id: "chicken-special", label: "Chicken Biryani Special", url: "/brand/special.png" },
  { id: "mutton", label: "Mutton Biryani", url: "/brand/mutton.png" },
];

describe("resolveProductImageReference", () => {
  it("resolves a quoted name exactly even when another name contains it", () => {
    expect(
      resolveProductImageReference('Use the “Chicken Biryani” image for this content', products),
    ).toEqual({ status: "match", asset: products[0] });
  });

  it("resolves the most specific exact unquoted name", () => {
    expect(
      resolveProductImageReference("Use the Chicken Biryani Special product image", products),
    ).toEqual({ status: "match", asset: products[1] });
  });

  it("does not guess when a requested name is missing", () => {
    expect(
      resolveProductImageReference('Use the "Paneer Tikka" image in the creative', products),
    ).toEqual({ status: "missing", requestedName: "Paneer Tikka" });
  });

  it("does not fall back to a shorter saved name when an explicit longer name is missing", () => {
    expect(
      resolveProductImageReference('Use the "Chicken Biryani Deluxe" image', [products[0]!]),
    ).toEqual({ status: "missing", requestedName: "Chicken Biryani Deluxe" });
    expect(
      resolveProductImageReference("Use the Chicken Biryani Deluxe image", [products[0]!]),
    ).toEqual({ status: "missing", requestedName: "Chicken Biryani Deluxe" });
  });

  it("reports multiple explicitly named product images as ambiguous", () => {
    expect(
      resolveProductImageReference(
        'Use the "Chicken Biryani" image and the "Mutton Biryani" image',
        products,
      ),
    ).toEqual({
      status: "ambiguous",
      names: ["chicken biryani", "mutton biryani"],
    });
  });

  it("reports duplicate names as ambiguous instead of selecting one", () => {
    expect(
      resolveProductImageReference("Use the Chicken Biryani image", [
        products[0]!,
        { ...products[0]!, id: "chicken-copy", url: "/brand/chicken-copy.png" },
      ]),
    ).toEqual({ status: "ambiguous", names: ["chicken biryani"] });
  });

  it("does not fuzzy-match similar product names", () => {
    expect(
      resolveProductImageReference("Use the Chicken Biriyani image", products),
    ).toEqual({ status: "missing", requestedName: "Chicken Biriyani" });
  });

  it("does not mistake quoted on-image copy for a Product Image name", () => {
    expect(
      resolveProductImageReference('Use "Happy Birthday" text in the image', []),
    ).toEqual({ status: "none" });
  });

  it("does not select a product when the prompt does not reference one", () => {
    expect(resolveProductImageReference("Create a bright food poster", products)).toEqual({
      status: "none",
    });
  });
});

describe("requestsImageFromProductImage", () => {
  it("routes an explicit product-reference creation prompt as an image request", () => {
    const selection = resolveProductImageReference(
      'Use the "Chicken Biryani" image to create this content',
      products,
    );
    expect(
      requestsImageFromProductImage(
        'Use the "Chicken Biryani" image to create this content',
        selection,
      ),
    ).toBe(true);
    expect(
      requestsImageFromProductImage("What is Chicken Biryani?", selection),
    ).toBe(false);
    const missing = resolveProductImageReference(
      'Use the "Paneer Tikka" image to create this content',
      products,
    );
    expect(requestsImageFromProductImage('Use the "Paneer Tikka" image to create this content', missing)).toBe(true);
  });
});

describe("normalizeProductImageName", () => {
  it("matches case and punctuation consistently", () => {
    expect(normalizeProductImageName("  VGrand-Special Biryani! ")).toBe(
      "vgrand special biryani",
    );
  });
});
