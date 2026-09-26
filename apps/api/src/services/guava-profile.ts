import { badRequest } from "../lib/errors.js";
import { prisma, type Brand, type GuavaProfile } from "@catgpt/db";
import {
  GUAVA_INDUSTRIES,
  GUAVA_SECTIONS,
  GUAVA_SECTION_KEYS,
  computeGuavaCompleteness,
  guavaSectionsFor,
  suggestGuavaIndustry,
  brandProfileSchema,
  type BrandProfile,
  type GuavaPlatformSnapshot,
  type GuavaProfileDto,
  type GuavaProfileUpdate,
  type GuavaValues,
} from "@catgpt/types";

/** Platform activity is looked at over this many days. */
export const PLATFORM_WINDOW_DAYS = 90;

const inheritedKey = (section: string, field: string) => `${section}.${field}`;

const money = (n: number | undefined) =>
  n === undefined ? "" : String(Math.round(n * 100) / 100);

/**
 * What the Brand already knows, mapped onto Guava's fields, so nobody enters
 * the same thing twice. Read-only: Guava never writes back to the Brand.
 */
export function brandDerivedValues(
  brand: Pick<Brand, "name" | "category" | "profile">,
): GuavaValues {
  const parsed = brandProfileSchema.safeParse(brand.profile ?? {});
  const p: BrandProfile = parsed.success ? parsed.data : {};
  const out: GuavaValues = {};
  const set = (section: string, field: string, value: string | undefined) => {
    const v = value?.trim();
    if (!v) return;
    (out[section] ??= {})[field] = v;
  };

  set("overview", "name", brand.name);
  set("overview", "products", p.offer || p.description);
  set("overview", "location", p.location);
  set("overview", "stage", p.stage);

  const revenue = p.monthlyRevenue !== undefined ? `About ${money(p.monthlyRevenue)} per month` : "";
  const orders = p.monthlyOrders !== undefined ? `${money(p.monthlyOrders)} orders per month` : "";
  set("goals", "current", [revenue, orders].filter(Boolean).join(", "));
  set("goals", "revenueTarget", p.goalRevenue !== undefined ? money(p.goalRevenue) : undefined);
  set("goals", "timeline", p.goalDays ? `${p.goalDays} days` : undefined);

  if (p.avgPrice !== undefined) set("offers", "pricing", `Average price ${money(p.avgPrice)}`);
  if (p.avgPrice && p.avgCost !== undefined && p.avgPrice > 0) {
    const pct = Math.round(((p.avgPrice - p.avgCost) / p.avgPrice) * 100);
    set("offers", "margins", `About ${pct}% (average price ${money(p.avgPrice)}, average cost ${money(p.avgCost)})`);
  }

  set("customers", "who", p.customers);
  set("customers", "needs", p.painPoints);
  set("marketing", "channels", p.channels?.join(", "));
  set("marketing", "budget", p.monthlyBudget !== undefined ? `${money(p.monthlyBudget)} per month` : undefined);
  set("competition", "competitors", p.competitors);
  set("competition", "differentiators", p.differentiator);
  set("challenges", "problems", p.problems);
  return out;
}

/** Every field any industry can show, so switching industry never discards an answer. */
const KNOWN_FIELDS = new Map<string, Set<string>>(
  GUAVA_SECTIONS.map((s) => [
    s.key,
    new Set([
      ...s.fields.map((f) => f.key),
      ...GUAVA_INDUSTRIES.flatMap((i) => i.fields.filter((f) => f.section === s.key).map((f) => f.key)),
    ]),
  ]),
);

/** Keep only known sections and fields - saved data never grows unbounded keys. */
function cleanValues(raw: unknown): GuavaValues {
  const out: GuavaValues = {};
  if (!raw || typeof raw !== "object") return out;
  const known = KNOWN_FIELDS;
  for (const [section, fields] of Object.entries(raw as Record<string, unknown>)) {
    const allowed = known.get(section);
    if (!allowed || !fields || typeof fields !== "object") continue;
    for (const [field, value] of Object.entries(fields as Record<string, unknown>)) {
      if (allowed.has(field) && typeof value === "string") (out[section] ??= {})[field] = value;
    }
  }
  return out;
}

/**
 * Saved answers win; the Brand fills any gap. A saved empty string is a
 * deliberate blank and is not replaced.
 */
export function resolveValues(
  saved: GuavaValues,
  derived: GuavaValues,
): { values: GuavaValues; inheritedKeys: string[] } {
  const values: GuavaValues = {};
  const inheritedKeys: string[] = [];
  for (const [section, fields] of Object.entries(saved)) values[section] = { ...fields };
  for (const [section, fields] of Object.entries(derived)) {
    for (const [field, value] of Object.entries(fields)) {
      if (saved[section]?.[field] !== undefined) continue;
      (values[section] ??= {})[field] = value;
      inheritedKeys.push(inheritedKey(section, field));
    }
  }
  return { values, inheritedKeys };
}

/** The saved row's parts, tolerating anything unexpected in the JSON column. */
export function readSaved(row: GuavaProfile | null) {
  const industry = row?.industry ?? null;
  return {
    industry,
    saved: cleanValues(row?.values),
    skipped: (row?.skipped ?? []).filter((s) => GUAVA_SECTION_KEYS.includes(s)),
  };
}

/** The profile as Guava reasons about it: saved answers plus what the Brand already told us. */
export async function loadEffectiveProfile(
  brand: Pick<Brand, "id" | "name" | "category" | "profile">,
) {
  const row = await prisma.guavaProfile.findUnique({ where: { brandId: brand.id } });
  const { industry, saved, skipped } = readSaved(row);
  const { values, inheritedKeys } = resolveValues(saved, brandDerivedValues(brand));
  return { row, industry, saved, skipped, values, inheritedKeys };
}

/** Counts of what has happened inside the platform for this brand. Effort, never results. */
export async function collectPlatformSnapshot(
  brand: Pick<Brand, "id" | "userId" | "workspaceId">,
): Promise<GuavaPlatformSnapshot> {
  const since = new Date(Date.now() - PLATFORM_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const accountScope = brand.workspaceId
    ? { workspaceId: brand.workspaceId }
    : { userId: brand.userId, workspaceId: null };

  const [accounts, plans, images, logo, voice, documents, assets] = await Promise.all([
    prisma.socialAccount.findMany({
      where: { ...accountScope, status: "active" },
      select: { id: true, platform: true, handle: true },
    }),
    prisma.campaignPlan.findMany({
      where: { brandId: brand.id },
      select: { posts: { select: { status: true } } },
    }),
    prisma.generation.count({
      where: { brandId: brand.id, kind: "image", status: "completed", createdAt: { gte: since } },
    }),
    prisma.brandAsset.count({ where: { brandId: brand.id, kind: "logo" } }),
    prisma.brandVoice.count({ where: { brandId: brand.id, status: "enrolled" } }),
    prisma.document.count({ where: { brandId: brand.id } }),
    prisma.brandAsset.count({ where: { brandId: brand.id } }),
  ]);

  const accountIds = accounts.map((a) => a.id);
  const [byStatus, lastPosted] = accountIds.length
    ? await Promise.all([
        prisma.socialPost.groupBy({
          by: ["status"],
          where: { accountId: { in: accountIds }, createdAt: { gte: since } },
          _count: { _all: true },
        }),
        prisma.socialPost.findFirst({
          where: { accountId: { in: accountIds }, status: "posted" },
          orderBy: { postedAt: "desc" },
          select: { postedAt: true },
        }),
      ])
    : [[], null];
  const count = (status: string) => byStatus.find((r) => r.status === status)?._count._all ?? 0;

  const campaignPosts = plans.flatMap((p) => p.posts);
  return {
    windowDays: PLATFORM_WINDOW_DAYS,
    connectedAccounts: accounts.map((a) => ({ platform: a.platform, handle: a.handle })),
    posts: {
      published: count("posted"),
      scheduled: count("scheduled"),
      failed: count("failed"),
      lastPublishedAt: lastPosted?.postedAt?.toISOString() ?? null,
    },
    campaigns: {
      plans: plans.length,
      postsPlanned: campaignPosts.length,
      postsApproved: campaignPosts.filter((p) => p.status === "approved").length,
    },
    content: { imagesCreated: images },
    brand: { hasLogo: logo > 0, hasVoice: voice > 0, documents, assets },
    hasPerformanceData: false,
  };
}

/** Everything the Guava page needs to show the profile. */
export async function buildProfileDto(
  brand: Brand,
  canEdit: boolean,
): Promise<GuavaProfileDto> {
  const { row, industry, skipped, values, inheritedKeys } = await loadEffectiveProfile(brand);
  const parsed = brandProfileSchema.safeParse(brand.profile ?? {});
  const suggestedIndustry = industry
    ? null
    : suggestGuavaIndustry(brand.category, parsed.success ? parsed.data.description : undefined, brand.name);
  return {
    brandId: brand.id,
    brandName: brand.name,
    industry,
    suggestedIndustry,
    values,
    inheritedKeys,
    skipped,
    completeness: computeGuavaCompleteness(values, industry, skipped),
    platform: await collectPlatformSnapshot(brand),
    canEdit,
    updatedAt: row?.updatedAt.toISOString() ?? null,
  };
}

/** Apply a partial update: only the sent fields change, null removes a saved answer. */
export async function saveProfileUpdate(brandId: string, update: GuavaProfileUpdate) {
  const existing = await prisma.guavaProfile.findUnique({ where: { brandId } });
  const current = readSaved(existing);
  const industry = update.industry !== undefined ? update.industry || null : current.industry;
  if (industry && !GUAVA_INDUSTRIES.some((i) => i.key === industry)) {
    throw badRequest("Unknown industry");
  }

  const values = cleanValues(current.saved);
  for (const [section, fields] of Object.entries(cleanValues(update.values))) {
    values[section] = { ...values[section], ...fields };
  }
  // null means "forget my answer" - cleanValues drops non-strings, so apply removals here.
  for (const [section, fields] of Object.entries(update.values ?? {})) {
    for (const [field, value] of Object.entries(fields)) {
      if (value === null && values[section]) delete values[section][field];
    }
  }
  const skipped = (update.skipped ?? current.skipped).filter(
    (s) => GUAVA_SECTION_KEYS.includes(s),
  );

  const data = { industry, values, skipped };
  return prisma.guavaProfile.upsert({
    where: { brandId },
    create: { brandId, ...data },
    update: data,
  });
}

/** The profile as readable text for the model: labelled, section by section. */
export function renderProfileText(values: GuavaValues, industry: string | null): string {
  const lines: string[] = [];
  for (const s of guavaSectionsFor(industry)) {
    const filled = s.fields.filter((f) => values[s.key]?.[f.key]?.trim());
    if (!filled.length) continue;
    lines.push(`## ${s.title}`);
    for (const f of filled) lines.push(`- ${f.label}: ${values[s.key]![f.key]!.trim()}`);
  }
  return lines.join("\n") || "(nothing provided)";
}
