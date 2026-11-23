import { z } from "zod";
import { GUAVA_EVIDENCE, GUAVA_PRIORITY_LEVELS } from "./guava";

/**
 * Guava's Instagram content review: Gemini watches the brand's recent reels
 * (and, optionally, competitors' reels), then judges them against what the
 * Brand says about itself. Advisory only - nothing is posted or changed.
 */

/** Instagram usernames: letters, digits, dot, underscore; at most 30 chars. */
export const IG_HANDLE_RE = /^[A-Za-z0-9._]{1,30}$/;
export const GUAVA_MAX_COMPETITORS = 3;
export const GUAVA_OWN_REELS = 6;
export const GUAVA_COMPETITOR_REELS = 4;
/** How many recent posts are sorted into brands when one account serves several brands. */
export const GUAVA_SPLIT_POSTS = 30;

/** Accepts "@name", "name" or an instagram.com profile link; returns the bare handle or null. */
export function normalizeIgHandle(input: string): string | null {
  let s = input.trim();
  const link = s.match(/instagram\.com\/([^/?#\s]+)/i);
  if (link) s = link[1]!;
  s = s.replace(/^@+/, "").replace(/\/+$/, "");
  return IG_HANDLE_RE.test(s) ? s.toLowerCase() : null;
}

const competitorsSchema = z
  .array(z.string().trim().max(200))
  .max(10)
  .default([])
  .transform((list, ctx) => {
    const out: string[] = [];
    for (const raw of list) {
      if (!raw) continue;
      const h = normalizeIgHandle(raw);
      if (!h) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `"${raw}" is not a valid Instagram username` });
        return z.NEVER;
      }
      if (!out.includes(h)) out.push(h);
    }
    if (out.length > GUAVA_MAX_COMPETITORS) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Compare with at most ${GUAVA_MAX_COMPETITORS} competitors at a time` });
      return z.NEVER;
    }
    return out;
  });

/** A one-off run; with no body the brand's saved Instagram setup is used. */
export const guavaContentAuditRequestSchema = z.object({
  accountId: z.string().uuid(),
  competitors: competitorsSchema,
});
export type GuavaContentAuditRequest = z.input<typeof guavaContentAuditRequestSchema>;

/**
 * Saved on the Instagram page: the owner's one Instagram account and up to three
 * rival accounts. Shared by every brand in the same scope (personal or one
 * workspace); Brand Strategist splits the account's posts by brand.
 */
export const instagramSetupUpdateSchema = z.object({
  workspaceId: z.string().uuid().nullable().default(null),
  accountId: z.string().uuid().nullable(),
  competitors: competitorsSchema,
});
export type InstagramSetupUpdate = z.input<typeof instagramSetupUpdateSchema>;

export interface InstagramSetupDto {
  workspaceId: string | null;
  accountId: string | null;
  /** Handle of the saved account; null when none is saved or it was disconnected. */
  accountHandle: string | null;
  competitors: string[];
  /** Personal setup: always. Workspace setup: the workspace owner only. */
  canEdit: boolean;
  updatedAt: string | null;
}

/* ------------------------------ per-reel notes ----------------------------- */

const text = z.string().catch("");
const textList = z.array(z.string()).catch([]);
const evidence = z.enum(GUAVA_EVIDENCE).catch("hypothesis");
const level = z.enum(GUAVA_PRIORITY_LEVELS).catch("medium");
const items = <T extends z.ZodTypeAny>(item: T) =>
  z.array(z.unknown()).catch([]).transform((arr) =>
    arr.flatMap((v) => {
      const r = item.safeParse(v);
      return r.success ? [r.data as z.infer<T>] : [];
    }),
  );

/** What Gemini saw in one reel. Model output is untrusted, so every field has a fallback. */
export const guavaReelNotesSchema = z.object({
  summary: text,
  hook: text,
  format: text,
  visuals: text,
  audio: text,
  onScreenText: text,
  cta: text,
  tone: text,
  productsShown: text,
  audience: text,
  quality: text,
});
export type GuavaReelNotes = z.infer<typeof guavaReelNotesSchema>;

/** How much of the reel Gemini actually got to see. */
export const GUAVA_REEL_SOURCES = ["video", "thumbnail", "caption"] as const;
export type GuavaReelSource = (typeof GUAVA_REEL_SOURCES)[number];

export interface GuavaReelInsight {
  mediaId: string;
  handle: string;
  isOwn: boolean;
  permalink: string | null;
  thumbnailUrl: string | null;
  caption: string;
  timestamp: string | null;
  /** Straight from Instagram; null when hidden or not returned. */
  likes: number | null;
  comments: number | null;
  analysedFrom: GuavaReelSource;
  notes: GuavaReelNotes;
}

export interface GuavaIgAccountInfo {
  handle: string;
  name: string | null;
  followers: number | null;
  mediaCount: number | null;
  biography: string | null;
}

/* ---------------------------------- report --------------------------------- */

export const GUAVA_BRAND_FIT = ["on_brand", "partly", "off_brand"] as const;
export type GuavaBrandFit = (typeof GUAVA_BRAND_FIT)[number];
const fit = z.enum(GUAVA_BRAND_FIT).catch("partly");

export const guavaContentReportSchema = z.object({
  headline: text,
  summary: text,
  /** "brand_data" = judged against the Brand Engine profile; "inferred" = brand data was too thin, so the brand was read from the content itself. */
  brandBasis: z.enum(["brand_data", "inferred"]).catch("inferred"),
  brandBasisNote: text,
  brandFit: z
    .object({
      verdict: fit,
      score: z.coerce.number().min(0).max(100).catch(50),
      why: text,
    })
    .catch({ verdict: "partly", score: 50, why: "" }),
  ownContent: z
    .object({
      themes: textList,
      strengths: items(z.object({ title: text, detail: text, evidence })),
      weaknesses: items(z.object({ title: text, detail: text, evidence })),
    })
    .catch({ themes: [], strengths: [], weaknesses: [] }),
  brandGaps: items(z.object({ brandSays: text, contentShows: text, fix: text })),
  reelVerdicts: items(z.object({ mediaId: text, fit, note: text, positives: textList, negatives: textList })),
  /** The model's reading of the numbers; the numbers themselves are computed, see GuavaPerformance. */
  performance: z
    .object({ summary: text, whatWorks: text, whatDoesNot: text })
    .catch({ summary: "", whatWorks: "", whatDoesNot: "" }),
  reachTips: items(z.object({ tip: text, why: text })),
  improvements: items(
    z.object({
      title: text,
      what: text,
      why: text,
      example: text,
      measure: text,
      priority: level,
    }),
  ),
  competitors: items(
    z.object({
      handle: text,
      summary: text,
      differences: items(z.object({ aspect: text, you: text, them: text })),
      theyDoBetter: textList,
      youDoBetter: textList,
      ideasToTry: textList,
    }),
  ),
  uncertainties: items(z.object({ area: text, needed: text })),
});
export type GuavaContentReport = z.infer<typeof guavaContentReportSchema>;

/* ------------------------------ account split ------------------------------ */

/**
 * One Instagram account can carry posts for several of the user's brands.
 * Each recent post is assigned to one brand (or none) plus a content category,
 * and only this brand's posts are reviewed.
 */
export interface GuavaSplitPost {
  mediaId: string;
  brandId: string | null;
  brandName: string | null;
  category: string;
  reason: string;
  isReel: boolean;
  permalink: string | null;
  thumbnailUrl: string | null;
  caption: string;
  timestamp: string | null;
  likes: number | null;
  comments: number | null;
}

export const guavaSplitResponseSchema = z.object({
  posts: items(z.object({ mediaId: text, brand: text, category: text, reason: text })),
});

/** Computed from Instagram's own numbers, never by the model. */
export interface GuavaPerformance {
  followers: number | null;
  postsReviewed: number;
  avgLikes: number | null;
  avgComments: number | null;
  /** (avg likes + avg comments) / followers, as a percentage; null without followers. */
  engagementRatePct: number | null;
  bestMediaId: string | null;
  weakestMediaId: string | null;
}

/* ----------------------------------- DTOs ---------------------------------- */

export type GuavaContentAuditStatus = "processing" | "completed" | "failed";

export interface GuavaContentAuditSummaryDto {
  id: string;
  status: GuavaContentAuditStatus;
  /** The Instagram account this brand was reviewed with; the page preselects it next time. */
  accountId: string | null;
  handle: string | null;
  competitors: string[];
  headline: string;
  verdict: GuavaBrandFit | null;
  score: number | null;
  /** Live step shown while processing, e.g. "Watching reel 3 of 8". */
  progress: string | null;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface GuavaContentAuditDto extends GuavaContentAuditSummaryDto {
  report: GuavaContentReport | null;
  accounts: GuavaIgAccountInfo[];
  reels: GuavaReelInsight[];
  /** Every recent post on the account and which brand it belongs to (empty when the user has one brand). */
  split: GuavaSplitPost[];
  performance: GuavaPerformance | null;
  /** Competitors that could not be read (private, personal account, not found). */
  skippedCompetitors: { handle: string; reason: string }[];
}
