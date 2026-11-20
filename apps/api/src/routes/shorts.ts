import type { FastifyInstance } from "fastify";
import { updateShortsChannelSchema } from "@catgpt/types";
import { parseBody } from "../lib/errors.js";
import { shortsHealth } from "../services/shorts/env-check.js";
import { listChannels, updateChannel } from "../services/shorts/channels.js";

/** Shorts Factory API. Everything here is scoped to the signed-in user. */
export async function shortsRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  app.get("/shorts/health", async () => shortsHealth());

  app.get("/shorts/channels", async (req) => ({ items: await listChannels(req.userId) }));

  app.patch<{ Params: { id: string } }>("/shorts/channels/:id", async (req) => {
    const body = parseBody(updateShortsChannelSchema, req.body);
    return updateChannel(req.userId, req.params.id, body);
  });
}
