import { z } from "zod";

/* ---------------------------------- enums --------------------------------- */

export const PROVIDERS = ["openai", "flux", "ideogram"] as const;
export type ProviderName = (typeof PROVIDERS)[number];

export const QUALITIES = ["low", "medium", "high"] as const;
export type Quality = (typeof QUALITIES)[number];

export const IMAGE_SIZES = [
  "auto",
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
] as const;
export type GenerationStatus = (typeof GENERATION_STATUSES)[number];

export const MEMORY_TYPES = ["preference", "fact", "style", "learned"] as const;
export type MemoryType = (typeof MEMORY_TYPES)[number];

export const GENERATION_KINDS = ["image", "text"] as const;
export type GenerationKind = (typeof GENERATION_KINDS)[number];

export const DOCUMENT_STATUSES = ["processing", "ready", "failed"] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

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
  finalPrompt: string;
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
});
export type RegenerateGenerationRequest = z.infer<
  typeof regenerateGenerationSchema
>;

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
});
export type BrandProfile = z.infer<typeof brandProfileSchema>;

export const BRAND_ASSET_KINDS = ["logo", "product", "reference"] as const;
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
