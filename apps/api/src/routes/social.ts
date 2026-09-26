import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  socialBestTimesQuerySchema,
  socialCalendarQuerySchema,
  socialPostCreateRequestSchema,
  socialPostRescheduleSchema,
  socialPreviewRequestSchema,
  type BestTimeSlotDto,
  type SocialAccountDto,
  type SocialCalendarItemDto,
  type SocialConnector,
  type SocialPlatformsDto,
  type SocialPostDto,
  type SocialPreviewsDto,
} from "@catgpt/types";
import { env } from "../env.js";
import { badRequest, HttpError, parseBody } from "../lib/errors.js";
import { hasValidTokenKey } from "../lib/social-crypto.js";
import {
  assertCanConnect,
  deleteAccountAs,
  listVisibleAccounts,
  toSocialAccountDto,
  upsertConnectedAccount,
  type ConnectedAccountInput,
} from "../services/social/accounts.js";
import { SocialConnectError } from "../services/social/errors.js";
import { suggestBestTimes } from "../services/social/best-times.js";
import { generateSocialPreviews } from "../services/social/preview.js";
import {
  cancelScheduledPost,
  createSocialPosts,
  listCalendarPosts,
  listSocialPosts,
  loadGenerationForSocial,
  publishScheduledNow,
  rescheduleSocialPost,
  retrySocialPost,
} from "../services/social/posts.js";
import {
  consumeOAuthSession,
  createOAuthSession,
  OAuthStateError,
} from "../services/social/oauth-state.js";
import { completeGoogleConnect, googleAuthUrl } from "../services/social/oauth/google.js";
import { completeMetaConnect, metaAuthUrl } from "../services/social/oauth/meta.js";
import { completeXConnect, generatePkce, xAuthUrl } from "../services/social/oauth/x.js";

const workspaceQuery = z.object({ workspaceId: z.string().uuid().optional() });
const idParams = z.object({ id: z.string().uuid() });

/** The path segment each provider redirects back to. */
const CALLBACK_SEGMENT: Record<SocialConnector, string> = {
  meta: "meta",
  x: "x",
  youtube: "google",
};
const CONNECTOR_BY_SEGMENT: Record<string, SocialConnector> = {
  meta: "meta",
  x: "x",
  google: "youtube",
};
/** The UI says "Connect Instagram"; both Meta platforms share one OAuth flow. */
const CONNECTOR_BY_PLATFORM_PARAM: Record<string, SocialConnector> = {
  meta: "meta",
  instagram: "meta",
  facebook: "meta",
  x: "x",
  youtube: "youtube",
};

const callbackUrl = (c: SocialConnector) =>
  `${env.API_PUBLIC_URL.replace(/\/+$/, "")}/social/callback/${CALLBACK_SEGMENT[c]}`;

export const socialPlatformsConfigured = (): SocialPlatformsDto => {
  const keyOk = hasValidTokenKey();
  return {
    meta: keyOk && env.metaConfigured,
    x: keyOk && env.xConfigured,
    youtube: keyOk && env.youtubeConfigured,
  };
};

/** Where the browser lands after the provider round-trip (the popup or tab). */
function webRedirect(result: string): string {
  const origin = env.WEB_ORIGIN.replace(/\/+$/, "");
  return `${origin}/?social=${encodeURIComponent(result)}`;
}

const safeCode = (code: string) => (/^[a-z_]{1,40}$/.test(code) ? code : "connect_failed");

export async function socialRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  app.get("/social/platforms", async (): Promise<SocialPlatformsDto> => socialPlatformsConfigured());

  app.get("/social/accounts", async (req): Promise<{ items: SocialAccountDto[] }> => {
    const { workspaceId } = parseBody(workspaceQuery, req.query);
    const accounts = await listVisibleAccounts(req.userId, workspaceId ?? null);
    return { items: accounts.map(toSocialAccountDto) };
  });

  app.delete("/social/accounts/:id", async (req, reply) => {
    const { id } = parseBody(z.object({ id: z.string().uuid() }), req.params);
    await deleteAccountAs(req.userId, id);
    return reply.code(204).send();
  });

  /** One model call; nothing is written to the database. */
  app.post(
    "/generations/:id/social-preview",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (req): Promise<SocialPreviewsDto> => {
      const { id } = parseBody(idParams, req.params);
      const body = parseBody(socialPreviewRequestSchema, req.body);
      const generation = await loadGenerationForSocial(req.userId, id);
      return generateSocialPreviews(req.userId, generation, body.platforms);
    },
  );

  app.post("/generations/:id/social-posts", async (req, reply) => {
    const { id } = parseBody(idParams, req.params);
    const body = parseBody(socialPostCreateRequestSchema, req.body);
    const items = await createSocialPosts(req.userId, id, body);
    return reply.code(201).send({ items });
  });

  app.get("/generations/:id/social-posts", async (req): Promise<{ items: SocialPostDto[] }> => {
    const { id } = parseBody(idParams, req.params);
    return { items: await listSocialPosts(req.userId, id) };
  });

  app.get("/social/calendar", async (req): Promise<{ items: SocialCalendarItemDto[] }> => {
    const q = parseBody(socialCalendarQuerySchema, req.query);
    const from = new Date(q.from);
    const to = new Date(q.to);
    if (to <= from || to.getTime() - from.getTime() > 93 * 86_400_000) {
      throw badRequest("Invalid date range");
    }
    return { items: await listCalendarPosts(req.userId, from, to) };
  });

  app.get("/social/best-times", async (req): Promise<{ items: BestTimeSlotDto[] }> => {
    const q = parseBody(socialBestTimesQuerySchema, req.query);
    const ids = q.accountIds.split(",").filter(Boolean);
    if (ids.length === 0 || !ids.every((id) => z.string().uuid().safeParse(id).success)) {
      throw badRequest("Invalid accounts");
    }
    return { items: await suggestBestTimes(req.userId, ids, q.timezone, q.date) };
  });

  app.patch("/social-posts/:id", async (req): Promise<SocialPostDto> => {
    const { id } = parseBody(idParams, req.params);
    const body = parseBody(socialPostRescheduleSchema, req.body);
    return rescheduleSocialPost(req.userId, id, body.scheduledFor);
  });

  app.delete("/social-posts/:id", async (req, reply) => {
    const { id } = parseBody(idParams, req.params);
    await cancelScheduledPost(req.userId, id);
    return reply.code(204).send();
  });

  app.post("/social-posts/:id/publish-now", async (req): Promise<SocialPostDto> => {
    const { id } = parseBody(idParams, req.params);
    return publishScheduledNow(req.userId, id);
  });

  app.post("/social-posts/:id/retry", async (req): Promise<SocialPostDto> => {
    const { id } = parseBody(idParams, req.params);
    return retrySocialPost(req.userId, id);
  });

  app.get("/social/connect/:platform", async (req): Promise<{ url: string }> => {
    const { platform } = req.params as { platform: string };
    const connector = CONNECTOR_BY_PLATFORM_PARAM[platform];
    if (!connector) throw badRequest("Unknown platform");
    const { workspaceId } = parseBody(workspaceQuery, req.query);

    if (!hasValidTokenKey()) {
      throw new HttpError(503, "Social publishing is not configured on this server");
    }
    if (!socialPlatformsConfigured()[connector]) {
      throw badRequest(`${connector} publishing is not configured on this server`);
    }
    await assertCanConnect(req.userId, workspaceId ?? null);

    const redirectUri = callbackUrl(connector);
    const pkce = connector === "x" ? generatePkce() : null;
    const state = await createOAuthSession({
      userId: req.userId,
      workspaceId: workspaceId ?? null,
      platform: connector,
      codeVerifier: pkce?.verifier,
    });
    const url =
      connector === "meta"
        ? metaAuthUrl(state, redirectUri)
        : connector === "x"
          ? xAuthUrl(state, redirectUri, pkce!.challenge)
          : googleAuthUrl(state, redirectUri);
    return { url };
  });
}

/**
 * Provider redirects land here directly, with no Authorization header, so this
 * plugin is registered WITHOUT app.authenticate. Trust comes solely from the
 * opaque, single-use state that /social/connect stored for an authenticated user.
 */
export async function socialCallbackRoutes(app: FastifyInstance) {
  app.get("/social/callback/:provider", async (req, reply) => {
    const { provider } = req.params as { provider: string };
    const connector = CONNECTOR_BY_SEGMENT[provider];
    if (!connector) return reply.code(404).send({ message: "Not found" });

    const query = req.query as Record<string, string | undefined>;
    const fail = (code: string) => reply.redirect(webRedirect(`error:${safeCode(code)}`));

    // The state is consumed BEFORE the code is exchanged (single use), and is
    // burned even when the user cancelled at the provider.
    let session;
    try {
      session = await consumeOAuthSession(query.state ?? "", connector);
    } catch (err) {
      if (err instanceof OAuthStateError) return fail(err.reason);
      req.log.error({ connector }, "oauth state lookup failed");
      return fail("connect_failed");
    }
    if (query.error) return fail("access_denied");
    if (!query.code) return fail("missing_code");

    try {
      // Re-check at callback time: never rely on what was true when the flow began.
      await assertCanConnect(session.userId, session.workspaceId);
      if (!socialPlatformsConfigured()[connector]) return fail("not_configured");

      const redirectUri = callbackUrl(connector);
      let accounts: ConnectedAccountInput[];
      if (connector === "meta") {
        accounts = await completeMetaConnect(query.code, redirectUri);
      } else if (connector === "x") {
        if (!session.codeVerifier) return fail("invalid_state");
        accounts = await completeXConnect(query.code, session.codeVerifier, redirectUri);
      } else {
        accounts = await completeGoogleConnect(query.code, redirectUri);
      }
      for (const account of accounts) {
        await upsertConnectedAccount(session.userId, session.workspaceId, account);
      }
      req.log.info({ connector, count: accounts.length }, "social accounts connected");
      return reply.redirect(webRedirect(`connected:${connector}`));
    } catch (err) {
      // Log the slug/status only - provider errors and bodies can echo secrets.
      const code = err instanceof SocialConnectError ? err.code : "connect_failed";
      req.log.warn({ connector, code }, "social connect failed");
      return fail(err instanceof HttpError ? "forbidden" : code);
    }
  });
}
