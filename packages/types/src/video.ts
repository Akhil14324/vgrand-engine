import { z } from "zod";

/**
 * Reel studio (phase 1): source folders, reel briefs and the project state
 * machine. The pricing table and transition rules live here so the API, the
 * web app and the tests share one set of rules.
 */

/* ------------------------------- video models ------------------------------- */

export const VIDEO_RESOLUTIONS = ["720p", "1080p"] as const;
export type VideoResolution = (typeof VIDEO_RESOLUTIONS)[number];

export interface VideoModelSpec {
  id: string;
  label: string;
  provider: "google" | "runway" | "kling";
  /** USD per output second, keyed by resolution. */
  pricePerSecondUsd: Record<VideoResolution, number>;
  /** Prices come from third-party listings until checked against the vendor's own pricing page. */
  priceSource: "third-party-estimate";
}

/**
 * Ordered cheapest first. The default is the cheapest model with audio included.
 * Runway and Kling prices vary by provider; the Kling figure is the cheapest listing found.
 */
export const VIDEO_MODELS = [
  {
    id: "veo-3.1-lite",
    label: "Veo 3.1 Lite",
    provider: "google",
    pricePerSecondUsd: { "720p": 0.05, "1080p": 0.08 },
    priceSource: "third-party-estimate",
  },
  {
    id: "runway-gen4-turbo",
    label: "Runway Gen-4 Turbo",
    provider: "runway",
    pricePerSecondUsd: { "720p": 0.05, "1080p": 0.05 },
    priceSource: "third-party-estimate",
  },
  {
    id: "veo-3.1-fast",
    label: "Veo 3.1 Fast",
    provider: "google",
    pricePerSecondUsd: { "720p": 0.1, "1080p": 0.12 },
    priceSource: "third-party-estimate",
  },
  {
    id: "runway-gen4.5",
    label: "Runway Gen-4.5",
    provider: "runway",
    pricePerSecondUsd: { "720p": 0.12, "1080p": 0.12 },
    priceSource: "third-party-estimate",
  },
  {
    id: "kling-3-standard",
    label: "Kling 3.0 Standard",
    provider: "kling",
    pricePerSecondUsd: { "720p": 0.1764, "1080p": 0.1764 },
    priceSource: "third-party-estimate",
  },
  {
    id: "veo-3.1",
    label: "Veo 3.1",
    provider: "google",
    pricePerSecondUsd: { "720p": 0.4, "1080p": 0.4 },
    priceSource: "third-party-estimate",
  },
] as const satisfies readonly VideoModelSpec[];

export type VideoModelId = (typeof VIDEO_MODELS)[number]["id"];
export const VIDEO_MODEL_IDS = VIDEO_MODELS.map((m) => m.id) as [VideoModelId, ...VideoModelId[]];
export const DEFAULT_VIDEO_MODEL: VideoModelId = "veo-3.1-lite";

export const getVideoModel = (id: string): VideoModelSpec | undefined =>
  VIDEO_MODELS.find((m) => m.id === id);

/* --------------------------------- brief ----------------------------------- */

export const REEL_MIN_SECONDS = 5;
export const REEL_MAX_SECONDS = 60;
export const REEL_ASPECT_RATIOS = ["9:16", "1:1", "16:9"] as const;
export const VOICE_PROVIDERS = ["none", "elevenlabs", "fish"] as const;

/** Source folders are capped so one folder can't swamp a single run. */
export const SOURCE_FOLDER_MAX_ASSETS = 300;

export const reelBriefSchema = z.object({
  goal: z.string().trim().min(3).max(500),
  durationSec: z.number().int().min(REEL_MIN_SECONDS).max(REEL_MAX_SECONDS).default(15),
  aspectRatio: z.enum(REEL_ASPECT_RATIOS).default("9:16"),
  resolution: z.enum(VIDEO_RESOLUTIONS).default("720p"),
  videoModel: z.enum(VIDEO_MODEL_IDS).default(DEFAULT_VIDEO_MODEL),
  voiceProvider: z.enum(VOICE_PROVIDERS).default("none"),
});
export type ReelBrief = z.infer<typeof reelBriefSchema>;

export const createSourceFolderSchema = z.object({
  brandId: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
});

export const createVideoProjectSchema = z.object({
  brandId: z.string().uuid(),
  folderId: z.string().uuid().nullable().optional(),
  title: z.string().trim().min(1).max(120),
  brief: reelBriefSchema,
});

/* ----------------------------- project states ------------------------------ */

export const VIDEO_PROJECT_STATUSES = [
  "draft",
  "scripting",
  "generating",
  "editing",
  "review",
  "approved",
  "failed",
  "cancelled",
] as const;
export type VideoProjectStatus = (typeof VIDEO_PROJECT_STATUSES)[number];

/** Forward-only pipeline. `review -> editing` is a requested change; `failed -> scripting` is a retry. */
export const VIDEO_PROJECT_TRANSITIONS: Record<VideoProjectStatus, readonly VideoProjectStatus[]> = {
  draft: ["scripting", "cancelled"],
  // Footage-only reels skip generation and go straight to editing.
  scripting: ["generating", "editing", "failed", "cancelled"],
  generating: ["editing", "failed", "cancelled"],
  editing: ["review", "failed", "cancelled"],
  review: ["approved", "editing", "cancelled"],
  approved: [],
  failed: ["scripting"],
  cancelled: [],
};

/** Statuses where a worker is running; a project in one of these can't be deleted. */
export const VIDEO_PROJECT_BUSY_STATUSES: readonly VideoProjectStatus[] = [
  "scripting",
  "generating",
  "editing",
];

export function canTransitionVideoProject(from: string, to: VideoProjectStatus): boolean {
  const allowed = VIDEO_PROJECT_TRANSITIONS[from as VideoProjectStatus];
  return Boolean(allowed?.includes(to));
}

/* --------------------------------- cost ------------------------------------ */

const MICRO_USD_PER_USD = 1_000_000;

/** Estimated cost in integer micro-dollars, so ledger sums never drift from float rounding. */
export function estimateReelCostMicroUsd(
  model: VideoModelId,
  resolution: VideoResolution,
  seconds: number,
): number {
  const spec = getVideoModel(model);
  if (!spec) throw new Error(`unknown video model: ${model}`);
  return Math.round(seconds * spec.pricePerSecondUsd[resolution] * MICRO_USD_PER_USD);
}

/** True when spending `estimateMicroUsd` on top of `spentMicroUsd` would pass the monthly cap. No cap = never over. */
export function isOverVideoBudget(
  spentMicroUsd: number,
  estimateMicroUsd: number,
  capUsd: number | undefined,
): boolean {
  if (capUsd === undefined) return false;
  return spentMicroUsd + estimateMicroUsd > capUsd * MICRO_USD_PER_USD;
}

/* ---------------------------------- DTOs ----------------------------------- */

export interface SourceAssetDto {
  id: string;
  kind: "image" | "video";
  fileName: string;
  url: string;
  mimeType: string;
  sizeBytes: number;
  durationSec: number | null;
  width: number | null;
  height: number | null;
  createdAt: string;
}

export interface SourceFolderDto {
  id: string;
  brandId: string;
  name: string;
  assetCount: number;
  videoCount: number;
  imageCount: number;
  createdAt: string;
}

export interface SourceFolderDetailDto extends SourceFolderDto {
  assets: SourceAssetDto[];
}

export interface VideoProjectDto {
  id: string;
  brandId: string;
  folderId: string | null;
  title: string;
  brief: ReelBrief;
  status: VideoProjectStatus;
  errorMessage: string | null;
  outputUrl: string | null;
  estimatedCostUsd: number;
  createdAt: string;
  updatedAt: string;
}

export interface VideoBudgetDto {
  spentUsd: number;
  capUsd: number | null;
  remainingUsd: number | null;
  resetsAt: string;
}
