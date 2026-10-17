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

const REEL_POLL_INTERVAL_MS = 4_000;
const REEL_POLL_MAX_MS = 5 * 60_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function graphJson(res: Response): Promise<Record<string, any>> {
  const json = await readJson(res);
  if (!res.ok) throw graphError(res.status, json);
  return json;
}

/**
 * Page Reel via the 3-phase Reels API: start (returns video_id + upload_url),
 * upload the bytes to that URL, then finish with PUBLISHED. Each irreversible
 * step is saved so a retry resumes (re-uploading only if the bytes never
 * landed) instead of creating a second Reel. Uses the Page permissions the
 * app already requests (pages_manage_posts) - no extra review needed.
 */
async function publishReel(
  pageId: string,
  token: string,
  media: PublishInput["media"],
  message: string | undefined,
  providerState: ProviderState,
  saveState: PublishInput["saveState"],
): Promise<PublishResult> {
  let videoId = typeof providerState.fbReelId === "string" ? providerState.fbReelId : null;
  let uploadUrl = typeof providerState.fbReelUploadUrl === "string" ? providerState.fbReelUploadUrl : null;
  let uploaded = providerState.fbReelUploaded === true;
  let finished = providerState.fbReelFinished === true;

  const post = async (path: string, params: Record<string, string>) => {
    try {
      return await graphJson(
        await socialFetch(`${graphBase()}${path}`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ ...params, access_token: token }).toString(),
        }),
      );
    } catch (err) {
      if (err instanceof SocialPublishError) throw err;
      throw new SocialPublishError("PROVIDER_ERROR", "Could not reach Facebook");
    }
  };

  if (!videoId || !uploadUrl) {
    const started = await post(`/${pageId}/video_reels`, { upload_phase: "start" });
    if (typeof started.video_id !== "string" || typeof started.upload_url !== "string") {
      throw new SocialPublishError("PROVIDER_ERROR", "Facebook returned no Reel upload session");
    }
    videoId = started.video_id;
    uploadUrl = started.upload_url;
    uploaded = false;
    finished = false;
    await saveState({ fbReelId: videoId, fbReelUploadUrl: uploadUrl, fbReelUploaded: false, fbReelFinished: false });
  }

  if (!uploaded) {
    const bytes = await media.video();
    let res: Response;
    try {
      res = await socialFetch(
        uploadUrl,
        {
          method: "POST",
          headers: {
            Authorization: `OAuth ${token}`,
            offset: "0",
            file_size: String(bytes.byteLength),
            "Content-Type": "application/octet-stream",
          },
          body: new Uint8Array(bytes),
        },
        10 * 60_000,
      );
    } catch {
      throw new SocialPublishError("PROVIDER_ERROR", "Facebook Reel upload was interrupted");
    }
    const json = await graphJson(res);
    if (json.success === false) throw new SocialPublishError("PROVIDER_ERROR", "Facebook rejected the Reel upload");
    uploaded = true;
    await saveState({ fbReelUploaded: true });
  }

  if (!finished) {
    const done = await post(`/${pageId}/video_reels`, {
      upload_phase: "finish",
      video_id: videoId,
      video_state: "PUBLISHED",
      ...(message ? { description: message } : {}),
    });
    if (done.success === false) throw new SocialPublishError("PROVIDER_ERROR", "Facebook could not publish the Reel");
    await saveState({ fbReelFinished: true });
  }

  // Facebook processes the video asynchronously; wait for it to go live (or fail).
  const deadline = Date.now() + REEL_POLL_MAX_MS;
  let permalink: string | null = null;
  for (;;) {
    let info: Record<string, any> = {};
    try {
      const url = new URL(`${graphBase()}/${videoId}`);
      url.searchParams.set("fields", "status,permalink_url");
      url.searchParams.set("access_token", token);
      info = await graphJson(await socialFetch(url.toString()));
    } catch (err) {
      if (err instanceof SocialPublishError && err.code !== "PROVIDER_ERROR") throw err;
      // transient read failure - keep polling until the deadline
    }
    const status = (info.status ?? {}) as {
      video_status?: string;
      publishing_phase?: { status?: string };
      processing_phase?: { status?: string };
    };
    if (typeof info.permalink_url === "string") permalink = `https://www.facebook.com${info.permalink_url}`;
    if (status.video_status === "error" || status.publishing_phase?.status === "error" || status.processing_phase?.status === "error") {
      // Session is dead; a retry must start a new one.
      await saveState({ fbReelId: null, fbReelUploadUrl: null, fbReelUploaded: false, fbReelFinished: false });
      throw new SocialPublishError("INVALID_MEDIA", "Facebook could not process this video as a Reel");
    }
    if (status.publishing_phase?.status === "complete" || status.video_status === "ready") break;
    if (Date.now() > deadline) {
      throw new SocialPublishError("PROVIDER_ERROR", "Facebook is still processing the Reel");
    }
    await sleep(REEL_POLL_INTERVAL_MS);
  }
  return { remoteId: videoId, remoteUrl: permalink ?? `https://www.facebook.com/reel/${videoId}` };
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

    if (media.kind === "video") {
      return publishReel(pageId, token, media, message, providerState, saveState);
    }

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
