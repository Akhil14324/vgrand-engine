import { Prisma, prisma } from "@catgpt/db";
import type { SocialFailureCode } from "@catgpt/types";
import { SOCIAL_BACKOFF_MS, SOCIAL_MAX_ATTEMPTS, enqueueSocialPost } from "../queue.js";
import { findUsableAccount } from "./accounts.js";
import { getAdapter, type PreparedMedia, type ProviderState } from "./adapters/index.js";
import { isRetryableFailure, SocialPublishError } from "./errors.js";
import { fetchImage } from "./media/fetch-image.js";
import { ensurePublicMediaUrl } from "./media/public-url.js";
import { imageToYoutubeVideo } from "./media/youtube-video.js";
import { normalizeContent } from "./posts.js";
import { ensureFreshToken } from "./tokens.js";

function buildMedia(imageUrl: string): PreparedMedia {
  let image: ReturnType<typeof fetchImage> | null = null;
  let video: Promise<Buffer> | null = null;
  const loadImage = () => (image ??= fetchImage(imageUrl));
  return {
    imageUrl,
    publicUrl: () => ensurePublicMediaUrl(imageUrl),
    image: loadImage,
    video: () => (video ??= loadImage().then((i) => imageToYoutubeVideo(i.buffer))),
  };
}

const asState = (v: unknown): ProviderState =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as ProviderState) : {};

/**
 * Publishes one SocialPost. Returns "retry" when a retryable failure happened
 * and another attempt is still allowed (the caller backs off), else "done" -
 * the row is then posted or failed. Never logs tokens; only ids/codes.
 *
 * Order matters: authorization is re-checked (findUsableAccount) BEFORE any
 * token is decrypted (ensureFreshToken), so a user removed from a workspace
 * can no longer publish through its accounts even for already-queued posts.
 */
export async function runSocialPost(
  socialPostId: string,
  opts: { finalAttempt?: boolean } = {},
): Promise<"done" | "retry"> {
  const finalAttempt = opts.finalAttempt ?? true;

  // Atomic claim: only a pending (or crashed-mid-flight "posting") row runs.
  // Already posted/failed rows, or a duplicate job, fall through here.
  const claimed = await prisma.socialPost.updateMany({
    where: { id: socialPostId, status: { in: ["pending", "posting"] } },
    data: { status: "posting", attemptCount: { increment: 1 }, lastAttemptAt: new Date() },
  });
  if (claimed.count === 0) return "done";

  const post = await prisma.socialPost.findUnique({ where: { id: socialPostId } });
  if (!post) return "done";
  const attempt = post.attemptCount;
  const platformLabel = { socialPostId, attempt };

  const saveState = async (patch: ProviderState): Promise<ProviderState> => {
    const current = await prisma.socialPost.findUnique({
      where: { id: socialPostId },
      select: { providerState: true },
    });
    const merged = { ...asState(current?.providerState), ...patch };
    await prisma.socialPost.update({
      where: { id: socialPostId },
      data: { providerState: merged as Prisma.InputJsonValue },
    });
    return merged;
  };

  let platform = "unknown";
  try {
    let account;
    try {
      account = await findUsableAccount(post.userId, post.accountId);
    } catch {
      throw new SocialPublishError("AUTH_REVOKED", "You no longer have access to this account");
    }
    platform = account.platform;

    const tokens = await ensureFreshToken(account);
    const content = normalizeContent(account.platform as never, post.content as never);
    const result = await getAdapter(account.platform as never).publish({
      account,
      decryptedTokens: tokens,
      content,
      media: buildMedia(post.mediaUrl),
      providerState: asState(post.providerState),
      saveState,
    });

    const finalState = { ...(await saveState({})), ...(result.providerState ?? {}) };
    await prisma.socialPost.update({
      where: { id: socialPostId },
      data: {
        status: "posted",
        remoteId: result.remoteId,
        remoteUrl: result.remoteUrl,
        providerState: finalState as Prisma.InputJsonValue,
        postedAt: new Date(),
        failureCode: null,
        error: null,
      },
    });
    console.log("[social] posted", { ...platformLabel, platform, remoteId: result.remoteId, remoteUrl: result.remoteUrl });
    return "done";
  } catch (err) {
    const code: SocialFailureCode = err instanceof SocialPublishError ? err.code : "UNKNOWN";
    // Only typed errors carry user-safe text; anything else could hold internals.
    const message = err instanceof SocialPublishError ? err.message : "Unexpected error while posting";

    if (code === "AUTH_EXPIRED" || code === "AUTH_REVOKED") {
      await prisma.socialAccount
        .update({ where: { id: post.accountId }, data: { status: "reauth_required" } })
        .catch(() => {});
    }

    const willRetry = isRetryableFailure(code) && !finalAttempt;
    await prisma.socialPost.update({
      where: { id: socialPostId },
      data: { status: willRetry ? "pending" : "failed", failureCode: code, error: message },
    });
    console.warn("[social] failed", { ...platformLabel, platform, failureCode: code, willRetry });
    return willRetry ? "retry" : "done";
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** No-Redis mode: same attempt count and exponential backoff as the BullMQ job options. */
export async function runSocialPostInline(socialPostId: string): Promise<void> {
  for (let attempt = 1; attempt <= SOCIAL_MAX_ATTEMPTS; attempt++) {
    const outcome = await runSocialPost(socialPostId, {
      finalAttempt: attempt === SOCIAL_MAX_ATTEMPTS,
    });
    if (outcome === "done") return;
    await sleep(SOCIAL_BACKOFF_MS * 2 ** (attempt - 1));
  }
}

const STALE_SOCIAL_MS = 2 * 60_000;

/**
 * Posts left pending/posting by a crashed or redeployed process. Re-enqueues
 * them (forced, so a finished BullMQ job with the same id can't swallow it);
 * providerState makes the resumed run reuse containers/uploads.
 */
export async function recoverSocialPosts(): Promise<void> {
  const stale = await prisma.socialPost.findMany({
    where: {
      status: { in: ["pending", "posting"] },
      updatedAt: { lt: new Date(Date.now() - STALE_SOCIAL_MS) },
    },
    select: { id: true },
    take: 100,
  });
  for (const { id } of stale) {
    await enqueueSocialPost(id, { force: true }).catch((err) =>
      console.error(`[social] recover ${id} failed:`, err instanceof Error ? err.message : err),
    );
  }
}
