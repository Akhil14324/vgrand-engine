import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "@catgpt/db";
import { applyBrandKitSchema, type BrandAssetDto } from "@catgpt/types";
import { badRequest, forbidden, notFound, parseBody } from "../lib/errors.js";
import { findManageableBrand, loadBrandContext, MAX_BRAND_ASSETS } from "../lib/brand.js";
import { composeBrandKit, fetchOwnBytes, isUsableFont, loadBrandKit } from "../services/brand-compose.js";
import { storeImage } from "../services/storage.js";

const MAX_FONT_BYTES = 5 * 1024 * 1024;
const MAX_BRAND_FONTS = 4;
const idParams = z.object({ id: z.string().uuid() });

/** Brand kit: font upload and "apply brand kit" on an existing image. */
export async function brandKitRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  /** Upload a TTF / OTF / WOFF / WOFF2 font for headline and CTA text. */
  app.post("/brands/:id/fonts", async (req, reply): Promise<BrandAssetDto> => {
    const { id } = parseBody(idParams, req.params);
    const brand = await findManageableBrand(req.userId, id);
    if (brand.assets.length >= MAX_BRAND_ASSETS) {
      throw badRequest(`a brand can hold up to ${MAX_BRAND_ASSETS} files - remove one first`);
    }
    if (brand.assets.filter((a) => a.kind === "font").length >= MAX_BRAND_FONTS) {
      throw badRequest(`a brand can hold up to ${MAX_BRAND_FONTS} fonts - remove one first`);
    }
    const file = await req.file();
    if (!file) throw badRequest("multipart field 'file' is required");
    const buffer = await file.toBuffer();
    if (buffer.byteLength > MAX_FONT_BYTES) throw badRequest("fonts are limited to 5 MB");
    if (!isUsableFont(buffer)) throw badRequest("that file isn't a usable font (use TTF, OTF, WOFF or WOFF2)");

    const ext = buffer.subarray(0, 4).toString("ascii") === "wOFF" ? "woff"
      : buffer.subarray(0, 4).toString("ascii") === "wOF2" ? "woff2"
      : buffer.subarray(0, 4).toString("ascii") === "OTTO" ? "otf" : "ttf";
    const label = file.filename.replace(/\.[^.]+$/, "").slice(0, 120) || "Font";
    const url = await storeImage({
      buffer,
      mimeType: "font/" + ext,
      ext,
      keyPrefix: `brand-fonts/${req.userId}`,
    });
    const asset = await prisma.brandAsset.create({ data: { brandId: id, kind: "font", url, label } });
    return reply.code(201).send({ id: asset.id, kind: "font", url: asset.url, label: asset.label });
  });

  /**
   * Stamps the real logo (and optional headline / CTA) onto a finished image.
   * Non-destructive: the result is a NEW generation whose parent is the original.
   */
  app.post(
    "/generations/:id/apply-brand-kit",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const { id } = parseBody(idParams, req.params);
      const body = parseBody(applyBrandKitSchema, req.body);

      const source = await prisma.generation.findUnique({ where: { id } });
      if (!source) throw notFound("Generation not found");
      if (source.userId !== req.userId) throw forbidden();
      const sourceUrl = source.imageUrls[0];
      if (source.status !== "completed" || !sourceUrl) throw badRequest("Only finished images can get the brand kit");

      // The caller must be able to use this brand (own or workspace member).
      if (!(await loadBrandContext(body.brandId, req.userId))) throw notFound("Brand not found");
      const kit = await loadBrandKit(body.brandId);
      if (!kit) throw notFound("Brand not found");
      if ((body.logo ?? true) && !kit.logoUrl && !body.headline && !body.cta) {
        throw badRequest("Upload a logo to this brand first, or add a headline");
      }

      let out: Buffer | null;
      try {
        out = await composeBrandKit(await fetchOwnBytes(sourceUrl), kit, {
          logo: body.logo ?? true,
          headline: body.headline,
          cta: body.cta,
        });
      } catch (err) {
        console.error("[brand-kit] compose failed:", err instanceof Error ? err.message : err);
        throw badRequest("Couldn't apply the brand kit to this image");
      }
      if (!out) throw badRequest("Nothing to apply - add a logo, headline or CTA");

      const newId = randomUUID();
      const url = await storeImage({ buffer: out, mimeType: "image/png", keyPrefix: `generations/${newId}/0` });
      const created = await prisma.generation.create({
        data: {
          id: newId,
          userId: req.userId,
          brandId: body.brandId,
          themeId: source.themeId,
          conversationId: source.conversationId,
          parentId: source.id,
          kind: "image",
          prompt: "Brand kit applied",
          finalPrompt: source.finalPrompt,
          provider: source.provider,
          imageUrls: [url],
          status: "completed",
          metadata: {
            brandId: body.brandId,
            brandKit: { logo: body.logo ?? true, headline: body.headline ?? null, cta: body.cta ?? null },
          },
        },
      });
      return reply.code(201).send({ id: created.id, imageUrl: url });
    },
  );
}
