import { env } from "../../../env.js";
import type { ConnectedAccountInput } from "../accounts.js";
import { SocialConnectError } from "../errors.js";
import { readJson, socialFetch } from "../http.js";

/** Exactly the permission set the project specified - nothing added. */
export const META_SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_posts",
  "business_management",
  "instagram_basic",
  "instagram_content_publish",
] as const;

export const graphBase = () => `https://graph.facebook.com/${env.META_GRAPH_VERSION}`;

export function metaAuthUrl(state: string, redirectUri: string): string {
  const url = new URL(`https://www.facebook.com/${env.META_GRAPH_VERSION}/dialog/oauth`);
  url.searchParams.set("client_id", env.META_APP_ID!);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("scope", META_SCOPES.join(","));
  url.searchParams.set("response_type", "code");
  return url.toString();
}

async function graphGet(
  path: string,
  params: Record<string, string>,
): Promise<Record<string, any>> {
  const url = new URL(path.startsWith("http") ? path : `${graphBase()}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await socialFetch(url.toString());
  const json = await readJson(res);
  if (!res.ok) {
    // Deliberately no body/URL in the message: it can echo tokens.
    throw new SocialConnectError("provider_error", `Meta request failed (${res.status})`);
  }
  return json;
}

interface PageRow {
  id: string;
  name?: string;
  access_token?: string;
  picture?: { data?: { url?: string } };
}

/**
 * code -> short-lived user token -> long-lived user token -> pages. A Page
 * access token derived from a long-lived user token is what publishes for both
 * Facebook and its linked Instagram professional account.
 */
export async function completeMetaConnect(
  code: string,
  redirectUri: string,
): Promise<ConnectedAccountInput[]> {
  const short = await graphGet("/oauth/access_token", {
    client_id: env.META_APP_ID!,
    client_secret: env.META_APP_SECRET!,
    redirect_uri: redirectUri,
    code,
  });
  if (typeof short.access_token !== "string") {
    throw new SocialConnectError("token_exchange_failed", "Meta returned no token");
  }
  const long = await graphGet("/oauth/access_token", {
    grant_type: "fb_exchange_token",
    client_id: env.META_APP_ID!,
    client_secret: env.META_APP_SECRET!,
    fb_exchange_token: short.access_token,
  });
  const userToken = typeof long.access_token === "string" ? long.access_token : null;
  if (!userToken) {
    throw new SocialConnectError("token_exchange_failed", "Meta returned no long-lived token");
  }

  const pages: PageRow[] = [];
  let next: string | null = null;
  let first = true;
  for (let i = 0; i < 10 && (first || next); i++) {
    const json: Record<string, any> = first
      ? await graphGet("/me/accounts", {
          fields: "id,name,access_token,picture.type(large){url}",
          limit: "100",
          access_token: userToken,
        })
      : await graphGet(next!, {});
    first = false;
    pages.push(...((json.data as PageRow[] | undefined) ?? []));
    next = typeof json.paging?.next === "string" ? json.paging.next : null;
  }
  if (pages.length === 0) {
    throw new SocialConnectError("no_pages", "No Facebook Pages were granted");
  }

  const accounts: ConnectedAccountInput[] = [];
  for (const page of pages) {
    if (!page.id || !page.access_token) continue;
    accounts.push({
      platform: "facebook",
      externalAccountId: page.id,
      handle: null,
      displayName: page.name ?? null,
      avatarUrl: page.picture?.data?.url ?? null,
      accessToken: page.access_token,
      tokenExpiresAt: null, // long-lived-user-derived Page tokens carry no expiry; revocation is detected on use
      scopes: [...META_SCOPES],
      metadata: { pageId: page.id },
    });

    // Instagram is best-effort per Page: a failure here must not drop the Page itself.
    try {
      const ig = await graphGet(`/${page.id}`, {
        fields: "instagram_business_account{id,username,profile_picture_url}",
        access_token: page.access_token,
      });
      const igAcc = ig.instagram_business_account as
        | { id?: string; username?: string; profile_picture_url?: string }
        | undefined;
      if (igAcc?.id) {
        accounts.push({
          platform: "instagram",
          externalAccountId: igAcc.id,
          handle: igAcc.username ? `@${igAcc.username}` : null,
          displayName: igAcc.username ?? page.name ?? null,
          avatarUrl: igAcc.profile_picture_url ?? null,
          accessToken: page.access_token,
          tokenExpiresAt: null,
          scopes: [...META_SCOPES],
          metadata: { pageId: page.id, igUserId: igAcc.id },
        });
      }
    } catch {
      // Page saved without its Instagram link; reconnecting retries it.
    }
  }
  if (accounts.length === 0) {
    throw new SocialConnectError("no_pages", "No usable Facebook Pages were granted");
  }
  return accounts;
}
