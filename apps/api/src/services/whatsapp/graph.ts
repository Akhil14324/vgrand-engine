import { env } from "../../env.js";
import { graphBase } from "../social/oauth/meta.js";
import { isRetryableCode } from "./logic.js";

/** WhatsApp Cloud API calls. `endpoints.base` is overridable so tests can point at a fake Meta. */
export const endpoints = { base: () => graphBase() };

export class WaError extends Error {
  constructor(
    public kind: "auth" | "retryable" | "rejected",
    public status: number,
    public code: number | null,
    message: string,
  ) {
    super(message);
  }
}
/** The request never got a response: the outcome is unknown, so never blindly resend. */
export class WaNetworkError extends Error {}

type Json = Record<string, any>;

async function call(method: "GET" | "POST", path: string, token: string, json?: unknown, query?: Record<string, string>): Promise<Json> {
  const url = new URL(path.startsWith("http") ? path : `${endpoints.base()}${path}`);
  for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, v);
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(json !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: json !== undefined ? JSON.stringify(json) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    throw new WaNetworkError(`Could not reach Meta: ${err instanceof Error ? err.message : err}`);
  }
  let body: Json = {};
  try {
    body = (await res.json()) as Json;
  } catch {
    // empty body
  }
  if (!res.ok || body.error) {
    const e = (body.error ?? {}) as Json;
    const code = typeof e.code === "number" ? e.code : null;
    const detail = e.error_data?.details ? ` ${e.error_data.details}` : "";
    const kind = code === 190 || res.status === 401 ? "auth" : res.status >= 500 || res.status === 429 || isRetryableCode(code) ? "retryable" : "rejected";
    // Message only: the body can echo request data, never the token.
    throw new WaError(kind, res.status, code, `${e.message ?? `Meta returned ${res.status}`}${detail}`.slice(0, 500));
  }
  return body;
}

export async function sendRaw(token: string, phoneNumberId: string, payload: unknown): Promise<string> {
  const r = await call("POST", `/${phoneNumberId}/messages`, token, payload);
  const mid = r.messages?.[0]?.id;
  if (!mid) throw new WaError("rejected", 200, null, "Meta accepted the request but returned no message id");
  return String(mid);
}

export const sendTextPayload = (to: string, body: string) => ({ messaging_product: "whatsapp", to, type: "text", text: { body, preview_url: true } });
export const sendImagePayload = (to: string, link: string, caption: string) => ({ messaging_product: "whatsapp", to, type: "image", image: { link, caption: caption.slice(0, 1024) } });

export function sendTemplatePayload(to: string, name: string, language: string, headerUrl: string | null, values: string[]) {
  const components: Json[] = [];
  if (headerUrl) components.push({ type: "header", parameters: [{ type: "image", image: { link: headerUrl } }] });
  if (values.length) components.push({ type: "body", parameters: values.map((text) => ({ type: "text", text: text || "-" })) });
  return { messaging_product: "whatsapp", to, type: "template", template: { name, language: { code: language }, components } };
}

/** Marks the customer's message read and shows "typing…" (for up to ~25 s or until we reply). Best effort: never throws. */
export async function markReadTyping(token: string, phoneNumberId: string, mid: string): Promise<void> {
  try {
    await call("POST", `/${phoneNumberId}/messages`, token, { messaging_product: "whatsapp", status: "read", message_id: mid, typing_indicator: { type: "text" } });
  } catch {
    // purely cosmetic
  }
}

export interface PhoneInfo {
  displayPhone: string | null;
  verifiedName: string | null;
}
export async function getPhoneInfo(token: string, phoneNumberId: string): Promise<PhoneInfo> {
  const r = await call("GET", `/${phoneNumberId}`, token, undefined, { fields: "display_phone_number,verified_name" });
  return { displayPhone: r.display_phone_number ?? null, verifiedName: r.verified_name ?? null };
}

/** Makes Meta deliver this WABA's message webhooks to the app's callback URL. */
export async function subscribeWaba(token: string, wabaId: string): Promise<void> {
  await call("POST", `/${wabaId}/subscribed_apps`, token, {});
}

export async function listMetaTemplates(token: string, wabaId: string): Promise<{ id: string; name: string; language: string; status: string; reason: string | null }[]> {
  const r = await call("GET", `/${wabaId}/message_templates`, token, undefined, { fields: "id,name,language,status,rejected_reason", limit: "200" });
  return (r.data ?? []).map((t: Json) => ({
    id: String(t.id),
    name: String(t.name),
    language: String(t.language),
    status: String(t.status).toLowerCase(),
    reason: t.rejected_reason && t.rejected_reason !== "NONE" ? String(t.rejected_reason) : null,
  }));
}

/** Meta wants an uploaded-file handle (not a URL) as the header example: resumable upload API. */
export async function uploadExampleImage(token: string, imageUrl: string): Promise<string> {
  const appId = env.WHATSAPP_APP_ID ?? env.META_APP_ID;
  if (!appId) throw new WaError("rejected", 400, null, "WHATSAPP_APP_ID (or META_APP_ID) is not set");
  let img: Response;
  try {
    img = await fetch(imageUrl, { signal: AbortSignal.timeout(30_000) });
  } catch {
    throw new WaError("rejected", 400, null, "Could not download the header image");
  }
  const type = img.headers.get("content-type")?.split(";")[0] ?? "";
  if (!img.ok || !["image/jpeg", "image/png"].includes(type)) throw new WaError("rejected", 400, null, "Header image must be a public JPEG or PNG");
  const bytes = Buffer.from(await img.arrayBuffer());
  if (bytes.length > 5 * 1024 * 1024) throw new WaError("rejected", 400, null, "Header image must be under 5 MB");
  const session = await call("POST", `/${appId}/uploads`, token, undefined, { file_length: String(bytes.length), file_type: type, file_name: "header" });
  let up: Response;
  try {
    up = await fetch(`${endpoints.base()}/${session.id}`, { method: "POST", headers: { Authorization: `OAuth ${token}`, file_offset: "0" }, body: bytes, signal: AbortSignal.timeout(60_000) });
  } catch (err) {
    throw new WaNetworkError(`Upload failed: ${err instanceof Error ? err.message : err}`);
  }
  const j = (await up.json().catch(() => ({}))) as Json;
  if (!up.ok || !j.h) throw new WaError("rejected", up.status, null, "Meta did not accept the header image upload");
  return String(j.h);
}

export async function createMetaTemplate(token: string, wabaId: string, body: Json): Promise<{ id: string; status: string }> {
  const r = await call("POST", `/${wabaId}/message_templates`, token, body);
  return { id: String(r.id), status: String(r.status ?? "PENDING").toLowerCase() };
}
