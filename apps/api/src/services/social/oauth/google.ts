import { env } from "../../../env.js";
import type { ConnectedAccountInput } from "../accounts.js";
import { SocialConnectError } from "../errors.js";
import { form, readJson, socialFetch } from "../http.js";

/**
 * `youtube.upload` as specified, plus `youtube.readonly`: channels.list?mine=true
 * (needed to "fetch the connected channel") is documented as not covered by the
 * upload scope alone. UNVERIFIED against a live app - remove it and the channel
 * lookup if you would rather identify the account another way.
 */
export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly",
] as const;

export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

export function googleAuthUrl(state: string, redirectUri: string): string {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", env.GOOGLE_CLIENT_ID!);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_SCOPES.join(" "));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", state);
  return url.toString();
}

export async function completeGoogleConnect(
  code: string,
  redirectUri: string,
): Promise<ConnectedAccountInput[]> {
  const res = await socialFetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
    }),
  });
  const token = await readJson(res);
  if (!res.ok || typeof token.access_token !== "string") {
    throw new SocialConnectError("token_exchange_failed", `Google token exchange failed (${res.status})`);
  }
  // Uploads happen long after the access token expires, so a refresh token is mandatory.
  if (typeof token.refresh_token !== "string") {
    throw new SocialConnectError("no_refresh_token", "Google returned no refresh token");
  }

  const chRes = await socialFetch(
    "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true",
    { headers: { Authorization: `Bearer ${token.access_token}` } },
  );
  const channel = ((await readJson(chRes)).items as any[] | undefined)?.[0] as
    | {
        id?: string;
        snippet?: {
          title?: string;
          customUrl?: string;
          thumbnails?: { default?: { url?: string } };
        };
      }
    | undefined;
  if (!chRes.ok) {
    throw new SocialConnectError("identity_failed", `YouTube channel lookup failed (${chRes.status})`);
  }
  if (!channel?.id) {
    throw new SocialConnectError("no_channel", "This Google account has no YouTube channel");
  }

  return [
    {
      platform: "youtube",
      externalAccountId: channel.id,
      handle: channel.snippet?.customUrl ?? null,
      displayName: channel.snippet?.title ?? null,
      avatarUrl: channel.snippet?.thumbnails?.default?.url ?? null,
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      tokenExpiresAt:
        typeof token.expires_in === "number"
          ? new Date(Date.now() + token.expires_in * 1000)
          : null,
      scopes: typeof token.scope === "string" ? token.scope.split(" ") : [...GOOGLE_SCOPES],
      // Unverified Google apps are locked to private uploads; surface that to the UI.
      metadata: { channelId: channel.id, visibility: env.YOUTUBE_VISIBILITY },
    },
  ];
}
