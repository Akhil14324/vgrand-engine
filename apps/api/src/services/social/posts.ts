import { Prisma, prisma, type SocialAccount, type SocialPost } from "@catgpt/db";
import {
  X_MAX_CHARS,
  type SocialAccountStatus,
  type SocialFailureCode,
  type SocialPlatform,
  type SocialPostContent,
  type SocialPostCreateRequest,
  type SocialPostDto,
  type SocialPostStatus,
} from "@catgpt/types";
import { badRequest, forbidden, HttpError, notFound } from "../../lib/errors.js";
import { enqueueSocialPost } from "../queue.js";
import { findUsableAccount } from "./accounts.js";
import { isRetryableFailure, SocialPublishError } from "./errors.js";

/* --------------------------- content validation --------------------------- */

const cleanTag = (t: string) => t.replace(/^#+/, "").replace(/\s+/g, "").trim();
/** Hashtags can't contain spaces; YouTube tags can (multi-word tags are normal). */
const cleanTags = (tags: string[] | undefined, keepSpaces = false) =>
  [
    ...new Set(
      (tags ?? [])
        .map((t) => (keepSpaces ? t.replace(/^#+/, "").replace(/\s+/g, " ").trim() : cleanTag(t)))
        .filter(Boolean),
    ),
  ];
/** YouTube rejects angle brackets in titles/descriptions/tags. */
const noAngles = (s: string) => s.replace(/[<>]/g, "");

/**
 * The immutable snapshot for one platform: exactly the fields that platform
 * publishes, trimmed and validated. Used at creation AND again by the worker.
 * Violations throw SocialPublishError(INVALID_CONTENT); routes turn that into a 400.
 */
export function normalizeContent(
  platform: SocialPlatform,
  content: SocialPostContent,
): SocialPostContent {
  const invalid = (msg: string) => new SocialPublishError("INVALID_CONTENT", msg);
  const caption = content.caption?.trim() ?? "";

  switch (platform) {
    case "instagram": {
      if (!caption) throw invalid("Instagram needs a caption");
      const hashtags = cleanTags(content.hashtags);
      if (hashtags.length > 30) throw invalid("Instagram allows at most 30 hashtags");
      const total = caption.length + hashtags.reduce((n, h) => n + h.length + 2, 0);
      if (total > 2200) throw invalid("Instagram caption and hashtags exceed 2,200 characters");
      return { caption, hashtags };
    }
    case "facebook": {
      if (!caption) throw invalid("Facebook needs a caption");
      return { caption };
    }
    case "x": {
      if (!caption) throw invalid("X needs post text");
      if (caption.length > X_MAX_CHARS) throw invalid(`X posts are limited to ${X_MAX_CHARS} characters`);
      return { caption };
    }
    case "youtube": {
      const title = noAngles(content.title?.trim() ?? "").trim();
      if (!title) throw invalid("YouTube needs a title");
      if (title.length > 100) throw invalid("YouTube titles are limited to 100 characters");
      const tags = cleanTags(content.tags, true).map(noAngles);
      if (tags.join(",").length > 500) throw invalid("YouTube tags exceed 500 characters in total");
      return { title, description: noAngles(content.description?.trim() ?? ""), tags };
    }
  }
}

/* -------------------------------- lookups --------------------------------- */

/**
 * A generation the caller owns (existing semantics: generations are per-user),
 * finished with an image. The scope (workspace) is read from ITS conversation,
 * never from client input.
 */
export async function loadGenerationForSocial(userId: string, id: string) {
  const generation = await prisma.generation.findUnique({
    where: { id },
    include: {
      theme: { select: { label: true } },
      conversation: { select: { workspaceId: true } },
    },
  });
  if (!generation) throw notFound("Generation not found");
  if (generation.userId !== userId) throw forbidden();
  if (generation.status !== "completed" || generation.imageUrls.length === 0) {
    throw badRequest("Only completed image generations can be posted");
  }
  return generation;
}

/* --------------------------------- DTO ------------------------------------ */

type PostWithAccount = SocialPost & { account: SocialAccount };

export function toSocialPostDto(p: PostWithAccount): SocialPostDto {
  const state = (p.providerState ?? {}) as { visibility?: unknown };
  const accountMeta = (p.account.metadata ?? {}) as { visibility?: unknown };
  const raw = state.visibility ?? accountMeta.visibility;
  return {
    id: p.id,
    generationId: p.generationId,
    accountId: p.accountId,
    platform: p.account.platform as SocialPlatform,
    accountHandle: p.account.handle,
    accountDisplayName: p.account.displayName,
    accountStatus: p.account.status as SocialAccountStatus,
    status: p.status as SocialPostStatus,
    failureCode: (p.failureCode as SocialFailureCode | null) ?? null,
    error: p.error,
    remoteUrl: p.remoteUrl,
    attemptCount: p.attemptCount,
    visibility:
      p.account.platform === "youtube" && (raw === "private" || raw === "public") ? raw : null,
    retryable: p.status === "failed" && isRetryableFailure(p.failureCode),
    postedAt: p.postedAt?.toISOString() ?? null,
    createdAt: p.createdAt.toISOString(),
  };
}

export async function listSocialPosts(userId: string, generationId: string) {
  await loadOwnedGeneration(userId, generationId);
  const rows = await prisma.socialPost.findMany({
    where: { generationId, userId },
    include: { account: true },
    orderBy: { createdAt: "asc" },
  });
  return rows.map(toSocialPostDto);
}

/** Ownership only - listing must keep working after a generation stops being postable. */
async function loadOwnedGeneration(userId: string, id: string) {
  const generation = await prisma.generation.findUnique({
    where: { id },
    select: { userId: true },
  });
  if (!generation) throw notFound("Generation not found");
  if (generation.userId !== userId) throw forbidden();
}

/* -------------------------------- creation -------------------------------- */

export async function createSocialPosts(
  userId: string,
  generationId: string,
  body: SocialPostCreateRequest,
): Promise<SocialPostDto[]> {
  const generation = await loadGenerationForSocial(userId, generationId);
  const scopeWorkspaceId = generation.conversation?.workspaceId ?? null;

  const ids = body.posts.map((p) => p.accountId);
  if (new Set(ids).size !== ids.length) {
    throw badRequest("Each account can only be selected once");
  }

  // Validate EVERYTHING before writing anything: one bad item rejects the request.
  const prepared: { account: SocialAccount; content: SocialPostContent }[] = [];
  for (const item of body.posts) {
    // Membership / ownership check - the client-supplied id is never trusted.
    const account = await findUsableAccount(userId, item.accountId);
    // The account must belong to the generation's scope: the user's own
    // personal account, or a shared account of THIS generation's workspace.
    if (account.workspaceId !== null && account.workspaceId !== scopeWorkspaceId) {
      throw forbidden("This account is not available in this workspace");
    }
    if (account.status === "revoked" || account.status === "reauth_required") {
      throw new HttpError(409, `Reconnect ${account.displayName ?? account.platform} before posting`);
    }
    try {
      prepared.push({
        account,
        content: normalizeContent(account.platform as SocialPlatform, item.content),
      });
    } catch (err) {
      if (err instanceof SocialPublishError) throw badRequest(err.message);
      throw err;
    }
  }

  const inFlight = await prisma.socialPost.findFirst({
    where: { generationId, accountId: { in: ids }, status: { in: ["pending", "posting"] } },
    select: { id: true },
  });
  if (inFlight) throw new HttpError(409, "A post to one of these accounts is already in progress");

  const mediaUrl = generation.imageUrls[0]!; // snapshot - later edits never change what was approved
  const rows = await prisma.$transaction(
    prepared.map(({ account, content }) =>
      prisma.socialPost.create({
        data: {
          userId,
          workspaceId: account.workspaceId,
          generationId,
          accountId: account.id,
          content: content as Prisma.InputJsonValue,
          mediaUrl,
        },
        include: { account: true },
      }),
    ),
  );

  // One independent job per SocialPost. A queue failure marks only that row.
  await Promise.all(
    rows.map((row) =>
      enqueueSocialPost(row.id).catch(async (err) => {
        console.error(`[social] enqueue ${row.id} failed:`, err instanceof Error ? err.message : err);
        await prisma.socialPost.update({
          where: { id: row.id },
          data: { status: "failed", failureCode: "PROVIDER_ERROR", error: "Could not queue the post - retry" },
        });
      }),
    ),
  );
  const fresh = await prisma.socialPost.findMany({
    where: { id: { in: rows.map((r) => r.id) } },
    include: { account: true },
    orderBy: { createdAt: "asc" },
  });
  return fresh.map(toSocialPostDto);
}

/* ---------------------------------- retry --------------------------------- */

/**
 * Re-runs the SAME row: content snapshot and providerState are untouched, so
 * the resumed run reuses containers/uploads instead of duplicating them.
 */
export async function retrySocialPost(userId: string, id: string): Promise<SocialPostDto> {
  const post = await prisma.socialPost.findFirst({ where: { id, userId } });
  if (!post) throw notFound("Post not found");
  // Still allowed to use the account? (membership can change after posting.)
  await findUsableAccount(userId, post.accountId);

  if (post.status !== "failed") throw new HttpError(409, "Only failed posts can be retried");
  if (!isRetryableFailure(post.failureCode)) {
    throw new HttpError(409, "This failure can't be retried - fix the problem and post again");
  }
  const claimed = await prisma.socialPost.updateMany({
    where: { id, status: "failed" },
    data: { status: "pending", failureCode: null, error: null },
  });
  if (claimed.count === 0) throw new HttpError(409, "Post is already being retried");

  await enqueueSocialPost(id, { force: true }).catch(async () => {
    await prisma.socialPost.update({
      where: { id },
      data: { status: "failed", failureCode: post.failureCode, error: "Could not queue the retry" },
    });
    throw new HttpError(503, "Could not queue the retry");
  });
  const fresh = await prisma.socialPost.findUniqueOrThrow({
    where: { id },
    include: { account: true },
  });
  return toSocialPostDto(fresh);
}
