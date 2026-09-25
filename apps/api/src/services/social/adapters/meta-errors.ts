import { briefProviderMessage, SocialPublishError } from "../errors.js";

/**
 * Maps a Graph API failure to a typed error. Codes below are from Meta's
 * documented error reference (190 = access token problems, 4/17/32/613 and
 * 80001-80006 = rate limits, 100 = invalid parameter, 10 / 200-299 = missing
 * permissions). Anything unrecognised becomes a retryable PROVIDER_ERROR.
 * Only Meta's own message text is surfaced - never the request URL or token.
 */
export function graphError(status: number, json: Record<string, any>): SocialPublishError {
  const err = (json.error ?? {}) as {
    code?: number;
    error_subcode?: number;
    message?: string;
  };
  const code = err.code;
  const sub = err.error_subcode;
  const msg = briefProviderMessage(err.message, `Meta request failed (${status})`);

  if (code === 190) {
    // 463 = expired, 467 = invalid (session ended); other subcodes = revoked/changed password.
    return new SocialPublishError(
      sub === 463 || sub === 467 ? "AUTH_EXPIRED" : "AUTH_REVOKED",
      "Meta authorization is no longer valid - reconnect this account",
    );
  }
  if (code === 102) return new SocialPublishError("AUTH_EXPIRED", "Meta session expired - reconnect this account");
  if (code === 10 || (typeof code === "number" && code >= 200 && code <= 299)) {
    return new SocialPublishError("AUTH_REVOKED", `Missing Meta permission - reconnect this account (${msg})`);
  }
  if (
    code === 4 || code === 17 || code === 32 || code === 613 ||
    (typeof code === "number" && code >= 80001 && code <= 80006) ||
    status === 429
  ) {
    return new SocialPublishError("RATE_LIMITED", "Meta rate limit reached - try again later");
  }
  if (sub === 2207009 || sub === 2207026) {
    return new SocialPublishError("INVALID_MEDIA", msg);
  }
  if (code === 100 && status < 500) return new SocialPublishError("INVALID_CONTENT", msg);
  return new SocialPublishError("PROVIDER_ERROR", msg);
}
