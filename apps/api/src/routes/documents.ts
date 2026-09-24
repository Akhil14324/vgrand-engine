import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "@catgpt/db";
import { badRequest, forbidden, notFound } from "../lib/errors.js";
import { toDocumentDto } from "../lib/serialize.js";
import { enqueueDocumentIngestion } from "../services/queue.js";
import { storeFile } from "../services/storage.js";

/**
 * PDF/DOCX uploads for RAG. The file is stored, then ingestion (text
 * extraction + embeddings) runs on the worker queue — the response returns
 * immediately with status "processing" and the client polls until "ready".
 */
export async function documentRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  app.post("/documents", async (req, reply) => {
    const file = await req.file();
    if (!file) throw badRequest("multipart field 'file' is required");
    const DOCX_MIME =
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    if (file.mimetype === "application/msword") {
      throw badRequest(
        "Legacy .doc isn't supported — please save as .docx and re-upload.",
      );
    }
    if (file.mimetype !== "application/pdf" && file.mimetype !== DOCX_MIME) {
      throw badRequest("only PDF and Word (.docx) files are supported");
    }
    const buffer = await file.toBuffer();
    const filename = file.filename?.trim() || "document";

    // Optional workspaceId multipart field — upload straight into a
    // workspace without needing an existing conversation.
    const workspaceField = file.fields["workspaceId"] as
      | { value?: string }
      | undefined;
    const workspaceId = z
      .string()
      .uuid()
      .safeParse(workspaceField?.value)
      .success
      ? (workspaceField!.value as string)
      : null;
    if (workspaceId) {
      const ws = await prisma.workspace.findUnique({
        where: { id: workspaceId },
      });
      if (!ws) throw notFound("Workspace not found");
      if (ws.userId !== req.userId) throw forbidden();
    }

    const storageUrl = await storeFile({
      buffer,
      mimeType: file.mimetype,
      keyPrefix: `documents/${req.userId}`,
    });

    const doc = await prisma.document.create({
      data: { userId: req.userId, filename, storageUrl, workspaceId },
    });
    await enqueueDocumentIngestion(doc.id, file.mimetype);
    return reply.code(201).send(toDocumentDto(doc));
  });

  /** Documents for a chat or a workspace (chips / workspace detail view). */
  app.get("/documents", async (req) => {
    const q = req.query as {
      conversationId?: string;
      workspaceId?: string;
    };
    const docs = await prisma.document.findMany({
      where: {
        userId: req.userId,
        ...(q.conversationId ? { conversationId: q.conversationId } : {}),
        ...(q.workspaceId ? { workspaceId: q.workspaceId } : {}),
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
