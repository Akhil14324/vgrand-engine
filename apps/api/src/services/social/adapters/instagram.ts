import { SocialPublishError } from "../errors.js";
import { form, readJson, socialFetch } from "../http.js";
import { graphBase } from "../oauth/meta.js";
import { graphError } from "./meta-errors.js";
import type { ProviderState, PublishInput, PublishResult, SocialAdapter } from "./types.js";

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
 * Waits for a media container to leave IN_PROGRESS. `onFail` clears whatever
 * saved state points at this container on ERROR/EXPIRED, so a retry recreates
 * only the broken container instead of the whole post.
 */
async function waitUntilFinished(containerId: string, token: string, onFail: () => Promise<unknown>): Promise<void> {
  const deadline = Date.now() + POLL_MAX_MS;
  for (;;) {
    const status = await graph("GET", `/${containerId}`, token, { fields: "status_code" });
    const code = status.status_code as string | undefined;
    if (code === "FINISHED") return;
    if (code === "ERROR") {
      await onFail();
      throw new SocialPublishError("INVALID_MEDIA", "Instagram could not process the image");
    }
    if (code === "EXPIRED") {
      // Containers expire after ~24h; a retry must start fresh.
      await onFail();
      throw new SocialPublishError("PROVIDER_ERROR", "Instagram media container expired - retrying");
    }
    if (Date.now() > deadline) {
      // Container id stays saved: the retry keeps polling the same one.
      throw new SocialPublishError("PROVIDER_ERROR", "Instagram is still processing the image");
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

/**
 * Content Publishing API: create container(s) -> poll until FINISHED ->
 * media_publish. A single image is a normal container; 2+ images become a
 * carousel (each image becomes an unpublishable "carousel item" container,
 * then a parent CAROUSEL container references all of them and carries the
 * caption). A retry reuses whatever containers were already saved instead of
 * recreating them.
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
      containerId =
        media.items.length > 1
          ? await createCarouselContainer(igUserId, token, media.items, content, providerState, saveState)
          : await createSingleContainer(igUserId, token, media.items[0]!, content);
      state = await saveState({ igContainerId: containerId });
    }

    await waitUntilFinished(containerId, token, () => saveState({ igContainerId: null }));

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

async function createSingleContainer(
  igUserId: string,
  token: string,
  item: PublishInput["media"]["items"][number],
  content: PublishInput["content"],
): Promise<string> {
  // Reject local/private/non-HTTPS URLs BEFORE calling Instagram.
  const imageUrl = await item.publicUrl();
  const created = await graph("POST", `/${igUserId}/media`, token, {
    image_url: imageUrl,
    caption: composeCaption(content),
  });
  if (typeof created.id !== "string") {
    throw new SocialPublishError("PROVIDER_ERROR", "Instagram returned no container id");
  }
  return created.id;
}

/** Item containers carry no caption - only the parent CAROUSEL container does. */
async function createCarouselContainer(
  igUserId: string,
  token: string,
  items: PublishInput["media"]["items"],
  content: PublishInput["content"],
  providerState: ProviderState,
  saveState: PublishInput["saveState"],
): Promise<string> {
  const itemIds: (string | null)[] = Array.isArray(providerState.igItemContainerIds)
    ? [...(providerState.igItemContainerIds as (string | null)[])]
    : new Array(items.length).fill(null);

  for (let i = 0; i < items.length; i++) {
    if (itemIds[i]) continue; // reused from a previous attempt
    const imageUrl = await items[i]!.publicUrl();
    const created = await graph("POST", `/${igUserId}/media`, token, {
      image_url: imageUrl,
      is_carousel_item: "true",
    });
    if (typeof created.id !== "string") {
      throw new SocialPublishError("PROVIDER_ERROR", "Instagram returned no container id");
    }
    itemIds[i] = created.id;
    await saveState({ igItemContainerIds: itemIds });
  }
  for (let i = 0; i < itemIds.length; i++) {
    await waitUntilFinished(itemIds[i]!, token, () => {
      itemIds[i] = null;
      return saveState({ igItemContainerIds: itemIds });
    });
  }

  const parent = await graph("POST", `/${igUserId}/media`, token, {
    media_type: "CAROUSEL",
    children: itemIds.join(","),
    caption: composeCaption(content),
  });
  if (typeof parent.id !== "string") {
    throw new SocialPublishError("PROVIDER_ERROR", "Instagram returned no carousel container id");
  }
  return parent.id;
}

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
