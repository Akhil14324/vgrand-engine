import fp from "fastify-plugin";
import type { FastifyReply, FastifyRequest } from "fastify";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { prisma } from "@prompthub/db";
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

const DEV_USER = {
  id: "dev-user",
  email: "dev@prompthub.local",
  name: "Dev User",
};

let supabaseAuth: SupabaseClient | null = null;
function getSupabase(): SupabaseClient | null {
  if (!env.supabaseConfigured) return null;
  supabaseAuth ??= createClient(
    env.SUPABASE_URL!,
    env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
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
 * Auth strategy:
 *  - Supabase configured  -> verify the Bearer JWT via supabase.auth.getUser,
 *    upsert the user row (Supabase user id becomes our User.id).
 *  - Not configured + DEV_AUTH_BYPASS -> everyone maps to a local dev user so
 *    the app runs end-to-end before Supabase is wired in.
 */
export const authPlugin = fp(async (app) => {
  app.decorateRequest("userId", "");

  app.decorate("authenticate", async (req: FastifyRequest) => {
    const token = extractToken(req);
    const supabase = getSupabase();

    if (supabase && token) {
      const { data, error } = await supabase.auth.getUser(token);
      if (!error && data.user) {
        req.userId = await upsertUser(
          data.user.id,
          data.user.email,
          (data.user.user_metadata?.name as string | undefined) ??
            (data.user.user_metadata?.full_name as string | undefined),
          data.user.user_metadata?.avatar_url as string | undefined,
        );
        return;
      }
      // Bad token: fall through — DEV_AUTH_BYPASS still rescues the request
      // when it's explicitly enabled; otherwise this 401s below.
    }

    if (env.DEV_AUTH_BYPASS) {
      req.userId = await upsertUser(DEV_USER.id, DEV_USER.email, DEV_USER.name);
      return;
    }

    throw unauthorized(
      token ? "Invalid or expired token" : "Missing bearer token",
    );
  });
});
