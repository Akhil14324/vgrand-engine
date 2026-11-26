import { describe, expect, it } from "vitest";
import {
  brandBriefContext,
  brandWantsLogoOverlay,
  checkBrandReadiness,
  describePalette,
  paletteDirective,
} from "./brand-identity.js";

const nutbytes = {
  id: "b1",
  name: "NutBytes",
  summary: "Brand: NutBytes (dry fruits)",
  profile: { colors: ["#5a2d0c", "#f2c14e", "#ffffff"], visualStyle: "warm premium" },
  assets: [
    { kind: "logo", url: "logo.png", label: "Logo" },
    { kind: "product", url: "p1.png", label: "Almond Box" },
    { kind: "product", url: "p2.png", label: null },
  ],
};

describe("checkBrandReadiness", () => {
  it("reports what the brand can contribute and warns about gaps", () => {
    const c = checkBrandReadiness(nutbytes);
    expect(c).toMatchObject({ hasLogo: true, logoOverlay: true, productCount: 2, productNames: ["Almond Box"], blocking: null });
    expect(c.warnings.some((w) => w.includes("no name"))).toBe(true);
  });

  it("warns when the logo, colours or products are missing", () => {
    const c = checkBrandReadiness({ ...nutbytes, profile: { visualStyle: "x" }, assets: [] });
    expect(c.warnings).toHaveLength(3);
    expect(c.blocking).toBeNull();
  });

  it("blocks a brand with nothing brand-specific at all", () => {
    expect(checkBrandReadiness({ id: "b", name: "Empty", profile: {}, assets: [] }).blocking).toContain("Empty");
  });

  it("honours an explicit overlay opt-out", () => {
    expect(brandWantsLogoOverlay({ overlayDefault: false })).toBe(false);
    expect(brandWantsLogoOverlay({})).toBe(true);
    const c = checkBrandReadiness({ ...nutbytes, profile: { ...nutbytes.profile, overlayDefault: false } });
    expect(c.logoOverlay).toBe(false);
  });
});

describe("palette", () => {
  it("names colour roles and keeps the brand palette dominant over occasion colours", () => {
    expect(describePalette(["#5a2d0c", "#f2c14e"])).toBe("#5A2D0C (primary), #F2C14E (secondary)");
    const d = paletteDirective(["#5a2d0c"]);
    expect(d).toContain("#5A2D0C as the dominant colour");
    expect(d).toContain("must never replace the brand palette");
    expect(paletteDirective([])).toBe("");
  });

  it("gives the brief analyser the brand's palette and product names", () => {
    const ctx = brandBriefContext(nutbytes);
    expect(ctx).toContain("NutBytes");
    expect(ctx).toContain("Almond Box");
    expect(ctx).toContain("#5A2D0C (primary)");
  });
});
