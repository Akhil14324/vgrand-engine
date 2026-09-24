import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import { ZodError } from "zod";
import { env } from "./env.js";
import { HttpError } from "./lib/errors.js";
import { queueStats } from "./services/queue.js";
import { authPlugin } from "./plugins/auth.js";
import { themeRoutes } from "./routes/themes.js";
import { generationRoutes } from "./routes/generations.js";
import { conversationRoutes } from "./routes/conversations.js";
import { workspaceRoutes } from "./routes/workspaces.js";
import { shareRoutes } from "./routes/share.js";
import { memoryRoutes } from "./routes/memories.js";
import { uploadRoutes } from "./routes/uploads.js";
import { documentRoutes } from "./routes/documents.js";
import { brandRoutes } from "./routes/brands.js";

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: env.NODE_ENV === "development" ? "info" : "warn",
    },
    bodyLimit: 2 * 1024 * 1024,
  });

  await app.register(cors, {
    // Any origin — the web app may be served from localhost, Railway, Vercel…
    // Auth uses Bearer tokens (no cookies), so credentials aren't needed and
    // "*" + credentials is an invalid pairing browsers reject anyway.
    origin: "*",
    // Explicit list — without it the preflight only advertises GET/HEAD/POST
    // and browsers silently block DELETE/PATCH (delete chat, rename, pin…).
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  });
  await app.register(multipart, {
    limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024, files: 1 },
  });
  // Serves locally stored images when Supabase Storage isn't configured.
  await mkdir(path.resolve(env.UPLOAD_DIR), { recursive: true });
  await app.register(fastifyStatic, {
    root: path.resolve(env.UPLOAD_DIR),
    prefix: "/uploads/",
    decorateReply: false,
  });
  // Brand reference posters committed with the repo — providers fetch these
  // over HTTP as the edit base for themed generations.
  await app.register(fastifyStatic, {
    root: fileURLToPath(new URL("../assets/themes", import.meta.url)),
    prefix: "/theme-assets/",
    decorateReply: false,
  });
  await app.register(authPlugin);
  // One heavy client (or a retry storm) shouldn't degrade everyone. userId
  // isn't set until route preHandlers run, so unauth/early requests key on IP.
  await app.register(rateLimit, {
    max: 120,
    timeWindow: "1 minute",
    keyGenerator: (req) => req.userId || req.ip,
  });

  app.setErrorHandler((err: unknown, req, reply) => {
    if (err instanceof HttpError) {
      return reply
        .code(err.statusCode)
        .send({ statusCode: err.statusCode, error: err.name, message: err.message });
    }
    if (err instanceof ZodError) {
      return reply
        .code(400)
        .send({ statusCode: 400, error: "Bad Request", message: err.message });
    }
    const e = err as { statusCode?: number; name?: string; message?: string };
    const statusCode = e.statusCode ?? 500;
    if (statusCode >= 500) req.log.error(err);
    return reply.code(statusCode).send({
      statusCode,
      error: e.name ?? "Internal Server Error",
      message: statusCode >= 500 ? "Internal Server Error" : e.message,
    });
  });

  app.get("/health", async () => ({
    status: "ok",
    auth: "supabase",
    storage: "supabase",
    queue: await queueStats().catch((e: Error) => ({ error: e.message })),
  }));

  await app.register(themeRoutes);
  await app.register(generationRoutes);
  await app.register(conversationRoutes);
  await app.register(workspaceRoutes);
  await app.register(shareRoutes);
  await app.register(memoryRoutes);
  await app.register(uploadRoutes);
  await app.register(documentRoutes);
  await app.register(brandRoutes);

  return app;
}
