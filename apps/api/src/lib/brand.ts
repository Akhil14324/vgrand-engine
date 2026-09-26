import {
  prisma,
  type Brand,
  type BrandAsset,
  type BrandMascot,
  type BrandVoice,
} from "@catgpt/db";
import {
  brandProfileSchema,
  computeBrandSnapshot,
  type BrandAssetKind,
  type BrandDto,
  type BrandProfile,
  type BrandVoiceDto,
} from "@catgpt/types";
import { notFound } from "./errors.js";
import { isTrustedImageUrl } from "./urls.js";
import { workspaceAccess } from "./workspace-access.js";

/** Caps that keep a brand's footprint (rows, embeddings, prompt size) small. */
export const MAX_BRAND_ASSETS = 20;
export const MAX_BRAND_DOCUMENTS = 10;
/** Reference images a brand may contribute to one generation. */
export const MAX_BRAND_REFERENCES = 4;

/**
 * Fixed recording scripts for brand-voice enrollment — one per language the
 * Phase 1 bake-off verified on the selected adapter (`language_id`s it
 * reports: Telugu "te", Hindi "hi", and English "en"). Each script reads
 * naturally in roughly 20–30 seconds, the sample length the benchmark requires.
 */
export const BRAND_VOICE_SCRIPTS: Record<string, string> = {
  te: "నమస్కారం! మీరు ఇప్పుడు విన్నది నా స్వంత గొంతు. మా చిన్న వ్యాపారం గురించి కొద్దిగా చెప్తాను. మేము ప్రతిరోజూ తాజా ఉత్పత్తులను మా కస్టమర్లకు అందిస్తాము. మా లక్ష్యం నాణ్యమైన వస్తువులను సరసమైన ధరకే అందించడం. మీరు మా దుకాణానికి వచ్చినప్పుడు మా బృందం మిమ్మల్ని నవ్వుతో స్వాగతం పలుకుతుంది. మీ విశ్వాసమే మా అసలైన పెట్టుబడి. శుభోదయం, శుభ సాయంత్రం — మీ రోజు మంచిగా గడవాలని కోరుకుంటున్నాను. ధన్యవాదాలు!",
  hi: "नमस्ते! ये मेरी अपनी आवाज़ है। ये मेरे छोटे से कारोबार की कहानी है। हम रोज़ाना अपने ग्राहकों को ताज़ा और अच्छी क्वालिटी की चीज़ें देते हैं। हमारा लक्ष्य है कि हर ग्राहक सही दाम पर बेहतरीन सामान पाए। जब भी आप हमारी दुकान पर आते हैं, हमारी टीम आपका मुस्कान के साथ स्वागत करती है। आपका भरोसा ही हमारी सबसे बड़ी पूँजी है। आपका दिन शुभ हो — बहुत-बहुत धन्यवाद!",
  en: "Hello! This is my own voice, and I am glad to share a little about my work. Every day, I try to give customers helpful service, clear answers, and good value. I listen carefully, explain things simply, and do my best to make each experience welcoming. Thank you for your time, your trust, and the opportunity to help. I hope you have a wonderful day.",
};

/** Languages with a verified script — anything else is rejected up front. */
export const BRAND_VOICE_LANGUAGES = Object.keys(BRAND_VOICE_SCRIPTS);

export const BRAND_INCLUDE = {
  assets: { orderBy: { createdAt: "asc" as const } },
  mascot: { include: { asset: true } },
  _count: { select: { documents: true } },
};
/** Owner/manager views additionally get the saved voice (one row max).
 *  Read-only workspace access must never receive it. */
export const MANAGEABLE_BRAND_INCLUDE = { ...BRAND_INCLUDE, voice: true };
type BrandRow = Brand & {
  assets: BrandAsset[];
  mascot: (BrandMascot & { asset: BrandAsset }) | null;
  _count: { documents: number };
  voice?: BrandVoice | null;
};

function toVoiceDto(v: BrandVoice): BrandVoiceDto {
  return {
    id: v.id,
    brandId: v.brandId,
    sampleLanguage: v.sampleLanguage,
    scriptText: v.scriptText,
    status: v.status as BrandVoiceDto["status"],
    enrolledAt: v.enrolledAt ? v.enrolledAt.toISOString() : null,
    lastSynthesisError: v.lastSynthesisError,
    lastSynthesisErrorAt: v.lastSynthesisErrorAt
      ? v.lastSynthesisErrorAt.toISOString()
      : null,
    createdAt: v.createdAt.toISOString(),
    updatedAt: v.updatedAt.toISOString(),
  };
}

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
    mascot: b.mascot
      ? {
          id: b.mascot.id,
          brandId: b.mascot.brandId,
          assetId: b.mascot.assetId,
          url: b.mascot.asset.url,
          name: b.mascot.name,
          description: b.mascot.description,
          status: b.mascot.status as "active" | "archived",
          createdAt: b.mascot.createdAt.toISOString(),
          updatedAt: b.mascot.updatedAt.toISOString(),
        }
      : null,
    documentCount: b._count.documents,
    ...(b.voice !== undefined
      ? { voice: b.voice ? toVoiceDto(b.voice) : null }
      : {}),
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
  add("Typography", clip(profile.typography, 120));
  add("Visual style", clip(profile.visualStyle, 160));
  add("Photo style", clip(profile.photographyStyle, 160));
  add("Logo rules", clip(profile.logoRules, 180));
  add(
    "Required phrases",
    profile.requiredPhrases?.length ? profile.requiredPhrases.join(" | ") : null,
  );
  add(
    "Do not use",
    profile.forbiddenWords?.length ? profile.forbiddenWords.join(", ") : null,
  );
  add(
    "Do not claim",
    profile.forbiddenClaims?.length ? profile.forbiddenClaims.join(" | ") : null,
  );
  add("Default CTA", clip(profile.defaultCta, 120));
  add(
    "Content languages",
    profile.contentLanguages?.length ? profile.contentLanguages.join(", ") : null,
  );
  return lines.join("\n");
}

/**
 * A brand the user may use: their own personal brand, or any brand inside a
 * workspace they own. Missing and not-yours look identical (404) so ids can't
 * be probed.
 */
export async function findAccessibleBrand(userId: string, id: string) {
  const brand = await prisma.brand.findFirst({
    where: { id, OR: [{ userId }, { workspace: workspaceAccess(userId) }] },
    include: BRAND_INCLUDE,
  });
  if (!brand) throw notFound("Brand not found");
  return brand;
}

/**
 * Brands a user may change or delete: their own, or any brand in a workspace
 * they OWN. Plain members can read and use workspace brands but not alter them.
 */
export async function findManageableBrand(userId: string, id: string) {
  const brand = await prisma.brand.findFirst({
    where: { id, OR: [{ userId }, { workspace: { userId } }] },
    include: MANAGEABLE_BRAND_INCLUDE,
  });
  if (!brand) throw notFound("Brand not found");
  return brand;
}

/** Only files we stored ourselves may be attached as brand assets. */
export function isOwnStorageUrl(url: string): boolean {
  return isTrustedImageUrl(url);
}

/**
 * What a generation needs from a brand - one narrow query, no docs. When a
 * userId is given the brand must be usable by them (else null).
 */
export async function loadBrandContext(brandId: string, userId?: string) {
  return prisma.brand.findFirst({
    where: {
      id: brandId,
      ...(userId
        ? { OR: [{ userId }, { workspace: workspaceAccess(userId) }] }
        : {}),
    },
    select: {
      id: true,
      name: true,
      summary: true,
      profile: true,
      assets: {
        where: { kind: { in: ["mascot", "logo", "product", "reference"] } },
        orderBy: { createdAt: "asc" },
        select: { kind: true, url: true },
      },
      mascot: {
        select: {
          name: true,
          description: true,
          status: true,
          asset: { select: { url: true } },
        },
      },
    },
  });
}

/** Logo first, then mascot, products, references - capped so references stay light. */
export function brandReferenceUrls(
  assets: { kind: string; url: string }[],
  mascotUrl?: string | null,
): string[] {
  const mascotUrls = mascotUrl
    ? [mascotUrl]
    : assets.filter((a) => a.kind === "mascot").map((a) => a.url).slice(0, 2);
  const logos = assets.filter((a) => a.kind === "logo");
  const products = assets.filter((a) => a.kind === "product");
  const references = assets.filter((a) => a.kind === "reference");
  return [
    ...new Set([
      ...logos.slice(0, 1).map((a) => a.url),
      ...mascotUrls,
      ...products.map((a) => a.url),
      ...references.map((a) => a.url),
    ]),
  ].slice(0, MAX_BRAND_REFERENCES);
}

/** Style guidance appended to image prompts in brand mode. */
export function brandImageGuidance(
  name: string,
  profile: BrandProfile,
  hasLogo: boolean,
  mascot?: { name: string; description: string; status: string } | null,
): string {
  const parts = [`\nBrand: ${name}. Keep the creative on-brand.`];
  if (profile.colors?.length) {
    parts.push(`Brand colours: ${profile.colors.join(", ")}.`);
  }
  if (profile.tagline) parts.push(`Tagline: "${profile.tagline}".`);
  if (profile.tone) parts.push(`Feel: ${profile.tone}.`);
  if (profile.visualStyle) parts.push(`Visual style: ${profile.visualStyle}.`);
  if (profile.photographyStyle) {
    parts.push(`Photo style: ${profile.photographyStyle}.`);
  }
  if (profile.typography) parts.push(`Typography feel: ${profile.typography}.`);
  if (profile.logoRules) parts.push(`Logo rules: ${profile.logoRules}.`);
  if (profile.requiredPhrases?.length) {
    parts.push(`Approved phrases: ${profile.requiredPhrases.join(" | ")}.`);
  }
  if (profile.forbiddenWords?.length) {
    parts.push(`Never use these words: ${profile.forbiddenWords.join(", ")}.`);
  }
  if (profile.forbiddenClaims?.length) {
    parts.push(`Never claim: ${profile.forbiddenClaims.join(" | ")}.`);
  }
  if (profile.defaultCta) parts.push(`Preferred CTA: "${profile.defaultCta}".`);
  if (mascot?.status === "active") {
    parts.push(
      `Optional mascot "${mascot.name}": ${mascot.description}. It is a supporting brand character, never the main subject — include it only as a small cameo or corner accent when a character naturally fits the brief, and never let it dominate the composition. If it appears, match the mascot reference image exactly (silhouette, palette, facial features); do not redesign it.`,
    );
  }
  if (hasLogo) {
    parts.push(
      "The logo reference image is the brand logo - reproduce it faithfully where a logo belongs, without altering it.",
    );
  }
  return parts.join(" ");
}
