import type { FastifyInstance } from "fastify";
import { Prisma, prisma } from "@catgpt/db";
import {
  createBrandAssetSchema,
  createBrandSchema,
  generateBrandMascotSchema,
  updateBrandSchema,
  upsertBrandMascotSchema,
  type BrandProfile,
} from "@catgpt/types";
import { HttpError, badRequest, notFound, parseBody } from "../lib/errors.js";
import { findWorkspaceForUser, workspaceAccess } from "../lib/workspace-access.js";
import { deleteStoredFiles } from "../services/storage.js";
import {
  BRAND_INCLUDE,
  MAX_BRAND_ASSETS,
  brandImageGuidance,
  brandReferenceUrls,
  buildBrandSummary,
  findAccessibleBrand,
  findManageableBrand,
  isOwnStorageUrl,
  toBrandDto,
} from "../lib/brand.js";
import {
  deleteBrandVoiceCache,
  deletePrivateObject,
} from "../services/storage.js";
import { env } from "../env.js";
import { enqueueGeneration } from "../services/queue.js";
import {
  assertImageQuota,
  quotaError,
  recordImageUsage,
  refundImageUsage,
} from "../lib/usage.js";
import { buildFinalPrompt, resolveProvider } from "../lib/prompt.js";

/**
 * Brands: users can own multiple personal brands and any number of brands
 * inside workspaces they own.
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
    }

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
  });

  app.get("/brands/:id", async (req) => {
    const { id } = req.params as { id: string };
    return toBrandDto(await findAccessibleBrand(req.userId, id));
  });

  /** Save questionnaire answers - the digest used in prompts is rebuilt here. */
  app.patch("/brands/:id", async (req) => {
    const { id } = req.params as { id: string };
    const current = await findManageableBrand(req.userId, id);
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
    await findManageableBrand(req.userId, id);
    // The cascade removes this brand's documents, assets and voice row — collect
    // their storage locations first so storage can be reclaimed safely.
    const [docs, assets, voice] = await Promise.all([
      prisma.document.findMany({
        where: { brandId: id },
        select: { storageUrl: true },
      }),
      prisma.brandAsset.findMany({
        where: { brandId: id },
        select: { url: true },
      }),
      prisma.brandVoice.findUnique({
        where: { brandId: id },
        select: { storageKey: true },
      }),
    ]);
    // A storage failure aborts the row delete so the private voice key cannot
    // be orphaned by the BrandVoice FK cascade.
    try {
      await deleteBrandVoiceCache(id);
      if (voice) await deletePrivateObject(voice.storageKey);
    } catch {
      throw new HttpError(
        502,
        "couldn't remove the brand's saved voice audio — nothing was deleted, please try again",
      );
    }
    await prisma.brand.delete({ where: { id } });
    const assetUrls = assets.map((a) => a.url);
    // An uploaded image can be attached to more than one brand — only remove
    // files nothing else still references.
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

  /** Create/replace the one canonical mascot identity for this brand. */
  app.put("/brands/:id/mascot", async (req) => {
    const { id } = req.params as { id: string };
    const brand = await findManageableBrand(req.userId, id);
    const body = parseBody(upsertBrandMascotSchema, req.body);
    if (!isOwnStorageUrl(body.url)) {
      throw badRequest("mascot images must be uploaded or generated in the app");
    }
    if (!brand.mascot && brand.assets.length >= MAX_BRAND_ASSETS) {
      throw badRequest(
        `a brand can hold up to ${MAX_BRAND_ASSETS} images - remove one first`,
      );
    }

    const name = body.name.trim();
    const description = body.description.trim();
    const asset =
      brand.mascot?.asset.url === body.url
        ? await prisma.brandAsset.update({
            where: { id: brand.mascot.assetId },
            data: { kind: "mascot", label: name },
          })
        : await prisma.brandAsset.create({
            data: {
              brandId: id,
              kind: "mascot",
              url: body.url,
              label: name,
            },
          });

    const mascot = await prisma.brandMascot.upsert({
      where: { brandId: id },
      update: {
        assetId: asset.id,
        name,
        description,
        status: "active",
      },
      create: {
        brandId: id,
        assetId: asset.id,
        name,
        description,
        status: "active",
      },
      include: { asset: true },
    });

    // Replacing the mascot should not keep the old image first in every future
    // reference list. Keep it available as a normal reference asset instead.
    if (brand.mascot && brand.mascot.assetId !== asset.id) {
      if (brand.assets.length >= MAX_BRAND_ASSETS) {
        await prisma.brandAsset.delete({
          where: { id: brand.mascot.assetId },
        });
        const stillUsed = await prisma.brandAsset.count({
          where: { url: brand.mascot.asset.url },
        });
        if (!stillUsed) await deleteStoredFiles([brand.mascot.asset.url]);
      } else {
        await prisma.brandAsset.update({
          where: { id: brand.mascot.assetId },
          data: { kind: "reference" },
        });
      }
    }

    return {
      id: mascot.id,
      brandId: mascot.brandId,
      assetId: mascot.assetId,
      url: mascot.asset.url,
      name: mascot.name,
      description: mascot.description,
      status: mascot.status,
      createdAt: mascot.createdAt.toISOString(),
      updatedAt: mascot.updatedAt.toISOString(),
    };
  });

  /** Remove mascot identity; the image remains as a normal brand reference. */
  app.delete("/brands/:id/mascot", async (req, reply) => {
    const { id } = req.params as { id: string };
    const brand = await findManageableBrand(req.userId, id);
    if (!brand.mascot) throw notFound("Mascot not found");
    await prisma.brandAsset.update({
      where: { id: brand.mascot.assetId },
      data: { kind: "reference" },
    });
    await prisma.brandMascot.delete({ where: { brandId: id } });
    return reply.code(204).send();
  });

  /** Generate a candidate mascot; saving it is a separate explicit action. */
  app.post("/brands/:id/mascot/generate", async (req, reply) => {
    const { id } = req.params as { id: string };
    const brand = await findManageableBrand(req.userId, id);
    const body = parseBody(generateBrandMascotSchema, req.body);
    await assertImageQuota(req.userId);

    const profile = (brand.profile ?? {}) as BrandProfile;
    const brief = [
      body.prompt?.trim() ||
        `Design one distinctive mascot character for ${brand.name}.`,
      body.name?.trim() ? `Mascot name: ${body.name.trim()}.` : null,
      body.description?.trim()
        ? `Mascot direction: ${body.description.trim()}.`
        : null,
      "Show one clear full-body character, front-facing, centered on a clean plain background. Give it a simple repeatable silhouette, memorable face, limited brand-colour palette, and friendly personality suitable for reuse across social posts. Do not include a logo, watermark, scene, or extra characters unless the request explicitly asks.",
    ]
      .filter(Boolean)
      .join("\n");
    const refs = brandReferenceUrls(
      brand.assets.filter((a) => a.kind !== "mascot"),
    );
    const generation = await prisma.generation.create({
      data: {
        userId: req.userId,
        kind: "image",
        prompt: brief,
        finalPrompt:
          buildFinalPrompt(null, brief) +
          brandImageGuidance(
            brand.name,
            profile,
            brand.assets.some((a) => a.kind === "logo"),
            brand.mascot,
          ),
        provider: resolveProvider(null),
        metadata: {
          brandId: brand.id,
          mascotCandidate: true,
          quality: body.quality ?? "medium",
          size: "1024x1024",
          ...(refs.length
            ? { referenceImageUrl: refs[0], referenceImageUrls: refs }
            : {}),
        },
      },
    });
    try {
      if (!(await recordImageUsage(req.userId, generation.id))) {
        throw quotaError(env.IMAGE_DAILY_LIMIT);
      }
      await enqueueGeneration(generation.id, { background: true });
    } catch (err) {
      await Promise.allSettled([
        refundImageUsage(generation.id),
        prisma.generation.update({
          where: { id: generation.id },
          data: { status: "failed", error: "Could not start mascot generation" },
        }),
      ]);
      throw err;
    }
    return reply.code(202).send({
      generationId: generation.id,
      status: "pending",
    });
  });

  /** Attach an already-uploaded image (logo / product photo / reference). */
  app.post("/brands/:id/assets", async (req, reply) => {
    const { id } = req.params as { id: string };
    const brand = await findManageableBrand(req.userId, id);
    const body = parseBody(createBrandAssetSchema, req.body);
    if (body.kind === "mascot") {
      throw badRequest("save mascot images through the brand mascot endpoint");
    }
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
    await findManageableBrand(req.userId, id);
    const asset = await prisma.brandAsset.findFirst({
      where: { id: assetId, brandId: id },
      select: { id: true, url: true },
    });
    if (!asset) throw notFound("Asset not found");
    await prisma.brandAsset.delete({ where: { id: asset.id } });
    // The same upload may back another brand's asset — only remove the file
    // when nothing else references it.
    const stillUsed = await prisma.brandAsset.count({
      where: { url: asset.url },
    });
    if (!stillUsed) await deleteStoredFiles([asset.url]);
    return reply.code(204).send();
  });
}
