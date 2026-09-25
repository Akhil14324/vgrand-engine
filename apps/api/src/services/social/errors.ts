import {
  RETRYABLE_SOCIAL_FAILURES,
  type SocialFailureCode,
} from "@catgpt/types";

/**
 * The only error adapters/token code should throw. `message` is shown to the
 * user, so it must never contain tokens, codes or provider response bodies
 * that could echo credentials.
 */
export class SocialPublishError extends Error {
  constructor(
    public code: SocialFailureCode,
    message: string,
  ) {
    super(message);
    this.name = "SocialPublishError";
  }
}

/**
 * Raised while connecting an account (OAuth callback). `code` is a short slug
 * that is safe to put in the redirect URL (?social=error:{code}).
 */
export class SocialConnectError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "SocialConnectError";
  }
}

export const isRetryableFailure = (code: string | null | undefined): boolean =>
  RETRYABLE_SOCIAL_FAILURES.includes(code as SocialFailureCode);

/** Cap provider-supplied text before it is stored/shown. */
export const briefProviderMessage = (raw: unknown, fallback: string): string => {
  const text = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
  return text ? text.slice(0, 300) : fallback;
};
