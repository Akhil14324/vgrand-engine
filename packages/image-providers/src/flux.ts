import type {
  GenerateParams,
  GenerateResult,
  ImageProvider,
} from "./types.js";
import { ProviderError } from "./types.js";

const BFL_BASE_URL = "https://api.bfl.ml";
const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 120_000;

/**
 * Flux 2 Pro (Black Forest Labs) — best photorealism. Intended as a
 * theme-pinned provider (e.g. /infra) or fallback when photographic realism
 * matters more than text rendering.
 *
 * BFL's API is async: POST /v1/{model} -> {id, polling_url}, then poll until
 * status === "Ready" and read result.sample.
 */
export class FluxProvider implements ImageProvider {
  name = "flux" as const;

  private get apiKey(): string {
    const key = process.env.FLUX_API_KEY;
    if (!key) throw new ProviderError(this.name, "FLUX_API_KEY is not configured");
    return key;
  }

  async generate(params: GenerateParams): Promise<GenerateResult> {
    const endpoint = process.env.FLUX_MODEL_ENDPOINT ?? "flux-2-pro";
    const { width, height } = toDimensions(params.size);

    const body: Record<string, unknown> = {
      prompt: params.prompt,
      width,
      height,
      output_format: "jpeg",
      safety_tolerance: 2,
    };

    // Flux 2 supports an input image for edit/img2img-style requests.
    if (params.mode === "edit" && params.referenceImageUrl) {
      body.input_image = await fetchAsBase64(params.referenceImageUrl);
    }

    const submit = await fetch(`${BFL_BASE_URL}/v1/${endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-key": this.apiKey,
      },
      body: JSON.stringify(body),
    });
    if (!submit.ok) {
      throw new ProviderError(
        this.name,
        `submit failed (${submit.status}): ${await submit.text()}`,
      );
    }
    const { id, polling_url } = (await submit.json()) as {
      id: string;
      polling_url: string;
    };

    const url = await this.poll(polling_url);
    return {
      images: [{ url, mimeType: "image/jpeg" }],
      metadata: { model: endpoint, providerJobId: id, size: `${width}x${height}` },
    };
  }

  private async poll(pollingUrl: string): Promise<string> {
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await sleep(POLL_INTERVAL_MS);
      const res = await fetch(pollingUrl, {
        headers: { "x-key": this.apiKey },
      });
      if (!res.ok) continue;
      const data = (await res.json()) as {
        status: string;
        result?: { sample?: string };
      };
      if (data.status === "Ready" && data.result?.sample) {
        return data.result.sample;
      }
      if (data.status === "Error" || data.status === "Failed") {
        throw new ProviderError(this.name, `job failed: ${JSON.stringify(data)}`);
      }
    }
    throw new ProviderError(this.name, "timed out waiting for result");
  }
}

function toDimensions(size?: string): { width: number; height: number } {
  switch (size) {
    case "1024x1536":
      return { width: 1024, height: 1536 };
    case "1536x1024":
      return { width: 1536, height: 1024 };
    default:
      return { width: 1024, height: 1024 };
  }
}

async function fetchAsBase64(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new ProviderError("flux", `failed to fetch reference image (${res.status})`);
  }
  return Buffer.from(await res.arrayBuffer()).toString("base64");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
