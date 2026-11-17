import { createHmac, timingSafeEqual } from "node:crypto";

export type MetaSignedPayload = { userId: string };

const b64urlToBuffer = (s: string) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

/**
 * Verify and decode a Meta `signed_request` (data-deletion and deauthorize
 * callbacks). Format: `<base64url signature>.<base64url JSON payload>`, with the
 * signature an HMAC-SHA256 of the payload segment keyed by the app secret.
 * Returns null for anything malformed or not signed with our secret.
 */
export function parseMetaSignedRequest(
  signedRequest: unknown,
  appSecret: string,
): MetaSignedPayload | null {
  if (typeof signedRequest !== "string" || !appSecret) return null;
  const parts = signedRequest.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const [sigPart, payloadPart] = parts as [string, string];

  const expected = createHmac("sha256", appSecret).update(payloadPart).digest();
  const given = b64urlToBuffer(sigPart);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

  try {
    const json = JSON.parse(b64urlToBuffer(payloadPart).toString("utf8")) as Record<string, unknown>;
    if (json.algorithm !== undefined && String(json.algorithm).toUpperCase() !== "HMAC-SHA256") {
      return null;
    }
    const userId = json.user_id;
    if (typeof userId !== "string" || !/^\d{1,40}$/.test(userId)) return null;
    return { userId };
  } catch {
    return null;
  }
}
