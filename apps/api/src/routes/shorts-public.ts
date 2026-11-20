import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { FastifyInstance } from "fastify";
import { prisma } from "@catgpt/db";
import { env } from "../env.js";
import { insideStorage, verifyFileSignature } from "../services/shorts/storage.js";
import { completeConnect } from "../services/shorts/youtube.js";

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
