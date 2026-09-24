import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "@catgpt/db";
import { badRequest, forbidden, notFound } from "../lib/errors.js";
import { toDocumentDto } from "../lib/serialize.js";
import { enqueueDocumentIngestion } from "../services/queue.js";
import { storeFile } from "../services/storage.js";
import { MAX_BRAND_DOCUMENTS, findAccessibleBrand } from "../lib/brand.js";
import { findWorkspaceForUser } from "../lib/workspace-access.js";

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
    // Optional brandId field - the file becomes part of that brand's durable
    // knowledge base, retrieved automatically whenever brand mode is on.
    const brandField = file.fields["brandId"] as { value?: string } | undefined;
    const brandId = z.string().uuid().safeParse(brandField?.value).success
      ? (brandField!.value as string)
      : null;
    if (brandId) {
      const brand = await findAccessibleBrand(req.userId, brandId);
      if (brand._count.documents >= MAX_BRAND_DOCUMENTS) {
        throw badRequest(
          `a brand can hold up to ${MAX_BRAND_DOCUMENTS} documents - remove one first`,
        );
      }
    }
    if (workspaceId) await findWorkspaceForUser(req.userId, workspaceId);

    const storageUrl = await storeFile({
      buffer,
      mimeType: file.mimetype,
      keyPrefix: `documents/${req.userId}`,
    });

    const doc = await prisma.document.create({
      data: { userId: req.userId, filename, storageUrl, workspaceId, brandId },
    });
    await enqueueDocumentIngestion(doc.id, file.mimetype);
    return reply.code(201).send(toDocumentDto(doc));
  });

  /** Documents for a chat or a workspace (chips / workspace detail view). */
  app.get("/documents", async (req) => {
    const q = req.query as {
      conversationId?: string;
      workspaceId?: string;
      brandId?: string;
    };
    // Asking for a workspace's files needs membership, and then shows every
    // member's uploads; anything else stays limited to the caller's own.
    const ws = q.workspaceId
      ? await findWorkspaceForUser(req.userId, q.workspaceId)
      : null;
    const docs = await prisma.document.findMany({
      where: {
        ...(ws ? { workspaceId: ws.id } : { userId: req.userId }),
        ...(q.conversationId ? { conversationId: q.conversationId } : {}),
        ...(q.brandId ? { brandId: q.brandId } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return { items: docs.map(toDocumentDto) };
  });

  app.delete("/documents/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const doc = await prisma.document.findUnique({
      where: { id },
      include: { workspace: { select: { userId: true } } },
    });
    if (!doc) throw notFound("Document not found");
    // The uploader, or the owner of the workspace it lives in.
    if (doc.userId !== req.userId && doc.workspace?.userId !== req.userId) {
      throw forbidden();
    }
    await prisma.document.delete({ where: { id } });
    return reply.code(204).send();
  });
}
