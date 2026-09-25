import { randomBytes } from "node:crypto";
import type IORedis from "ioredis";
import { prisma } from "@catgpt/db";
import type { SocialConnector } from "@catgpt/types";
import { env } from "../../env.js";
import { decryptToken, encryptToken, sha256 } from "../../lib/social-crypto.js";
import { createRedisConnection } from "../queue.js";

/**
 * Opaque, single-use OAuth state. The raw state only ever travels to the
 * provider and back; storage keeps sha256(state). Redis (with TTL) when
 * configured, otherwise the SocialOAuthSession table.
 */
export const OAUTH_STATE_TTL_SECONDS = 10 * 60;

export interface OAuthSessionData {
  userId: string;
  workspaceId: string | null;
  platform: SocialConnector;
  /** PKCE verifier (X only), decrypted. */
  codeVerifier: string | null;
}

export type OAuthStateFailure =
  | "invalid_state"
  | "expired"
  | "consumed"
  | "platform_mismatch";

export class OAuthStateError extends Error {
  constructor(public reason: OAuthStateFailure) {
    super(`OAuth state rejected: ${reason}`);
    this.name = "OAuthStateError";
  }
}

let redis: IORedis | null = null;
const getRedis = () => (redis ??= createRedisConnection());
const redisKey = (hash: string) => `social:oauth:state:${hash}`;

interface StoredSession {
  userId: string;
  workspaceId: string | null;
  platform: SocialConnector;
  codeVerifierEnc: string | null;
}

/** Returns the raw state to hand to the provider. */
export async function createOAuthSession(input: {
  userId: string;
  workspaceId: string | null;
  platform: SocialConnector;
  codeVerifier?: string;
}): Promise<string> {
  const state = randomBytes(32).toString("base64url");
  const stateHash = sha256(state);
  const codeVerifierEnc = input.codeVerifier ? encryptToken(input.codeVerifier) : null;

  if (env.redisConfigured) {
    const stored: StoredSession = {
      userId: input.userId,
      workspaceId: input.workspaceId,
      platform: input.platform,
      codeVerifierEnc,
    };
    await getRedis().set(
      redisKey(stateHash),
      JSON.stringify(stored),
      "EX",
      OAUTH_STATE_TTL_SECONDS,
    );
    return state;
  }

  // Housekeeping: expired handshakes are dead weight (bounded, best effort).
  void prisma.socialOAuthSession
    .deleteMany({ where: { expiresAt: { lt: new Date() } } })
    .catch(() => {});
  await prisma.socialOAuthSession.create({
    data: {
      stateHash,
      userId: input.userId,
      workspaceId: input.workspaceId,
      platform: input.platform,
      codeVerifierEnc,
      expiresAt: new Date(Date.now() + OAUTH_STATE_TTL_SECONDS * 1000),
    },
  });
  return state;
}

/**
 * Validates and CONSUMES the state in one atomic step, so it is already burned
 * before the caller exchanges the authorization code. A replay, an expired
 * state, or a callback on the wrong platform all throw OAuthStateError.
 */
export async function consumeOAuthSession(
  rawState: string,
  platform: SocialConnector,
): Promise<OAuthSessionData> {
  if (!rawState || rawState.length > 256) throw new OAuthStateError("invalid_state");
  const stateHash = sha256(rawState);

  let stored: StoredSession;
  if (env.redisConfigured) {
    // GETDEL is atomic: only one callback can ever receive the value.
    const raw = await getRedis().getdel(redisKey(stateHash));
    if (!raw) throw new OAuthStateError("invalid_state"); // unknown, expired or replayed
    stored = JSON.parse(raw) as StoredSession;
  } else {
    // Atomic claim: only the request that flips consumedAt from null proceeds.
    const claimed = await prisma.socialOAuthSession.updateMany({
      where: { stateHash, consumedAt: null, expiresAt: { gt: new Date() } },
      data: { consumedAt: new Date() },
    });
    const row = await prisma.socialOAuthSession.findUnique({ where: { stateHash } });
    if (!row) throw new OAuthStateError("invalid_state");
    if (claimed.count !== 1) {
      throw new OAuthStateError(row.consumedAt ? "consumed" : "expired");
    }
    stored = {
      userId: row.userId,
      workspaceId: row.workspaceId,
      platform: row.platform as SocialConnector,
      codeVerifierEnc: row.codeVerifierEnc,
    };
  }

  if (stored.platform !== platform) throw new OAuthStateError("platform_mismatch");
  return {
    userId: stored.userId,
    workspaceId: stored.workspaceId,
    platform: stored.platform,
    codeVerifier: stored.codeVerifierEnc ? decryptToken(stored.codeVerifierEnc) : null,
  };
}
