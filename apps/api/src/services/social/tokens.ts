import { prisma, type SocialAccount } from "@catgpt/db";
import { env } from "../../env.js";
import { decryptToken, encryptToken } from "../../lib/social-crypto.js";
import { SocialPublishError } from "./errors.js";
import { form, readJson, socialFetch } from "./http.js";
import { graphBase } from "./oauth/meta.js";
import { GOOGLE_TOKEN_URL } from "./oauth/google.js";
import { X_TOKEN_URL, xBasicAuth } from "./oauth/x.js";

export interface DecryptedTokens {
  accessToken: string;
  refreshToken: string | null;
}

/** Refresh a little early so a token can't expire mid-upload. */
const EXPIRY_SKEW_MS = 2 * 60_000;

/** One refresh per account at a time (rotating refresh tokens are single-use). */
const inflight = new Map<string, Promise<DecryptedTokens>>();

async function markReauth(accountId: string) {
  await prisma.socialAccount
    .update({ where: { id: accountId }, data: { status: "reauth_required" } })
    .catch(() => {});
}

function decrypt(account: SocialAccount): DecryptedTokens {
  return {
    accessToken: decryptToken(account.accessTokenEnc),
    refreshToken: account.refreshTokenEnc ? decryptToken(account.refreshTokenEnc) : null,
  };
}

/**
 * Returns usable plaintext tokens for an account, refreshing when needed.
 * Callers MUST have authorized the account (findUsableAccount) first - this
 * function decrypts credentials and performs no access check of its own.
 * Never logs tokens; failures surface as SocialPublishError.
 */
export async function ensureFreshToken(account: SocialAccount): Promise<DecryptedTokens> {
  if (account.status === "revoked" || account.status === "reauth_required") {
    throw new SocialPublishError(
      "AUTH_REVOKED",
      "This account needs to be reconnected",
    );
  }

  if (account.platform === "instagram" || account.platform === "facebook") {
    return ensureMetaToken(account);
  }

  const expiring =
    account.tokenExpiresAt !== null &&
    account.tokenExpiresAt.getTime() - Date.now() < EXPIRY_SKEW_MS;
  if (!expiring) return decrypt(account);

  const running = inflight.get(account.id);
  if (running) return running;
  const promise = refresh(account).finally(() => inflight.delete(account.id));
  inflight.set(account.id, promise);
  return promise;
}

async function refresh(stale: SocialAccount): Promise<DecryptedTokens> {
  // Another worker may have refreshed since this row was loaded.
  const account = (await prisma.socialAccount.findUnique({ where: { id: stale.id } })) ?? stale;
  if (
    account.tokenExpiresAt &&
    account.tokenExpiresAt.getTime() - Date.now() >= EXPIRY_SKEW_MS
  ) {
    return decrypt(account);
  }

  if (!account.refreshTokenEnc) {
    await markReauth(account.id);
    throw new SocialPublishError("AUTH_EXPIRED", "Authorization expired - reconnect this account");
  }
  const refreshToken = decryptToken(account.refreshTokenEnc);

  const isX = account.platform === "x";
  const res = await socialFetch(isX ? X_TOKEN_URL : GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      ...(isX ? { Authorization: xBasicAuth() } : {}),
    },
    body: isX
      ? form({
          grant_type: "refresh_token",
          refresh_token: refreshToken,
          client_id: env.X_CLIENT_ID,
        })
      : form({
          grant_type: "refresh_token",
          refresh_token: refreshToken,
          client_id: env.GOOGLE_CLIENT_ID,
          client_secret: env.GOOGLE_CLIENT_SECRET,
        }),
  }).catch(() => {
    throw new SocialPublishError("PROVIDER_ERROR", "Could not reach the provider to refresh authorization");
  });
  const json = await readJson(res);

  if (!res.ok || typeof json.access_token !== "string") {
    if (res.status === 429) {
      throw new SocialPublishError("RATE_LIMITED", "Provider rate limited the authorization refresh");
    }
    if (res.status >= 500) {
      throw new SocialPublishError("PROVIDER_ERROR", "Provider is unavailable for authorization refresh");
    }
    // 4xx (invalid_grant etc.). With a rotating refresh token a sibling job may
    // have just used ours - if the stored token changed, that refresh won.
    const latest = await prisma.socialAccount.findUnique({ where: { id: account.id } });
    if (latest && latest.refreshTokenEnc !== account.refreshTokenEnc) return decrypt(latest);
    await markReauth(account.id);
    throw new SocialPublishError("AUTH_REVOKED", "Authorization was revoked - reconnect this account");
  }

  const updated = await prisma.socialAccount.update({
    where: { id: account.id },
    data: {
      accessTokenEnc: encryptToken(json.access_token),
      // X rotates refresh tokens; Google usually omits a new one - keep the old.
      ...(typeof json.refresh_token === "string"
        ? { refreshTokenEnc: encryptToken(json.refresh_token) }
        : {}),
      tokenExpiresAt:
        typeof json.expires_in === "number" ? new Date(Date.now() + json.expires_in * 1000) : null,
      status: "active",
    },
  });
  return decrypt(updated);
}

/**
 * Meta Page tokens (from a long-lived user token) don't expire on a schedule,
 * but can be invalidated (password change, app removed, permissions revoked).
 * Revalidate with the documented /debug_token endpoint before publishing. If the
 * check itself can't run (network, unexpected shape) we proceed and let the
 * publish call report auth failure.
 */
async function ensureMetaToken(account: SocialAccount): Promise<DecryptedTokens> {
  const tokens = decrypt(account);
  try {
    const url = new URL(`${graphBase()}/debug_token`);
    url.searchParams.set("input_token", tokens.accessToken);
    url.searchParams.set("access_token", `${env.META_APP_ID}|${env.META_APP_SECRET}`);
    const res = await socialFetch(url.toString());
    const data = (await readJson(res)).data as
      | { is_valid?: boolean; expires_at?: number }
      | undefined;
    if (res.ok && data && data.is_valid === false) {
      await markReauth(account.id);
      const expired = typeof data.expires_at === "number" && data.expires_at > 0;
      throw new SocialPublishError(
        expired ? "AUTH_EXPIRED" : "AUTH_REVOKED",
        "Meta authorization is no longer valid - reconnect this account",
      );
    }
  } catch (err) {
    if (err instanceof SocialPublishError) throw err;
  }
  return tokens;
}
