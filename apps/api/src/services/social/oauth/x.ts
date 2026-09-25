import { createHash, randomBytes } from "node:crypto";
import { env } from "../../../env.js";
import type { ConnectedAccountInput } from "../accounts.js";
import { SocialConnectError } from "../errors.js";
import { form, readJson, socialFetch } from "../http.js";

/**
 * The four scopes the project specified, plus `media.write`: X's v2 media
 * upload endpoint is documented as requiring it. UNVERIFIED against a live
 * app - drop it here if X accepts uploads without it.
 */
export const X_SCOPES = [
  "tweet.read",
  "tweet.write",
  "users.read",
  "offline.access",
  "media.write",
] as const;

export const X_TOKEN_URL = "https://api.x.com/2/oauth2/token";

/** Confidential-client auth for the token endpoint. */
export const xBasicAuth = () =>
  `Basic ${Buffer.from(`${env.X_CLIENT_ID}:${env.X_CLIENT_SECRET}`).toString("base64")}`;

export function generatePkce() {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function xAuthUrl(state: string, redirectUri: string, challenge: string): string {
  const url = new URL("https://x.com/i/oauth2/authorize");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", env.X_CLIENT_ID!);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", X_SCOPES.join(" "));
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export async function completeXConnect(
  code: string,
  verifier: string,
  redirectUri: string,
): Promise<ConnectedAccountInput[]> {
  const res = await socialFetch(X_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: xBasicAuth(),
    },
    body: form({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
      client_id: env.X_CLIENT_ID,
    }),
  });
  const token = await readJson(res);
  if (!res.ok || typeof token.access_token !== "string") {
    throw new SocialConnectError("token_exchange_failed", `X token exchange failed (${res.status})`);
  }

  const meRes = await socialFetch(
    "https://api.x.com/2/users/me?user.fields=profile_image_url,username,name",
    { headers: { Authorization: `Bearer ${token.access_token}` } },
  );
  const me = (await readJson(meRes)).data as
    | { id?: string; username?: string; name?: string; profile_image_url?: string }
    | undefined;
  if (!meRes.ok || !me?.id) {
    throw new SocialConnectError("identity_failed", `X identity lookup failed (${meRes.status})`);
  }

  return [
    {
      platform: "x",
      externalAccountId: me.id,
      handle: me.username ? `@${me.username}` : null,
      displayName: me.name ?? me.username ?? null,
      avatarUrl: me.profile_image_url ?? null,
      accessToken: token.access_token,
      refreshToken: typeof token.refresh_token === "string" ? token.refresh_token : null,
      tokenExpiresAt:
        typeof token.expires_in === "number"
          ? new Date(Date.now() + token.expires_in * 1000)
          : null,
      scopes:
        typeof token.scope === "string" ? token.scope.split(" ") : [...X_SCOPES],
      // username kept for building the post URL (x.com/{username}/status/{id})
      metadata: me.username ? { username: me.username } : undefined,
    },
  ];
}
