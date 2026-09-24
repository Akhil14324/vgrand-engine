import { prisma, type Brand, type BrandAsset } from "@catgpt/db";
import {
  brandProfileSchema,
  computeBrandSnapshot,
  type BrandAssetKind,
  type BrandDto,
  type BrandProfile,
} from "@catgpt/types";
import { env } from "../env.js";
import { notFound } from "./errors.js";

/** Caps that keep a brand's footprint (rows, embeddings, prompt size) small. */
export const MAX_BRAND_ASSETS = 20;
export const MAX_BRAND_DOCUMENTS = 10;
/** Reference images a brand may contribute to one generation. */
export const MAX_BRAND_REFERENCES = 4;

export const BRAND_INCLUDE = {
  assets: { orderBy: { createdAt: "asc" as const } },
  _count: { select: { documents: true } },
};
type BrandRow = Brand & {
  assets: BrandAsset[];
  _count: { documents: number };
};

function parseProfile(raw: unknown): BrandProfile {
  const res = brandProfileSchema.safeParse(raw ?? {});
  return res.success ? res.data : {};
}

export function toBrandDto(b: BrandRow): BrandDto {
  const profile = parseProfile(b.profile);
  return {
    id: b.id,
    userId: b.userId,
    workspaceId: b.workspaceId,
    name: b.name,
    category: b.category,
    profile,
    snapshot: computeBrandSnapshot(profile),
    assets: b.assets.map((a) => ({
      id: a.id,
      kind: a.kind as BrandAssetKind,
      url: a.url,
      label: a.label,
    })),
    documentCount: b._count.documents,
    createdAt: b.createdAt.toISOString(),
    updatedAt: b.updatedAt.toISOString(),
  };
}

const clip = (s: string | undefined, n: number) =>
  s && s.trim() ? s.trim().replace(/\s+/g, " ").slice(0, n) : null;

/**
 * The compact digest injected into prompts instead of the raw questionnaire
 * or uploaded files: one line per topic, every field length-capped (~1.6k
 * chars worst case). Plain string building - no model call, no extra latency.
 */
export function buildBrandSummary(
  name: string,
  category: string | null | undefined,
  profile: BrandProfile,
): string {
  const snap = computeBrandSnapshot(profile);
  const num = (n: number | undefined) =>
    n === undefined ? null : String(Math.round(n * 100) / 100);
  const lines: string[] = [`Brand: ${name}${category ? ` (${category})` : ""}`];
  const add = (label: string, value: string | null | undefined) => {
    if (value) lines.push(`${label}: ${value}`);
  };

  add("What it does", clip(profile.description, 240));
  add("Market/location", clip(profile.location, 80));
  add("Stage", clip(profile.stage, 60));
  add("Offer", clip(profile.offer, 240));
  if (profile.avgPrice !== undefined) {
    add(
      "Pricing",
      [
        `avg price ${num(profile.avgPrice)}`,
        profile.avgCost !== undefined ? `avg cost ${num(profile.avgCost)}` : null,
        snap.marginPct !== null ? `gross margin ${snap.marginPct}%` : null,
      ]
        .filter(Boolean)
        .join(", "),
    );
  }
  add("Customers", clip(profile.customers, 200));
  add("Customer pain points", clip(profile.painPoints, 200));
  add("Differentiator", clip(profile.differentiator, 200));
  add("Sells/promotes via", profile.channels?.length ? profile.channels.join(", ") : null);
  if (profile.monthlyOrders !== undefined || profile.monthlyRevenue !== undefined) {
    add(
      "Today",
      `${num(profile.monthlyOrders) ?? "?"} orders/month, ${num(profile.monthlyRevenue) ?? "?"} revenue/month`,
    );
  }
  if (profile.goalRevenue !== undefined) {
    add(
      "Goal",
      `${num(profile.goalRevenue)} revenue in ${profile.goalDays ?? "?"} days${snap.ordersNeeded !== null ? ` (about ${snap.ordersNeeded} orders)` : ""}`,
    );
  }
  add("Marketing budget", profile.monthlyBudget !== undefined ? `${num(profile.monthlyBudget)}/month` : null);
  add("Biggest problems", clip(profile.problems, 240));
  add("Competitors", clip(profile.competitors, 160));
  add("Brand colours", profile.colors?.length ? profile.colors.join(", ") : null);
  add("Tagline", clip(profile.tagline, 120));
  add("Voice/tone", clip(profile.tone, 160));
  return lines.join("\n");
}

/**
 * A brand the user may use: their own personal brand, or any brand inside a
 * workspace they own. Missing and not-yours look identical (404) so ids can't
 * be probed.
 */
export async function findAccessibleBrand(userId: string, id: string) {
  const brand = await prisma.brand.findFirst({
    where: { id, OR: [{ userId }, { workspace: { userId } }] },
    include: BRAND_INCLUDE,
  });
  if (!brand) throw notFound("Brand not found");
  return brand;
}

/** Only files we stored ourselves may be attached as brand assets. */
export function isOwnStorageUrl(url: string): boolean {
  try {
    return new URL(url).host === new URL(env.SUPABASE_URL!).host;
  } catch {
    return false;
  }
}

/**
 * What a generation needs from a brand - one narrow query, no docs. When a
 * userId is given the brand must be usable by them (else null).
 */
export async function loadBrandContext(brandId: string, userId?: string) {
  return prisma.brand.findFirst({
    where: {
      id: brandId,
      ...(userId ? { OR: [{ userId }, { workspace: { userId } }] } : {}),
    },
    select: {
      id: true,
      name: true,
      summary: true,
      profile: true,
      assets: {
        where: { kind: { in: ["logo", "product"] } },
        orderBy: { createdAt: "asc" },
        select: { kind: true, url: true },
      },
    },
  });
}

/** Logo first, then product photos - capped so references stay light. */
export function brandReferenceUrls(
  assets: { kind: string; url: string }[],
): string[] {
  const logos = assets.filter((a) => a.kind === "logo");
  const products = assets.filter((a) => a.kind === "product");
  return [...logos.slice(0, 1), ...products]
    .slice(0, MAX_BRAND_REFERENCES)
    .map((a) => a.url);
}

/** Style guidance appended to image prompts in brand mode. */
export function brandImageGuidance(
  name: string,
  profile: BrandProfile,
  hasLogo: boolean,
): string {
  const parts = [`\nBrand: ${name}. Keep the creative on-brand.`];
  if (profile.colors?.length) {
    parts.push(`Brand colours: ${profile.colors.join(", ")}.`);
  }
  if (profile.tagline) parts.push(`Tagline: "${profile.tagline}".`);
  if (profile.tone) parts.push(`Feel: ${profile.tone}.`);
  if (hasLogo) {
    parts.push(
      "The first reference image is the brand logo - reproduce it faithfully where a logo belongs, without altering it.",
    );
  }
  return parts.join(" ");
}
