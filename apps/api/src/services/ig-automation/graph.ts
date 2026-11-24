import { env } from "../../env.js";
import { graphBase } from "../social/oauth/meta.js";
import { buildDmMessage, classifyGraphError, dmTextWithLink, dmTextWithOptions, type DmContent, type GraphErrorKind } from "./logic.js";

/**
 * Graph API calls for Instagram automation (Instagram API with Facebook Login,
 * Page access tokens). `endpoints.base` is overridable so tests can point it at
 * a local fake of Meta. Error bodies are classified, never logged with tokens.
 */
export const endpoints = { base: () => graphBase() };

export class GraphError extends Error {
  constructor(
    public kind: GraphErrorKind,
    public status: number,
    public code: number | null,
    public subcode: number | null,
    message: string,
  ) {
    super(message);
  }
}

/** Thrown when the request never got a response: the outcome is unknown. */
export class GraphNetworkError extends Error {}

async function call(
  method: "GET" | "POST" | "DELETE",
  path: string,
  token: string,
  opts: { query?: Record<string, string>; json?: unknown; form?: Record<string, string> } = {},
): Promise<Record<string, unknown>> {
  const url = new URL(`${endpoints.base()}${path}`);
  for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, v);
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  let body: string | undefined;
  if (opts.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.json);
  } else if (opts.form) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    body = new URLSearchParams(opts.form).toString();
  }
  let res: Response;
  try {
    res = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(30_000) });
  } catch (err) {
    throw new GraphNetworkError(`Could not reach Meta: ${err instanceof Error ? err.message : err}`);
  }
  let json: Record<string, unknown> = {};
  try {
    json = (await res.json()) as Record<string, unknown>;
  } catch {
    // empty or non-JSON body
  }
  if (!res.ok || json.error) {
    const c = classifyGraphError(res.status, json);
    throw new GraphError(c.kind, res.status, c.code, c.subcode, c.message);
  }
  return json;
}

/** Public reply under a top-level comment. Returns the new comment id. */
export async function replyToComment(token: string, commentId: string, message: string): Promise<string> {
  const r = await call("POST", `/${encodeURIComponent(commentId)}/replies`, token, { form: { message } });
  if (typeof r.id !== "string") throw new GraphError("invalid", 200, null, null, "Meta returned no reply id");
  return r.id;
}

/**
 * Sends `content` with a button template; if Meta refuses the template
 * (invalid request), sends the text with the link instead.
 */
async function sendWithFallback(send: (message: Record<string, unknown>) => Promise<Record<string, unknown>>, content: DmContent) {
  try {
    return { result: await send(buildDmMessage(content)), usedFallback: false };
  } catch (err) {
    if (err instanceof GraphError && err.kind === "invalid") {
      if (content.options?.length) return { result: await send(dmTextWithOptions(content)), usedFallback: true };
      if (content.buttonUrl) return { result: await send(dmTextWithLink(content)), usedFallback: true };
    }
    throw err;
  }
}

/**
 * Private reply to a comment (opens a DM thread with the commenter). Meta
 * documents both /{PAGE-ID}/messages and /{IG-ID}/messages for this; the Page
 * path is tried first and the Instagram path only if Meta rejects the path itself.
 */
export async function sendPrivateReply(
  token: string,
  ids: { pageId: string | null; igUserId: string },
  commentId: string,
  content: DmContent,
): Promise<{ messageId: string | null; usedFallback: boolean }> {
  const paths = [ids.pageId ? `/${ids.pageId}/messages` : null, `/${ids.igUserId}/messages`].filter((p): p is string => !!p);
  let lastErr: unknown = null;
  for (const p of paths) {
    try {
      const { result, usedFallback } = await sendWithFallback(
        (message) => call("POST", p, token, { json: { recipient: { comment_id: commentId }, message } }),
        content,
      );
      return { messageId: typeof result.message_id === "string" ? result.message_id : null, usedFallback };
    } catch (err) {
      lastErr = err;
      if (!(err instanceof GraphError && err.kind === "unsupported_path")) throw err;
    }
  }
  throw lastErr;
}

/** DM to someone who just messaged the account (inside the 24-hour window). */
export async function sendDm(token: string, pageId: string | null, igsid: string, content: DmContent): Promise<{ messageId: string | null; usedFallback: boolean }> {
  const path = pageId ? `/${pageId}/messages` : "/me/messages";
  const { result, usedFallback } = await sendWithFallback(
    (message) => call("POST", path, token, { json: { recipient: { id: igsid }, messaging_type: "RESPONSE", message } }),
    content,
  );
  return { messageId: typeof result.message_id === "string" ? result.message_id : null, usedFallback };
}

/**
 * Answer to a tapped option: sends `message` (an image/video attachment or a link template);
 * if Meta refuses it, sends `fallbackText` (text with the link) instead.
 */
export async function sendOptionReply(
  token: string,
  pageId: string | null,
  igsid: string,
  reply: { message: Record<string, unknown>; fallbackText: string },
): Promise<{ messageId: string | null; usedFallback: boolean }> {
  const path = pageId ? `/${pageId}/messages` : "/me/messages";
  const send = (message: Record<string, unknown>) =>
    call("POST", path, token, { json: { recipient: { id: igsid }, messaging_type: "RESPONSE", message } });
  let usedFallback = false;
  let result: Record<string, unknown>;
  try {
    result = await send(reply.message);
  } catch (err) {
    if (!(err instanceof GraphError && err.kind === "invalid")) throw err;
    usedFallback = true;
    result = await send({ text: reply.fallbackText });
  }
  return { messageId: typeof result.message_id === "string" ? result.message_id : null, usedFallback };
}

export interface IgMedia {
  id: string;
  caption: string | null;
  mediaType: string | null;
  productType: string | null;
  thumbnailUrl: string | null;
  permalink: string | null;
  timestamp: string | null;
}

/** Recent posts and reels of the Instagram account (for the per-post rule picker). */
export async function listMedia(token: string, igUserId: string, limit = 50): Promise<IgMedia[]> {
  const r = await call("GET", `/${igUserId}/media`, token, {
    query: { fields: "id,caption,media_type,media_product_type,thumbnail_url,media_url,permalink,timestamp", limit: String(limit) },
  });
  return ((r.data as Record<string, string | undefined>[] | undefined) ?? []).map((m) => ({
    id: String(m.id),
    caption: m.caption ?? null,
    mediaType: m.media_type ?? null,
    productType: m.media_product_type ?? null,
    thumbnailUrl: m.thumbnail_url ?? (m.media_type === "VIDEO" ? null : (m.media_url ?? null)),
    permalink: m.permalink ?? null,
    timestamp: m.timestamp ?? null,
  }));
}

/** Fields asked for when subscribing the Page; Meta's docs disagree on these, so a narrower set is tried next. */
export const PAGE_SUBSCRIBE_FIELDS = [["feed", "messages", "messaging_postbacks"], ["feed"]];

/** Whether this app is subscribed to the Page's webhooks, and with which fields. */
export async function pageSubscription(token: string, pageId: string): Promise<{ subscribed: boolean; fields: string[] }> {
  const r = await call("GET", `/${pageId}/subscribed_apps`, token);
  const apps = (r.data as { id?: string; subscribed_fields?: string[] }[] | undefined) ?? [];
  const mine = apps.find((a) => !env.META_APP_ID || a.id === env.META_APP_ID) ?? null;
  return { subscribed: !!mine, fields: mine?.subscribed_fields ?? [] };
}

/**
 * Subscribes this app to the Page (needs pages_manage_metadata). Tries the full
 * field set first, then `feed` alone. A permission error also falls through:
 * Meta refuses the `messages` field with #200 unless the app has pages_messaging,
 * which Instagram automation doesn't need (Instagram events come from the
 * Instagram webhook object). If `feed` fails too, that last error is thrown.
 */
export async function subscribePage(token: string, pageId: string): Promise<string[]> {
  let lastErr: unknown = null;
  for (const fields of PAGE_SUBSCRIBE_FIELDS) {
    try {
      await call("POST", `/${pageId}/subscribed_apps`, token, { query: { subscribed_fields: fields.join(",") } });
      return fields;
    } catch (err) {
      lastErr = err;
      if (!(err instanceof GraphError && (err.kind === "invalid" || err.kind === "unsupported_path" || err.kind === "permission"))) throw err;
    }
  }
  throw lastErr;
}

/** Permissions granted to the stored token (debug_token with the app token). */
export async function grantedScopes(token: string): Promise<{ valid: boolean; scopes: string[] }> {
  if (!env.META_APP_ID || !env.META_APP_SECRET) throw new Error("META_APP_ID / META_APP_SECRET not set");
  const url = new URL(`${endpoints.base()}/debug_token`);
  url.searchParams.set("input_token", token);
  url.searchParams.set("access_token", `${env.META_APP_ID}|${env.META_APP_SECRET}`);
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  } catch (err) {
    throw new GraphNetworkError(`Could not reach Meta: ${err instanceof Error ? err.message : err}`);
  }
  const json = (await res.json().catch(() => ({}))) as { data?: { is_valid?: boolean; scopes?: string[]; granular_scopes?: { scope: string }[] } };
  if (!res.ok || !json.data) throw new Error(`Meta token check failed (${res.status})`);
  const scopes = new Set([...(json.data.scopes ?? []), ...(json.data.granular_scopes ?? []).map((g) => g.scope)]);
  return { valid: json.data.is_valid !== false, scopes: [...scopes] };
}
