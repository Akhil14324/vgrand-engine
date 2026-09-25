import { env } from "../../../env.js";
import { briefProviderMessage, SocialPublishError } from "../errors.js";
import { readJson, socialFetch } from "../http.js";
import type { PublishInput, PublishResult, SocialAdapter } from "./types.js";

const INIT_URL =
  "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status";
const UPLOAD_TIMEOUT_MS = 5 * 60_000;

function googleError(status: number, json: Record<string, any>): SocialPublishError {
  const e = (json.error ?? {}) as { message?: string; errors?: { reason?: string }[] };
  const reason = e.errors?.[0]?.reason ?? "";
  const msg = briefProviderMessage(e.message, `YouTube request failed (${status})`);
  if (status === 401) return new SocialPublishError("AUTH_EXPIRED", "Google authorization is no longer valid - reconnect this account");
  if (status === 429 || reason === "quotaExceeded" || reason === "uploadLimitExceeded" || reason === "rateLimitExceeded") {
    return new SocialPublishError("RATE_LIMITED", "YouTube quota reached - try again later");
  }
  if (status === 400) return new SocialPublishError("INVALID_CONTENT", msg);
  return new SocialPublishError("PROVIDER_ERROR", msg);
}

type Outcome =
  | { kind: "done"; videoId: string }
  | { kind: "resume"; offset: number }
  | { kind: "dead" };

/** Asks the resumable session how much it already has (or whether it finished). */
async function probeSession(uri: string, token: string, size: number): Promise<Outcome> {
  let res: Response;
  try {
    res = await socialFetch(
      uri,
      {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Length": "0", "Content-Range": `bytes */${size}` },
      },
      30_000,
    );
  } catch {
    throw new SocialPublishError("PROVIDER_ERROR", "Could not reach YouTube");
  }
  if (res.status === 200 || res.status === 201) {
    const json = await readJson(res);
    if (typeof json.id === "string") return { kind: "done", videoId: json.id };
    return { kind: "dead" };
  }
  if (res.status === 308) {
    const range = res.headers.get("range"); // "bytes=0-12345" once some bytes landed
    const m = range ? /bytes=0-(\d+)/.exec(range) : null;
    return { kind: "resume", offset: m ? Number(m[1]) + 1 : 0 };
  }
  if (res.status === 404 || res.status === 410) return { kind: "dead" };
  throw googleError(res.status, await readJson(res));
}

export const youtubeAdapter: SocialAdapter = {
  platform: "youtube",
  async publish({ account, decryptedTokens, content, media, providerState, saveState }: PublishInput): Promise<PublishResult> {
    const token = decryptedTokens.accessToken;
    const title = content.title?.trim();
    if (!title) throw new SocialPublishError("INVALID_CONTENT", "Video title is empty");
    const meta = (account.metadata ?? {}) as { visibility?: string };
    const privacyStatus = (meta.visibility ?? env.YOUTUBE_VISIBILITY) === "public" ? "public" : "private";
    const visibilityState = { visibility: privacyStatus };

    let uri = typeof providerState.ytUploadUri === "string" ? providerState.ytUploadUri : null;
    const storedSize = typeof providerState.ytUploadSize === "number" ? providerState.ytUploadSize : 0;
    let offset = 0;
    let video: Buffer | null = null;

    if (uri) {
      // Reuse the persisted session where valid; it may already be complete.
      const probe = await probeSession(uri, token, storedSize);
      if (probe.kind === "done") {
        return finish(probe.videoId, visibilityState);
      }
      if (probe.kind === "resume") {
        video = await media.video();
        // Re-encoding can differ in size; a resume only makes sense for identical bytes.
        if (video.byteLength === storedSize) offset = probe.offset;
        else uri = null;
      } else {
        uri = null;
      }
    }

    if (!uri) {
      video ??= await media.video();
      let init: Response;
      try {
        init = await socialFetch(INIT_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json; charset=UTF-8",
            "X-Upload-Content-Length": String(video.byteLength),
            "X-Upload-Content-Type": "video/mp4",
          },
          body: JSON.stringify({
            snippet: {
              title,
              description: content.description ?? "",
              tags: content.tags ?? [],
              categoryId: "22",
            },
            status: { privacyStatus, selfDeclaredMadeForKids: false },
          }),
        });
      } catch {
        throw new SocialPublishError("PROVIDER_ERROR", "Could not reach YouTube");
      }
      if (!init.ok) throw googleError(init.status, await readJson(init));
      const location = init.headers.get("location");
      if (!location) throw new SocialPublishError("PROVIDER_ERROR", "YouTube returned no upload session");
      uri = location;
      offset = 0;
      // Persist BEFORE sending bytes so a crash resumes this session.
      await saveState({ ytUploadUri: uri, ytUploadSize: video.byteLength, ...visibilityState });
    }

    const total = video!.byteLength;
    let res: Response;
    try {
      res = await socialFetch(
        uri,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "video/mp4",
            "Content-Length": String(total - offset),
            ...(offset > 0 ? { "Content-Range": `bytes ${offset}-${total - 1}/${total}` } : {}),
          },
          body: new Uint8Array(video!.subarray(offset)),
        },
        UPLOAD_TIMEOUT_MS,
      );
    } catch {
      // Session URI is saved; the retry probes it and resumes.
      throw new SocialPublishError("PROVIDER_ERROR", "YouTube upload was interrupted");
    }
    if (res.status === 200 || res.status === 201) {
      const json = await readJson(res);
      if (typeof json.id === "string") return finish(json.id, visibilityState);
      throw new SocialPublishError("PROVIDER_ERROR", "YouTube returned no video id");
    }
    if (res.status === 308) throw new SocialPublishError("PROVIDER_ERROR", "YouTube upload incomplete - retrying");
    throw googleError(res.status, await readJson(res));
  },
};

function finish(videoId: string, providerState: Record<string, unknown>): PublishResult {
  return { remoteId: videoId, remoteUrl: `https://www.youtube.com/watch?v=${videoId}`, providerState };
}
