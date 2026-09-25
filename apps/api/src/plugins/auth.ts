import fp from "fastify-plugin";
import type { FastifyReply, FastifyRequest } from "fastify";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  createRemoteJWKSet,
  decodeJwt,
  decodeProtectedHeader,
  jwtVerify,
} from "jose";
import { prisma } from "@catgpt/db";
import { env } from "../env.js";
import { unauthorized } from "../lib/errors.js";

declare module "fastify" {
  interface FastifyRequest {
    userId: string;
  }
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

let supabaseAuth: SupabaseClient | null = null;
function getSupabase(): SupabaseClient | null {
  if (!env.supabaseConfigured) return null;
  try {
    supabaseAuth ??= createClient(
      env.SUPABASE_URL!,
      env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
  } catch (err) {
    // A malformed SUPABASE_URL/key must not turn every request into a 500.
    console.error("[auth] Supabase client init failed:", err);
    return null;
  }
  return supabaseAuth;
}

const SSE_PATH = /^\/generations\/[^/]+\/events$/;

function extractToken(req: FastifyRequest): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) return header.slice(7);
  // EventSource can't set headers, so the SSE stream sends the token as a query
  // param. Nowhere else: URLs end up in logs and browser history.
  if (!SSE_PATH.test(req.url.split("?")[0]!)) return null;
  const q = (req.query as Record<string, unknown> | undefined)?.token;
  return typeof q === "string" && q ? q : null;
}

async function upsertUser(
  id: string,
  email: string | undefined,
  name?: string | null,
  avatarUrl?: string | null,
): Promise<string> {
  const user = await prisma.user.upsert({
    where: { id },
    create: { id, email: email ?? `${id}@unknown.local`, name, avatarUrl },
    update: { email, name, avatarUrl },
  });
  return user.id;
}

/**
 * The User row only exists so profile fields stay fresh — req.userId comes
 * from the JWT itself, so a write per request is wasted work. Upsert once per
 * userId per process lifetime, fire-and-forget off the request path.
 */
const syncedUsers = new Set<string>();
function syncUser(
  id: string,
  email: string | undefined,
  name?: string | null,
  avatarUrl?: string | null,
): void {
  if (syncedUsers.has(id)) return;
  syncedUsers.add(id);
  void upsertUser(id, email, name, avatarUrl).catch((err) =>
    console.error(`[auth] user ${id} profile sync failed:`, err),
  );
}

/**
 * Tokens Supabase already vouched for. Asking auth.getUser on every request
 * costs ~1.5s of network round-trip per API call (measured on prod), so a
 * verified token is trusted for a few minutes - never past its own expiry.
 * Trade-off: a token revoked at Supabase stays usable here for up to TTL.
 */
const TOKEN_CACHE_TTL_MS = 5 * 60_000;
const TOKEN_CACHE_MAX = 5000;
const verifiedTokens = new Map<string, { userId: string; until: number }>();

function rememberToken(token: string, userId: string) {
  let until = Date.now() + TOKEN_CACHE_TTL_MS;
  try {
    const exp = decodeJwt(token).exp;
    if (exp) until = Math.min(until, exp * 1000);
  } catch {
    return; // not a decodable JWT - do not cache
  }
  if (verifiedTokens.size >= TOKEN_CACHE_MAX) {
    const now = Date.now();
    for (const [t, v] of verifiedTokens) if (v.until <= now) verifiedTokens.delete(t);
    // Still full: evict the oldest ~10% rather than wiping the whole map —
    // a full clear forces every in-flight user through JWKS again at once.
    // Map iterates in insertion order, so the first keys are the oldest.
    if (verifiedTokens.size >= TOKEN_CACHE_MAX) {
      let toDrop = Math.ceil(TOKEN_CACHE_MAX / 10);
      for (const t of verifiedTokens.keys()) {
        if (toDrop-- <= 0) break;
        verifiedTokens.delete(t);
      }
    }
  }
  verifiedTokens.set(token, { userId, until });
}

let jwtSecret: Uint8Array | null = null;
let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
/**
 * In-process verification of a Supabase access token — no round-trip to
 * Supabase's auth service per request. Projects on the newer asymmetric
 * signing keys (ES256/RS256) verify against the project's public JWKS, which
 * jose fetches once and caches; legacy HS256 projects use the JWT secret.
 */
async function verifySupabaseJwt(token: string) {
  const { alg } = decodeProtectedHeader(token);
  // Supabase user sessions carry aud "authenticated"; other project tokens
  // (anon, service role) must not pass as users.
  const audience = "authenticated";
  if (alg === "HS256") {
    if (!env.SUPABASE_JWT_SECRET) throw new Error("no JWT secret configured");
    jwtSecret ??= new TextEncoder().encode(env.SUPABASE_JWT_SECRET);
    return (await jwtVerify(token, jwtSecret, { audience, algorithms: ["HS256"] }))
      .payload;
  }
  jwks ??= createRemoteJWKSet(
    new URL("/auth/v1/.well-known/jwks.json", env.SUPABASE_URL!),
  );
  return (await jwtVerify(token, jwks, { audience, algorithms: ["ES256", "RS256"] }))
    .payload;
}

/** Local verification is possible whenever Supabase is configured (JWKS or secret). */
const canVerifyLocally = () => Boolean(env.SUPABASE_URL);

/**
 * Rate-limit bucket for a request. The limiter runs in onRequest, before any
 * route's authenticate preHandler has set req.userId, so it resolves the user
 * itself — from the verified-token cache or a local signature check, never a
 * network call and never an unverified claim (a forged token can't pick its
 * own bucket). Anything unverifiable shares its IP's bucket.
 */
export async function rateLimitKey(req: FastifyRequest): Promise<string> {
  const token = extractToken(req);
  if (token) {
    const hit = verifiedTokens.get(token);
    if (hit && hit.until > Date.now()) return `u:${hit.userId}`;
    if (canVerifyLocally()) {
      const claims = await verifySupabaseJwt(token).catch(() => null);
      if (claims?.sub) return `u:${claims.sub}`;
    }
  }
  return `ip:${req.ip}`;
}

/**
 * Auth strategy:
 *  - Supabase configured -> verify the Bearer JWT locally (JWKS for asymmetric
 *    keys, SUPABASE_JWT_SECRET for HS256); if that fails we fall back to
 *    supabase.auth.getUser (one HTTP call).
 */
export const authPlugin = fp(async (app) => {
  app.decorateRequest("userId", "");

  app.decorate("authenticate", async (req: FastifyRequest) => {
    const token = extractToken(req);
    const supabase = getSupabase();

    if (supabase && token) {
      const hit = verifiedTokens.get(token);
      if (hit && hit.until > Date.now()) {
        req.userId = hit.userId;
        return;
      }
      // Fast path: local verification. If it fails (unknown key, unreachable
      // JWKS, unset secret) fall back to asking Supabase directly.
      if (canVerifyLocally()) {
        const claims = await verifySupabaseJwt(token).catch(() => null);
        if (claims?.sub) {
          req.userId = claims.sub;
          const meta = claims.user_metadata as
            | Record<string, unknown>
            | undefined;
          syncUser(
            claims.sub,
            claims.email as string | undefined,
            (meta?.name ?? meta?.full_name) as string | undefined,
            meta?.avatar_url as string | undefined,
          );
          rememberToken(token, claims.sub);
          return;
        }
      }
      const { data, error } = await supabase.auth
        .getUser(token)
        .catch((err: Error) => ({ data: { user: null }, error: err }));
      if (!error && data.user) {
        req.userId = data.user.id;
        syncUser(
          data.user.id,
          data.user.email,
          (data.user.user_metadata?.name as string | undefined) ??
            (data.user.user_metadata?.full_name as string | undefined),
          data.user.user_metadata?.avatar_url as string | undefined,
        );
        rememberToken(token, data.user.id);
        return;
      }
      console.error(
        "[auth] token rejected:",
        error ? error.message : "no user returned",
      );
    } else if (token) {
      console.error("[auth] token sent but Supabase client unavailable");
    }

    throw unauthorized(
      token ? "Invalid or expired token" : "Missing bearer token",
    );
  });
});
