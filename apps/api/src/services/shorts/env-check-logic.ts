import type { ShortsHealthDto } from "@catgpt/types";

/**
 * Pure startup check for the Shorts Factory. Takes the raw env values plus
 * whether ffmpeg/ffprobe ran, and says exactly what is missing or invalid.
 * Nothing here throws: the report is printed at boot and shown in the UI.
 */

export const VIDEO_GEN_PROVIDERS = ["veo", "veo-fast", "veo-lite", "runway", "kling"] as const;
export type VideoGenProvider = (typeof VIDEO_GEN_PROVIDERS)[number];

export interface ShortsEnvInput {
  DATABASE_URL?: string;
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_MODEL?: string;
  ELEVENLABS_API_KEY?: string;
  PEXELS_API_KEY?: string;
  PIXABAY_API_KEY?: string;
  YOUTUBE_API_KEY?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_REDIRECT_URI?: string;
  TOKEN_ENCRYPTION_KEY?: string;
  VIDEO_GEN_PROVIDER?: string;
  VIDEO_GEN_API_KEY?: string;
  PATH_C_MONTHLY_BUDGET?: string;
  BUDGET_CURRENCY?: string;
  APP_BASE_URL?: string;
  TIMEZONE?: string;
  STORAGE_PATH?: string;
}

export interface ToolStatus {
  ffmpeg: boolean;
  ffprobe: boolean;
}

const REQUIRED = [
  "DATABASE_URL",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_MODEL",
  "ELEVENLABS_API_KEY",
  "PEXELS_API_KEY",
  "PIXABAY_API_KEY",
  "YOUTUBE_API_KEY",
  "PATH_C_MONTHLY_BUDGET",
  "BUDGET_CURRENCY",
  "APP_BASE_URL",
] as const;

const has = (v: string | undefined) => typeof v === "string" && v.trim() !== "";

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** TOKEN_ENCRYPTION_KEY: 64 hex chars (32 bytes), or any passphrase of at least 32 characters. */
export function isValidEncryptionKey(v: string): boolean {
  return /^[0-9a-fA-F]{64}$/.test(v) || v.length >= 32;
}

export function parseBudget(v: string | undefined): number | null {
  if (!has(v)) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function checkShortsEnv(e: ShortsEnvInput, tools: ToolStatus): ShortsHealthDto {
  const missingRequired: string[] = REQUIRED.filter((k) => !has(e[k]));
  const invalid: string[] = [];
  const warnings: string[] = [];

  if (!tools.ffmpeg) missingRequired.push("ffmpeg (tool not found on PATH)");
  if (!tools.ffprobe) missingRequired.push("ffprobe (tool not found on PATH)");

  if (has(e.PATH_C_MONTHLY_BUDGET) && parseBudget(e.PATH_C_MONTHLY_BUDGET) === null) {
    invalid.push("PATH_C_MONTHLY_BUDGET must be a non-negative number");
  }
  if (has(e.BUDGET_CURRENCY) && !/^[A-Za-z]{3}$/.test(e.BUDGET_CURRENCY!.trim())) {
    invalid.push("BUDGET_CURRENCY must be a 3-letter currency code, e.g. USD or INR");
  }
  if (has(e.APP_BASE_URL)) {
    try {
      new URL(e.APP_BASE_URL!);
    } catch {
      invalid.push("APP_BASE_URL must be a full URL, e.g. https://app.example.com");
    }
  }
  const tz = has(e.TIMEZONE) ? e.TIMEZONE! : "Asia/Kolkata";
  if (!isValidTimeZone(tz)) invalid.push(`TIMEZONE "${tz}" is not a valid IANA time zone`);

  // Google OAuth is optional, but all-or-nothing, and needs the encryption key.
  const googleVars = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REDIRECT_URI"] as const;
  const googleSet = googleVars.filter((k) => has(e[k]));
  let youtubeOAuth = false;
  if (googleSet.length > 0 && googleSet.length < googleVars.length) {
    invalid.push(
      `Google OAuth is partly configured: set all of ${googleVars.join(", ")} or none (missing: ${googleVars
        .filter((k) => !has(e[k]))
        .join(", ")})`,
    );
  } else if (googleSet.length === googleVars.length) {
    if (!has(e.TOKEN_ENCRYPTION_KEY)) {
      missingRequired.push("TOKEN_ENCRYPTION_KEY (required because Google OAuth is configured)");
    } else if (!isValidEncryptionKey(e.TOKEN_ENCRYPTION_KEY!)) {
      invalid.push("TOKEN_ENCRYPTION_KEY must be 64 hex characters (openssl rand -hex 32) or at least 32 characters");
    } else {
      youtubeOAuth = true;
    }
    if (has(e.GOOGLE_REDIRECT_URI)) {
      try {
        new URL(e.GOOGLE_REDIRECT_URI!);
      } catch {
        invalid.push("GOOGLE_REDIRECT_URI must be a full URL");
      }
    }
  } else {
    warnings.push("Google OAuth not configured: every video goes to the manual posting queue and only public stats are synced.");
  }

  // Path C is optional, both-or-nothing.
  let pathC = false;
  const p = e.VIDEO_GEN_PROVIDER?.trim().toLowerCase();
  if (has(p) !== has(e.VIDEO_GEN_API_KEY)) {
    invalid.push("Set both VIDEO_GEN_PROVIDER and VIDEO_GEN_API_KEY, or neither");
  } else if (has(p)) {
    if (!(VIDEO_GEN_PROVIDERS as readonly string[]).includes(p!)) {
      invalid.push(`VIDEO_GEN_PROVIDER must be one of ${VIDEO_GEN_PROVIDERS.join(", ")}`);
    } else {
      pathC = true;
    }
  } else {
    warnings.push("VIDEO_GEN_PROVIDER not set: Path C channels always use their fallback path (B).");
  }

  if (!has(e.STORAGE_PATH)) warnings.push("STORAGE_PATH not set: using ./shorts-storage (mount a persistent volume in production).");

  const ffmpeg = tools.ffmpeg && tools.ffprobe;
  return {
    ok: missingRequired.length === 0 && invalid.length === 0,
    missingRequired,
    invalid,
    warnings,
    features: {
      script: has(e.ANTHROPIC_API_KEY) && has(e.ANTHROPIC_MODEL),
      voice: has(e.ELEVENLABS_API_KEY),
      stock: has(e.PEXELS_API_KEY) || has(e.PIXABAY_API_KEY),
      publicStats: has(e.YOUTUBE_API_KEY),
      youtubeOAuth,
      pathC,
      ffmpeg,
    },
    timezone: tz,
    budget: { amount: parseBudget(e.PATH_C_MONTHLY_BUDGET), currency: has(e.BUDGET_CURRENCY) ? e.BUDGET_CURRENCY!.toUpperCase() : null },
  };
}

/** Human-readable report for the boot log and the `shorts check` CLI. */
export function formatHealthReport(h: ShortsHealthDto): string {
  const lines = ["[shorts] startup check: " + (h.ok ? "OK" : "PROBLEMS FOUND")];
  for (const m of h.missingRequired) lines.push(`  MISSING  ${m}`);
  for (const m of h.invalid) lines.push(`  INVALID  ${m}`);
  for (const w of h.warnings) lines.push(`  NOTE     ${w}`);
  const f = h.features;
  lines.push(
    `  features: script=${f.script} voice=${f.voice} stock=${f.stock} publicStats=${f.publicStats} ` +
      `youtubeOAuth=${f.youtubeOAuth} pathC=${f.pathC} ffmpeg=${f.ffmpeg} timezone=${h.timezone}`,
  );
  return lines.join("\n");
}
