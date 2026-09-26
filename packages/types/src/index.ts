import { z } from "zod";

/* ---------------------------------- enums --------------------------------- */

export const PROVIDERS = ["openai", "flux", "ideogram"] as const;
export type ProviderName = (typeof PROVIDERS)[number];

export const QUALITIES = ["low", "medium", "high"] as const;
export type Quality = (typeof QUALITIES)[number];

export const IMAGE_SIZES = [
  "auto",
  "1088x1360",
  "1024x1024",
  "1024x1536",
  "1536x1024",
] as const;
export type ImageSize = (typeof IMAGE_SIZES)[number];

export const GENERATION_STATUSES = [
  "pending",
  "processing",
  "completed",
  "failed",
  "cancelled",
] as const;
export type GenerationStatus = (typeof GENERATION_STATUSES)[number];

export const MEMORY_TYPES = ["preference", "fact", "style", "learned"] as const;
export type MemoryType = (typeof MEMORY_TYPES)[number];

export const GENERATION_KINDS = ["image", "text"] as const;
export type GenerationKind = (typeof GENERATION_KINDS)[number];

export const DOCUMENT_STATUSES = ["processing", "ready", "failed"] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

export const BRAND_VOICE_STATUSES = ["enrolling", "ready", "failed"] as const;
export type BrandVoiceStatus = (typeof BRAND_VOICE_STATUSES)[number];

export const BRAND_VOICE_CONSENT_TYPES = [
  "own_voice",
  "authorized_voice",
] as const;
export type BrandVoiceConsentType = (typeof BRAND_VOICE_CONSENT_TYPES)[number];

export const IMAGE_EDIT_OPERATIONS = [
  "edit",
  "inpaint",
  "outpaint",
  "remove_background",
  "upscale",
] as const;
export type ImageEditOperation = (typeof IMAGE_EDIT_OPERATIONS)[number];

export const APPROVAL_STATUSES = [
  "pending",
  "approved",
  "changes_requested",
] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export const CAMPAIGN_PLAN_STATUSES = ["active", "paused", "completed"] as const;
export type CampaignPlanStatus = (typeof CAMPAIGN_PLAN_STATUSES)[number];

export const CAMPAIGN_POST_STATUSES = [
  "scheduled",
  "generating",
  "ready_for_review",
  "approved",
  "failed",
  "cancelled",
] as const;
export type CampaignPostStatus = (typeof CAMPAIGN_POST_STATUSES)[number];

/* ---------------------------------- DTOs ---------------------------------- */

export interface ThemeStyleGuide {
  palette?: string[];
  negativePrompt?: string;
  preferredProvider?: ProviderName;
  layoutHints?: string;
  /** Brand reference images (paths under /theme-assets/ or full URLs) — sent as the edit base so output keeps the theme's branding. */
  referenceImageUrls?: string[];
  [key: string]: unknown;
}

export interface ThemeDto {
  id: string;
  slug: string;
  label: string;
  description: string | null;
  promptTemplate: string;
  styleGuide: ThemeStyleGuide | null;
  icon: string | null;
  isActive: boolean;
  createdAt: string;
}

export interface GenerationDto {
  id: string;
  userId: string;
  themeId: string | null;
  theme?: Pick<ThemeDto, "id" | "slug" | "label" | "icon"> | null;
  conversationId: string | null;
  /** "image" = generated image, "text" = chat reply (textResponse set). */
  kind: GenerationKind;
  prompt: string;
  /** Set on detail responses; omitted from list payloads to keep them light. */
  finalPrompt?: string;
  textResponse: string | null;
  provider: string;
  model: string | null;
  imageUrls: string[];
  status: GenerationStatus;
  error: string | null;
  metadata: Record<string, unknown> | null;
  parentId: string | null;
  createdAt: string;
}

/** A named collection of documents + chats — durable cross-chat RAG context. */
export interface WorkspaceDto {
  id: string;
  userId: string;
  name: string;
  /** The viewer's role: the creator is the owner; everyone else is a member. */
  role: "owner" | "member";
  /** People in the workspace, including the owner. */
  memberCount: number;
  documentCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceDetailDto extends WorkspaceDto {
  documents: DocumentDto[];
}

/** A chat — a group of generations, like a Claude/ChatGPT conversation. */
export interface ConversationDto {
  id: string;
  userId: string;
  title: string;
  pinned: boolean;
  archived: boolean;
  workspaceId: string | null;
  workspace?: { id: string; name: string } | null;
  generationCount: number;
  /** Latest generation in the chat — thumbnail + context for the sidebar. */
  preview: {
    id: string;
    prompt: string;
    imageUrl: string | null;
    status: GenerationStatus;
  } | null;
  createdAt: string;
  updatedAt: string;
}

export interface MemoryDto {
  id: string;
  userId: string;
  type: MemoryType | string;
  content: string;
  sourceGenId: string | null;
  /** First image of the source generation, when it still exists. */
  previewImage: string | null;
  /** Snapshot stored at generation time (prompt, model, urls, latency…). */
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

/** An uploaded document attached to a chat, chunked + embedded for RAG. */
export interface DocumentDto {
  id: string;
  userId: string;
  conversationId: string | null;
  filename: string;
  /** Stored file location — lets the client open the original. */
  storageUrl: string | null;
  pageCount: number;
  chunkCount: number;
  status: DocumentStatus;
  error: string | null;
  createdAt: string;
}

export interface ShareLinkDto {
  token: string;
  url: string;
  expiresAt: string | null;
}

/** Public, unauthenticated view returned by GET /share/:token */
export interface PublicShareDto {
  prompt: string;
  imageUrls: string[];
  themeLabel: string | null;
  provider: string;
  createdAt: string;
}

export interface ApprovalLinkDto {
  id: string;
  generationId: string;
  token: string;
  url: string;
  status: ApprovalStatus;
  reviewerName: string | null;
  reviewerEmail: string | null;
  comment: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  respondedAt: string | null;
  createdAt: string;
}

/** Public, unauthenticated client-review view returned by GET /approvals/:token. */
export interface PublicApprovalDto {
  prompt: string;
  imageUrls: string[];
  status: ApprovalStatus;
  reviewerName: string | null;
  comment: string | null;
  expiresAt: string | null;
  createdAt: string;
}

export interface CampaignPostDto {
  id: string;
  planId: string;
  generationId: string | null;
  scheduledFor: string;
  platform: string | null;
  prompt: string;
  caption: string | null;
  status: CampaignPostStatus;
  error: string | null;
  approvedAt: string | null;
  imageUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CampaignPlanDto {
  id: string;
  brandId: string;
  conversationId: string | null;
  title: string;
  status: CampaignPlanStatus;
  timezone: string;
  posts: CampaignPostDto[];
  createdAt: string;
  updatedAt: string;
}

/* ------------------------------ request bodies ----------------------------- */

export const createGenerationSchema = z.object({
  themeSlug: z.string().min(1).optional(),
  prompt: z.string().min(1).max(4000),
  /** Existing chat to append to. Omit to start a new conversation. */
  conversationId: z.string().uuid().optional(),
  /** Workspace a brand-new conversation should live inside. */
  workspaceId: z.string().uuid().optional(),
  provider: z.enum(PROVIDERS).optional(),
  quality: z.enum(QUALITIES).optional(),
  size: z.enum(IMAGE_SIZES).optional(),
  referenceImageUrl: z.string().url().optional(),
  /** Up to 10 reference images (edit mode). Merged with referenceImageUrl. */
  referenceImageUrls: z.array(z.string().url()).max(10).optional(),
  /** Uploaded PDFs to attach to this chat — their chunks feed RAG answers. */
  documentIds: z.array(z.string().uuid()).max(4).optional(),
  /** Force a live web search for this turn (otherwise auto-detected). */
  webSearch: z.boolean().optional(),
  /** Spoken conversation turn ("Kill Bill" voice mode): short spoken-style reply. */
  voice: z.boolean().optional(),
  /** Answer/create as this brand (brand mode). Omit for a common answer. */
  brandId: z.string().uuid().optional(),
  parentId: z.string().uuid().optional(),
});
export type CreateGenerationRequest = z.infer<typeof createGenerationSchema>;

export const regenerateGenerationSchema = z.object({
  prompt: z.string().min(1).max(4000).optional(),
  quality: z.enum(QUALITIES).optional(),
  size: z.enum(IMAGE_SIZES).optional(),
  /** Structured image-edit primitive; plain "edit" preserves current behavior. */
  operation: z.enum(IMAGE_EDIT_OPERATIONS).optional(),
  /** Optional uploaded replacement base (used by outpaint's expanded canvas). */
  referenceImageUrl: z.string().url().optional(),
  /** Uploaded PNG mask for inpainting; transparent pixels mark the edit area. */
  maskImageUrl: z.string().url().optional(),
});
export type RegenerateGenerationRequest = z.infer<
  typeof regenerateGenerationSchema
>;

export const createApprovalLinkSchema = z.object({
  reviewerName: z.string().max(120).optional(),
  reviewerEmail: z.string().email().max(200).optional(),
  expiresInDays: z.number().int().min(1).max(30).optional(),
});
export type CreateApprovalLinkRequest = z.infer<typeof createApprovalLinkSchema>;

export const approvalResponseSchema = z.object({
  action: z.enum(["approve", "request_changes"]),
  reviewerName: z.string().max(120).optional(),
  comment: z.string().max(2000).optional(),
});
export type ApprovalResponseRequest = z.infer<typeof approvalResponseSchema>;

export const createCampaignPlanSchema = z.object({
  brandId: z.string().uuid(),
  conversationId: z.string().uuid().optional(),
  title: z.string().min(1).max(120).optional(),
  /** ISO timestamp for the first post; subsequent posts are one day apart. */
  startAt: z.string().datetime(),
  days: z.number().int().min(1).max(14).default(7),
  platform: z.string().min(1).max(60).default("Instagram"),
  instructions: z.string().max(1600).optional(),
  timezone: z.string().min(1).max(80).optional(),
});
export type CreateCampaignPlanRequest = z.infer<typeof createCampaignPlanSchema>;

export const updateCampaignPostSchema = z.object({
  action: z.enum(["approve", "cancel", "retry", "generate_now"]),
});
export type UpdateCampaignPostRequest = z.infer<typeof updateCampaignPostSchema>;

export const updateCampaignPlanSchema = z.object({
  action: z.enum(["generate_all"]),
});
export type UpdateCampaignPlanRequest = z.infer<typeof updateCampaignPlanSchema>;

export const createThemeSchema = z.object({
  slug: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9-]+$/, "slug must be lowercase letters, numbers, dashes"),
  label: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  promptTemplate: z.string().min(1),
  styleGuide: z.record(z.unknown()).optional(),
  icon: z.string().max(64).optional(),
  isActive: z.boolean().optional(),
});
export type CreateThemeRequest = z.infer<typeof createThemeSchema>;

export const updateThemeSchema = createThemeSchema.partial();
export type UpdateThemeRequest = z.infer<typeof updateThemeSchema>;

export const createBoardSchema = z.object({
  name: z.string().min(1).max(120),
});
export type CreateBoardRequest = z.infer<typeof createBoardSchema>;

export const addBoardItemSchema = z.object({
  generationId: z.string().uuid(),
});
export type AddBoardItemRequest = z.infer<typeof addBoardItemSchema>;

export const updateConversationSchema = z
  .object({
    title: z.string().min(1).max(140).optional(),
    pinned: z.boolean().optional(),
    archived: z.boolean().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: "nothing to update",
  });
export type UpdateConversationRequest = z.infer<typeof updateConversationSchema>;

export const createMemorySchema = z.object({
  type: z.enum(MEMORY_TYPES),
  content: z.string().min(1).max(2000),
  sourceGenId: z.string().uuid().optional(),
});
export type CreateMemoryRequest = z.infer<typeof createMemorySchema>;

export const updateMemorySettingsSchema = z.object({ enabled: z.boolean() });
export type UpdateMemorySettingsRequest = z.infer<
  typeof updateMemorySettingsSchema
>;

/* ------------------------------ API envelopes ------------------------------ */

export interface Paginated<T> {
  items: T[];
  nextCursor: string | null;
}

export interface ApiError {
  statusCode: number;
  error: string;
  message: string;
}

/** SSE payload pushed on /generations/:id/events */
/** A web page the answer was grounded on (web search citations). */
export interface WebSource {
  title: string;
  url: string;
}

export interface GenerationEvent {
  generationId: string;
  status: GenerationStatus;
  kind?: GenerationKind;
  /** True while a live web search is running (before the answer streams). */
  searching?: boolean;
  sources?: WebSource[];
  /** Incremental text token for streaming chat replies. */
  delta?: string;
  /** Progressive preview (data URL) pushed while an image renders. */
  partialImage?: string;
  imageUrls?: string[];
  textResponse?: string | null;
  error?: string | null;
}

/* ---------------------------------- brands --------------------------------- */

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "use a hex colour like #C0392B");

/**
 * Answers to the guided brand questionnaire. Everything is optional so the
 * kit is useful after the first section; the more filled in, the better the
 * strategy. Amounts are numbers in the user's own currency.
 */
export const brandProfileSchema = z.object({
  description: z.string().max(1200).optional(),
  location: z.string().max(200).optional(),
  stage: z.string().max(100).optional(),
  offer: z.string().max(800).optional(),
  avgPrice: z.number().nonnegative().optional(),
  avgCost: z.number().nonnegative().optional(),
  customers: z.string().max(800).optional(),
  painPoints: z.string().max(800).optional(),
  differentiator: z.string().max(800).optional(),
  channels: z.array(z.string().max(40)).max(12).optional(),
  monthlyOrders: z.number().nonnegative().optional(),
  monthlyRevenue: z.number().nonnegative().optional(),
  goalRevenue: z.number().nonnegative().optional(),
  goalDays: z.number().int().positive().max(365).optional(),
  monthlyBudget: z.number().nonnegative().optional(),
  problems: z.string().max(1000).optional(),
  competitors: z.string().max(600).optional(),
  colors: z.array(hexColor).max(6).optional(),
  tagline: z.string().max(160).optional(),
  tone: z.string().max(300).optional(),
  typography: z.string().max(300).optional(),
  visualStyle: z.string().max(300).optional(),
  photographyStyle: z.string().max(300).optional(),
  logoRules: z.string().max(500).optional(),
  requiredPhrases: z.array(z.string().max(120)).max(8).optional(),
  forbiddenWords: z.array(z.string().max(60)).max(20).optional(),
  forbiddenClaims: z.array(z.string().max(160)).max(20).optional(),
  defaultCta: z.string().max(160).optional(),
  contentLanguages: z.array(z.string().max(40)).max(4).optional(),
});
export type BrandProfile = z.infer<typeof brandProfileSchema>;

export const BRAND_ASSET_KINDS = ["logo", "product", "mascot", "reference"] as const;
export type BrandAssetKind = (typeof BRAND_ASSET_KINDS)[number];

export const createBrandSchema = z.object({
  name: z.string().min(1).max(120),
  category: z.string().max(120).optional(),
  /** Omit for the user's personal brand; set to add a brand inside a workspace. */
  workspaceId: z.string().uuid().optional(),
  profile: brandProfileSchema.optional(),
});
export type CreateBrandRequest = z.infer<typeof createBrandSchema>;

export const updateBrandSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  category: z.string().max(120).optional(),
  profile: brandProfileSchema.optional(),
});
export type UpdateBrandRequest = z.infer<typeof updateBrandSchema>;

export const createBrandAssetSchema = z.object({
  url: z.string().url(),
  kind: z.enum(BRAND_ASSET_KINDS),
  label: z.string().max(120).optional(),
});
export type CreateBrandAssetRequest = z.infer<typeof createBrandAssetSchema>;

export interface BrandAssetDto {
  id: string;
  kind: BrandAssetKind;
  url: string;
  label: string | null;
}

export interface BrandMascotDto {
  id: string;
  brandId: string;
  assetId: string;
  url: string;
  name: string;
  description: string;
  status: "active" | "archived";
  createdAt: string;
  updatedAt: string;
}

export const upsertBrandMascotSchema = z.object({
  url: z.string().url(),
  name: z.string().min(1).max(80),
  description: z.string().min(1).max(1200),
});
export type UpsertBrandMascotRequest = z.infer<typeof upsertBrandMascotSchema>;

export const generateBrandMascotSchema = z.object({
  name: z.string().max(80).optional(),
  description: z.string().max(1200).optional(),
  prompt: z.string().max(1600).optional(),
  quality: z.enum(QUALITIES).optional(),
});
export type GenerateBrandMascotRequest = z.infer<typeof generateBrandMascotSchema>;

/**
 * Client-safe view of a brand's saved voice. Deliberately excludes the private
 * storage key, any filesystem path or object/signed URL, and consent secrets.
 */
export interface BrandVoiceDto {
  id: string;
  brandId: string;
  /** Language the sample was read in — adapter-reported code (e.g. "te"). */
  sampleLanguage: string;
  /** Exact script the speaker read, shown when reviewing/re-recording. */
  scriptText: string;
  status: BrandVoiceStatus;
  enrolledAt: string | null;
  /** Sanitized diagnostic only — never a raw provider error. */
  lastSynthesisError: string | null;
  lastSynthesisErrorAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Plain arithmetic on the user's own numbers — no benchmarks, no guesses. */
export interface BrandSnapshot {
  /** (price - cost) / price, as a percentage. */
  marginPct: number | null;
  /** Gross profit on one order = price - cost. */
  grossPerOrder: number | null;
  /** Orders needed in the goal window to reach the revenue goal. */
  ordersNeeded: number | null;
  ordersPerDay: number | null;
  /** Most you can spend to win one customer before losing money on the first order. */
  breakEvenCac: number | null;
  /** What the monthly budget allows per order if the goal is hit. */
  budgetPerOrder: number | null;
  /** Revenue still to find compared with the current monthly run-rate. */
  revenueGapPerMonth: number | null;
}

export function computeBrandSnapshot(p: BrandProfile): BrandSnapshot {
  const price = p.avgPrice && p.avgPrice > 0 ? p.avgPrice : null;
  const cost = p.avgCost ?? null;
  const gross = price !== null && cost !== null ? price - cost : null;
  const ordersNeeded =
    price !== null && p.goalRevenue ? Math.ceil(p.goalRevenue / price) : null;
  const days = p.goalDays ?? null;
  const months = days ? days / 30 : null;
  return {
    marginPct:
      price !== null && gross !== null
        ? Math.round((gross / price) * 1000) / 10
        : null,
    grossPerOrder: gross,
    ordersNeeded,
    ordersPerDay:
      ordersNeeded !== null && days
        ? Math.round((ordersNeeded / days) * 10) / 10
        : null,
    breakEvenCac: gross,
    budgetPerOrder:
      p.monthlyBudget && ordersNeeded !== null && months
        ? Math.round(((p.monthlyBudget * months) / ordersNeeded) * 100) / 100
        : null,
    revenueGapPerMonth:
      p.goalRevenue && months
        ? Math.max(
            0,
            Math.round(p.goalRevenue / months - (p.monthlyRevenue ?? 0)),
          )
        : null,
  };
}

export interface BrandDto {
  id: string;
  userId: string;
  workspaceId: string | null;
  name: string;
  category: string | null;
  profile: BrandProfile;
  snapshot: BrandSnapshot;
  assets: BrandAssetDto[];
  mascot: BrandMascotDto | null;
  /** Present when the endpoint includes it; null = no saved voice yet. */
  voice?: BrandVoiceDto | null;
  documentCount: number;
  createdAt: string;
  updatedAt: string;
}

/* ------------------------------ shared chats ------------------------------ */

export interface PublicChatTurn {
  id: string;
  prompt: string;
  kind: GenerationKind;
  textResponse: string | null;
  imageUrls: string[];
  createdAt: string;
}

/** Read-only view of a chat behind a public share link. */
export interface PublicChatDto {
  title: string;
  createdAt: string;
  turns: PublicChatTurn[];
}

/* ------------------------------ team workspaces ---------------------------- */

export interface WorkspaceMemberDto {
  userId: string;
  name: string;
  email: string;
  role: "owner" | "member";
}

export interface TeamMessageDto {
  id: string;
  workspaceId: string;
  role: "user" | "ai";
  authorId: string | null;
  /** Display name; "CatGPT" for AI replies. */
  authorName: string;
  body: string;
  status: "pending" | "done" | "failed";
  createdAt: string;
  updatedAt: string;
}

export const teamMessageSchema = z.object({
  body: z.string().trim().min(1).max(2000),
});
export const addMemberSchema = z.object({ email: z.string().email() });

/* ---------------------------- social publishing ---------------------------- */

export const SOCIAL_PLATFORMS = ["instagram", "facebook", "x", "youtube"] as const;
export const socialPlatformSchema = z.enum(SOCIAL_PLATFORMS);
export type SocialPlatform = z.infer<typeof socialPlatformSchema>;

/** OAuth providers behind the platforms: Meta covers Instagram + Facebook. */
export const SOCIAL_CONNECTORS = ["meta", "x", "youtube"] as const;
export const socialConnectorSchema = z.enum(SOCIAL_CONNECTORS);
export type SocialConnector = z.infer<typeof socialConnectorSchema>;

export const SOCIAL_ACCOUNT_STATUSES = [
  "active",
  "expired",
  "revoked",
  "reauth_required",
] as const;
export type SocialAccountStatus = (typeof SOCIAL_ACCOUNT_STATUSES)[number];

export const SOCIAL_POST_STATUSES = ["scheduled", "pending", "posting", "posted", "failed"] as const;
export type SocialPostStatus = (typeof SOCIAL_POST_STATUSES)[number];

export const SOCIAL_FAILURE_CODES = [
  "AUTH_EXPIRED",
  "AUTH_REVOKED",
  "RATE_LIMITED",
  "INVALID_MEDIA",
  "INVALID_CONTENT",
  "PROVIDER_ERROR",
  "UNKNOWN",
] as const;
export type SocialFailureCode = (typeof SOCIAL_FAILURE_CODES)[number];

/** Failures a retry can plausibly fix; everything else needs a new post/reconnect. */
export const RETRYABLE_SOCIAL_FAILURES: readonly SocialFailureCode[] = [
  "RATE_LIMITED",
  "PROVIDER_ERROR",
  "UNKNOWN",
];

export const X_MAX_CHARS = 280;

/** Which connectors are configured server-side (true = credentials present). */
export type SocialPlatformsDto = Record<SocialConnector, boolean>;

/** Tokens are never part of this shape - see the API's toSocialAccountDto. */
export interface SocialAccountDto {
  id: string;
  platform: SocialPlatform;
  workspaceId: string | null;
  handle: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  status: SocialAccountStatus;
  /** Non-secret hints only, e.g. YouTube { visibility: "private" }. */
  metadata: { visibility?: "private" | "public" } | null;
}

const trimmed = (max: number) => z.string().trim().min(1).max(max);

export const socialPreviewSchema = z.object({
  instagram: z
    .object({
      caption: z.string().trim().max(2200),
      hashtags: z.array(z.string().trim().min(1).max(100)).max(30),
    })
    .optional(),
  facebook: z.object({ caption: z.string().trim().max(5000) }).optional(),
  x: z.object({ caption: z.string().trim().max(X_MAX_CHARS) }).optional(),
  youtube: z
    .object({
      title: z.string().trim().max(100),
      description: z.string().trim().max(5000),
      tags: z.array(z.string().trim().min(1).max(100)).max(30),
    })
    .optional(),
});
export type SocialPreview = z.infer<typeof socialPreviewSchema>;
export type SocialPreviewsDto = SocialPreview;

export const socialPreviewRequestSchema = z.object({
  platforms: z.array(socialPlatformSchema).min(1).max(4),
});
export type SocialPreviewRequest = z.infer<typeof socialPreviewRequestSchema>;

/** What the user approved for one account. Shape is checked per platform server-side. */
export const socialPostContentSchema = z.object({
  caption: z.string().trim().max(5000).optional(),
  hashtags: z.array(z.string().trim().min(1).max(100)).max(30).optional(),
  title: trimmed(100).optional(),
  description: z.string().trim().max(5000).optional(),
  tags: z.array(z.string().trim().min(1).max(100)).max(30).optional(),
});
export type SocialPostContent = z.infer<typeof socialPostContentSchema>;

export const socialPostRequestSchema = z.object({
  accountId: z.string().uuid(),
  content: socialPostContentSchema,
});
export type SocialPostRequest = z.infer<typeof socialPostRequestSchema>;

export const socialPostCreateRequestSchema = z.object({
  posts: z.array(socialPostRequestSchema).min(1).max(12),
  /** ISO instant. Omitted = post now; present = publish then (must be in the future). */
  scheduledFor: z.string().datetime().optional(),
});
export type SocialPostCreateRequest = z.infer<typeof socialPostCreateRequestSchema>;

export interface SocialPostDto {
  id: string;
  generationId: string;
  accountId: string;
  platform: SocialPlatform;
  accountHandle: string | null;
  accountDisplayName: string | null;
  accountStatus: SocialAccountStatus;
  status: SocialPostStatus;
  failureCode: SocialFailureCode | null;
  error: string | null;
  remoteUrl: string | null;
  attemptCount: number;
  /** YouTube posts stay private while the Google app is unverified. */
  visibility: "private" | "public" | null;
  retryable: boolean;
  scheduledFor: string | null;
  postedAt: string | null;
  createdAt: string;
}

export const socialPostRescheduleSchema = z.object({ scheduledFor: z.string().datetime() });
export type SocialPostRescheduleRequest = z.infer<typeof socialPostRescheduleSchema>;

export const socialCalendarQuerySchema = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
});

/** One calendar entry: a SocialPost plus what's needed to render it. */
export interface SocialCalendarItemDto extends SocialPostDto {
  mediaUrl: string;
  captionPreview: string;
}

/* ------------------------------ best time to post ------------------------------ */

export const socialBestTimesQuerySchema = z.object({
  /** Comma-separated account ids the post will go to. */
  accountIds: z.string().min(1).max(600),
  /** IANA zone the slots are computed and shown in. */
  timezone: z.string().min(1).max(80),
  /** Restrict to one local calendar day (YYYY-MM-DD); omitted = the next 7 days. */
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});
export type SocialBestTimesQuery = z.infer<typeof socialBestTimesQuerySchema>;

export interface BestTimeSlotDto {
  /** ISO instant, on the hour in the requested time zone. */
  at: string;
  /** 0-100, relative strength of the slot for the selected platforms. */
  score: number;
  /** Platforms this slot is especially good for. */
  platforms: SocialPlatform[];
}

/* ------------------------- holidays and AI calendar fill ------------------------- */

export interface HolidayDto {
  id: string;
  /** Calendar date, YYYY-MM-DD. */
  date: string;
  name: string;
  country: string;
  region: string | null;
  type: "national" | "festival" | "observance";
}

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** "Papaya": generate one on-brand image for a chosen calendar day. */
export const calendarDayPostSchema = z.object({
  brandId: z.string().uuid(),
  date: ymd,
  timezone: z.string().min(1).max(80).optional(),
  instructions: z.string().max(800).optional(),
});
export type CalendarDayPostRequest = z.infer<typeof calendarDayPostSchema>;

export interface CalendarDayPostDto {
  generationId: string;
  /** The calendar draft holding this image on its day. */
  postId: string;
  /** Holiday the idea was themed around, if the model judged one relevant. */
  holiday: string | null;
  caption: string | null;
}

/** "AI Fill": propose a content plan across a date range, nothing generated or published yet. */
export const calendarFillSchema = z.object({
  brandId: z.string().uuid(),
  startDate: ymd,
  endDate: ymd,
  everyDays: z.number().int().min(1).max(14),
  /** Local publish time, HH:mm. */
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  timezone: z.string().min(1).max(80).optional(),
  platform: z.string().min(1).max(60).default("Instagram"),
  holidays: z.enum(["suggest", "ignore"]).default("suggest"),
  instructions: z.string().max(1000).optional(),
});
export type CalendarFillRequest = z.input<typeof calendarFillSchema>;

/** A planned/generated campaign post placed on its publish date. */
export interface CalendarPlanItemDto {
  id: string;
  planId: string;
  /** Null for calendar drafts (chat images, Papaya results). */
  brandId: string | null;
  publishAt: string;
  status: CampaignPostStatus;
  /** Plan "paused" = proposed, waiting for the user to press Generate all. */
  planStatus: CampaignPlanStatus;
  platform: string | null;
  prompt: string;
  caption: string | null;
  generationId: string | null;
  imageUrl: string | null;
  error: string | null;
}
