import type { FastifyInstance, FastifyRequest } from "fastify";
import { prisma } from "@prompthub/db";
import {
  createGenerationSchema,
  regenerateGenerationSchema,
  type GenerationEvent,
} from "@prompthub/types";
import { badRequest, forbidden, notFound, parseBody } from "../lib/errors.js";
import { buildFinalPrompt, resolveProvider } from "../lib/prompt.js";
import { toGenerationDto } from "../lib/serialize.js";
import { enqueueGeneration } from "../services/queue.js";
import { subscribeGenerationEvents } from "../services/events.js";
import { env } from "../env.js";

async function loadOwned(req: FastifyRequest, id: string) {
  const generation = await prisma.generation.findUnique({
    where: { id },
    include: {
      theme: { select: { id: true, slug: true, label: true, icon: true } },
    },
  });
  if (!generation) throw notFound("Generation not found");
  if (generation.userId !== req.userId) throw forbidden();
  return generation;
}

export async function generationRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  /** Create a generation job. New ideas route to gpt-image-2.5-flare. */
  app.post("/generations", async (req, reply) => {
    const body = parseBody(createGenerationSchema, req.body);

    let theme = null;
    if (body.themeSlug) {
      theme = await prisma.theme.findUnique({
        where: { slug: body.themeSlug },
      });
      if (!theme || !theme.isActive) {
        throw notFound(`Theme "/${body.themeSlug}" not found`);
      }
    }
    if (body.parentId) await loadOwned(req, body.parentId);

    const generation = await prisma.generation.create({
      data: {
        userId: req.userId,
        themeId: theme?.id ?? null,
        prompt: body.prompt,
        finalPrompt: buildFinalPrompt(theme, body.prompt),
        provider: resolveProvider(theme, body.provider),
        parentId: body.parentId ?? null,
        metadata: {
          referenceImageUrl: body.referenceImageUrl,
          quality: body.quality ?? "low",
          size: body.size ?? "auto",
        },
      },
    });
    await enqueueGeneration(generation.id);
    return reply
      .code(202)
      .send({ generationId: generation.id, status: "pending" });
  });

  /** Paginated history — the "memory" feed. */
  app.get("/generations", async (req) => {
    const q = req.query as { themeSlug?: string; cursor?: string; limit?: string };
    const limit = Math.min(Number(q.limit) || 30, 100);
    const items = await prisma.generation.findMany({
      where: {
        userId: req.userId,
        ...(q.themeSlug ? { theme: { slug: q.themeSlug } } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: limit + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
      include: {
        theme: { select: { id: true, slug: true, label: true, icon: true } },
      },
    });
    const hasMore = items.length > limit;
    const page = hasMore ? items.slice(0, limit) : items;
    return {
      items: page.map(toGenerationDto),
      nextCursor: hasMore ? page[page.length - 1]!.id : null,
    };
  });

  app.get("/generations/:id", async (req) => {
    const { id } = req.params as { id: string };
    return toGenerationDto(await loadOwned(req, id));
  });

  app.delete("/generations/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    await loadOwned(req, id);
    await prisma.generation.delete({ where: { id } });
    return reply.code(204).send();
  });

  /**
   * Re-run with an edited prompt — routes to gpt-image-2.5-sunburst and links
   * to the source via parentId, passing the parent's image as the reference.
   */
  app.post("/generations/:id/regenerate", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parent = await loadOwned(req, id);
    const body = parseBody(regenerateGenerationSchema, req.body);

    const referenceImageUrl = parent.imageUrls[0];
    if (!referenceImageUrl) {
      throw badRequest("Parent generation has no image to edit");
    }
    const prompt = body.prompt ?? parent.prompt;
    const theme = parent.themeId
      ? await prisma.theme.findUnique({ where: { id: parent.themeId } })
      : null;
    const parentMeta = (parent.metadata ?? {}) as Record<string, unknown>;

    const child = await prisma.generation.create({
      data: {
        userId: req.userId,
        themeId: parent.themeId,
        prompt,
        finalPrompt: buildFinalPrompt(theme, prompt),
        provider: resolveProvider(theme, parent.provider),
        parentId: parent.id,
        metadata: {
          referenceImageUrl,
          quality: body.quality ?? parentMeta.quality ?? "low",
          size: parentMeta.size ?? "auto",
        },
      },
    });
    await enqueueGeneration(child.id);
    return reply.code(202).send({ generationId: child.id, status: "pending" });
  });

  /** SSE stream for the live "generating..." state. Token may come via ?token=. */
  app.get("/generations/:id/events", async (req, reply) => {
    const { id } = req.params as { id: string };
    const generation = await loadOwned(req, id);

    await reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      "Access-Control-Allow-Origin": env.WEB_ORIGIN,
    });

    const send = (evt: GenerationEvent) =>
      reply.raw.write(`data: ${JSON.stringify(evt)}\n\n`);

    send({
      generationId: generation.id,
      status: generation.status as GenerationEvent["status"],
      imageUrls: generation.imageUrls,
      error: generation.error,
    });
    if (generation.status === "completed" || generation.status === "failed") {
      reply.raw.end();
      return;
    }

    const heartbeat = setInterval(() => reply.raw.write(": ping\n\n"), 25_000);
    const unsubscribe = subscribeGenerationEvents((evt) => {
      if (evt.generationId !== generation.id) return;
      send(evt);
      if (evt.status === "completed" || evt.status === "failed") cleanup();
    });
    const cleanup = () => {
      clearInterval(heartbeat);
      unsubscribe();
      reply.raw.end();
    };
    req.raw.on("close", cleanup);
  });
}
