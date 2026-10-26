import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Prisma, prisma } from "@catgpt/db";
import {
  canTransitionVideoProject,
  createSourceFolderSchema,
  createVideoProjectSchema,
  estimateReelCostMicroUsd,
  reelScriptSchema,
  SOURCE_FOLDER_MAX_ASSETS,
  validateReelScript,
  VIDEO_MAX_SECONDS,
  VIDEO_MIME_TYPES,
  VIDEO_PROJECT_BUSY_STATUSES,
  type BrandProfile,
  type ReelBrief,
  type ReelQaReport,
  type ReelScript,
} from "@catgpt/types";
import { env } from "../env.js";
import { badRequest, notFound, parseBody, HttpError } from "../lib/errors.js";
import { findAccessibleBrand } from "../lib/brand.js";
import { getVideoBudget } from "../lib/video-usage.js";
import { isPlatformReady, looksLikeMp4, probeVideo, transcodeToMp4 } from "../services/social/media/video.js";
import { deleteStoredFiles, storeImage } from "../services/storage.js";
import { runScriptJob } from "../services/video-script.js";
import { checkRenderPlan, runRenderJob } from "../services/video-render.js";
import { scriptComplianceNotes } from "../services/video-script-logic.js";

const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

const brandQuerySchema = z.object({ brandId: z.string().uuid() });

/** Folder lookups go through the brand, so workspace members see what their workspace can see. */
async function loadFolder(userId: string, id: string) {
  const folder = await prisma.sourceFolder.findUnique({
    where: { id },
    include: { assets: { orderBy: { createdAt: "asc" } } },
  });
  if (!folder) throw notFound("Folder not found");
  await findAccessibleBrand(userId, folder.brandId);
  return folder;
}

async function loadProject(userId: string, id: string) {
  const project = await prisma.videoProject.findUnique({ where: { id } });
  if (!project) throw notFound("Reel not found");
  const brand = await findAccessibleBrand(userId, project.brandId);
  return { project, profile: (brand.profile as BrandProfile | null) ?? null };
}

type FolderRow = Prisma.SourceFolderGetPayload<{ include: { assets: true } }>;
type AssetRow = FolderRow["assets"][number];
type ProjectRow = Prisma.VideoProjectGetPayload<object>;

const toAssetDto = (a: AssetRow) => ({
  id: a.id,
  kind: a.kind,
  fileName: a.fileName,
  url: a.url,
  mimeType: a.mimeType,
  sizeBytes: a.sizeBytes,
  durationSec: a.durationSec,
  width: a.width,
  height: a.height,
  createdAt: a.createdAt.toISOString(),
});

const toFolderDto = (f: FolderRow) => ({
  id: f.id,
  brandId: f.brandId,
  name: f.name,
  assetCount: f.assets.length,
  videoCount: f.assets.filter((a) => a.kind === "video").length,
  imageCount: f.assets.filter((a) => a.kind === "image").length,
  createdAt: f.createdAt.toISOString(),
});

const toProjectDto = (p: ProjectRow, profile: BrandProfile | null) => {
  const script = (p.script as ReelScript | null) ?? null;
  return {
    id: p.id,
    brandId: p.brandId,
    folderId: p.folderId,
    title: p.title,
    brief: p.brief as ReelBrief,
    script,
    complianceNotes: scriptComplianceNotes(profile, script),
    qaReport: (p.qaReport as ReelQaReport | null) ?? null,
    status: p.status,
    errorMessage: p.errorMessage,
    outputUrl: p.outputUrl,
    estimatedCostUsd: p.estimatedCostMicroUsd / 1_000_000,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
};

/** Videos go through the same probe/transcode checks as Library uploads, so the editor can always read them. */
async function prepareSourceVideo(buffer: Buffer, mimeType: string) {
  if (!looksLikeMp4(buffer)) throw badRequest("That file isn't a valid MP4/MOV video");
  let info;
  try {
    info = await probeVideo(buffer);
  } catch (err) {
    throw badRequest(err instanceof Error ? err.message : "This file isn't a readable video");
  }
  if (info.durationSec > VIDEO_MAX_SECONDS) {
    throw badRequest(`Videos can be at most ${VIDEO_MAX_SECONDS / 60} minutes long`);
  }
  let out = buffer;
  let outMime = mimeType;
  if (!isPlatformReady(info) || mimeType !== "video/mp4") {
    try {
      out = await transcodeToMp4(buffer);
    } catch (err) {
      throw badRequest(err instanceof Error ? err.message : "Could not convert this video to MP4");
    }
    outMime = "video/mp4";
  }
  return {
    buffer: out,
    mimeType: outMime,
    durationSec: Math.round(info.durationSec * 10) / 10,
    width: info.width,
    height: info.height,
  };
}

export async function videoStudioRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  /* -------------------------------- budget -------------------------------- */

  app.get("/video/budget", async (req) => getVideoBudget(req.userId));

  /* -------------------------------- folders ------------------------------- */

  app.get("/video/folders", async (req) => {
    const { brandId } = parseBody(brandQuerySchema, req.query);
    await findAccessibleBrand(req.userId, brandId);
    const folders = await prisma.sourceFolder.findMany({
      where: { brandId },
      include: { assets: true },
      orderBy: { createdAt: "desc" },
    });
    return folders.map(toFolderDto);
  });

  app.post("/video/folders", async (req, reply) => {
    const body = parseBody(createSourceFolderSchema, req.body);
    await findAccessibleBrand(req.userId, body.brandId);
    const folder = await prisma.sourceFolder.create({
      data: { userId: req.userId, brandId: body.brandId, name: body.name },
      include: { assets: true },
    });
    return reply.code(201).send(toFolderDto(folder));
  });

  app.get<{ Params: { id: string } }>("/video/folders/:id", async (req) => {
    const folder = await loadFolder(req.userId, req.params.id);
    return { ...toFolderDto(folder), assets: folder.assets.map(toAssetDto) };
  });

  app.delete<{ Params: { id: string } }>("/video/folders/:id", async (req, reply) => {
    const folder = await loadFolder(req.userId, req.params.id);
    const busy = await prisma.videoProject.count({
      where: { folderId: folder.id, status: { in: [...VIDEO_PROJECT_BUSY_STATUSES] } },
    });
    if (busy > 0) throw new HttpError(409, "A reel using this folder is still rendering", "FOLDER_BUSY");
    // Delete the stored files first; the rows go with the folder (cascade).
    await deleteStoredFiles(folder.assets.map((a) => a.url));
    await prisma.sourceFolder.delete({ where: { id: folder.id } });
    return reply.code(204).send();
  });

  /**
   * One file per request, so the browser can upload a whole folder with a
   * progress bar and a failed file doesn't lose the rest.
   */
  app.post<{ Params: { id: string } }>("/video/folders/:id/assets", async (req, reply) => {
    const folder = await loadFolder(req.userId, req.params.id);
    if (folder.assets.length >= SOURCE_FOLDER_MAX_ASSETS) {
      throw badRequest(`A folder can hold at most ${SOURCE_FOLDER_MAX_ASSETS} files`);
    }

    const file = await req.file({ limits: { fileSize: env.MAX_VIDEO_UPLOAD_MB * 1024 * 1024 } });
    if (!file) throw badRequest("multipart field 'file' is required");
    const isVideo = (VIDEO_MIME_TYPES as readonly string[]).includes(file.mimetype);
    if (!isVideo && !ALLOWED_IMAGE_TYPES.has(file.mimetype)) {
      throw badRequest("Only PNG, JPEG or WebP images, or MP4/MOV videos, can be added to a folder");
    }
    const raw = await file.toBuffer();
    if (file.file.truncated) {
      throw badRequest(`File is larger than ${isVideo ? env.MAX_VIDEO_UPLOAD_MB : env.MAX_UPLOAD_MB} MB`);
    }
    const fileName = file.filename.slice(0, 200) || (isVideo ? "video" : "image");

    let buffer = raw;
    let mimeType = file.mimetype;
    let durationSec: number | null = null;
    let width: number | null = null;
    let height: number | null = null;
    if (isVideo) {
      const prepared = await prepareSourceVideo(raw, file.mimetype);
      buffer = prepared.buffer;
      mimeType = prepared.mimeType;
      durationSec = prepared.durationSec;
      width = prepared.width;
      height = prepared.height;
    } else if (raw.byteLength > env.MAX_UPLOAD_MB * 1024 * 1024) {
      throw badRequest(`Images must be under ${env.MAX_UPLOAD_MB} MB`);
    }

    const url = await storeImage({
      buffer,
      mimeType,
      keyPrefix: `video-sources/${req.userId}`,
    });
    const asset = await prisma.sourceAsset.create({
      data: {
        folderId: folder.id,
        kind: isVideo ? "video" : "image",
        fileName,
        url,
        mimeType,
        sizeBytes: buffer.byteLength,
        durationSec,
        width,
        height,
      },
    });
    return reply.code(201).send(toAssetDto(asset));
  });

  app.delete<{ Params: { id: string; assetId: string } }>(
    "/video/folders/:id/assets/:assetId",
    async (req, reply) => {
      const folder = await loadFolder(req.userId, req.params.id);
      const asset = folder.assets.find((a) => a.id === req.params.assetId);
      if (!asset) throw notFound("File not found");
      await deleteStoredFiles([asset.url]);
      await prisma.sourceAsset.delete({ where: { id: asset.id } });
      return reply.code(204).send();
    },
  );

  /* -------------------------------- projects ------------------------------ */

  app.get("/video/projects", async (req) => {
    const { brandId } = parseBody(brandQuerySchema, req.query);
    const brand = await findAccessibleBrand(req.userId, brandId);
    const profile = (brand.profile as BrandProfile | null) ?? null;
    const projects = await prisma.videoProject.findMany({
      where: { brandId },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return projects.map((p) => toProjectDto(p, profile));
  });

  app.post("/video/projects", async (req, reply) => {
    const body = parseBody(createVideoProjectSchema, req.body);
    const brand = await findAccessibleBrand(req.userId, body.brandId);
    if (body.folderId) {
      const folder = await prisma.sourceFolder.findUnique({ where: { id: body.folderId } });
      if (!folder || folder.brandId !== body.brandId) {
        throw badRequest("The folder must belong to the same brand");
      }
    }
    const { brief } = body;
    const project = await prisma.videoProject.create({
      data: {
        userId: req.userId,
        brandId: body.brandId,
        folderId: body.folderId ?? null,
        title: body.title,
        brief: brief as Prisma.InputJsonValue,
        estimatedCostMicroUsd: estimateReelCostMicroUsd(brief.videoModel, brief.resolution, brief.durationSec),
      },
    });
    return reply.code(201).send(toProjectDto(project, (brand.profile as BrandProfile | null) ?? null));
  });

  app.get<{ Params: { id: string } }>("/video/projects/:id", async (req) => {
    const { project, profile } = await loadProject(req.userId, req.params.id);
    return toProjectDto(project, profile);
  });

  app.delete<{ Params: { id: string } }>("/video/projects/:id", async (req, reply) => {
    const { project } = await loadProject(req.userId, req.params.id);
    if ((VIDEO_PROJECT_BUSY_STATUSES as readonly string[]).includes(project.status)) {
      throw new HttpError(409, "This reel is still rendering. Cancel it first.", "PROJECT_BUSY");
    }
    await prisma.videoProject.delete({ where: { id: project.id } });
    return reply.code(204).send();
  });

  /* ---------------------------------- script ------------------------------ */

  /**
   * Starts the script job and returns at once with status `scripting`; the
   * page polls GET /video/projects/:id until it reads `scripted` or `failed`.
   * Only draft, scripted or failed reels can be (re)scripted.
   */
  app.post<{ Params: { id: string } }>("/video/projects/:id/script", async (req, reply) => {
    const { project, profile } = await loadProject(req.userId, req.params.id);
    if (!canTransitionVideoProject(project.status, "scripting")) {
      throw new HttpError(409, "This reel can't be scripted right now", "INVALID_STATE");
    }
    const claimed = await prisma.videoProject.updateMany({
      where: { id: project.id, status: project.status },
      data: { status: "scripting", errorMessage: null },
    });
    if (claimed.count === 0) throw new HttpError(409, "This reel changed while starting. Try again.", "INVALID_STATE");
    void runScriptJob(project.id);
    const fresh = await prisma.videoProject.findUniqueOrThrow({ where: { id: project.id } });
    return reply.code(202).send(toProjectDto(fresh, profile));
  });

  /** Manual edit of a scripted reel. The whole script is sent and checked again. */
  app.put<{ Params: { id: string } }>("/video/projects/:id/script", async (req, reply) => {
    const { project, profile } = await loadProject(req.userId, req.params.id);
    if (project.status !== "scripted") {
      throw new HttpError(409, "Only a scripted reel can be edited", "INVALID_STATE");
    }
    const script = parseBody(reelScriptSchema, req.body);
    const brief = project.brief as ReelBrief;
    const problems = validateReelScript(script, brief.durationSec);
    if (problems.length) throw badRequest(problems.join(" "));
    const saved = await prisma.videoProject.updateMany({
      where: { id: project.id, status: "scripted" },
      data: { script: script as unknown as Prisma.InputJsonValue },
    });
    if (saved.count === 0) throw new HttpError(409, "This reel changed while saving. Reload and try again.", "INVALID_STATE");
    const fresh = await prisma.videoProject.findUniqueOrThrow({ where: { id: project.id } });
    return reply.send(toProjectDto(fresh, profile));
  });

  /**
   * Starts the render. Footage-only reels for now: the plan is checked here so
   * problems come back at once, then the job runs in the background and ends in
   * `review` or `failed`.
   */
  app.post<{ Params: { id: string } }>("/video/projects/:id/render", async (req, reply) => {
    const { project, profile } = await loadProject(req.userId, req.params.id);
    if (!project.script) {
      throw new HttpError(409, "Write and review the script before rendering", "INVALID_STATE");
    }
    // Generated shots go through the video model first (status `generating`); footage and motion go straight to `editing`.
    const hasGenerated = (project.script as unknown as ReelScript).shots.some((s) => s.kind === "generate");
    const target = hasGenerated ? "generating" : "editing";
    if (!canTransitionVideoProject(project.status, target)) {
      throw new HttpError(409, "This reel can't be rendered right now", "INVALID_STATE");
    }
    const folder = project.folderId
      ? await prisma.sourceFolder.findUnique({ where: { id: project.folderId }, include: { assets: true } })
      : null;
    const plan = checkRenderPlan(
      project.script as unknown as ReelScript,
      (folder?.assets ?? []).map((a) => ({ fileName: a.fileName, kind: a.kind, durationSec: a.durationSec })),
    );
    if (!plan.ok) throw badRequest(plan.problems.join(" "));
    const claimed = await prisma.videoProject.updateMany({
      where: { id: project.id, status: project.status },
      data: { status: target, errorMessage: null },
    });
    if (claimed.count === 0) throw new HttpError(409, "This reel changed while starting. Try again.", "INVALID_STATE");
    void runRenderJob(project.id);
    const fresh = await prisma.videoProject.findUniqueOrThrow({ where: { id: project.id } });
    return reply.code(202).send(toProjectDto(fresh, profile));
  });

  /**
   * Approves a reviewed reel. It is added to the Library as a completed video, so
   * the existing share and social flow can post it. Nothing is posted here.
   */
  app.post<{ Params: { id: string } }>("/video/projects/:id/approve", async (req, reply) => {
    const { project, profile } = await loadProject(req.userId, req.params.id);
    if (project.status !== "review" || !project.outputUrl) {
      throw new HttpError(409, "Only a rendered reel that is ready for review can be approved", "INVALID_STATE");
    }
    const claimed = await prisma.videoProject.updateMany({
      where: { id: project.id, status: "review" },
      data: { status: "approved" },
    });
    if (claimed.count === 0) throw new HttpError(409, "This reel changed while approving. Reload and try again.", "INVALID_STATE");
    const brief = project.brief as ReelBrief;
    const generation = await prisma.generation.create({
      data: {
        userId: req.userId,
        brandId: project.brandId,
        kind: "video",
        prompt: project.title,
        finalPrompt: project.title,
        provider: "reel-studio",
        model: brief.videoModel,
        imageUrls: [project.outputUrl],
        status: "completed",
        metadata: {
          mediaType: "video",
          source: "reel-studio",
          reelProjectId: project.id,
          durationSec: brief.durationSec,
          aspectRatio: brief.aspectRatio,
        },
      },
      select: { id: true },
    });
    const fresh = await prisma.videoProject.findUniqueOrThrow({ where: { id: project.id } });
    return reply.code(200).send({ ...toProjectDto(fresh, profile), generationId: generation.id });
  });
}
