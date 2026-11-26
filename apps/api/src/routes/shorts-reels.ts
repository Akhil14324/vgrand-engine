import { createWriteStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { pipeline } from "node:stream/promises";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { createReelSchema, REEL_MODES, regenerateReelSchema, regenerateReelScriptSchema, regenerateSceneSchema, updateReelSchema } from "@catgpt/types";
import { HttpError, parseBody } from "../lib/errors.js";
import {
  addMusicTrack,
  createReel,
  deleteReel,
  getReelDetail,
  listReels,
  reelOptions,
  regenerateReel,
  regenerateScene,
  regenerateScript,
  setSceneUpload,
  startRender,
  updateReel,
} from "../services/shorts/reel-service.js";
import { storageRoot } from "../services/shorts/storage.js";

const MAX_SCENE_UPLOAD = 200 * 1024 * 1024;
const MAX_MUSIC_UPLOAD = 30 * 1024 * 1024;

/** Streams the single file of a multipart request to a temp path. */
async function receiveFile(req: FastifyRequest, limit: number): Promise<{ tmp: string; name: string }> {
  const dir = path.join(storageRoot(), ".uploads");
  await mkdir(dir, { recursive: true });
  const file = await req.file({ limits: { fileSize: limit, files: 1 } });
  if (!file) throw new HttpError(400, "No file in the upload");
  const tmp = path.join(dir, randomUUID());
  try {
    await pipeline(file.file, createWriteStream(tmp));
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
  if (file.file.truncated) {
    await rm(tmp, { force: true });
    throw new HttpError(413, `File is larger than ${Math.round(limit / 1024 / 1024)} MB`);
  }
  return { tmp, name: file.filename };
}

/** Shorts Factory Reel Studio: brand-based and general-topic AI reels. Scoped to the signed-in user. */
export async function shortsReelRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  app.get("/shorts/reels/options", async (req) => reelOptions(req.userId));

  app.get("/shorts/reels", async (req) => {
    const q = parseBody(
      z.object({ mode: z.enum(REEL_MODES).optional(), status: z.enum(["processing", "completed", "failed", "draft"]).optional() }),
      req.query,
    );
    return { items: await listReels(req.userId, q) };
  });

  /**
   * The generator: creates the reel. With `autoRender` the whole reel is produced by one
   * background job (poll GET /shorts/reels/:id); without it, only the script is written.
   */
  app.post("/shorts/reels", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req, reply) => {
    const body = parseBody(createReelSchema, req.body);
    return reply.code(201).send(await createReel(req.userId, body));
  });

  app.get<{ Params: { id: string } }>("/shorts/reels/:id", async (req) => getReelDetail(req.userId, req.params.id));

  /** Edit title, script (scenes, order, durations, visual choices) and settings. */
  app.patch<{ Params: { id: string } }>("/shorts/reels/:id", async (req) => updateReel(req.userId, req.params.id, parseBody(updateReelSchema, req.body)));

  app.post<{ Params: { id: string } }>("/shorts/reels/:id/script", async (req) =>
    regenerateScript(req.userId, req.params.id, parseBody(regenerateReelScriptSchema, req.body ?? {}).instructions),
  );

  app.post<{ Params: { id: string; sceneId: string } }>("/shorts/reels/:id/scenes/:sceneId/regenerate", async (req) =>
    regenerateScene(req.userId, req.params.id, req.params.sceneId, parseBody(regenerateSceneSchema, req.body ?? {})),
  );

  /** Replace a scene's visual with your own image or video (multipart, one file). */
  app.post<{ Params: { id: string; sceneId: string } }>("/shorts/reels/:id/scenes/:sceneId/upload", async (req) => {
    const { tmp, name } = await receiveFile(req, MAX_SCENE_UPLOAD);
    try {
      return await setSceneUpload(req.userId, req.params.id, req.params.sceneId, tmp, name);
    } finally {
      await rm(tmp, { force: true });
    }
  });

  /** Step 6: render (or re-render) the MP4 in the background. Poll GET /shorts/reels/:id for progress. */
  app.post<{ Params: { id: string } }>("/shorts/reels/:id/render", async (req, reply) => reply.code(202).send(await startRender(req.userId, req.params.id)));

  /** Regenerate: a fresh take on the same brief (new script, visuals, voice, edit), optionally steered. */
  app.post<{ Params: { id: string } }>("/shorts/reels/:id/regenerate", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req, reply) =>
    reply.code(202).send(await regenerateReel(req.userId, req.params.id, parseBody(regenerateReelSchema, req.body ?? {}).instructions)),
  );

  app.delete<{ Params: { id: string } }>("/shorts/reels/:id", async (req, reply) => {
    await deleteReel(req.userId, req.params.id);
    return reply.code(204).send();
  });

  /** Adds a background-music track to the user's own reel music (use only tracks you have the rights to). */
  app.post("/shorts/reels/music", async (req, reply) => {
    const { tmp, name } = await receiveFile(req, MAX_MUSIC_UPLOAD);
    try {
      return reply.code(201).send({ key: await addMusicTrack(req.userId, tmp, name), options: await reelOptions(req.userId) });
    } finally {
      await rm(tmp, { force: true });
    }
  });
}
