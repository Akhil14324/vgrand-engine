import type { FastifyInstance } from "fastify";
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
}
