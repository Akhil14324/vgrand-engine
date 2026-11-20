import type { FastifyInstance } from "fastify";
import { updateShortsChannelSchema } from "@catgpt/types";
import { parseBody } from "../lib/errors.js";
import { shortsHealth } from "../services/shorts/env-check.js";
import { z } from "zod";
import { getOwnedChannel, listChannels, updateChannel } from "../services/shorts/channels.js";
import { createVideo } from "../services/shorts/pipeline.js";
import { HttpError } from "../lib/errors.js";

/** Shorts Factory API. Everything here is scoped to the signed-in user. */
export async function shortsRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  app.get("/shorts/health", async () => shortsHealth());

  app.get("/shorts/channels", async (req) => ({ items: await listChannels(req.userId) }));

  app.patch<{ Params: { id: string } }>("/shorts/channels/:id", async (req) => {
    const body = parseBody(updateShortsChannelSchema, req.body);
    return updateChannel(req.userId, req.params.id, body);
  });

  /** "Generate now": one Path B/C video outside the schedule. `offline` = local fixtures, never uploadable. */
  app.post<{ Params: { id: string } }>("/shorts/channels/:id/generate", async (req, reply) => {
    const body = parseBody(z.object({ offline: z.boolean().default(false) }), req.body ?? {});
    const channel = await getOwnedChannel(req.userId, req.params.id);
    if (channel.path === "A") throw new HttpError(400, "Path A channels ingest files rendered elsewhere; drop an MP4 into the ingest folder or upload one", "PATH_A");
    const { video } = await createVideo({ channelId: channel.id, source: body.offline ? "dry_run" : "manual" });
    return reply.code(202).send({ id: video.id, status: video.status });
  });
}
