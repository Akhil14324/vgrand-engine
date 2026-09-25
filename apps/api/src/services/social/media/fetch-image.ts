import { isTrustedImageUrl } from "../../../lib/urls.js";
import { SocialPublishError } from "../errors.js";
import { socialFetch } from "../http.js";

export const MAX_IMAGE_BYTES = 50 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 30_000;

export interface FetchedImage {
  buffer: Buffer;
  contentType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
}

/** Sniff the real format from magic bytes - a Content-Type header is not proof. */
function sniff(buf: Buffer): FetchedImage["contentType"] | null {
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length > 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") {
    return "image/webp";
  }
  if (buf.length > 6 && buf.toString("ascii", 0, 3) === "GIF") return "image/gif";
  return null;
}

/**
 * Downloads a generated image: 30s timeout, 50 MB cap (enforced while
 * streaming, not just from Content-Length), format verified from the bytes.
 * Only our own storage URLs are fetched - the URL is a stored snapshot, but
 * this stays SSRF-safe even if a row were ever tampered with.
 */
export async function fetchImage(url: string): Promise<FetchedImage> {
  if (!isTrustedImageUrl(url)) {
    throw new SocialPublishError("INVALID_MEDIA", "Image is not stored on this app's storage");
  }
  let res: Response;
  try {
    res = await socialFetch(url, {}, FETCH_TIMEOUT_MS);
  } catch {
    // Timeouts and connection failures are worth retrying.
    throw new SocialPublishError("PROVIDER_ERROR", "Could not download the image in time");
  }
  if (!res.ok) {
    throw new SocialPublishError(
      res.status >= 500 ? "PROVIDER_ERROR" : "INVALID_MEDIA",
      `Image download failed (${res.status})`,
    );
  }
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > MAX_IMAGE_BYTES) {
    throw new SocialPublishError("INVALID_MEDIA", "Image exceeds the 50 MB limit");
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
      if (total > MAX_IMAGE_BYTES) {
        await reader.cancel().catch(() => {});
        throw new SocialPublishError("INVALID_MEDIA", "Image exceeds the 50 MB limit");
      }
      chunks.push(Buffer.from(value));
    }
  } catch (err) {
    if (err instanceof SocialPublishError) throw err;
    throw new SocialPublishError("PROVIDER_ERROR", "Image download was interrupted");
  }

  const buffer = Buffer.concat(chunks);
  const contentType = sniff(buffer);
  if (!contentType) {
    throw new SocialPublishError("INVALID_MEDIA", "File is not a supported image (PNG, JPEG, WebP or GIF)");
  }
  return { buffer, contentType };
}
