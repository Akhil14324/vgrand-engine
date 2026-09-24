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
