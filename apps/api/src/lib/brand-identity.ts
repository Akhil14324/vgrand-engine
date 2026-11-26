import type { BrandProfile } from "@catgpt/types";

/**
 * Pure brand-identity rules for brand-based image generation: what a selected
 * brand can contribute (validation), how its palette is phrased so it stays
 * dominant over occasion colours, and the compact context the brief analyser
 * receives. No I/O — the route validates with it before a job is created and
 * the worker uses it to brief the model.
 */

export interface BrandIdentityInput {
  id: string;
  name: string;
  summary?: string | null;
  profile: BrandProfile;
  assets: { kind: string; url: string; label?: string | null }[];
}

export interface BrandReadiness {
  brandId: string;
  brandName: string;
  hasLogo: boolean;
  /** The real logo file will be composited onto the image after generation. */
  logoOverlay: boolean;
  colors: string[];
  productCount: number;
  productNames: string[];
  hasFonts: boolean;
  /** Visible, non-fatal gaps (shown to the user with the job). */
  warnings: string[];
  /** Set when the brand has nothing brand-specific at all: refuse instead of producing an unbranded image. */
  blocking: string | null;
}

/** Overlay is on unless the brand explicitly opted out. */
export function brandWantsLogoOverlay(profile: Pick<BrandProfile, "overlayDefault"> | null | undefined): boolean {
  return profile?.overlayDefault !== false;
}

export function checkBrandReadiness(brand: BrandIdentityInput): BrandReadiness {
  const profile = brand.profile ?? {};
  const hasLogo = brand.assets.some((a) => a.kind === "logo");
  const products = brand.assets.filter((a) => a.kind === "product");
  const productNames = products.map((p) => p.label?.trim()).filter((l): l is string => Boolean(l));
  const colors = profile.colors ?? [];
  const hasFonts = Boolean(profile.fonts?.heading || profile.fonts?.body || profile.typography);
  const warnings: string[] = [];
  if (!hasLogo) {
    warnings.push(`${brand.name} has no logo uploaded - the image will be generated without the brand logo. Upload one in the Brand section.`);
  }
  if (!colors.length) {
    warnings.push(`${brand.name} has no brand colours saved - colours will follow the brand's style notes instead of exact colour codes.`);
  }
  if (!products.length) {
    warnings.push(`${brand.name} has no product photos - real products can't be shown, so none will be invented.`);
  } else if (productNames.length < products.length) {
    const unnamed = products.length - productNames.length;
    warnings.push(`${unnamed} product photo${unnamed === 1 ? " has" : "s have"} no name - name them so the right product is picked for each prompt.`);
  }
  const hasStyle = Boolean(
    profile.visualStyle || profile.photographyStyle || profile.tone || profile.typography || profile.tagline,
  );
  const blocking =
    !hasLogo && !colors.length && !products.length && !hasStyle
      ? `Brand "${brand.name}" has no logo, colours, products or visual style saved, so a brand-based image can't follow its identity. Add brand assets in the Brand section, or turn brand mode off for a general image.`
      : null;
  return {
    brandId: brand.id,
    brandName: brand.name,
    hasLogo,
    logoOverlay: hasLogo && brandWantsLogoOverlay(profile),
    colors,
    productCount: products.length,
    productNames,
    hasFonts,
    warnings,
    blocking,
  };
}

const ROLES = ["primary", "secondary", "accent", "background", "accent 2", "accent 3"];

/** "#5A2D0C (primary), #F2C14E (secondary)" */
export function describePalette(colors: string[] | undefined): string {
  return (colors ?? []).map((c, i) => `${c.toUpperCase()} (${ROLES[i] ?? "accent"})`).join(", ");
}

/** The colour directive for brand images: brand palette first, occasion colours only as accents. */
export function paletteDirective(colors: string[] | undefined): string {
  if (!colors?.length) return "";
  const [primary, ...rest] = colors.map((c) => c.toUpperCase());
  return [
    `Brand colour palette (exact codes): ${describePalette(colors)}.`,
    `Use ${primary} as the dominant colour${rest.length ? ` with ${rest.join(", ")} as supporting colours` : ""} across backgrounds, decorations, props and any typography.`,
    "Occasion or festival colours may appear only as small accents and must never replace the brand palette.",
  ].join(" ");
}

/** Compact brand context for the brief analyser (palette, products, style). */
export function brandBriefContext(brand: BrandIdentityInput): string {
  const p = brand.profile ?? {};
  const products = brand.assets
    .filter((a) => a.kind === "product")
    .map((a) => a.label?.trim())
    .filter(Boolean);
  return [
    `Brand: ${brand.name}`,
    p.colors?.length ? `Palette: ${describePalette(p.colors)}` : "",
    products.length ? `Real products (only these may appear): ${products.join(", ")}` : "",
    p.visualStyle ? `Visual style: ${p.visualStyle}` : "",
    p.photographyStyle ? `Photo style: ${p.photographyStyle}` : "",
    p.typography ? `Typography: ${p.typography}` : "",
    p.tone ? `Tone: ${p.tone}` : "",
    brand.summary ? brand.summary.slice(0, 600) : "",
  ]
    .filter(Boolean)
    .join("\n");
}
