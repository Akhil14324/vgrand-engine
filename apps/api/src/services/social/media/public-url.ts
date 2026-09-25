import { isIP } from "node:net";
import { SocialPublishError } from "../errors.js";
import { socialFetch } from "../http.js";

function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    return true;
  }
  const kind = isIP(host);
  if (kind === 4) {
    const [a, b] = host.split(".").map(Number) as [number, number];
    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) // CGNAT
    );
  }
  if (kind === 6) {
    return (
      host === "::1" ||
      host === "::" ||
      host.startsWith("fc") ||
      host.startsWith("fd") ||
      host.startsWith("fe80") ||
      host.startsWith("::ffff:") // v4-mapped: not worth parsing, never a public image host
    );
  }
  // A bare single-label name ("api") only resolves inside a private network.
  return !host.includes(".");
}

/**
 * Instagram fetches the image itself, so the URL must be reachable from the
 * public internet. Rejects non-HTTPS, credentials, and localhost/private
 * targets, then confirms the URL actually serves an image (a HEAD, falling
 * back to a 1-byte ranged GET) so we fail cleanly BEFORE any provider call.
 */
export async function ensurePublicMediaUrl(raw: string): Promise<string> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SocialPublishError("INVALID_MEDIA", "Image URL is not valid");
  }
  if (url.protocol !== "https:") {
    throw new SocialPublishError(
      "INVALID_MEDIA",
      "Instagram needs a public HTTPS image URL - configure Supabase storage or a public API_PUBLIC_URL",
    );
  }
  if (url.username || url.password || isPrivateHost(url.hostname)) {
    throw new SocialPublishError(
      "INVALID_MEDIA",
      "Image URL is local/private, so Instagram cannot fetch it",
    );
  }

  let res: Response;
  try {
    res = await socialFetch(url.toString(), { method: "HEAD" }, 15_000);
    if (res.status === 405 || res.status === 501) {
      res = await socialFetch(url.toString(), { headers: { Range: "bytes=0-0" } }, 15_000);
    }
  } catch {
    throw new SocialPublishError("INVALID_MEDIA", "Image URL is not reachable from the internet");
  }
  if (!res.ok) {
    throw new SocialPublishError(
      "INVALID_MEDIA",
      `Image URL is not publicly accessible (${res.status})`,
    );
  }
  if (!(res.headers.get("content-type") ?? "").toLowerCase().startsWith("image/")) {
    throw new SocialPublishError("INVALID_MEDIA", "Image URL does not serve an image");
  }
  return url.toString();
}
