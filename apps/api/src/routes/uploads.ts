import type { FastifyInstance } from "fastify";
import { prisma } from "@catgpt/db";
import { badRequest } from "../lib/errors.js";
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
    const file = await req.file();
    if (!file) throw badRequest("multipart field 'file' is required");
    if (!ALLOWED_IMAGE_TYPES.has(file.mimetype)) {
      throw badRequest("only PNG, JPEG, WebP or GIF images are supported");
    }
    const buffer = await file.toBuffer();
    const url = await storeImage({
      buffer,
      mimeType: file.mimetype,
      keyPrefix: `uploads/${req.userId}`,
    });
    const name =
      file.filename.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim().slice(0, 120) ||
      "Uploaded image";
    const generation = await prisma.generation.create({
      data: {
        userId: req.userId,
        kind: "image",
        prompt: name,
        finalPrompt: name,
        provider: "upload",
        imageUrls: [url],
        status: "completed",
        metadata: { uploaded: true },
      },
      select: { id: true },
    });
    return reply.code(201).send({ id: generation.id, url });
  });
}
