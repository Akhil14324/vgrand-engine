/**
 * Thin fetch helpers shared by the social OAuth + adapter code. Deliberately
 * knows nothing about URLs' contents: request URLs and bodies can carry tokens
 * or client secrets, so nothing in here logs them.
 */
export const SOCIAL_HTTP_TIMEOUT_MS = 30_000;

export async function socialFetch(
  url: string,
  init: RequestInit = {},
  timeoutMs = SOCIAL_HTTP_TIMEOUT_MS,
): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
}

/** Parses a JSON body, tolerating empty/non-JSON responses. */
export async function readJson(res: Response): Promise<Record<string, any>> {
  const text = await res.text().catch(() => "");
  if (!text) return {};
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, any>) : {};
  } catch {
    return {};
  }
}

export const form = (params: Record<string, string | undefined>): URLSearchParams => {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) body.set(k, v);
  return body;
};
