import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { FastifyInstance } from "fastify";
import { prisma } from "@catgpt/db";
import { env } from "../env.js";
import { insideStorage, verifyFileSignature } from "../services/shorts/storage.js";
import { completeConnect } from "../services/shorts/youtube.js";
import { musicPath, reelFilePath } from "../services/shorts/reel-service.js";
import type { FastifyReply, FastifyRequest } from "fastify";

const MIME: Record<string, string> = {
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".m4v": "video/mp4",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".flac": "audio/flac",
};

/** Streams a file with Range support (seekable previews). */
async function sendFile(req: FastifyRequest, reply: FastifyReply, file: string, downloadName?: string) {
  const { size } = await stat(file).catch(() => ({ size: -1 }));
  if (size < 0) return reply.code(404).send({ statusCode: 404, error: "Not Found", message: "File missing on disk" });
  const ext = file.slice(file.lastIndexOf(".")).toLowerCase();
  reply.header("Content-Type", MIME[ext] ?? "application/octet-stream").header("Accept-Ranges", "bytes").header("Cache-Control", "private, max-age=3600");
  if (downloadName) reply.header("Content-Disposition", `attachment; filename="${downloadName}"`);
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
  if (m && (m[1] || m[2])) {
    const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
    const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
    if (start >= size || start > end) return reply.code(416).header("Content-Range", `bytes */${size}`).send();
    reply.code(206).header("Content-Range", `bytes ${start}-${end}/${size}`).header("Content-Length", String(end - start + 1));
    return reply.send(createReadStream(file, { start, end }));
  }
  reply.header("Content-Length", String(size));
  return reply.send(createReadStream(file));
}

/**
 * Unauthenticated Shorts endpoints. Trust comes from an HMAC-signed, expiring
 * URL (file previews/downloads, since <video> can't send a Bearer header).
 */
export async function shortsPublicRoutes(app: FastifyInstance) {
  app.get<{ Params: { file: string }; Querystring: { exp?: string; sig?: string; download?: string } }>(
    "/shorts/files/:file",
    async (req, reply) => {
      const id = req.params.file.replace(/\.mp4$/, "");
      if (!verifyFileSignature(id, Number(req.query.exp), String(req.query.sig ?? ""))) {
        return reply.code(403).send({ statusCode: 403, error: "Forbidden", message: "Link expired or invalid; reload the page" });
      }
      const v = await prisma.shortsVideo.findUnique({ where: { id }, select: { filePath: true, title: true, channel: { select: { slug: true } } } });
      if (!v?.filePath || !insideStorage(v.filePath)) return reply.code(404).send({ statusCode: 404, error: "Not Found", message: "No file" });
      const { size } = await stat(v.filePath).catch(() => ({ size: -1 }));
      if (size < 0) return reply.code(404).send({ statusCode: 404, error: "Not Found", message: "File missing on disk" });

      reply.header("Content-Type", "video/mp4").header("Accept-Ranges", "bytes").header("Cache-Control", "private, max-age=3600");
      if (req.query.download) {
        const name = `${v.channel.slug}-${(v.title ?? id).replace(/[^\w-]+/g, "-").slice(0, 60)}.mp4`;
        reply.header("Content-Disposition", `attachment; filename="${name}"`);
      }
      // Range support so browsers can seek in the preview player.
      const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
      if (m && (m[1] || m[2])) {
        const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
        const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
        if (start >= size || start > end) return reply.code(416).header("Content-Range", `bytes */${size}`).send();
        reply.code(206).header("Content-Range", `bytes ${start}-${end}/${size}`).header("Content-Length", String(end - start + 1));
        return reply.send(createReadStream(v.filePath, { start, end }));
      }
      reply.header("Content-Length", String(size));
      return reply.send(createReadStream(v.filePath));
    },
  );

  /** Reel Studio files (final MP4, thumbnails, scene visuals), via signed expiring URLs. */
  app.get<{ Params: { id: string; "*": string }; Querystring: { exp?: string; sig?: string; download?: string } }>(
    "/shorts/reel-files/:id/*",
    async (req, reply) => {
      const name = req.params["*"];
      if (!verifyFileSignature(`reel:${req.params.id}:${name}`, Number(req.query.exp), String(req.query.sig ?? ""))) {
        return reply.code(403).send({ statusCode: 403, error: "Forbidden", message: "Link expired or invalid; reload the page" });
      }
      const file = await reelFilePath(req.params.id, name);
      if (!file) return reply.code(404).send({ statusCode: 404, error: "Not Found", message: "No file" });
      let downloadName: string | undefined;
      if (req.query.download) {
        const r = await prisma.shortsReel.findUnique({ where: { id: req.params.id }, select: { title: true } });
        downloadName = `${(r?.title || "reel").replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "reel"}.mp4`;
      }
      return sendFile(req, reply, file, downloadName);
    },
  );

  /** Music preview in the Reel Studio editor. */
  app.get<{ Params: { userId: string; key: string }; Querystring: { exp?: string; sig?: string } }>("/shorts/music-files/:userId/:key", async (req, reply) => {
    if (!verifyFileSignature(`music:${req.params.userId}:${req.params.key}`, Number(req.query.exp), String(req.query.sig ?? ""))) {
      return reply.code(403).send({ statusCode: 403, error: "Forbidden", message: "Link expired or invalid; reload the page" });
    }
    const file = await musicPath(req.params.userId, req.params.key);
    if (!file) return reply.code(404).send({ statusCode: 404, error: "Not Found", message: "No file" });
    return sendFile(req, reply, file);
  });

  /** Google redirects here (GOOGLE_REDIRECT_URI). Sends the owner back to the Channels page with the outcome. */
  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>("/shorts/oauth/callback", async (req, reply) => {
    const base = (env.APP_BASE_URL ?? env.WEB_ORIGIN).replace(/\/+$/, "");
    const back = (q: Record<string, string>) => reply.redirect(`${base}/shorts?${new URLSearchParams(q)}`);
    if (req.query.error) return back({ yt_error: `Google: ${req.query.error}` });
    if (!req.query.code || !req.query.state) return back({ yt_error: "Missing code or state" });
    try {
      const r = await completeConnect(req.query.code, req.query.state);
      return back({ yt_connected: r.slug, yt_title: r.title });
    } catch (err) {
      req.log.warn({ err }, "shorts oauth callback failed");
      return back({ yt_error: err instanceof Error ? err.message.slice(0, 300) : "Connect failed" });
    }
  });
}
