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
  /** RAG: embeddings for PDF chunks + query vectors (same OpenAI key). */
  EMBEDDING_MODEL: opt(z.string().min(1)),
  MAX_PDF_PAGES: z.coerce.number().int().positive().default(200),
  /** Multipart cap — applies to reference images and PDF uploads. */
  MAX_UPLOAD_MB: z.coerce.number().int().positive().default(25),
  RAG_TOP_K: z.coerce.number().int().positive().default(6),
  RAG_CHUNK_CHARS: z.coerce.number().int().positive().default(1200),
  RAG_CHUNK_OVERLAP: z.coerce.number().int().nonnegative().default(150),
  DEFAULT_IMAGE_PROVIDER: opt(z.enum(["openai", "flux", "ideogram"])),
  FLUX_API_KEY: opt(z.string().min(1)),
  FLUX_MODEL_ENDPOINT: opt(z.string().min(1)),
  IDEOGRAM_API_KEY: opt(z.string().min(1)),
  IDEOGRAM_API_URL: opt(z.string().url()),

  SUPABASE_URL: opt(z.string().url()),
  SUPABASE_ANON_KEY: opt(z.string().min(1)),
  SUPABASE_SERVICE_ROLE_KEY: opt(z.string().min(1)),
  STORAGE_BUCKET: opt(z.string().min(1)),

  DEV_AUTH_BYPASS: bool,
  WORKER_INLINE: bool,
  UPLOAD_DIR: opt(z.string().min(1)),
});

const parsed = envSchema.parse(process.env);

export const env = {
  ...parsed,
  REDIS_URL: parsed.REDIS_URL ?? "redis://localhost:6379",
  CHAT_MODEL: parsed.CHAT_MODEL ?? "gpt-4o-mini",
  EMBEDDING_MODEL: parsed.EMBEDDING_MODEL ?? "text-embedding-3-small",
  STORAGE_BUCKET: parsed.STORAGE_BUCKET ?? "generated-images",
  UPLOAD_DIR: parsed.UPLOAD_DIR ?? "./uploads",
  // Defaults on in dev only — production must opt in explicitly.
  DEV_AUTH_BYPASS:
    parsed.DEV_AUTH_BYPASS ?? parsed.NODE_ENV !== "production",
  WORKER_INLINE: parsed.WORKER_INLINE ?? true,
  /** True only when REDIS_URL was explicitly provided — otherwise jobs run inline. */
  get redisConfigured(): boolean {
    return Boolean(parsed.REDIS_URL);
  },
  /** True when enough Supabase config exists to verify JWTs + use Storage. */
  get supabaseConfigured(): boolean {
    return Boolean(this.SUPABASE_URL && this.SUPABASE_SERVICE_ROLE_KEY);
  },
};
