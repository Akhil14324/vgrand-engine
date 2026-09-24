import type { FastifyInstance } from "fastify";
import { badRequest } from "../lib/errors.js";
import { storeImage } from "../services/storage.js";

/** Reference-image upload for edit/img2img flows (composer drag-and-drop). */
export async function uploadRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  app.post("/uploads", async (req, reply) => {
    const file = await req.file();
    if (!file) throw badRequest("multipart field 'file' is required");
    if (!file.mimetype.startsWith("image/")) {
      throw badRequest("only image files are supported on /uploads");
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
