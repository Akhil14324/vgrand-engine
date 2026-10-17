import { isTrustedImageUrl } from "../../../lib/urls.js";
import { SocialPublishError } from "../errors.js";
import { socialFetch } from "../http.js";
import { looksLikeMp4 } from "./video.js";

export const MAX_VIDEO_BYTES = 300 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 5 * 60_000;

/** Downloads a stored library video. Same SSRF rule as images: only our own storage. */
export async function fetchVideo(url: string): Promise<Buffer> {
  if (!isTrustedImageUrl(url)) {
    throw new SocialPublishError("INVALID_MEDIA", "Video is not stored on this app's storage");
  }
  let res: Response;
  try {
    res = await socialFetch(url, {}, FETCH_TIMEOUT_MS);
  } catch {
    throw new SocialPublishError("PROVIDER_ERROR", "Could not download the video in time");
  }
  if (!res.ok) {
    throw new SocialPublishError(
      res.status >= 500 ? "PROVIDER_ERROR" : "INVALID_MEDIA",
      `Video download failed (${res.status})`,
    );
  }
  if (Number(res.headers.get("content-length") ?? 0) > MAX_VIDEO_BYTES) {
    throw new SocialPublishError("INVALID_MEDIA", "Video is too large to publish");
  }
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    const reader = res.body?.getReader();
    if (!reader) throw new Error("no body");
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_VIDEO_BYTES) {
        await reader.cancel().catch(() => {});
        throw new SocialPublishError("INVALID_MEDIA", "Video is too large to publish");
      }
      chunks.push(Buffer.from(value));
    }
  } catch (err) {
    if (err instanceof SocialPublishError) throw err;
    throw new SocialPublishError("PROVIDER_ERROR", "Video download was interrupted");
  }
  const buffer = Buffer.concat(chunks);
  if (!looksLikeMp4(buffer)) throw new SocialPublishError("INVALID_MEDIA", "File is not a valid MP4/MOV video");
  return buffer;
}
