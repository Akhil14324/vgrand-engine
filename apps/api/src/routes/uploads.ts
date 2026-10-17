import type { FastifyInstance } from "fastify";
import { Prisma, prisma } from "@catgpt/db";
import { VIDEO_MAX_SECONDS, VIDEO_MIME_TYPES, VIDEO_MIN_SECONDS } from "@catgpt/types";
import { env } from "../env.js";
import { badRequest } from "../lib/errors.js";
import { isPlatformReady, looksLikeMp4, probeVideo, transcodeToMp4 } from "../services/social/media/video.js";
import { storeImage } from "../services/storage.js";

const ALLOWED_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

/** Reference-image upload for edit/img2img flows (composer drag-and-drop). */
export async function uploadRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  app.post("/uploads", async (req, reply) => {
    const file = await req.file();
    if (!file) throw badRequest("multipart field 'file' is required");
    // Explicit allowlist — image/svg+xml can carry scripts and would be served
    // from our storage origin.
    if (!ALLOWED_IMAGE_TYPES.has(file.mimetype)) {
      throw badRequest("only PNG, JPEG, WebP or GIF images are supported");
    }
    const buffer = await file.toBuffer();
    const url = await storeImage({
      buffer,
      mimeType: file.mimetype,
      keyPrefix: `uploads/${req.userId}`,
    });
    return reply.code(201).send({ url });
  });

  /**
   * Adds the user's own picture to the Library. Posting is keyed by a completed
   * image generation, so the upload is stored as one (provider "upload", no chat,
   * no quota use) - that lets it go through the same Share / social flow.
   */
  app.post("/library/uploads", async (req, reply) => {
    // Videos get a bigger ceiling than the app-wide upload limit; images are re-checked below.
    const file = await req.file({ limits: { fileSize: env.MAX_VIDEO_UPLOAD_MB * 1024 * 1024 } });
    if (!file) throw badRequest("multipart field 'file' is required");
    const isVideo = (VIDEO_MIME_TYPES as readonly string[]).includes(file.mimetype);
    if (!isVideo && !ALLOWED_IMAGE_TYPES.has(file.mimetype)) {
      throw badRequest("only PNG, JPEG, WebP or GIF images, or MP4/MOV videos, are supported");
    }
    let buffer = await file.toBuffer();
    if (file.file.truncated) {
      throw badRequest(`File is larger than ${isVideo ? env.MAX_VIDEO_UPLOAD_MB : env.MAX_UPLOAD_MB} MB`);
    }
    const name =
      file.filename.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim().slice(0, 120) ||
      (isVideo ? "Uploaded video" : "Uploaded image");

    let mimeType = file.mimetype;
    let metadata: Record<string, unknown> = { uploaded: true };
    if (isVideo) {
      if (!looksLikeMp4(buffer)) throw badRequest("That file isn't a valid MP4/MOV video");
      let info;
      try {
        info = await probeVideo(buffer);
      } catch (err) {
        throw badRequest(err instanceof Error ? err.message : "This file isn't a readable video");
      }
      if (info.durationSec < VIDEO_MIN_SECONDS) {
        throw badRequest(`Videos must be at least ${VIDEO_MIN_SECONDS} seconds long`);
      }
      if (info.durationSec > VIDEO_MAX_SECONDS) {
        throw badRequest(`Videos can be at most ${VIDEO_MAX_SECONDS / 60} minutes long`);
      }
      if (!isPlatformReady(info) || mimeType !== "video/mp4") {
        try {
          buffer = await transcodeToMp4(buffer);
        } catch (err) {
          throw badRequest(err instanceof Error ? err.message : "Could not convert this video to MP4");
        }
        mimeType = "video/mp4";
      }
      metadata = {
        uploaded: true,
        mediaType: "video",
        durationSec: Math.round(info.durationSec * 10) / 10,
        width: info.width,
        height: info.height,
      };
    } else if (buffer.byteLength > env.MAX_UPLOAD_MB * 1024 * 1024) {
      throw badRequest(`Images must be under ${env.MAX_UPLOAD_MB} MB`);
    }

    const url = await storeImage({
      buffer,
      mimeType,
      keyPrefix: `uploads/${req.userId}`,
    });
    const generation = await prisma.generation.create({
      data: {
        userId: req.userId,
        kind: isVideo ? "video" : "image",
        prompt: name,
        finalPrompt: name,
        provider: "upload",
        imageUrls: [url],
        status: "completed",
        metadata: metadata as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
    return reply.code(201).send({ id: generation.id, url });
  });
}
