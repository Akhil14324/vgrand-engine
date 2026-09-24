import { API_URL } from "./config";

/** Registered by AuthProvider so the client never hardcodes token storage. */
let tokenGetter: (() => Promise<string | null>) | null = null;
export function registerTokenGetter(fn: () => Promise<string | null>) {
  tokenGetter = fn;
}

export class ApiRequestError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

/** Like apiFetch, but returns the raw response body (e.g. synthesized speech). */
export async function apiFetchBlob(
  path: string,
  init: RequestInit & { json?: unknown } = {},
): Promise<Blob> {
  const token = tokenGetter ? await tokenGetter() : null;
  const headers: Record<string, string> = {
    ...(init.headers as Record<string, string> | undefined),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  let body = init.body;
  if (init.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(init.json);
  }
  const res = await fetch(`${API_URL}${path}`, { ...init, headers, body });
  if (!res.ok) throw new ApiRequestError(res.status, `${res.status} ${res.statusText}`);
  return res.blob();
}

export async function apiFetch<T>(
  path: string,
  init: RequestInit & { json?: unknown } = {},
): Promise<T> {
  const token = tokenGetter ? await tokenGetter() : null;
  const headers: Record<string, string> = {
    ...(init.headers as Record<string, string> | undefined),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  let body = init.body;
  if (init.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(init.json);
  }

  const res = await fetch(`${API_URL}${path}`, { ...init, headers, body });
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const data = (await res.json()) as { message?: string };
      if (data.message) message = data.message;
    } catch {
      // keep default message
    }
    throw new ApiRequestError(res.status, message);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}
