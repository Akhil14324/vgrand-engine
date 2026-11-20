import { z } from "zod";

/* -------------------------------------------------------------------------- */
/*  Shorts Factory: shared enums, state machine, seed data, schemas and DTOs. */
/* -------------------------------------------------------------------------- */

export const SHORTS_PATHS = ["A", "B", "C"] as const;
export type ShortsPath = (typeof SHORTS_PATHS)[number];

export const SHORTS_PATH_LABELS: Record<ShortsPath, string> = {
  A: "A: ingest external renders",
  B: "B: stock + script + voice",
  C: "C: AI clips (metered)",
};

export const SHORTS_APPROVAL_MODES = ["manual", "auto"] as const;
export type ShortsApprovalMode = (typeof SHORTS_APPROVAL_MODES)[number];

export const SHORTS_STATUSES = [
  "idea",
  "scripted",
  "assets_ready",
  "rendered",
  "awaiting_approval",
  "approved",
  "scheduled",
  "posted",
  "manual_pending",
  "manual_posted",
  "failed",
  "rejected",
] as const;
export type ShortsStatus = (typeof SHORTS_STATUSES)[number];

/**
 * Allowed moves. `failed` is reachable from every working state; a failed video
 * can be retried back to the step it failed at (idea/scripted/assets_ready/rendered/approved).
 * `rejected` is the owner declining a video at approval.
 */
export const SHORTS_TRANSITIONS: Record<ShortsStatus, readonly ShortsStatus[]> = {
  idea: ["scripted", "failed"],
  scripted: ["assets_ready", "failed"],
  assets_ready: ["rendered", "failed"],
  // Path A ingest enters at `rendered`.
  rendered: ["awaiting_approval", "approved", "failed"],
  awaiting_approval: ["approved", "rejected", "failed"],
  approved: ["scheduled", "posted", "manual_pending", "failed"],
  // A scheduled upload can turn out to be private-locked and go manual.
  scheduled: ["posted", "manual_pending", "failed"],
  posted: [],
  manual_pending: ["manual_posted", "approved", "failed"],
  manual_posted: [],
  failed: ["idea", "scripted", "assets_ready", "rendered", "approved"],
  rejected: [],
};

export function canTransition(from: ShortsStatus, to: ShortsStatus): boolean {
  return SHORTS_TRANSITIONS[from]?.includes(to) ?? false;
}

/** Statuses that count as "posted" for analytics. */
export const SHORTS_POSTED_STATUSES: readonly ShortsStatus[] = ["posted", "manual_posted"];

export const SHORTS_HOOK_TYPES = [
  "question",
  "shock_fact",
  "countdown",
  "pov",
  "challenge",
  "story",
  "how_to",
  "reveal",
  "relatable",
  "other",
] as const;
export type ShortsHookType = (typeof SHORTS_HOOK_TYPES)[number];

export interface ShortsStyleNotes {
  tone: string;
  hookPatterns: string[];
  bannedTopics: string[];
  extra?: string;
}

export interface ShortsSeedChannel {
  slug: string;
  displayName: string;
  niche: string;
  path: ShortsPath;
  fallbackPath: ShortsPath | null;
  postingTimes: string[];
  styleNotes: ShortsStyleNotes;
  stockKeywords: string[];
}

const COMMON_BANNED = ["politics", "religion", "medical advice", "real people by name", "violence or injury shown for laughs"];

/** The 10 experiment channels. Approval is manual for all of them; the owner changes it in the UI. */
export const SHORTS_SEED_CHANNELS: ShortsSeedChannel[] = [
  {
    slug: "oddly-satisfying",
    displayName: "Oddly Satisfying",
    niche: "oddly satisfying",
    path: "A",
    fallbackPath: null,
    postingTimes: ["19:00"],
    styleNotes: { tone: "calm, minimal text", hookPatterns: ["wait for it", "perfect fit"], bannedTopics: COMMON_BANNED },
    stockKeywords: [],
  },
  {
    slug: "weird-science",
    displayName: "Weird Science and Illusions",
    niche: "science and illusions",
    path: "A",
    fallbackPath: null,
    postingTimes: ["18:00"],
    styleNotes: { tone: "curious, precise", hookPatterns: ["your brain is lying", "this shouldn't work"], bannedTopics: COMMON_BANNED },
    stockKeywords: [],
  },
  {
    slug: "cats",
    displayName: "Cats",
    niche: "cats",
    path: "B",
    fallbackPath: null,
    postingTimes: ["08:30"],
    styleNotes: {
      tone: "warm, playful, a little dry humour",
      hookPatterns: ["question", "surprising fact", "POV from the cat"],
      bannedTopics: [...COMMON_BANNED, "animal cruelty", "unsafe pet advice"],
    },
    stockKeywords: ["cat", "kitten", "cat playing", "cat sleeping", "cat close up"],
  },
  {
    slug: "dogs",
    displayName: "Dogs",
    niche: "dogs",
    path: "B",
    fallbackPath: null,
    postingTimes: ["09:30"],
    styleNotes: {
      tone: "upbeat, affectionate",
      hookPatterns: ["did you know", "countdown", "POV from the dog"],
      bannedTopics: [...COMMON_BANNED, "animal cruelty", "unsafe pet advice"],
    },
    stockKeywords: ["dog", "puppy", "dog running", "dog playing", "dog portrait"],
  },
  {
    slug: "wild-animals",
    displayName: "Wild Animals",
    niche: "wild animals",
    path: "B",
    fallbackPath: null,
    postingTimes: ["12:30"],
    styleNotes: {
      tone: "documentary, awe-struck but accurate",
      hookPatterns: ["shock fact", "countdown", "which animal"],
      bannedTopics: [...COMMON_BANNED, "graphic predation", "unverified animal facts"],
    },
    stockKeywords: ["wildlife", "lion", "elephant", "bird", "ocean animals", "forest animals"],
  },
  {
    slug: "food",
    displayName: "Food",
    niche: "food",
    path: "B",
    fallbackPath: null,
    postingTimes: ["13:30"],
    styleNotes: {
      tone: "sensory, quick, appetising",
      hookPatterns: ["you've been doing it wrong", "one-ingredient secret", "story"],
      bannedTopics: [...COMMON_BANNED, "diet or health claims", "brand names"],
    },
    stockKeywords: ["cooking", "street food", "dessert", "chef", "food close up", "spices"],
  },
  {
    slug: "wholesome",
    displayName: "Wholesome",
    niche: "wholesome moments",
    path: "B",
    fallbackPath: null,
    postingTimes: ["20:30"],
    styleNotes: {
      tone: "gentle, hopeful, never preachy",
      hookPatterns: ["story", "small kindness", "question"],
      bannedTopics: [...COMMON_BANNED, "tragedy", "charity appeals"],
    },
    stockKeywords: ["friends laughing", "family", "kindness", "sunrise", "people hugging"],
  },
  {
    slug: "memes-relatable",
    displayName: "Memes / Relatable",
    niche: "relatable everyday humour",
    path: "B",
    fallbackPath: null,
    postingTimes: ["21:30"],
    styleNotes: {
      tone: "deadpan, self-aware, Gen Z friendly",
      hookPatterns: ["POV", "nobody:", "relatable"],
      bannedTopics: [...COMMON_BANNED, "copyrighted meme formats", "punching down"],
    },
    stockKeywords: ["office", "student studying", "phone scrolling", "monday morning", "traffic"],
  },
  {
    slug: "fails",
    displayName: "Fails",
    niche: "harmless fails",
    path: "C",
    fallbackPath: "B",
    postingTimes: ["17:30"],
    styleNotes: {
      tone: "comic timing, no mockery of real people",
      hookPatterns: ["wait for it", "countdown", "it went wrong"],
      bannedTopics: [...COMMON_BANNED, "serious injury", "real accidents"],
    },
    stockKeywords: ["slip", "spill", "clumsy", "funny mistake", "cake falling"],
  },
  {
    slug: "insane-skills",
    displayName: "Insane Skills",
    niche: "insane skills",
    path: "C",
    fallbackPath: "B",
    postingTimes: ["16:30"],
    styleNotes: {
      tone: "hype but specific",
      hookPatterns: ["this is impossible", "countdown", "how long did it take"],
      bannedTopics: [...COMMON_BANNED, "dangerous stunts to copy"],
    },
    stockKeywords: ["parkour", "juggling", "skateboard trick", "basketball trick", "drawing timelapse"],
  },
];

/* --------------------------------- schemas -------------------------------- */

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "use HH:MM (24h)");

export const shortsStyleNotesSchema = z.object({
  tone: z.string().max(300).default(""),
  hookPatterns: z.array(z.string().min(1).max(120)).max(20).default([]),
  bannedTopics: z.array(z.string().min(1).max(120)).max(40).default([]),
  extra: z.string().max(2000).optional(),
});

export const updateShortsChannelSchema = z
  .object({
    displayName: z.string().min(1).max(80),
    niche: z.string().min(1).max(80),
    path: z.enum(SHORTS_PATHS),
    fallbackPath: z.enum(SHORTS_PATHS).nullable(),
    videosPerDay: z.number().int().min(0).max(6),
    postingTimes: z.array(hhmm).max(6),
    approvalMode: z.enum(SHORTS_APPROVAL_MODES),
    voiceId: z.string().max(100).nullable(),
    styleNotes: shortsStyleNotesSchema,
    stockKeywords: z.array(z.string().min(1).max(60)).max(30),
    enabled: z.boolean(),
  })
  .partial()
  .refine((v) => v.postingTimes === undefined || new Set(v.postingTimes).size === v.postingTimes.length, {
    message: "posting times must be distinct",
    path: ["postingTimes"],
  });
export type UpdateShortsChannelRequest = z.infer<typeof updateShortsChannelSchema>;

/** A video URL pasted by the owner after posting by hand. */
export const markShortsPostedSchema = z.object({
  url: z.string().url().max(500),
  postedAt: z.string().datetime().optional(),
});

export const shortsManualMetricSchema = z.object({
  viewedPct: z.number().min(0).max(100).nullable(),
});

export const shortsSettingsSchema = z.object({
  pathCPricePerSecond: z.number().min(0).max(1000).nullable(),
  pathCModel: z.string().max(60).nullable().optional(),
});

/** Optional JSON sidecar next to a Path A MP4. */
export const shortsSidecarSchema = z.object({
  title: z.string().min(1).max(100).optional(),
  description: z.string().max(5000).optional(),
  tags: z.array(z.string().min(1).max(100)).max(30).optional(),
  synthetic: z.boolean().optional(),
  hookType: z.enum(SHORTS_HOOK_TYPES).optional(),
  topic: z.string().max(120).optional(),
});
export type ShortsSidecar = z.infer<typeof shortsSidecarSchema>;

/* ---------------------------------- DTOs ---------------------------------- */

export interface ShortsChannelDto {
  id: string;
  slug: string;
  displayName: string;
  niche: string;
  path: ShortsPath;
  fallbackPath: ShortsPath | null;
  videosPerDay: number;
  postingTimes: string[];
  approvalMode: ShortsApprovalMode;
  voiceId: string | null;
  styleNotes: ShortsStyleNotes;
  stockKeywords: string[];
  enabled: boolean;
  youtube: {
    status: "disconnected" | "connected" | "reauth_required";
    channelId: string | null;
    channelTitle: string | null;
    reason: string | null;
    connectedAt: string | null;
  };
  counts: Partial<Record<ShortsStatus, number>>;
}

export interface ShortsAssetDto {
  id: string;
  kind: string;
  provider: string;
  providerAssetId: string | null;
  sourceUrl: string | null;
  license: string;
  licenseUrl: string | null;
  author: string | null;
  beatIndex: number | null;
}

export interface ShortsEventDto {
  id: string;
  level: string;
  type: string;
  message: string;
  createdAt: string;
}

export interface ShortsVideoDto {
  id: string;
  channelId: string;
  channelSlug: string;
  channelName: string;
  status: ShortsStatus;
  path: ShortsPath;
  plannedPath: ShortsPath;
  source: string;
  slotAt: string | null;
  title: string | null;
  description: string | null;
  tags: string[];
  hook: string | null;
  hookType: string | null;
  topic: string | null;
  narration: string | null;
  durationSec: number | null;
  synthetic: boolean;
  dims: Record<string, string | number | boolean | null>;
  youtubeVideoId: string | null;
  youtubeUrl: string | null;
  publishAt: string | null;
  postedAt: string | null;
  privacyStatus: string | null;
  privateLocked: boolean;
  manualReason: string | null;
  error: string | null;
  manualViewedPct: number | null;
  /** Short-lived signed URL for preview/download, when a file exists. */
  fileUrl: string | null;
  createdAt: string;
  updatedAt: string;
  latestStats: { views: number | null; likes: number | null; comments: number | null; capturedAt: string } | null;
}

export interface ShortsVideoDetailDto extends ShortsVideoDto {
  assets: ShortsAssetDto[];
  events: ShortsEventDto[];
  validation: unknown;
  llmPrompt: unknown;
  llmResponse: unknown;
}

export interface ShortsHealthDto {
  ok: boolean;
  missingRequired: string[];
  invalid: string[];
  warnings: string[];
  features: {
    script: boolean;
    voice: boolean;
    stock: boolean;
    publicStats: boolean;
    youtubeOAuth: boolean;
    pathC: boolean;
    ffmpeg: boolean;
  };
  timezone: string;
  budget: { amount: number | null; currency: string | null };
}
