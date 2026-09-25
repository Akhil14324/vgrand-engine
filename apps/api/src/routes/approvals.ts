import { randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { prisma, type ApprovalLink, type Generation } from "@catgpt/db";
import {
  approvalResponseSchema,
  createApprovalLinkSchema,
  type ApprovalLinkDto,
  type ApprovalStatus,
} from "@catgpt/types";
import { env } from "../env.js";
import { badRequest, forbidden, notFound, parseBody } from "../lib/errors.js";

function toApprovalDto(link: ApprovalLink): ApprovalLinkDto {
  return {
    id: link.id,
    generationId: link.generationId,
    token: link.token,
    url: `${env.WEB_ORIGIN}/approve/${link.token}`,
    status: link.status as ApprovalStatus,
    reviewerName: link.reviewerName,
    reviewerEmail: link.reviewerEmail,
    comment: link.comment,
    expiresAt: link.expiresAt?.toISOString() ?? null,
    revokedAt: link.revokedAt?.toISOString() ?? null,
    respondedAt: link.respondedAt?.toISOString() ?? null,
    createdAt: link.createdAt.toISOString(),
  };
}

async function loadOwnedGeneration(req: FastifyRequest, id: string) {
  const generation = await prisma.generation.findUnique({ where: { id } });
  if (!generation) throw notFound("Generation not found");
  if (generation.userId !== req.userId) throw forbidden();
  return generation;
}

function activeApproval(link: ApprovalLink & { generation: Generation }) {
  if (
    link.revokedAt ||
    (link.expiresAt && link.expiresAt.getTime() <= Date.now())
  ) {
    throw notFound("Approval link not found or expired");
  }
  return link;
}

/** Client approval links: private owner management + public token review. */
export async function approvalRoutes(app: FastifyInstance) {
  app.post(
    "/generations/:id/approvals",
    { preHandler: app.authenticate },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const generation = await loadOwnedGeneration(req, id);
      if (generation.status !== "completed" || generation.imageUrls.length === 0) {
        throw badRequest("only completed image generations can be sent for approval");
      }
      const body = parseBody(createApprovalLinkSchema, req.body);
      const link = await prisma.approvalLink.create({
        data: {
          generationId: generation.id,
          token: randomBytes(24).toString("base64url"),
          reviewerName: body.reviewerName?.trim() || null,
          reviewerEmail: body.reviewerEmail?.trim() || null,
          expiresAt: body.expiresInDays
            ? new Date(Date.now() + body.expiresInDays * 86_400_000)
            : null,
        },
      });
      return reply.code(201).send(toApprovalDto(link));
    },
  );

  app.get(
    "/generations/:id/approvals",
    { preHandler: app.authenticate },
    async (req) => {
      const { id } = req.params as { id: string };
      await loadOwnedGeneration(req, id);
      const items = await prisma.approvalLink.findMany({
        where: { generationId: id },
        orderBy: { createdAt: "desc" },
      });
      return { items: items.map(toApprovalDto) };
    },
  );

  app.delete(
    "/generations/:id/approvals/:approvalId",
    { preHandler: app.authenticate },
    async (req, reply) => {
      const { id, approvalId } = req.params as {
        id: string;
        approvalId: string;
      };
      await loadOwnedGeneration(req, id);
      const res = await prisma.approvalLink.updateMany({
        where: { id: approvalId, generationId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (res.count === 0) throw notFound("Approval link not found");
      return reply.code(204).send();
    },
  );

  /** Public read-only approval payload — intentionally omits owner/user data. */
  app.get("/approvals/:token", async (req) => {
    const { token } = req.params as { token: string };
    const link = await prisma.approvalLink.findUnique({
      where: { token },
      include: { generation: true },
    });
    if (!link) throw notFound("Approval link not found");
    activeApproval(link);
    const generation = link.generation;
    return {
      prompt: generation.prompt,
      imageUrls: generation.imageUrls,
      status: link.status,
      reviewerName: link.reviewerName,
      comment: link.comment,
      expiresAt: link.expiresAt?.toISOString() ?? null,
      createdAt: link.createdAt.toISOString(),
    };
  });

  /** Public client decision. The bearer token is the authorization boundary. */
  app.post("/approvals/:token/respond", async (req) => {
    const { token } = req.params as { token: string };
    const body = parseBody(approvalResponseSchema, req.body);
    if (body.action === "request_changes" && !body.comment?.trim()) {
      throw badRequest("a change request needs a short note");
    }
    const existing = await prisma.approvalLink.findUnique({
      where: { token },
      include: { generation: true },
    });
    if (!existing) throw notFound("Approval link not found");
    activeApproval(existing);

    const link = await prisma.approvalLink.update({
      where: { id: existing.id },
      data: {
        status: body.action === "approve" ? "approved" : "changes_requested",
        reviewerName: body.reviewerName?.trim() || existing.reviewerName,
        comment: body.comment?.trim() || null,
        respondedAt: new Date(),
      },
    });
    return toApprovalDto(link);
  });
}
