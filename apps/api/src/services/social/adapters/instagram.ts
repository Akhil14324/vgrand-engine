import { SocialPublishError } from "../errors.js";
import { form, readJson, socialFetch } from "../http.js";
import { graphBase } from "../oauth/meta.js";
import { graphError } from "./meta-errors.js";
import type { PublishInput, PublishResult, SocialAdapter } from "./types.js";

const POLL_INTERVAL_MS = 3_000;
const POLL_MAX_MS = 90_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function graph(
  method: "GET" | "POST",
  path: string,
  token: string,
  params: Record<string, string> = {},
): Promise<Record<string, any>> {
  let res: Response;
  try {
    if (method === "GET") {
      const url = new URL(`${graphBase()}${path}`);
      for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
      url.searchParams.set("access_token", token);
      res = await socialFetch(url.toString());
    } else {
      res = await socialFetch(`${graphBase()}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form({ ...params, access_token: token }),
      });
    }
  } catch {
    throw new SocialPublishError("PROVIDER_ERROR", "Could not reach Instagram");
  }
  const json = await readJson(res);
  if (!res.ok) throw graphError(res.status, json);
  return json;
}

function composeCaption(content: PublishInput["content"]): string {
  const tags = (content.hashtags ?? []).map((h) => `#${h.replace(/^#+/, "")}`);
  return [content.caption?.trim() ?? "", tags.join(" ")].filter(Boolean).join("\n\n");
}

/**
 * Content Publishing API: create container -> (persist id) -> poll until
 * FINISHED -> media_publish. A retry reuses the stored container instead of
 * creating a second one.
 */
export const instagramAdapter: SocialAdapter = {
  platform: "instagram",
  async publish({ account, decryptedTokens, content, media, providerState, saveState }: PublishInput): Promise<PublishResult> {
    const token = decryptedTokens.accessToken;
    const igUserId = account.externalAccountId;
    let state = providerState;

    // Already published on a previous attempt whose result wasn't saved.
    if (typeof state.igMediaId === "string") {
      return finish(igUserId, token, state.igMediaId, state);
    }

    let containerId = typeof state.igContainerId === "string" ? state.igContainerId : null;
    if (!containerId) {
      // Reject local/private/non-HTTPS URLs BEFORE calling Instagram.
      const imageUrl = await media.publicUrl();
      const created = await graph("POST", `/${igUserId}/media`, token, {
        image_url: imageUrl,
        caption: composeCaption(content),
      });
      if (typeof created.id !== "string") {
        throw new SocialPublishError("PROVIDER_ERROR", "Instagram returned no container id");
      }
      containerId = created.id;
      state = await saveState({ igContainerId: containerId });
    }

    const deadline = Date.now() + POLL_MAX_MS;
    for (;;) {
      const status = await graph("GET", `/${containerId}`, token, { fields: "status_code" });
      const code = status.status_code as string | undefined;
      if (code === "FINISHED") break;
      if (code === "ERROR") {
        await saveState({ igContainerId: null });
        throw new SocialPublishError("INVALID_MEDIA", "Instagram could not process the image");
      }
      if (code === "EXPIRED") {
        // Containers expire after ~24h; a retry must start a fresh one.
        await saveState({ igContainerId: null });
        throw new SocialPublishError("PROVIDER_ERROR", "Instagram media container expired - retrying");
      }
      if (Date.now() > deadline) {
        // Container id stays saved: the retry keeps polling the same one.
        throw new SocialPublishError("PROVIDER_ERROR", "Instagram is still processing the image");
      }
      await sleep(POLL_INTERVAL_MS);
    }

    const published = await graph("POST", `/${igUserId}/media_publish`, token, {
      creation_id: containerId,
    });
    if (typeof published.id !== "string") {
      throw new SocialPublishError("PROVIDER_ERROR", "Instagram returned no media id");
    }
    state = await saveState({ igMediaId: published.id });
    return finish(igUserId, token, published.id, state);
  },
};

async function finish(
  _igUserId: string,
  token: string,
  mediaId: string,
  providerState: Record<string, unknown>,
): Promise<PublishResult> {
  // Permalink is cosmetic - never fail a successful publish over it.
  let remoteUrl: string | null = null;
  try {
    const info = await graph("GET", `/${mediaId}`, token, { fields: "permalink" });
    remoteUrl = typeof info.permalink === "string" ? info.permalink : null;
  } catch {
    // leave null
  }
  return { remoteId: mediaId, remoteUrl, providerState };
}
