import type { FastifyInstance } from "fastify";
import { prisma } from "@catgpt/db";
import { createMemorySchema } from "@catgpt/types";
import { forbidden, notFound, parseBody } from "../lib/errors.js";
import { toMemoryDto } from "../lib/serialize.js";

export async function memoryRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  app.get("/memories", async (req) => {
    const items = await prisma.memory.findMany({
      where: { userId: req.userId },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { sourceGen: { select: { imageUrls: true } } },
    });
    return { items: items.map(toMemoryDto) };
  });

  app.post("/memories", async (req, reply) => {
    const body = parseBody(createMemorySchema, req.body);
    const memory = await prisma.memory.create({
      data: { userId: req.userId, ...body },
    });
    return reply.code(201).send(toMemoryDto(memory));
  });

  app.delete("/memories/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const memory = await prisma.memory.findUnique({ where: { id } });
    if (!memory) throw notFound("Memory not found");
    if (memory.userId !== req.userId) throw forbidden();
    await prisma.memory.delete({ where: { id } });
    return reply.code(204).send();
  });
}
