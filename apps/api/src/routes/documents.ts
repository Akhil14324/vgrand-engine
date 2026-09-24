import type { FastifyInstance } from "fastify";
import { prisma } from "@catgpt/db";
import { badRequest, forbidden, notFound } from "../lib/errors.js";
import { toDocumentDto } from "../lib/serialize.js";
import { ingestDocument } from "../services/documents.js";
import { storeFile } from "../services/storage.js";

/**
 * PDF uploads for RAG. Ingest runs inline — extraction + one batched
 * embeddings call keeps typical documents ready in ~1–2s, so the upload
 * response already carries status "ready" (or "failed" + error).
 */
export async function documentRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  app.post("/documents", async (req, reply) => {
    const file = await req.file();
    if (!file) throw badRequest("multipart field 'file' is required");
    if (file.mimetype !== "application/pdf") {
      throw badRequest("only PDF files are supported on /documents");
    }
    const buffer = await file.toBuffer();
    const filename = file.filename?.trim() || "document.pdf";

    const storageUrl = await storeFile({
      buffer,
      mimeType: "application/pdf",
      keyPrefix: `documents/${req.userId}`,
    });

    const doc = await prisma.document.create({
      data: { userId: req.userId, filename, storageUrl },
    });
    try {
      const { pageCount, chunkCount } = await ingestDocument(doc.id, buffer);
      const ready = await prisma.document.update({
        where: { id: doc.id },
        data: { status: "ready", pageCount, chunkCount },
      });
      return reply.code(201).send(toDocumentDto(ready));
    } catch (err) {
      const message = err instanceof Error ? err.message : "ingest failed";
      await prisma.document.update({
        where: { id: doc.id },
        data: { status: "failed", error: message },
      });
      throw badRequest(`Couldn't read this PDF — ${message}`);
    }
  });

  /** Documents for a chat (composer chips / context indicator). */
  app.get("/documents", async (req) => {
    const q = req.query as { conversationId?: string };
    const docs = await prisma.document.findMany({
      where: {
        userId: req.userId,
        ...(q.conversationId ? { conversationId: q.conversationId } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return { items: docs.map(toDocumentDto) };
  });

  app.delete("/documents/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const doc = await prisma.document.findUnique({ where: { id } });
    if (!doc) throw notFound("Document not found");
    if (doc.userId !== req.userId) throw forbidden();
    await prisma.document.delete({ where: { id } });
    return reply.code(204).send();
  });
}
