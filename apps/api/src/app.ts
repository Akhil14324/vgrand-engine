import { mkdir } from "node:fs/promises";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { ZodError } from "zod";
import { env } from "./env.js";
import { HttpError } from "./lib/errors.js";
import { authPlugin } from "./plugins/auth.js";
import { themeRoutes } from "./routes/themes.js";
import { generationRoutes } from "./routes/generations.js";
import { conversationRoutes } from "./routes/conversations.js";
import { boardRoutes } from "./routes/boards.js";
import { shareRoutes } from "./routes/share.js";
import { memoryRoutes } from "./routes/memories.js";
import { uploadRoutes } from "./routes/uploads.js";

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: env.NODE_ENV === "development" ? "info" : "warn",
    },
    bodyLimit: 2 * 1024 * 1024,
  });

  await app.register(cors, {
    origin: [env.WEB_ORIGIN, "http://localhost:3000"],
    credentials: true,
  });
  await app.register(multipart, {
    limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  });
  // Serves locally stored images when Supabase Storage isn't configured.
  await mkdir(path.resolve(env.UPLOAD_DIR), { recursive: true });
  await app.register(fastifyStatic, {
    root: path.resolve(env.UPLOAD_DIR),
    prefix: "/uploads/",
    decorateReply: false,
  });
  await app.register(authPlugin);

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
    auth: env.supabaseConfigured ? "supabase" : "dev-bypass",
    storage: env.supabaseConfigured ? "supabase" : "local",
  }));

  await app.register(themeRoutes);
  await app.register(generationRoutes);
  await app.register(conversationRoutes);
  await app.register(boardRoutes);
  await app.register(shareRoutes);
  await app.register(memoryRoutes);
  await app.register(uploadRoutes);

  return app;
}
