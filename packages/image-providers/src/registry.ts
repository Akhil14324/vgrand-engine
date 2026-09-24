import type { ProviderName } from "@catgpt/types";
import type {
  GenerateParams,
  GenerateResult,
  ImageProvider,
} from "./types.js";
import { ProviderError } from "./types.js";
import { OpenAIImageProvider } from "./openai.js";
import { FluxProvider } from "./flux.js";
import { IdeogramProvider } from "./ideogram.js";

const instances = new Map<ProviderName, ImageProvider>();
const factories: Record<ProviderName, () => ImageProvider> = {
  openai: () => new OpenAIImageProvider(),
  flux: () => new FluxProvider(),
  ideogram: () => new IdeogramProvider(),
};

export const DEFAULT_PROVIDER: ProviderName = "openai";

export function getProvider(name: ProviderName): ImageProvider {
  let p = instances.get(name);
  if (!p) {
    const factory = factories[name];
    if (!factory) throw new ProviderError(name, "unknown provider");
    p = factory();
    instances.set(name, p);
  }
  return p;
}

export interface RoutedResult extends GenerateResult {
  providerUsed: ProviderName;
  fellBack: boolean;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Provider-side 429s and 5xx are worth retrying — a 429 under load means
 * "try again shortly", not "switch providers" (the fallback is often the
 * same upstream anyway).
 */
function isRetryable(err: unknown): boolean {
  const status =
    (err as { status?: number } | null)?.status ??
    (err as { cause?: { status?: number } } | null)?.cause?.status;
  if (status === 429 || (typeof status === "number" && status >= 500)) {
    return true;
  }
  const msg = err instanceof Error ? err.message : "";
  return /\b429\b|\b5\d\d\b|rate.?limit/i.test(msg);
}

/** Up to 3 attempts on the same provider with exponential backoff. */
async function generateWithRetry(
  providerName: ProviderName,
  params: GenerateParams,
): Promise<GenerateResult> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await getProvider(providerName).generate(params);
    } catch (err) {
      lastErr = err;
      if (!isRetryable(err) || attempt === 2) throw err;
      await sleep(400 * 2 ** attempt);
    }
  }
  throw lastErr;
}

/**
 * Runs `params` against the requested provider, retrying transient 429/5xx
 * failures with backoff first. If it still errors and isn't already the
 * default provider, falls back to OpenAI (gpt-image-2.5) so a misbehaving
 * theme-pinned provider never hard-fails a user request.
 */
export async function generateWithFallback(
  providerName: ProviderName,
  params: GenerateParams,
): Promise<RoutedResult> {
  try {
    const result = await generateWithRetry(providerName, params);
    return { ...result, providerUsed: providerName, fellBack: false };
  } catch (err) {
    if (providerName === DEFAULT_PROVIDER) throw err;
    const result = await generateWithRetry(DEFAULT_PROVIDER, params);
    return {
      ...result,
      providerUsed: DEFAULT_PROVIDER,
      fellBack: true,
      metadata: {
        ...result.metadata,
        fallbackReason:
          err instanceof Error ? err.message : "provider request failed",
      },
    };
  }
}
