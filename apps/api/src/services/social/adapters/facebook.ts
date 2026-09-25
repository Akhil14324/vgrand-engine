import { SocialPublishError } from "../errors.js";
import { readJson, socialFetch } from "../http.js";
import { graphBase } from "../oauth/meta.js";
import { graphError } from "./meta-errors.js";
import type { PublishInput, PublishResult, SocialAdapter } from "./types.js";

/**
 * Page photo publish: multipart POST /{page-id}/photos with the image bytes as
 * `source` and the caption as `message`, using the stored Page token.
 * Facebook offers no idempotency key, so the result is persisted immediately by
 * the worker; a crash in the instant between Facebook accepting the photo and
 * that write is the one unavoidable duplicate window.
 */
export const facebookAdapter: SocialAdapter = {
  platform: "facebook",
  async publish({ account, decryptedTokens, content, media }: PublishInput): Promise<PublishResult> {
    const pageId = account.externalAccountId;
    const image = await media.image();

    const body = new FormData();
    body.set("source", new Blob([new Uint8Array(image.buffer)], { type: image.contentType }), "image");
    if (content.caption?.trim()) body.set("message", content.caption.trim());
    body.set("access_token", decryptedTokens.accessToken);

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
