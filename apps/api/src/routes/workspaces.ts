import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { prisma } from "@catgpt/db";
import { forbidden, notFound, parseBody } from "../lib/errors.js";
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

async function loadOwned(req: FastifyRequest, id: string) {
  const workspace = await prisma.workspace.findUnique({ where: { id } });
  if (!workspace) throw notFound("Workspace not found");
  if (workspace.userId !== req.userId) throw forbidden();
  return workspace;
}

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
      include: { _count: { select: { documents: true } } },
    });
    return reply.code(201).send(toWorkspaceDto(workspace));
  });

  /** All workspaces, newest activity first, with document counts. */
  app.get("/workspaces", async (req) => {
    const items = await prisma.workspace.findMany({
      where: { userId: req.userId },
      orderBy: { updatedAt: "desc" },
      include: { _count: { select: { documents: true } } },
    });
    return { items: items.map(toWorkspaceDto) };
  });

  /** One workspace + its documents. */
  app.get("/workspaces/:id", async (req) => {
    const { id } = req.params as { id: string };
    await loadOwned(req, id);
    const workspace = await prisma.workspace.findUniqueOrThrow({
      where: { id },
      include: {
        documents: { orderBy: { createdAt: "desc" } },
        _count: { select: { documents: true } },
      },
    });
    return toWorkspaceDetailDto(workspace);
  });

  app.patch("/workspaces/:id", async (req) => {
    const { id } = req.params as { id: string };
    await loadOwned(req, id);
    const body = parseBody(updateWorkspaceSchema, req.body);
    const workspace = await prisma.workspace.update({
      where: { id },
      data: { name: body.name.trim() },
      include: { _count: { select: { documents: true } } },
    });
    return toWorkspaceDto(workspace);
  });

  app.delete("/workspaces/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    await loadOwned(req, id);
    await prisma.workspace.delete({ where: { id } });
    return reply.code(204).send();
  });
}
