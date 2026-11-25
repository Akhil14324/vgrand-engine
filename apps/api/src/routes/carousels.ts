import type { FastifyInstance } from "fastify";
import { prisma } from "@catgpt/db";
import {
  addCarouselSlideSchema,
  CAROUSEL_MIN_SLIDES,
  carouselDesignSchema,
  regenerateCarouselSlideSchema,
  reorderCarouselSchema,
  replaceCarouselSlideImageSchema,
  updateCarouselSchema,
  updateCarouselSlideSchema,
} from "@catgpt/types";
import { badRequest, HttpError, notFound, parseBody } from "../lib/errors.js";
import { assertImageQuota } from "../lib/usage.js";
import { isTrustedImageUrl } from "../lib/urls.js";
import { buildZip } from "../lib/zip.js";
import { slideFileName } from "../services/carousel-logic.js";
import {
  addSlide,
  getCarouselForUser,
  reconcileCarousel,
  regenerateAllSlides,
  regenerateSlide,
  removeSlide,
  reorderSlides,
  replaceSlideImage,
  retryFailedSlides,
  toCarouselDto,
} from "../services/carousel.js";

/**
 * AI carousel gallery/editor. The carousel itself is created through
 * POST /generations (composer slide count or a "make a carousel" prompt);
 * these routes read it and edit individual slides.
 */
export async function carouselRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  async function load(userId: string, id: string) {
    const c = await getCarouselForUser(id, userId);
    if (!c) throw notFound("Carousel not found");
    return c;
  }
  async function fresh(userId: string, id: string) {
    return toCarouselDto(await load(userId, id));
  }
  function slideOf(c: Awaited<ReturnType<typeof load>>, slideId: string) {
    const slide = c.slides.find((s) => s.id === slideId);
    if (!slide) throw notFound("Slide not found");
    return slide;
  }
  const busy = () => new HttpError(409, "This slide is already being generated", "SLIDE_BUSY");

  app.get("/carousels/:id", async (req) => {
    const { id } = req.params as { id: string };
    return fresh(req.userId, id);
  });

  /** Title, design system or format; regenerateAll re-renders every slide with it. */
  app.patch("/carousels/:id", async (req) => {
    const { id } = req.params as { id: string };
    const body = parseBody(updateCarouselSchema, req.body);
    const c = await load(req.userId, id);
    if (c.status === "planning") throw badRequest("The carousel is still being planned");
    const design = body.design
      ? carouselDesignSchema.parse({ ...((c.design ?? {}) as object), ...body.design })
      : undefined;
    await prisma.carousel.update({
      where: { id },
      data: {
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(design ? { design: design as object } : {}),
        ...(body.aspect ? { aspect: body.aspect } : {}),
      },
    });
    // A new format cannot reuse images cut for the old one.
    if (body.regenerateAll || (body.aspect && body.aspect !== c.aspect)) {
      await assertImageQuota(req.userId, c.slides.length);
      await regenerateAllSlides((await load(req.userId, id))!);
    }
    return fresh(req.userId, id);
  });

  /** Edit a slide's text/visual; `regenerate` re-renders it with the new text. */
  app.patch("/carousels/:id/slides/:slideId", async (req) => {
    const { id, slideId } = req.params as { id: string; slideId: string };
    const body = parseBody(updateCarouselSlideSchema, req.body);
    const c = await load(req.userId, id);
    const slide = slideOf(c, slideId);
    if (body.regenerate && slide.status === "generating") throw busy();
    await prisma.carouselSlide.update({
      where: { id: slideId },
      data: {
        ...(body.title !== undefined ? { title: body.title.trim() } : {}),
        ...(body.body !== undefined ? { body: body.body.trim() } : {}),
        ...(body.visual !== undefined ? { visual: body.visual.trim() } : {}),
      },
    });
    if (body.regenerate) {
      await assertImageQuota(req.userId, 1);
      await regenerateSlide((await load(req.userId, id))!, slideId);
    }
    return fresh(req.userId, id);
  });

  /** Regenerate ONE slide; the other slides stay as they are and serve as its style reference. */
  app.post(
    "/carousels/:id/slides/:slideId/regenerate",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (req) => {
      const { id, slideId } = req.params as { id: string; slideId: string };
      const body = parseBody(regenerateCarouselSlideSchema, req.body ?? {});
      const c = await load(req.userId, id);
      if (slideOf(c, slideId).status === "generating") throw busy();
      await assertImageQuota(req.userId, 1);
      await regenerateSlide(c, slideId, body.instructions);
      return fresh(req.userId, id);
    },
  );

  /** Replace a slide's image with the user's own upload (fitted to the carousel size). */
  app.post("/carousels/:id/slides/:slideId/replace", async (req) => {
    const { id, slideId } = req.params as { id: string; slideId: string };
    const { imageUrl } = parseBody(replaceCarouselSlideImageSchema, req.body);
    if (!isTrustedImageUrl(imageUrl)) throw badRequest("images must be uploaded through the app");
    const c = await load(req.userId, id);
    slideOf(c, slideId);
    await replaceSlideImage(c, slideId, imageUrl);
    return fresh(req.userId, id);
  });

  app.delete("/carousels/:id/slides/:slideId", async (req) => {
    const { id, slideId } = req.params as { id: string; slideId: string };
    const c = await load(req.userId, id);
    slideOf(c, slideId);
    if (c.slides.length <= CAROUSEL_MIN_SLIDES) {
      throw badRequest(`A carousel needs at least ${CAROUSEL_MIN_SLIDES} slides`);
    }
    await removeSlide(c, slideId);
    return fresh(req.userId, id);
  });

  /** Add a slide: the AI writes it to fit the set, then it is generated. */
  app.post(
    "/carousels/:id/slides",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (req) => {
      const { id } = req.params as { id: string };
      const body = parseBody(addCarouselSlideSchema, req.body ?? {});
      const c = await load(req.userId, id);
      if (c.status === "planning") throw badRequest("The carousel is still being planned");
      await assertImageQuota(req.userId, 1);
      try {
        await addSlide(c, body.position, body.idea);
      } catch (err) {
        throw badRequest(err instanceof Error ? err.message : "Could not add the slide");
      }
      return fresh(req.userId, id);
    },
  );

  app.post("/carousels/:id/reorder", async (req) => {
    const { id } = req.params as { id: string };
    const { slideIds } = parseBody(reorderCarouselSchema, req.body);
    const c = await load(req.userId, id);
    try {
      await reorderSlides(c, slideIds);
    } catch (err) {
      throw badRequest(err instanceof Error ? err.message : "Invalid order");
    }
    return fresh(req.userId, id);
  });

  /** Retry only the slides that failed - finished slides are kept. */
  app.post("/carousels/:id/retry", async (req) => {
    const { id } = req.params as { id: string };
    const c = await load(req.userId, id);
    const failed = c.slides.filter((s) => s.status === "failed").length;
    if (failed > 0) {
      await assertImageQuota(req.userId, failed);
      await retryFailedSlides(c);
    } else {
      await reconcileCarousel(id);
    }
    return fresh(req.userId, id);
  });

  /** Every slide as its own image file, in slide order, in one ZIP. */
  app.get("/carousels/:id/download", async (req, reply) => {
    const { id } = req.params as { id: string };
    const c = await load(req.userId, id);
    const missing = c.slides.filter((s) => !s.imageUrl || s.status !== "completed");
    if (c.slides.length === 0 || missing.length > 0) {
      throw badRequest(
        `Slides ${missing.map((s) => s.position + 1).join(", ")} are not ready yet - the carousel is not complete.`,
      );
    }
    const files = await Promise.all(
      c.slides.map(async (s) => {
        const res = await fetch(s.imageUrl!, { signal: AbortSignal.timeout(30_000) });
        if (!res.ok) throw new HttpError(502, `Could not read slide ${s.position + 1}`);
        const type = res.headers.get("content-type") ?? "image/png";
        const ext = type.includes("jpeg") ? "jpg" : type.includes("webp") ? "webp" : "png";
        return {
          name: slideFileName(c.title || c.prompt, s.position, ext),
          data: Buffer.from(await res.arrayBuffer()),
        };
      }),
    );
    const zip = buildZip(files);
    const name = slideFileName(c.title || c.prompt, 0).replace(/-slide-01\.png$/, "");
    return reply
      .header("Content-Type", "application/zip")
      .header("Content-Disposition", `attachment; filename="${name}-carousel.zip"`)
      .send(zip);
  });
}
