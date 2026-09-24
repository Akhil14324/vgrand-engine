import type { FastifyInstance } from "fastify";
import { prisma, Prisma } from "@catgpt/db";
import { addBoardItemSchema, createBoardSchema } from "@catgpt/types";
import { forbidden, notFound, parseBody } from "../lib/errors.js";
import { toBoardDto, toBoardItemDto } from "../lib/serialize.js";

const ITEM_INCLUDE = {
  generation: {
    include: {
      theme: { select: { id: true, slug: true, label: true, icon: true } },
    },
  },
} as const;

export async function boardRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  app.post("/boards", async (req, reply) => {
    const { name } = parseBody(createBoardSchema, req.body);
    const board = await prisma.board.create({
      data: { userId: req.userId, name },
      include: { items: true },
    });
    return reply.code(201).send(toBoardDto(board));
  });

  app.get("/boards", async (req) => {
    const boards = await prisma.board.findMany({
      where: { userId: req.userId },
      orderBy: { createdAt: "desc" },
      include: {
        items: { orderBy: { addedAt: "desc" }, include: ITEM_INCLUDE },
      },
    });
    return { items: boards.map(toBoardDto) };
  });

  app.post("/boards/:id/items", async (req, reply) => {
    const { id } = req.params as { id: string };
    const { generationId } = parseBody(addBoardItemSchema, req.body);

    const board = await prisma.board.findUnique({ where: { id } });
    if (!board) throw notFound("Board not found");
    if (board.userId !== req.userId) throw forbidden();

    const generation = await prisma.generation.findUnique({
      where: { id: generationId },
    });
    if (!generation) throw notFound("Generation not found");
    if (generation.userId !== req.userId) throw forbidden();

    try {
      const item = await prisma.boardItem.create({
        data: { boardId: id, generationId },
        include: ITEM_INCLUDE,
      });
      return reply.code(201).send(toBoardItemDto(item));
    } catch (err) {
      // @@unique([boardId, generationId]) — re-saving is a no-op.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        const existing = await prisma.boardItem.findUnique({
          where: { boardId_generationId: { boardId: id, generationId } },
          include: ITEM_INCLUDE,
        });
        return reply.code(200).send(toBoardItemDto(existing!));
      }
      throw err;
    }
  });

  app.delete("/boards/:id/items/:itemId", async (req, reply) => {
    const { id, itemId } = req.params as { id: string; itemId: string };
    const board = await prisma.board.findUnique({ where: { id } });
    if (!board) throw notFound("Board not found");
    if (board.userId !== req.userId) throw forbidden();
    await prisma.boardItem.delete({ where: { id: itemId } });
    return reply.code(204).send();
  });
}
