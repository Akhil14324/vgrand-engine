import { SocialPublishError } from "../errors.js";
import { readJson, socialFetch } from "../http.js";
import { graphBase } from "../oauth/meta.js";
import { graphError } from "./meta-errors.js";
import type { ProviderState, PublishInput, PublishResult, SocialAdapter } from "./types.js";

async function uploadPhoto(
  pageId: string,
  token: string,
  item: PublishInput["media"]["items"][number],
  opts: { message?: string; published: boolean },
): Promise<string> {
  const image = await item.image();
  const body = new FormData();
  body.set("source", new Blob([new Uint8Array(image.buffer)], { type: image.contentType }), "image");
  if (opts.message) body.set("message", opts.message);
  body.set("published", String(opts.published));
  body.set("access_token", token);

  let res: Response;
  try {
    res = await socialFetch(`${graphBase()}/${pageId}/photos`, { method: "POST", body }, 120_000);
  } catch {
    throw new SocialPublishError("PROVIDER_ERROR", "Could not reach Facebook");
  }
  const json = await readJson(res);
  if (!res.ok) throw graphError(res.status, json);
  if (typeof json.id !== "string") throw new SocialPublishError("PROVIDER_ERROR", "Facebook returned no photo id");
  return json.id;
}

/**
 * Multi-photo post: each image is uploaded unpublished (a "staged" photo,
 * `published=false`) to get a photo id, then a single feed post attaches all
 * of them via `attached_media`. A retry reuses whichever photo ids already
 * uploaded instead of re-uploading them.
 */
async function publishCarousel(
  pageId: string,
  token: string,
  items: PublishInput["media"]["items"],
  message: string | undefined,
  providerState: ProviderState,
  saveState: PublishInput["saveState"],
): Promise<{ postId: string }> {
  const photoIds: (string | null)[] = Array.isArray(providerState.fbPhotoIds)
    ? [...(providerState.fbPhotoIds as (string | null)[])]
    : new Array(items.length).fill(null);

  for (let i = 0; i < items.length; i++) {
    if (photoIds[i]) continue; // reused from a previous attempt
    photoIds[i] = await uploadPhoto(pageId, token, items[i]!, { published: false });
    await saveState({ fbPhotoIds: photoIds });
  }

  if (typeof providerState.fbPostId === "string") {
    return { postId: providerState.fbPostId };
  }

  const params: Record<string, string> = { access_token: token };
  if (message) params.message = message;
  photoIds.forEach((id, i) => {
    params[`attached_media[${i}]`] = JSON.stringify({ media_fbid: id });
  });

  let res: Response;
  try {
    res = await socialFetch(`${graphBase()}/${pageId}/feed`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params).toString(),
    });
  } catch {
    throw new SocialPublishError("PROVIDER_ERROR", "Could not reach Facebook");
  }
  const json = await readJson(res);
  if (!res.ok) throw graphError(res.status, json);
  if (typeof json.id !== "string") throw new SocialPublishError("PROVIDER_ERROR", "Facebook returned no post id");
  await saveState({ fbPostId: json.id });
  return { postId: json.id };
}

/**
 * Page photo/feed publish. A single image is a plain photo post
 * (`POST /{page-id}/photos`); 2+ images become a multi-photo post (see
 * publishCarousel). Facebook offers no idempotency key, so the result is
 * persisted immediately by the worker; a crash in the instant between
 * Facebook accepting the post and that write is the one unavoidable
 * duplicate window.
 */
export const facebookAdapter: SocialAdapter = {
  platform: "facebook",
  async publish({ account, decryptedTokens, content, media, providerState, saveState }: PublishInput): Promise<PublishResult> {
    const pageId = account.externalAccountId;
    const token = decryptedTokens.accessToken;
    const message = content.caption?.trim() || undefined;

    if (media.items.length > 1) {
      const { postId } = await publishCarousel(pageId, token, media.items, message, providerState, saveState);
      return { remoteId: postId, remoteUrl: `https://www.facebook.com/${postId}` };
    }

    const image = await media.image();
    const body = new FormData();
    body.set("source", new Blob([new Uint8Array(image.buffer)], { type: image.contentType }), "image");
    if (message) body.set("message", message);
    body.set("access_token", token);

    let res: Response;
    try {
      res = await socialFetch(`${graphBase()}/${pageId}/photos`, { method: "POST", body }, 120_000);
    } catch {
      throw new SocialPublishError("PROVIDER_ERROR", "Could not reach Facebook");
    }
    const json = await readJson(res);
    if (!res.ok) throw graphError(res.status, json);

    const photoId = typeof json.id === "string" ? json.id : null;
    const postId = typeof json.post_id === "string" ? json.post_id : null;
    const remoteId = postId ?? photoId;
    if (!remoteId) throw new SocialPublishError("PROVIDER_ERROR", "Facebook returned no post id");
    return {
      remoteId,
      remoteUrl: postId
        ? `https://www.facebook.com/${postId}`
        : `https://www.facebook.com/photo?fbid=${photoId}`,
    };
  },
};
