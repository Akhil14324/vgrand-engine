import { z } from "zod";

const bool = z
  .string()
  .optional()
  .transform((v) => v === "true" || v === "1");

/** Treat "" as unset so `.env` placeholders like `SUPABASE_URL=` don't break validation. */
const opt = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => (v === "" ? undefined : v), schema.optional());

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().default(4000),
  API_PUBLIC_URL: z.string().url().default("http://localhost:4000"),
  WEB_ORIGIN: z.string().default("http://localhost:3000"),

  DATABASE_URL: opt(z.string().min(1)),
  REDIS_URL: opt(z.string().min(1)),

  OPENAI_API_KEY: opt(z.string().min(1)),
  OPENAI_BASE_URL: opt(z.string().url()),
  /** Chat + intent-classification model — cheap tier, not the image models. */
  CHAT_MODEL: opt(z.string().min(1)),
  /** Model for code_interpreter runs — needs a capable tier (mini lacks it). */
  CODE_MODEL: opt(z.string().min(1)),
  /** Campaign Builder strategy model - long, structured output needs a capable tier. */
  CAMPAIGN_MODEL: opt(z.string().min(1)),
  /** Voice mode: speech-to-text, text-to-speech model and voice. */
  VOICE_STT_MODEL: opt(z.string().min(1)),
  VOICE_TTS_MODEL: opt(z.string().min(1)),
  VOICE_TTS_VOICE: opt(z.string().min(1)),
  /** Quality for auto-generated campaign creatives (they carry on-image text). */
  CAMPAIGN_IMAGE_QUALITY: opt(z.enum(["low", "medium", "high"])),
  /** RAG: embeddings for PDF chunks + query vectors (same OpenAI key). */
  EMBEDDING_MODEL: opt(z.string().min(1)),
  MAX_PDF_PAGES: z.coerce.number().int().positive().default(200),
  /** Multipart cap — applies to reference images and PDF uploads. */
  MAX_UPLOAD_MB: z.coerce.number().int().positive().default(25),
  RAG_TOP_K: z.coerce.number().int().positive().default(6),
  RAG_CHUNK_CHARS: z.coerce.number().int().positive().default(1200),
  RAG_CHUNK_OVERLAP: z.coerce.number().int().nonnegative().default(150),
  /** OCR for scanned PDF pages — must be a vision-capable chat model (defaults to CHAT_MODEL). */
  OCR_MODEL: opt(z.string().min(1)),
  /** A PDF page with fewer extracted characters than this is treated as scanned and OCR'd. */
  OCR_MIN_PAGE_CHARS: z.coerce.number().int().nonnegative().default(30),
  /** Document edits: model (defaults to CHAT_MODEL) and the most source text one edit will rewrite. */
  EDIT_MODEL: opt(z.string().min(1)),
  /** Sections rewritten in parallel — raise for speed if your OpenAI rate limits allow. */
  EDIT_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(8),
  EDIT_MAX_CHARS: z.coerce.number().int().positive().default(600_000),
  /** Summaries: up to this many chars go to the model in one pass; more is map-reduced. */
  SUMMARY_DIRECT_CHARS: z.coerce.number().int().positive().default(120_000),
  /** Hard ceiling on document text read for one summary (200 dense pages ≈ 600k chars). */
  SUMMARY_MAX_CHARS: z.coerce.number().int().positive().default(800_000),
  /** Jev (TypeSafe AI) — typed evaluations for intent routing + memory gating. */
  TYPESAFE_API_KEY: opt(z.string().min(1)),
  TYPESAFE_BASE_URL: opt(z.string().url()),
  JEV_MODEL: opt(z.string().min(1)),

  DEFAULT_IMAGE_PROVIDER: opt(z.enum(["openai", "flux", "ideogram"])),
  FLUX_API_KEY: opt(z.string().min(1)),
  FLUX_MODEL_ENDPOINT: opt(z.string().min(1)),
  IDEOGRAM_API_KEY: opt(z.string().min(1)),
  IDEOGRAM_API_URL: opt(z.string().url()),

  SUPABASE_URL: opt(z.string().url()),
  SUPABASE_ANON_KEY: opt(z.string().min(1)),
  SUPABASE_SERVICE_ROLE_KEY: opt(z.string().min(1)),
  /** Project JWT secret — enables in-process token verification (no getUser call). */
  SUPABASE_JWT_SECRET: opt(z.string().min(1)),
  STORAGE_BUCKET: opt(z.string().min(1)),
  /** Private bucket for consented voice samples — created with public:false. */
  PRIVATE_STORAGE_BUCKET: opt(z.string().min(1)),
  /** Local fallback root for private objects — MUST stay outside UPLOAD_DIR. */
  PRIVATE_UPLOAD_DIR: opt(z.string().min(1)),
  /** Internal-only voice model service (e.g. http://127.0.0.1:8765). */
  VOICE_MODEL_URL: opt(z.string().url()),
  /** Shared-secret header for the internal voice service (optional locally). */
  VOICE_SERVICE_TOKEN: opt(z.string().min(1)),

  /** Max image generations per user per UTC day. Chat is unlimited. */
  IMAGE_DAILY_LIMIT: z.coerce.number().int().positive().default(50),
  WORKER_INLINE: bool,
  /** Parallel generation jobs per worker process (chat turns and images). */
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(8),
  UPLOAD_DIR: opt(z.string().min(1)),

  /** Social publishing. SOCIAL_TOKEN_KEY = 64 hex chars (openssl rand -hex 32); validated on use. */
  SOCIAL_TOKEN_KEY: opt(z.string().min(1)),
  META_APP_ID: opt(z.string().min(1)),
  META_APP_SECRET: opt(z.string().min(1)),
  /** Graph API version, e.g. "v23.0". Meta retires old versions - bump when needed. */
  META_GRAPH_VERSION: opt(z.string().regex(/^v\d+\.\d+$/)),
  X_CLIENT_ID: opt(z.string().min(1)),
  X_CLIENT_SECRET: opt(z.string().min(1)),
  GOOGLE_CLIENT_ID: opt(z.string().min(1)),
  GOOGLE_CLIENT_SECRET: opt(z.string().min(1)),
  /** Set to "public" once the Google OAuth app is verified; until then uploads are private. */
  YOUTUBE_VISIBILITY: opt(z.enum(["private", "public"])),
});

/**
 * Hosting dashboards make it easy to paste `KEY="value"` lines with the quotes
 * (or stray whitespace) baked into the value, which silently breaks URLs and
 * keys. Normalise before validating.
 */
const cleanEnv = Object.fromEntries(
  Object.entries(process.env).map(([k, v]) => [
    k,
    v?.trim().replace(/^(["'])(.*)\1$/s, "$2").trim(),
  ]),
);

const parsed = envSchema.parse(cleanEnv);

export const env = {
  ...parsed,
  REDIS_URL: parsed.REDIS_URL ?? "redis://localhost:6379",
  CHAT_MODEL: parsed.CHAT_MODEL ?? "gpt-4o-mini",
  OCR_MODEL: parsed.OCR_MODEL ?? parsed.CHAT_MODEL ?? "gpt-4o-mini",
  EDIT_MODEL: parsed.EDIT_MODEL ?? parsed.CHAT_MODEL ?? "gpt-4o-mini",
  CODE_MODEL: parsed.CODE_MODEL ?? "gpt-4o",
  CAMPAIGN_MODEL: parsed.CAMPAIGN_MODEL ?? parsed.CODE_MODEL ?? "gpt-4o",
  VOICE_STT_MODEL: parsed.VOICE_STT_MODEL ?? "gpt-4o-mini-transcribe",
  VOICE_TTS_MODEL: parsed.VOICE_TTS_MODEL ?? "gpt-4o-mini-tts",
  VOICE_TTS_VOICE: parsed.VOICE_TTS_VOICE ?? "alloy",
  CAMPAIGN_IMAGE_QUALITY: parsed.CAMPAIGN_IMAGE_QUALITY ?? "medium",
  EMBEDDING_MODEL: parsed.EMBEDDING_MODEL ?? "text-embedding-3-small",
  JEV_MODEL: parsed.JEV_MODEL ?? "jev-latest",
  TYPESAFE_BASE_URL: parsed.TYPESAFE_BASE_URL ?? "https://api.typesafe.ai",
  STORAGE_BUCKET: parsed.STORAGE_BUCKET ?? "generated-images",
  PRIVATE_STORAGE_BUCKET: parsed.PRIVATE_STORAGE_BUCKET ?? "brand-voice-samples",
  UPLOAD_DIR: parsed.UPLOAD_DIR ?? "./uploads",
  PRIVATE_UPLOAD_DIR: parsed.PRIVATE_UPLOAD_DIR ?? "./private-uploads",
  VOICE_MODEL_URL: parsed.VOICE_MODEL_URL ?? null,
  VOICE_SERVICE_TOKEN: parsed.VOICE_SERVICE_TOKEN ?? null,
  YOUTUBE_VISIBILITY: parsed.YOUTUBE_VISIBILITY ?? "private",
  META_GRAPH_VERSION: parsed.META_GRAPH_VERSION ?? "v23.0",
  // Inline worker is the no-Redis fallback — a Redis-backed deploy defaults
  // to a separate worker process (pnpm --filter @catgpt/api worker).
  WORKER_INLINE: parsed.WORKER_INLINE ?? !parsed.REDIS_URL,
  /** True only when REDIS_URL was explicitly provided — otherwise jobs run inline. */
  get redisConfigured(): boolean {
    return Boolean(parsed.REDIS_URL);
  },
  /** Meta needs the app credentials plus the token key to store what it returns. */
  get metaConfigured(): boolean {
    return Boolean(this.META_APP_ID && this.META_APP_SECRET && this.SOCIAL_TOKEN_KEY);
  },
  get xConfigured(): boolean {
    return Boolean(this.X_CLIENT_ID && this.X_CLIENT_SECRET && this.SOCIAL_TOKEN_KEY);
  },
  get youtubeConfigured(): boolean {
    return Boolean(
      this.GOOGLE_CLIENT_ID && this.GOOGLE_CLIENT_SECRET && this.SOCIAL_TOKEN_KEY,
    );
  },
  /** True when enough Supabase config exists to verify JWTs + use Storage. */
  get supabaseConfigured(): boolean {
    return Boolean(this.SUPABASE_URL && this.SUPABASE_SERVICE_ROLE_KEY);
  },
};

// Every request is authenticated against Supabase — there is no anonymous or
// shared "dev" identity, so a missing config must stop the boot, not degrade.
if (!env.supabaseConfigured) {
  throw new Error(
    "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required — the API only " +
      "serves authenticated Supabase users.",
  );
}
