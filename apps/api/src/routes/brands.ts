import type { FastifyInstance } from "fastify";
import { Prisma, prisma } from "@catgpt/db";
import {
  createBrandAssetSchema,
  createBrandSchema,
  updateBrandSchema,
  type BrandProfile,
} from "@catgpt/types";
import { HttpError, badRequest, notFound, parseBody } from "../lib/errors.js";
import { findWorkspaceForUser, workspaceAccess } from "../lib/workspace-access.js";
import {
  BRAND_INCLUDE,
  MAX_BRAND_ASSETS,
  buildBrandSummary,
  findAccessibleBrand,
  isOwnStorageUrl,
  toBrandDto,
} from "../lib/brand.js";

/**
 * Brands: one personal brand per user, and any number of brands inside a
 * workspace the user owns (separate "channels" under one workspace).
 */
export async function brandRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  /** Personal brand + every brand in the user's workspaces. */
  app.get("/brands", async (req) => {
    const items = await prisma.brand.findMany({
      where: {
        OR: [
          { userId: req.userId, workspaceId: null },
          { workspace: workspaceAccess(req.userId) },
        ],
      },
      orderBy: { createdAt: "asc" },
      include: BRAND_INCLUDE,
    });
    return { items: items.map(toBrandDto) };
  });

  app.post("/brands", async (req, reply) => {
    const body = parseBody(createBrandSchema, req.body);
    const profile: BrandProfile = body.profile ?? {};

    if (body.workspaceId) {
      await findWorkspaceForUser(req.userId, body.workspaceId);
    } else {
      const existing = await prisma.brand.findFirst({
        where: { userId: req.userId, workspaceId: null },
        select: { id: true },
      });
      if (existing) {
        throw new HttpError(
          409,
          "You already have a personal brand. Add more brands inside a workspace.",
        );
      }
    }

    try {
      const brand = await prisma.brand.create({
        data: {
          userId: req.userId,
          workspaceId: body.workspaceId ?? null,
          name: body.name.trim(),
          category: body.category?.trim() || null,
          profile: profile as Prisma.InputJsonValue,
          summary: buildBrandSummary(body.name.trim(), body.category, profile),
        },
        include: BRAND_INCLUDE,
      });
      return reply.code(201).send(toBrandDto(brand));
    } catch (err) {
      // Two racing requests both passed the check above - the partial unique
      // index in the migration is the real guard.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        throw new HttpError(409, "You already have a personal brand.");
      }
      throw err;
    }
  });

  app.get("/brands/:id", async (req) => {
    const { id } = req.params as { id: string };
    return toBrandDto(await findAccessibleBrand(req.userId, id));
  });

  /** Save questionnaire answers - the digest used in prompts is rebuilt here. */
  app.patch("/brands/:id", async (req) => {
    const { id } = req.params as { id: string };
    const current = await findAccessibleBrand(req.userId, id);
    const body = parseBody(updateBrandSchema, req.body);

    const name = body.name?.trim() || current.name;
    const category =
      body.category !== undefined
        ? body.category.trim() || null
        : current.category;
    const profile: BrandProfile = body.profile
      ? body.profile
      : (current.profile as BrandProfile);

    const brand = await prisma.brand.update({
      where: { id },
      data: {
        name,
        category,
        profile: profile as Prisma.InputJsonValue,
        summary: buildBrandSummary(name, category, profile),
      },
      include: BRAND_INCLUDE,
    });
    return toBrandDto(brand);
  });

  app.delete("/brands/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    await findAccessibleBrand(req.userId, id);
    await prisma.brand.delete({ where: { id } });
    return reply.code(204).send();
  });

  /** Attach an already-uploaded image (logo / product photo / reference). */
  app.post("/brands/:id/assets", async (req, reply) => {
    const { id } = req.params as { id: string };
    const brand = await findAccessibleBrand(req.userId, id);
    const body = parseBody(createBrandAssetSchema, req.body);
    if (!isOwnStorageUrl(body.url)) {
      throw badRequest("assets must be uploaded through the app first");
    }
    if (brand.assets.length >= MAX_BRAND_ASSETS) {
      throw badRequest(
        `a brand can hold up to ${MAX_BRAND_ASSETS} images - remove one first`,
      );
    }
    const asset = await prisma.brandAsset.create({
      data: {
        brandId: id,
        kind: body.kind,
        url: body.url,
        label: body.label?.trim() || null,
      },
    });
    return reply.code(201).send({
      id: asset.id,
      kind: asset.kind,
      url: asset.url,
      label: asset.label,
    });
  });

  app.delete("/brands/:id/assets/:assetId", async (req, reply) => {
    const { id, assetId } = req.params as { id: string; assetId: string };
    await findAccessibleBrand(req.userId, id);
    const res = await prisma.brandAsset.deleteMany({
      where: { id: assetId, brandId: id },
    });
    if (res.count === 0) throw notFound("Asset not found");
    return reply.code(204).send();
  });
}
