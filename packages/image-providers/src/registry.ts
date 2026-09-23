import type { ProviderName } from "@prompthub/types";
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

/**
 * Runs `params` against the requested provider. If it errors and isn't already
 * the default provider, retries once on OpenAI (gpt-image-2.5) so a misbehaving
 * theme-pinned provider never hard-fails a user request.
 */
export async function generateWithFallback(
  providerName: ProviderName,
  params: GenerateParams,
): Promise<RoutedResult> {
  try {
    const result = await getProvider(providerName).generate(params);
    return { ...result, providerUsed: providerName, fellBack: false };
  } catch (err) {
    if (providerName === DEFAULT_PROVIDER) throw err;
    const result = await getProvider(DEFAULT_PROVIDER).generate(params);
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
