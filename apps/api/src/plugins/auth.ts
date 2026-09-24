import fp from "fastify-plugin";
import type { FastifyReply, FastifyRequest } from "fastify";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { jwtVerify } from "jose";
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

function extractToken(req: FastifyRequest): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) return header.slice(7);
  // EventSource can't set headers, so SSE sends the token as a query param.
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

let jwtSecret: Uint8Array | null = null;
/**
 * In-process verification of a Supabase access token (HS256, signed with the
 * project's JWT secret) — no round-trip to Supabase's auth service per request.
 */
async function verifySupabaseJwt(token: string) {
  jwtSecret ??= new TextEncoder().encode(env.SUPABASE_JWT_SECRET!);
  const { payload } = await jwtVerify(token, jwtSecret);
  return payload;
}

/**
 * Auth strategy:
 *  - Supabase configured -> verify the Bearer JWT. With SUPABASE_JWT_SECRET
 *    this is local (jose jwtVerify, zero network calls); without it we fall
 *    back to supabase.auth.getUser (one HTTP call per request).
 */
export const authPlugin = fp(async (app) => {
  app.decorateRequest("userId", "");

  app.decorate("authenticate", async (req: FastifyRequest) => {
    const token = extractToken(req);
    const supabase = getSupabase();

    if (supabase && token) {
      // Fast path: local HS256 verification. If the secret is wrong/unset or the
      // project uses asymmetric signing keys this fails — fall back to asking
      // Supabase, which handles every signing setup.
      if (env.SUPABASE_JWT_SECRET) {
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
