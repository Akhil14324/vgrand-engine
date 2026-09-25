import { X_MAX_CHARS } from "@catgpt/types";
import { briefProviderMessage, SocialPublishError } from "../errors.js";
import { readJson, socialFetch } from "../http.js";
import type { PublishInput, PublishResult, SocialAdapter } from "./types.js";

/** X's documented image upload ceiling. UNVERIFIED against a live account. */
const X_MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const V2_UPLOAD = "https://api.x.com/2/media/upload";
/** Legacy endpoint - used ONLY when the v2 upload endpoint is reported gone (404/410). */
const LEGACY_UPLOAD = "https://upload.twitter.com/1.1/media/upload.json";

function xError(status: number, json: Record<string, any>): SocialPublishError {
  const detail = briefProviderMessage(json.detail ?? json.title ?? json.error, `X request failed (${status})`);
  if (status === 401) return new SocialPublishError("AUTH_EXPIRED", "X authorization is no longer valid - reconnect this account");
  if (status === 429) return new SocialPublishError("RATE_LIMITED", "X rate limit reached - try again later");
  if (status === 403 && /duplicate/i.test(detail)) return new SocialPublishError("INVALID_CONTENT", "X rejected this as a duplicate post");
  if (status === 400) return new SocialPublishError("INVALID_CONTENT", detail);
  return new SocialPublishError("PROVIDER_ERROR", detail);
}

async function upload(
  url: string,
  token: string,
  image: { buffer: Buffer; contentType: string },
  legacy: boolean,
): Promise<Response> {
  const body = new FormData();
  body.set("media", new Blob([new Uint8Array(image.buffer)], { type: image.contentType }), "image");
  if (!legacy) {
    body.set("media_category", "tweet_image");
    body.set("media_type", image.contentType);
  }
  try {
    return await socialFetch(url, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body }, 120_000);
  } catch {
    throw new SocialPublishError("PROVIDER_ERROR", "Could not reach X");
  }
}

async function uploadMedia(token: string, image: { buffer: Buffer; contentType: string }): Promise<string> {
  let res = await upload(V2_UPLOAD, token, image, false);
  let json = await readJson(res);
  if (res.status === 404 || res.status === 410) {
    // Primary endpoint explicitly gone - the only case that warrants the legacy path.
    res = await upload(LEGACY_UPLOAD, token, image, true);
    json = await readJson(res);
    if (!res.ok) throw xError(res.status, json);
    if (typeof json.media_id_string !== "string") {
      throw new SocialPublishError("PROVIDER_ERROR", "X returned no media id");
    }
    return json.media_id_string;
  }
  if (!res.ok) throw xError(res.status, json);
  const id = json.data?.id ?? json.id;
  if (typeof id !== "string") throw new SocialPublishError("PROVIDER_ERROR", "X returned no media id");
  return id;
}

export const xAdapter: SocialAdapter = {
  platform: "x",
  async publish({ account, decryptedTokens, content, media, providerState, saveState }: PublishInput): Promise<PublishResult> {
    const text = content.caption?.trim() ?? "";
    if (!text) throw new SocialPublishError("INVALID_CONTENT", "Post text is empty");
    if (text.length > X_MAX_CHARS) {
      throw new SocialPublishError("INVALID_CONTENT", `Post is longer than ${X_MAX_CHARS} characters`);
    }
    const token = decryptedTokens.accessToken;

    let mediaId = typeof providerState.xMediaId === "string" ? providerState.xMediaId : null;
    if (!mediaId) {
      const image = await media.image();
      if (image.buffer.byteLength > X_MAX_IMAGE_BYTES) {
        throw new SocialPublishError("INVALID_MEDIA", "Image is larger than X's 5 MB limit");
      }
      mediaId = await uploadMedia(token, image);
      await saveState({ xMediaId: mediaId });
    }

    let res: Response;
    try {
      res = await socialFetch("https://api.x.com/2/tweets", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ text, media: { media_ids: [mediaId] } }),
      });
    } catch {
      throw new SocialPublishError("PROVIDER_ERROR", "Could not reach X");
    }
    const json = await readJson(res);
    if (!res.ok) throw xError(res.status, json);
    const id = json.data?.id;
    if (typeof id !== "string") throw new SocialPublishError("PROVIDER_ERROR", "X returned no post id");

    const meta = (account.metadata ?? {}) as { username?: string };
    const username = meta.username ?? account.handle?.replace(/^@/, "");
    return {
      remoteId: id,
      remoteUrl: username ? `https://x.com/${username}/status/${id}` : `https://x.com/i/web/status/${id}`,
    };
  },
};
