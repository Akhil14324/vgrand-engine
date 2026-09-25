import { Prisma, prisma, type SocialAccount } from "@catgpt/db";
import type {
  SocialAccountDto,
  SocialAccountStatus,
  SocialPlatform,
} from "@catgpt/types";
import { forbidden, notFound } from "../../lib/errors.js";
import { encryptToken } from "../../lib/social-crypto.js";
import { findWorkspaceForUser, workspaceAccess } from "../../lib/workspace-access.js";

/** What an OAuth connect yields for one account, tokens still in plaintext. */
export interface ConnectedAccountInput {
  platform: SocialPlatform;
  externalAccountId: string;
  handle: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  accessToken: string;
  refreshToken?: string | null;
  tokenExpiresAt?: Date | null;
  scopes: string[];
  metadata?: Record<string, unknown>;
}

/**
 * The ONLY place a SocialAccount becomes a client payload. Credential columns
 * (accessTokenEnc, refreshTokenEnc, tokenExpiresAt) are never copied, and
 * metadata is reduced to an allowlist of non-secret hints.
 */
export function toSocialAccountDto(a: SocialAccount): SocialAccountDto {
  const meta = (a.metadata ?? {}) as Record<string, unknown>;
  const visibility =
    meta.visibility === "private" || meta.visibility === "public"
      ? meta.visibility
      : undefined;
  return {
    id: a.id,
    platform: a.platform as SocialPlatform,
    workspaceId: a.workspaceId,
    handle: a.handle,
    displayName: a.displayName,
    avatarUrl: a.avatarUrl,
    status: a.status as SocialAccountStatus,
    metadata: visibility ? { visibility } : null,
  };
}

/**
 * Accounts a user may see and post through in a scope:
 *  - personal scope: only their own personal accounts
 *  - workspace scope: that workspace's shared accounts (membership verified,
 *    non-members get a 404) plus the user's own personal accounts
 */
export async function listVisibleAccounts(
  userId: string,
  workspaceId: string | null,
): Promise<SocialAccount[]> {
  const personal = { userId, workspaceId: null };
  if (workspaceId) await findWorkspaceForUser(userId, workspaceId);
  return prisma.socialAccount.findMany({
    where: workspaceId ? { OR: [personal, { workspaceId }] } : personal,
    orderBy: [{ platform: "asc" }, { createdAt: "asc" }],
  });
}

/**
 * Loads an account ONLY if the caller may use it. Runs before any token is
 * decrypted: personal accounts must be the caller's own, workspace accounts
 * require workspace membership. Everything else is a 404 so ids can't be probed.
 */
export async function findUsableAccount(
  userId: string,
  accountId: string,
): Promise<SocialAccount> {
  const account = await prisma.socialAccount.findFirst({
    where: {
      id: accountId,
      OR: [
        { userId, workspaceId: null },
        { workspace: workspaceAccess(userId) },
      ],
    },
  });
  if (!account) throw notFound("Social account not found");
  return account;
}

/**
 * Disconnect: a personal account by its owner, a workspace account by the
 * workspace owner (this app's only admin role - members have no role column).
 */
export async function deleteAccountAs(userId: string, accountId: string) {
  const account = await prisma.socialAccount.findUnique({ where: { id: accountId } });
  if (!account) throw notFound("Social account not found");
  if (account.workspaceId) {
    // 404 for non-members, 403 for members who are not the owner.
    await findWorkspaceForUser(userId, account.workspaceId, { ownerOnly: true });
  } else if (account.userId !== userId) {
    throw notFound("Social account not found");
  }
  await prisma.socialAccount.delete({ where: { id: account.id } });
}

/** Connecting into a workspace is owner-only, mirroring disconnect. */
export async function assertCanConnect(userId: string, workspaceId: string | null) {
  if (!workspaceId) return;
  const ws = await findWorkspaceForUser(userId, workspaceId);
  if (ws.userId !== userId) {
    throw forbidden("Only the workspace owner can connect shared accounts");
  }
}

/**
 * Create or refresh an account. The schema's compound unique cannot dedupe
 * personal accounts (NULL workspaceId), so this is a find-then-write, backed by
 * the partial unique index from the migration to make a race fail loudly
 * instead of duplicating - on that collision we retry once as an update.
 */
export async function upsertConnectedAccount(
  userId: string,
  workspaceId: string | null,
  input: ConnectedAccountInput,
): Promise<SocialAccount> {
  const key = {
    userId,
    workspaceId,
    platform: input.platform,
    externalAccountId: input.externalAccountId,
  };
  const data = {
    handle: input.handle,
    displayName: input.displayName,
    avatarUrl: input.avatarUrl,
    accessTokenEnc: encryptToken(input.accessToken),
    // Keep the old refresh token when a re-auth doesn't return a new one.
    ...(input.refreshToken ? { refreshTokenEnc: encryptToken(input.refreshToken) } : {}),
    tokenExpiresAt: input.tokenExpiresAt ?? null,
    scopes: input.scopes,
    ...(input.metadata ? { metadata: input.metadata as Prisma.InputJsonValue } : {}),
    status: "active",
  };

  const update = async () => {
    const existing = await prisma.socialAccount.findFirst({ where: key });
    return existing
      ? prisma.socialAccount.update({ where: { id: existing.id }, data })
      : null;
  };

  const updated = await update();
  if (updated) return updated;
  try {
    return await prisma.socialAccount.create({
      data: {
        ...key,
        ...data,
        refreshTokenEnc: input.refreshToken ? encryptToken(input.refreshToken) : null,
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const raced = await update();
      if (raced) return raced;
    }
    throw err;
  }
}
