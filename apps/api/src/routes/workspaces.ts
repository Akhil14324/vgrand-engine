import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { prisma } from "@catgpt/db";
import { parseBody } from "../lib/errors.js";
import { findWorkspaceForUser, workspaceAccess } from "../lib/workspace-access.js";
import { deleteStoredFiles } from "../services/storage.js";
import {
  toWorkspaceDetailDto,
  toWorkspaceDto,
} from "../lib/serialize.js";

const createWorkspaceSchema = z.object({
  name: z.string().min(1).max(120),
});
const updateWorkspaceSchema = z.object({
  name: z.string().min(1).max(120),
});

/** Owner or member. */
const loadAccessible = (req: FastifyRequest, id: string) =>
  findWorkspaceForUser(req.userId, id);
/** Owner only (rename / delete). */
const loadOwned = (req: FastifyRequest, id: string) =>
  findWorkspaceForUser(req.userId, id, { ownerOnly: true });

const WS_COUNTS = { _count: { select: { documents: true, members: true } } };

/**
 * Workspaces — durable, named collections of documents + chats. Deleting one
 * detaches rather than destroys: documents lose their workspaceId (SetNull)
 * and conversations stay as normal chats, so no user data is ever removed
 * by this endpoint.
 */
export async function workspaceRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  app.post("/workspaces", async (req, reply) => {
    const body = parseBody(createWorkspaceSchema, req.body);
    const workspace = await prisma.workspace.create({
      data: { id: randomUUID(), userId: req.userId, name: body.name.trim() },
      include: WS_COUNTS,
    });
    return reply.code(201).send(toWorkspaceDto(workspace, req.userId));
  });

  /** All workspaces, newest activity first, with document counts. */
  app.get("/workspaces", async (req) => {
    const items = await prisma.workspace.findMany({
      where: workspaceAccess(req.userId),
      orderBy: { updatedAt: "desc" },
      include: WS_COUNTS,
    });
    return { items: items.map((w) => toWorkspaceDto(w, req.userId)) };
  });

  /** One workspace + its documents. */
  app.get("/workspaces/:id", async (req) => {
    const { id } = req.params as { id: string };
    await loadAccessible(req, id);
    const workspace = await prisma.workspace.findUniqueOrThrow({
      where: { id },
      include: {
        documents: { orderBy: { createdAt: "desc" } },
        ...WS_COUNTS,
      },
    });
    return toWorkspaceDetailDto(workspace, req.userId);
  });

  app.patch("/workspaces/:id", async (req) => {
    const { id } = req.params as { id: string };
    await loadOwned(req, id);
    const body = parseBody(updateWorkspaceSchema, req.body);
    const workspace = await prisma.workspace.update({
      where: { id },
      data: { name: body.name.trim() },
      include: WS_COUNTS,
    });
    return toWorkspaceDto(workspace, req.userId);
  });

  app.delete("/workspaces/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    await loadOwned(req, id);
    // Workspace brands are destroyed with the workspace (documents and chats
    // only lose their workspaceId). Collect the brand-owned files — asset
    // images and brand document uploads — so storage can be reclaimed.
    const [docs, assets] = await Promise.all([
      prisma.document.findMany({
        where: { brand: { workspaceId: id } },
        select: { storageUrl: true },
      }),
      prisma.brandAsset.findMany({
        where: { brand: { workspaceId: id } },
        select: { url: true },
      }),
    ]);
    await prisma.workspace.delete({ where: { id } });
    const assetUrls = assets.map((a) => a.url);
    const shared = assetUrls.length
      ? new Set(
          (
            await prisma.brandAsset.findMany({
              where: { url: { in: assetUrls } },
              select: { url: true },
            })
          ).map((a) => a.url),
        )
      : new Set<string>();
    await deleteStoredFiles([
      ...docs.map((d) => d.storageUrl),
      ...assetUrls.filter((u) => !shared.has(u)),
    ]);
    return reply.code(204).send();
  });
}
