import { z } from "zod";

/* Instagram Insights: the account's own numbers straight from Instagram (views, reach, watch time...). */

export const IG_INSIGHTS_DAYS = 30;
export const IG_INSIGHTS_REELS = 12;

export type IgInsightsStatus = "ok" | "no_account" | "needs_permission" | "error";

export interface IgInsightsAccount {
  handle: string;
  followers: number | null;
  /** Totals over the last IG_INSIGHTS_DAYS days; null when Instagram didn't return them. */
  views: number | null;
  reach: number | null;
  interactions: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  /** Reach split: accounts that already follow you vs. new people. */
  reachFollowers: number | null;
  reachNonFollowers: number | null;
}

export interface IgInsightsReel {
  mediaId: string;
  permalink: string | null;
  thumbnailUrl: string | null;
  caption: string;
  timestamp: string | null;
  views: number | null;
  reach: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  interactions: number | null;
  /** Average seconds watched per view. */
  avgWatchSec: number | null;
  /** Instagram's own count of how many people skipped it in the first moments, as a % (when returned). */
  skipRatePct: number | null;
}

export interface IgDemographicRow {
  label: string;
  value: number;
}

export interface IgInsightsDemographics {
  gender: IgDemographicRow[];
  age: IgDemographicRow[];
}

export interface IgInsightsDto {
  status: IgInsightsStatus;
  /** Plain-language explanation when status isn't "ok". */
  message: string | null;
  accountId: string | null;
  handle: string | null;
  days: number;
  account: IgInsightsAccount | null;
  reels: IgInsightsReel[];
  demographics: IgInsightsDemographics | null;
  fetchedAt: string | null;
}

/* ------------------------------ AI strategy ------------------------------- */

const text = z.string().catch("");
const textList = z.array(z.string()).catch([]);
const items = <T extends z.ZodTypeAny>(item: T) =>
  z.array(z.unknown()).catch([]).transform((arr) =>
    arr.flatMap((v) => {
      const r = item.safeParse(v);
      return r.success ? [r.data as z.infer<T>] : [];
    }),
  );

export const igStrategySchema = z.object({
  headline: text,
  summary: text,
  whatWorks: textList,
  whatDoesNot: textList,
  nextReels: items(z.object({ title: text, hook: text, format: text, why: text })),
  audience: textList,
  posting: textList,
  watchOut: textList,
});
export type IgStrategy = z.infer<typeof igStrategySchema>;

export interface IgStrategyDto {
  strategy: IgStrategy;
  brandName: string;
  generatedAt: string;
}
