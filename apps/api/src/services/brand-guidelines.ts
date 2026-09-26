import { prisma, Prisma } from "@catgpt/db";
import type { BrandGuidelinesDto, BrandGuidelinesSaveDto, BrandProfile } from "@catgpt/types";
import { env } from "../env.js";
import { badRequest, HttpError, notFound } from "../lib/errors.js";
import { buildBrandSummary, findAccessibleBrand, findManageableBrand } from "../lib/brand.js";
import { getClient } from "./chat.js";
import { fetchOwnBytes } from "./brand-compose.js";
import { renderMarkdownDocx } from "./docx-export.js";
import { renderMarkdownPdf } from "./pdf-export.js";
import { storeFile } from "./storage.js";
import {
  mergeIntoProfile,
  parseGuidelines,
  drawBrandHeader,
  renderGuidelines,
  type GuidelinesNarrative,
} from "./brand-guidelines-doc.js";

const toDto = (g: { brandId: string; content: string; version: number; updatedAt: Date }): BrandGuidelinesDto => ({
  brandId: g.brandId,
  content: g.content,
  version: g.version,
  updatedAt: g.updatedAt.toISOString(),
});

export async function getGuidelines(userId: string, brandId: string): Promise<BrandGuidelinesDto | null> {
  await findAccessibleBrand(userId, brandId);
  const row = await prisma.brandGuidelines.findUnique({ where: { brandId } });
  return row ? toDto(row) : null;
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const strList = (v: unknown, max: number, len: number) =>
  Array.isArray(v) ? v.map((x) => str(x, len)).filter(Boolean).slice(0, max) : [];

/**
 * ONE model call writes the narrative parts. Facts (colours, forbidden lists,
 * required phrases, CTA) come only from the saved profile - the model may
 * suggest tone/typography/logo/visual/photo wording ONLY where the profile is
 * empty, and nothing is saved until the user reviews the draft.
 * The draft is returned, not stored.
 */
export async function generateGuidelinesDraft(userId: string, brandId: string): Promise<string> {
  const brand = await findManageableBrand(userId, brandId);
  const profile = (brand.profile ?? {}) as BrandProfile;

  const facts = JSON.stringify(
    {
      name: brand.name,
      category: brand.category,
      description: profile.description,
      location: profile.location,
      offer: profile.offer,
      customers: profile.customers,
      differentiator: profile.differentiator,
      painPoints: profile.painPoints,
      tagline: profile.tagline,
      tone: profile.tone,
      typography: profile.typography,
      logoRules: profile.logoRules,
      visualStyle: profile.visualStyle,
      photographyStyle: profile.photographyStyle,
      contentLanguages: profile.contentLanguages,
    },
    (_k, v) => (v === undefined || v === "" ? undefined : v),
  );

  const system =
    `You write a brand's style guidelines. Reply with ONE JSON object: ` +
    `{ "essence": string (2-3 sentences: what the brand stands for), "audience": string (who it speaks to), ` +
    `"dos": string[] (4-6 short writing rules), "donts": string[] (4-6), ` +
    `"samplePosts": [{ "platform": "Instagram"|"Facebook"|"X", "text": string }] (exactly 3, on-brand), ` +
    `"suggestions": { "tone"?: string, "typography"?: string, "logoRules"?: string, "visualStyle"?: string, "photographyStyle"?: string } }.\n` +
    `Rules: only state facts, offers, prices or claims that appear in the brand facts - never invent any. ` +
    `In "suggestions" include a key ONLY when that field is missing from the facts (one sentence each). ` +
    `Write in the brand's content language when given, otherwise English. Keep everything concise and practical.`;

  let raw: string;
  try {
    const res = await getClient().chat.completions.create({
      model: env.CAMPAIGN_MODEL,
      response_format: { type: "json_object" },
      temperature: 0.5,
      max_tokens: 1800,
      messages: [
        { role: "system", content: system },
        { role: "user", content: `Brand facts:\n${facts}\n\nBrand summary:\n${brand.summary}` },
      ],
    });
    raw = res.choices[0]?.message?.content ?? "";
  } catch (err) {
    console.error("[guidelines] model call failed:", err instanceof Error ? err.message : err);
    throw new HttpError(502, "Could not generate the guidelines - try again");
  }

  let json: Record<string, any>;
  try {
    json = JSON.parse(raw) as Record<string, any>;
  } catch {
    throw new HttpError(502, "The guidelines came back malformed - try again");
  }
  const sug = (json.suggestions ?? {}) as Record<string, unknown>;
  const narrative: GuidelinesNarrative = {
    essence: str(json.essence, 500),
    audience: str(json.audience, 400),
    dos: strList(json.dos, 6, 160),
    donts: strList(json.donts, 6, 160),
    samplePosts: (Array.isArray(json.samplePosts) ? json.samplePosts : [])
      .map((p: any) => ({ platform: str(p?.platform, 20) || "Post", text: str(p?.text, 400) }))
      .filter((p: { text: string }) => p.text)
      .slice(0, 3),
    suggestions: {
      tone: str(sug.tone, 300),
      typography: str(sug.typography, 300),
      logoRules: str(sug.logoRules, 500),
      visualStyle: str(sug.visualStyle, 300),
      photographyStyle: str(sug.photographyStyle, 300),
    },
  };
  if (!narrative.essence) throw new HttpError(502, "The guidelines were incomplete - try again");
  return renderGuidelines(brand.name, profile, narrative);
}

/**
 * Saves the document and re-derives the matching brand profile fields + the
 * prompt summary, so edits change every future generation. All-or-nothing.
 */
export async function saveGuidelines(userId: string, brandId: string, content: string): Promise<BrandGuidelinesSaveDto> {
  const brand = await findManageableBrand(userId, brandId);
  let merged: ReturnType<typeof mergeIntoProfile>;
  try {
    merged = mergeIntoProfile((brand.profile ?? {}) as BrandProfile, parseGuidelines(content));
  } catch (err) {
    throw badRequest(`Cannot save: ${err instanceof Error ? err.message : "invalid guidelines"}`);
  }

  const [row] = await prisma.$transaction([
    prisma.brandGuidelines.upsert({
      where: { brandId },
      create: { brandId, content, updatedBy: userId },
      update: { content, version: { increment: 1 }, updatedBy: userId },
    }),
    prisma.brand.update({
      where: { id: brandId },
      data: {
        profile: merged.profile as Prisma.InputJsonValue,
        summary: buildBrandSummary(brand.name, brand.category, merged.profile),
      },
    }),
  ]);
  return { ...toDto(row), updatedFields: merged.updatedFields };
}

/** Exports the SAVED guidelines; returns a stored file URL (same pattern as chat PDFs). */
export async function exportGuidelines(userId: string, brandId: string, format: "pdf" | "docx"): Promise<{ url: string }> {
  const brand = await findAccessibleBrand(userId, brandId);
  const row = await prisma.brandGuidelines.findUnique({ where: { brandId } });
  if (!row) throw notFound("Save the guidelines before exporting them");
  const title = `${brand.name} Brand Guidelines`;
  const profile = (brand.profile ?? {}) as BrandProfile;

  let buffer: Buffer;
  if (format === "docx") {
    buffer = await renderMarkdownDocx(title, row.content);
  } else {
    const logoUrl = brand.assets.find((a) => a.kind === "logo")?.url;
    const logo = logoUrl ? await fetchOwnBytes(logoUrl).catch(() => null) : null;
    const colors = profile.colors ?? [];
    buffer = await renderMarkdownPdf(title, row.content, {
      bare: true,
      creator: brand.name,
      beforeBody: (doc) => drawBrandHeader(doc, { logo, colors }),
    });
  }
  const url = await storeFile({
    buffer,
    mimeType: format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    keyPrefix: `exports/${userId}`,
  });
  return { url };
}
