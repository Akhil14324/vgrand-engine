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
  /** Project JWT secret — enables in-process token verification (no getUser call). */
  SUPABASE_JWT_SECRET: opt(z.string().min(1)),
  STORAGE_BUCKET: opt(z.string().min(1)),

  /** Max image generations per user per UTC day. Chat is unlimited. */
  IMAGE_DAILY_LIMIT: z.coerce.number().int().positive().default(50),
  WORKER_INLINE: bool,
  UPLOAD_DIR: opt(z.string().min(1)),
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
  CODE_MODEL: parsed.CODE_MODEL ?? "gpt-4o",
  EMBEDDING_MODEL: parsed.EMBEDDING_MODEL ?? "text-embedding-3-small",
  STORAGE_BUCKET: parsed.STORAGE_BUCKET ?? "generated-images",
  UPLOAD_DIR: parsed.UPLOAD_DIR ?? "./uploads",
  // Inline worker is the no-Redis fallback — a Redis-backed deploy defaults
  // to a separate worker process (pnpm --filter @catgpt/api worker).
  WORKER_INLINE: parsed.WORKER_INLINE ?? !Boolean(parsed.REDIS_URL),
  /** True only when REDIS_URL was explicitly provided — otherwise jobs run inline. */
  get redisConfigured(): boolean {
    return Boolean(parsed.REDIS_URL);
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
