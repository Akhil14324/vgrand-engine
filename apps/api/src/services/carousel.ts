import { prisma } from "@catgpt/db";
import {
  CAROUSEL_DIMENSIONS,
  CAROUSEL_MAX_SLIDES,
  type BrandProfile,
  type CarouselAspect,
  type CarouselDesign,
  type CarouselDto,
  type CarouselSlideDto,
  type CarouselSlideRole,
} from "@catgpt/types";
import { env } from "../env.js";
import { brandImageGuidance, loadBrandContext } from "../lib/brand.js";
import { brandWantsLogoOverlay } from "../lib/brand-identity.js";
import { buildFinalPrompt } from "../lib/prompt.js";
import { recordImageUsage, refundImageUsage } from "../lib/usage.js";
import { fitImageToSize } from "../lib/image-fit.js";
import { getClient, toMessages, userContent, type HistoryTurn } from "./chat.js";
import { enqueueGeneration } from "./queue.js";
import { publishGenerationEvent } from "./events.js";
import { storeImage } from "./storage.js";
import {
  composeCarouselSlidePrompt,
  deriveCarouselStatus,
  normalizeCarouselPlan,
  renderSizeForAspect,
  settleSlide,
  startableSlides,
  type CarouselPlan,
  type PlannedSlide,
} from "./carousel-logic.js";

/**
 * AI carousel pipeline. One Carousel row + one CarouselSlide row per slide;
 * every slide image is its own Generation run by the normal worker (so
 * quota, provider fallback, brand logo stamping, storage and SSE all behave
 * like any other image job). The chat shows the set through one host
 * Generation (metadata.carouselHost) whose status mirrors the carousel:
 * it is only "completed" once every requested slide has its own image.
 *
 * reconcileCarousel() is the single place that moves slide state forward;
 * the worker calls it when a slide job settles and the sweeper calls it for
 * anything that went quiet, so a lost hook can never strand a carousel.
 */

type CarouselRow = NonNullable<Awaited<ReturnType<typeof loadCarousel>>>;
type SlideRow = CarouselRow["slides"][number];

async function loadCarousel(id: string) {
  return prisma.carousel.findUnique({
    where: { id },
    include: { slides: { orderBy: { position: "asc" } } },
  });
}

export function toCarouselDto(c: CarouselRow): CarouselDto {
  const aspect = (c.aspect as CarouselAspect) in CAROUSEL_DIMENSIONS ? (c.aspect as CarouselAspect) : "square";
  return {
    id: c.id,
    generationId: c.generationId,
    brandId: c.brandId,
    prompt: c.prompt,
    title: c.title,
    aspect,
    width: CAROUSEL_DIMENSIONS[aspect].width,
    height: CAROUSEL_DIMENSIONS[aspect].height,
    design: (c.design ?? null) as CarouselDesign | null,
    status: c.status as CarouselDto["status"],
    error: c.error,
    slides: c.slides.map(
      (s): CarouselSlideDto => ({
        id: s.id,
        position: s.position,
        role: s.role as CarouselSlideRole,
        title: s.title,
        body: s.body,
        visual: s.visual,
        productLabel: s.productLabel,
        imageUrl: s.imageUrl,
        source: s.source === "upload" ? "upload" : "ai",
        status: s.status as CarouselSlideDto["status"],
        attempts: s.attempts,
        error: s.error,
      }),
    ),
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

export async function getCarouselForUser(id: string, userId: string) {
  const c = await loadCarousel(id);
  return c && c.userId === userId ? c : null;
}

// ---------------------------------------------------------------------------
// Planning

/** Per-turn and total caps so a long chat cannot blow the planner's context. */
const CONTEXT_TURN_CHARS = 1500;
const CONTEXT_TOTAL_CHARS = 20_000;
const MAX_PLANNER_IMAGES = 4;

/** Recent conversation as planner context, oldest turns dropped first. */
function plannerContext(history: HistoryTurn[]) {
  const trim = (s: string) => (s.length > CONTEXT_TURN_CHARS ? `${s.slice(0, CONTEXT_TURN_CHARS)}...` : s);
  const msgs = toMessages(history).map((m) => ({ ...m, content: trim(m.content) }));
  let total = 0;
  let start = msgs.length;
  while (start > 0 && total + msgs[start - 1]!.content.length <= CONTEXT_TOTAL_CHARS) {
    start--;
    total += msgs[start]!.content.length;
  }
  if (start % 2 === 1) start++;
  return msgs.slice(start);
}

type BrandCtx = NonNullable<Awaited<ReturnType<typeof loadBrandContext>>>;

function brandPlannerBlock(brand: BrandCtx | null): string {
  if (!brand) {
    return "General (unbranded) carousel: do not mention any brand, logo or company name, and do not set a product on any slide.";
  }
  const p = (brand.profile ?? {}) as BrandProfile;
  const products = brand.assets
    .filter((a) => a.kind === "product" && a.label?.trim())
    .map((a) => a.label!.trim());
  return [
    `Brand carousel for ${brand.name}. Keep every slide on-brand.`,
    brand.summary ? `About the brand: ${brand.summary.slice(0, 800)}` : null,
    p.colors?.length ? `Brand colours (use EXACTLY these as the palette): ${p.colors.join(", ")}.` : null,
    p.typography ? `Brand typography: ${p.typography}.` : null,
    p.visualStyle ? `Brand visual style: ${p.visualStyle}.` : null,
    p.tone ? `Tone of voice: ${p.tone}.` : null,
    p.defaultCta ? `Preferred call to action: "${p.defaultCta}".` : null,
    p.forbiddenWords?.length ? `Never use these words: ${p.forbiddenWords.join(", ")}.` : null,
    p.forbiddenClaims?.length ? `Never claim: ${p.forbiddenClaims.join(" | ")}.` : null,
    products.length
      ? `The brand's real product photos (labels): ${products.map((l) => JSON.stringify(l)).join(", ")}. On a slide whose subject is one of these products, set "product" to that exact label so the real photo is used; otherwise set "product" to null. Never invent other products.`
      : `The brand has no saved product photos: set "product" to null and do not depict invented branded packaging.`,
  ]
    .filter(Boolean)
    .join("\n");
}

const PLANNER_SYSTEM = (count: number, brandBlock: string) => `You are a senior social media designer planning an Instagram carousel of EXACTLY ${count} separate slides from the user's request. Return JSON only:
{"title":"...","design":{"palette":["#RRGGBB"],"typography":"...","background":"...","visualStyle":"...","layout":"..."},"slides":[{"role":"cover|content|cta","title":"...","body":"...","visual":"...","product":null}]}

Structure - decide the best content for the topic yourself:
- Slide 1 (role "cover"): an attractive title, an eye-catching visual, and the main topic introduced.
- Middle slides (role "content"): each covers ONE distinct sub-topic in a logical order (for "benefits of dry fruits": one fruit per slide - almonds, cashews, walnuts...), with a relevant visual of exactly that subject and one short informative line.
- Last slide (role "cta"): a short summary and a clear call to action.
- "slides" must contain exactly ${count} entries.

Copy: "title" at most 6 words; "body" one short sentence, at most 110 characters (the cover may use it as a subtitle); write in the user's language. Keep facts accurate and general - never invent prices, statistics, offers or claims the user did not give.
"visual": a concrete description of this slide's own imagery and composition (subject, angle, framing, where the text sits). Vary the composition from slide to slide while keeping one design identity.
"design": ONE design system reused on every slide - 3 to 5 hex colours, typography, background treatment, visual style, and layout/spacing grid.

Use the earlier conversation (if any) as source material for the topic, facts and tone.

${brandBlock}`;

async function requestPlan(
  messages: Parameters<ReturnType<typeof getClient>["chat"]["completions"]["create"]>[0]["messages"],
): Promise<unknown> {
  const res = await getClient().chat.completions.create({
    model: env.CHAT_MODEL,
    temperature: 0.5,
    response_format: { type: "json_object" },
    messages,
  });
  return JSON.parse(res.choices[0]?.message.content ?? "{}");
}

export async function planCarouselStructure(opts: {
  prompt: string;
  count: number;
  brand: BrandCtx | null;
  history: HistoryTurn[];
  attachedImages: string[];
}): Promise<CarouselPlan> {
  const p = (opts.brand?.profile ?? {}) as BrandProfile;
  const normalizeOpts = {
    fallbackTitle: opts.prompt.slice(0, 80),
    productLabels: (opts.brand?.assets ?? [])
      .filter((a) => a.kind === "product" && a.label?.trim())
      .map((a) => a.label!.trim()),
    brand: opts.brand ? { colors: p.colors, typography: p.typography, visualStyle: p.visualStyle } : null,
  };
  const messages = [
    { role: "system" as const, content: PLANNER_SYSTEM(opts.count, brandPlannerBlock(opts.brand)) },
    ...plannerContext(opts.history),
    {
      role: "user" as const,
      content: userContent(opts.prompt, opts.attachedImages.slice(0, MAX_PLANNER_IMAGES)),
    },
  ];
  // One retry when the model returns the wrong number of slides - the set is
  // never padded with invented filler or cut down silently.
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await requestPlan(
      attempt === 0
        ? messages
        : [
            ...messages,
            {
              role: "user" as const,
              content: `Your previous answer did not contain exactly ${opts.count} usable slides. Return the full JSON again with exactly ${opts.count} slides.`,
            },
          ],
    ).catch((err: Error) => {
      console.warn("[carousel] planner call failed:", err.message);
      return null;
    });
    const plan = normalizeCarouselPlan(raw, opts.count, normalizeOpts);
    if (plan) return plan;
  }
  throw new Error(`Could not plan ${opts.count} slides for this carousel - please try again.`);
}

/**
 * Runs after the route answered: plan -> slide rows -> reconcile (which
 * starts the cover, then the rest). Any failure lands on the row and the
 * host turn; nothing is reported as done.
 */
export async function runCarouselPlanning(
  carouselId: string,
  ctx: { count: number; history: HistoryTurn[]; attachedImages: string[] },
): Promise<void> {
  const c = await loadCarousel(carouselId);
  if (!c || c.status !== "planning") return;
  publishGenerationEvent({
    generationId: c.generationId,
    status: "processing",
    kind: "image",
    stage: "Planning carousel structure…",
  });
  try {
    const brand = c.brandId ? await loadBrandContext(c.brandId, c.userId).catch(() => null) : null;
    const plan = await planCarouselStructure({
      prompt: c.prompt,
      count: ctx.count,
      brand,
      history: ctx.history,
      attachedImages: ctx.attachedImages,
    });
    const moved = await prisma.carousel.updateMany({
      where: { id: carouselId, status: "planning" },
      data: { title: plan.title, design: plan.design as object, status: "generating", error: null },
    });
    if (moved.count === 0) return;
    await prisma.carouselSlide.createMany({
      data: plan.slides.map((s, i) => ({
        carouselId,
        position: i,
        role: s.role,
        title: s.title,
        body: s.body,
        visual: s.visual,
        productLabel: s.productLabel,
      })),
    });
    await reconcileCarousel(carouselId);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Carousel planning failed";
    console.error("[carousel] planning failed:", message);
    await prisma.carousel
      .update({ where: { id: carouselId }, data: { status: "failed", error: message } })
      .catch(() => {});
    await prisma.generation
      .updateMany({
        where: { id: c.generationId, status: { not: "cancelled" } },
        data: { status: "failed", error: message },
      })
      .catch(() => {});
    publishGenerationEvent({ generationId: c.generationId, status: "failed", error: message });
  }
}

/** The AI writes one more slide that fits between the existing ones. */
export async function planExtraSlide(
  c: CarouselRow,
  position: number,
  idea: string | undefined,
): Promise<PlannedSlide> {
  const brand = c.brandId ? await loadBrandContext(c.brandId, c.userId).catch(() => null) : null;
  const existing = c.slides
    .map((s) => `${s.position + 1}. [${s.role}] ${s.title} - ${s.body}`)
    .join("\n");
  const raw = await requestPlan([
    {
      role: "system",
      content: `You add ONE new content slide to an existing Instagram carousel. Return JSON only: {"slides":[{"role":"content","title":"...","body":"...","visual":"...","product":null}]}. "title" at most 6 words, "body" one short sentence (max 110 characters), "visual" a concrete description of the slide's own imagery. It must cover a point the other slides do not, fit at position ${position + 1}, and match their language and tone. Never invent prices, statistics or claims.\n\n${brandPlannerBlock(brand)}`,
    },
    {
      role: "user",
      content: `Carousel topic: ${c.prompt}\nTitle: ${c.title}\nExisting slides:\n${existing}\n${idea?.trim() ? `The new slide should be about: ${idea.trim()}` : "Pick the most useful missing point."}`,
    },
  ]);
  const plan = normalizeCarouselPlan(raw, 1, {
    fallbackTitle: c.title,
    productLabels: (brand?.assets ?? [])
      .filter((a) => a.kind === "product" && a.label?.trim())
      .map((a) => a.label!.trim()),
  });
  if (!plan) throw new Error("Could not write the new slide - please try again.");
  return { ...plan.slides[0]!, role: "content" };
}

// ---------------------------------------------------------------------------
// Slide rendering

/**
 * Starts (or restarts) the render job for one slide. The conditional claim
 * makes double clicks and racing reconciles harmless: a slide that is
 * already generating is never started twice.
 */
async function startSlide(
  c: CarouselRow,
  slide: SlideRow,
  opts: { retryOf?: string | null; instructions?: string } = {},
): Promise<void> {
  const claimed = await prisma.carouselSlide.updateMany({
    where: opts.retryOf
      ? { id: slide.id, status: "generating", generationId: opts.retryOf }
      : { id: slide.id, status: { not: "generating" } },
    data: {
      status: "generating",
      error: null,
      attempts: opts.retryOf ? { increment: 1 } : 1,
    },
  });
  if (claimed.count === 0) return;

  const fail = async (error: string) => {
    await prisma.carouselSlide
      .update({ where: { id: slide.id }, data: { status: "failed", error } })
      .catch(() => {});
  };

  try {
    const [brand, theme] = await Promise.all([
      c.brandId ? loadBrandContext(c.brandId, c.userId).catch(() => null) : Promise.resolve(null),
      c.themeId ? prisma.theme.findUnique({ where: { id: c.themeId } }) : Promise.resolve(null),
    ]);
    const aspect = (c.aspect as CarouselAspect) in CAROUSEL_DIMENSIONS ? (c.aspect as CarouselAspect) : "square";
    const design = (c.design ?? null) as CarouselDesign | null;
    if (!design) throw new Error("This carousel has no design yet");
    const profile = (brand?.profile ?? {}) as BrandProfile;
    const hasLogo = Boolean(brand?.assets.some((a) => a.kind === "logo"));
    const logoCorner =
      brand && hasLogo && brandWantsLogoOverlay(profile)
        ? (profile.logoPlacement?.corner ?? "bottom-right")
        : null;

    // Real product photo for this slide, only from the selected brand.
    const product = slide.productLabel
      ? brand?.assets.find(
          (a) => a.kind === "product" && a.label?.trim().toLowerCase() === slide.productLabel!.toLowerCase(),
        )
      : undefined;
    // Style reference: a finished AI slide of this set (cover first), so a
    // new or regenerated slide keeps the series' look.
    const fresh = await prisma.carouselSlide.findMany({
      where: { carouselId: c.id, status: "completed", imageUrl: { not: null }, id: { not: slide.id } },
      orderBy: { position: "asc" },
      select: { imageUrl: true, source: true },
    });
    const styleRef = (fresh.find((s) => s.source === "ai") ?? null)?.imageUrl ?? null;
    const referenceImageUrls = [...(product ? [product.url] : []), ...(styleRef ? [styleRef] : [])];

    const total = await prisma.carouselSlide.count({ where: { carouselId: c.id } });
    const slidePrompt = composeCarouselSlidePrompt(
      design,
      {
        role: slide.role as CarouselSlideRole,
        title: slide.title,
        body: slide.body,
        visual: slide.visual,
        productLabel: product ? slide.productLabel : null,
      },
      slide.position,
      total,
      {
        aspect,
        carouselTitle: c.title || c.prompt.slice(0, 80),
        brandName: brand?.name ?? null,
        logoCorner,
        hasStyleReference: Boolean(styleRef),
        hasProductReference: Boolean(product),
        instructions: opts.instructions,
      },
    );
    const dims = CAROUSEL_DIMENSIONS[aspect];
    const generation = await prisma.generation.create({
      data: {
        userId: c.userId,
        brandId: c.brandId,
        themeId: c.themeId,
        // Slides are not chat turns: the host turn shows the whole set.
        conversationId: null,
        kind: "image",
        prompt: `${c.title || "Carousel"} - slide ${slide.position + 1}${slide.title ? `: ${slide.title}` : ""}`,
        finalPrompt:
          buildFinalPrompt(theme, slidePrompt) +
          (brand
            ? brandImageGuidance(
                brand.name,
                profile,
                hasLogo,
                brand.mascot,
                Boolean(product),
              )
            : ""),
        provider: "openai",
        metadata: {
          quality: c.quality,
          size: renderSizeForAspect(aspect),
          referenceImageUrl: referenceImageUrls[0],
          referenceImageUrls,
          ...(c.brandId ? { brandId: c.brandId } : {}),
          carouselSlide: { carouselId: c.id, slideId: slide.id, position: slide.position },
          exactSize: { width: dims.width, height: dims.height },
        },
      },
    });
    await prisma.carouselSlide.update({
      where: { id: slide.id },
      data: { generationId: generation.id },
    });
    if (!(await recordImageUsage(c.userId, generation.id))) {
      await prisma.generation.update({
        where: { id: generation.id },
        data: { status: "failed", error: "Daily image limit reached" },
      });
      await fail("Daily image limit reached");
      return;
    }
    try {
      await enqueueGeneration(generation.id, { background: true });
    } catch (err) {
      await refundImageUsage(generation.id).catch(() => {});
      await prisma.generation
        .update({ where: { id: generation.id }, data: { status: "failed", error: "Could not start the job" } })
        .catch(() => {});
      throw err;
    }
  } catch (err) {
    console.error("[carousel] slide start failed:", err);
    await fail(err instanceof Error ? err.message : "Could not start this slide");
  }
}

// ---------------------------------------------------------------------------
// Reconcile

/** One reconcile at a time per carousel in this process; slide claims guard across processes. */
const running = new Map<string, Promise<void>>();

export function reconcileCarousel(carouselId: string): Promise<void> {
  const prev = running.get(carouselId) ?? Promise.resolve();
  const next = prev
    .catch(() => {})
    .then(() => reconcileOnce(carouselId))
    .catch((err) => console.error(`[carousel] reconcile ${carouselId} failed:`, err));
  running.set(carouselId, next);
  void next.finally(() => {
    if (running.get(carouselId) === next) running.delete(carouselId);
  });
  return next;
}

async function reconcileOnce(carouselId: string): Promise<void> {
  let c = await loadCarousel(carouselId);
  if (!c || c.status === "planning" || c.status === "failed") return;
  const host = await prisma.generation.findUnique({
    where: { id: c.generationId },
    select: { status: true },
  });
  if (!host) return;
  const stopped = host.status === "cancelled";

  // 1. Settle slides whose render job finished.
  const inFlight = c.slides.filter((s) => s.status === "generating");
  const gens = inFlight.length
    ? await prisma.generation.findMany({
        where: { id: { in: inFlight.map((s) => s.generationId).filter((x): x is string => Boolean(x)) } },
        select: { id: true, status: true, imageUrls: true, error: true },
      })
    : [];
  for (const slide of inFlight) {
    const gen = gens.find((g) => g.id === slide.generationId) ?? null;
    if (stopped && gen && (gen.status === "pending" || gen.status === "processing")) {
      await prisma.generation.updateMany({
        where: { id: gen.id, status: { in: ["pending", "processing"] } },
        data: { status: "cancelled", error: "Stopped" },
      });
      await refundImageUsage(gen.id).catch(() => {});
    }
    const action = stopped
      ? gen?.status === "completed" && gen.imageUrls[0]
        ? "complete"
        : "fail"
      : settleSlide({
          generationStatus: slide.generationId ? (gen?.status ?? null) : null,
          imageUrl: gen?.imageUrls[0] ?? null,
          attempts: slide.attempts,
          error: gen?.error ?? null,
          stopped,
        });
    if (action === "complete") {
      await prisma.carouselSlide.updateMany({
        where: { id: slide.id, status: "generating", generationId: slide.generationId },
        data: { status: "completed", imageUrl: gen!.imageUrls[0]!, source: "ai", error: null },
      });
    } else if (action === "fail") {
      await prisma.carouselSlide.updateMany({
        where: { id: slide.id, status: "generating", generationId: slide.generationId },
        data: {
          status: "failed",
          error: stopped ? "Stopped" : (gen?.error ?? "This slide could not be generated"),
        },
      });
    } else if (action === "retry") {
      console.warn(
        `[carousel] slide ${slide.position + 1} of ${carouselId} failed (${gen?.error ?? "no job"}), retrying (attempt ${slide.attempts + 1})`,
      );
      await startSlide(c, slide, { retryOf: slide.generationId });
    }
  }

  // 2. Start slides that are waiting (cover first, then the rest).
  c = (await loadCarousel(carouselId))!;
  if (stopped) {
    await prisma.carouselSlide.updateMany({
      where: { carouselId, status: "pending" },
      data: { status: "failed", error: "Stopped" },
    });
  } else {
    for (const slide of startableSlides(c.slides)) await startSlide(c, slide);
  }

  // 3. Roll the result up to the carousel and its chat turn.
  c = (await loadCarousel(carouselId))!;
  await syncHost(c);
}

/** Mirrors carousel state onto the host chat turn and publishes progress. */
async function syncHost(c: CarouselRow): Promise<void> {
  const status = c.slides.length ? deriveCarouselStatus(c.slides) : "failed";
  const total = c.slides.length;
  const done = c.slides.filter((s) => s.status === "completed" && s.imageUrl);
  const failed = c.slides.filter((s) => s.status === "failed");
  const imageUrls = done.map((s) => s.imageUrl!);
  const error =
    status === "partial"
      ? `${total - done.length} of ${total} slides could not be generated${failed[0]?.error ? ` (${failed[0].error})` : ""}. Retry the failed slides - the carousel is not complete yet.`
      : status === "failed"
        ? "This carousel has no slides."
        : null;
  await prisma.carousel.update({ where: { id: c.id }, data: { status, error } });

  const host = await prisma.generation.findUnique({
    where: { id: c.generationId },
    select: { status: true, metadata: true },
  });
  if (!host) return;
  const cancelled = host.status === "cancelled";
  if (status === "completed") {
    await prisma.generation.update({
      where: { id: c.generationId },
      data: {
        status: "completed",
        error: null,
        imageUrls,
        textResponse: `**${c.title || "Carousel"}** - all ${total} slides are ready (${CAROUSEL_DIMENSIONS[(c.aspect as CarouselAspect) in CAROUSEL_DIMENSIONS ? (c.aspect as CarouselAspect) : "square"].label}).`,
        metadata: { ...((host.metadata ?? {}) as object), slideCount: total },
      },
    });
    publishGenerationEvent({ generationId: c.generationId, status: "completed", imageUrls });
  } else if (status === "partial" || status === "failed") {
    await prisma.generation.update({
      where: { id: c.generationId },
      data: {
        status: cancelled ? "cancelled" : "failed",
        error,
        imageUrls,
        textResponse: null,
        metadata: { ...((host.metadata ?? {}) as object), slideCount: total },
      },
    });
    publishGenerationEvent({
      generationId: c.generationId,
      status: cancelled ? "cancelled" : "failed",
      error: error ?? undefined,
    });
  } else if (!cancelled) {
    await prisma.generation.update({
      where: { id: c.generationId },
      data: { status: "processing", error: null, imageUrls },
    });
    const active = c.slides.filter((s) => s.status === "generating").map((s) => s.position + 1);
    publishGenerationEvent({
      generationId: c.generationId,
      status: "processing",
      kind: "image",
      stage: `Generating slide${active.length > 1 ? "s" : ""} ${active.join(", ") || "…"} · ${done.length} of ${total} done`,
    });
  }
}

/** Puts a finished/failed carousel back into "generating" before new work. */
async function reopen(c: CarouselRow): Promise<void> {
  await prisma.carousel.update({ where: { id: c.id }, data: { status: "generating", error: null } });
  await prisma.generation.update({
    where: { id: c.generationId },
    data: { status: "processing", error: null },
  });
}

// ---------------------------------------------------------------------------
// User actions (routes/carousels.ts)

export async function regenerateSlide(c: CarouselRow, slideId: string, instructions?: string) {
  const slide = c.slides.find((s) => s.id === slideId);
  if (!slide) throw new Error("Slide not found");
  if (slide.status === "generating") return;
  await reopen(c);
  await startSlide(c, slide, { instructions });
  await reconcileCarousel(c.id);
}

export async function retryFailedSlides(c: CarouselRow) {
  const failed = c.slides.filter((s) => s.status === "failed");
  if (failed.length === 0) return;
  await reopen(c);
  for (const s of failed) {
    await prisma.carouselSlide.updateMany({
      where: { id: s.id, status: "failed" },
      data: { status: "pending", attempts: 0, error: null },
    });
  }
  await reconcileCarousel(c.id);
}

export async function regenerateAllSlides(c: CarouselRow) {
  await reopen(c);
  // Cancel anything still rendering with the old design.
  const live = c.slides.filter((s) => s.status === "generating" && s.generationId);
  if (live.length) {
    await prisma.generation.updateMany({
      where: { id: { in: live.map((s) => s.generationId!) }, status: { in: ["pending", "processing"] } },
      data: { status: "cancelled", error: "Superseded by a design change" },
    });
  }
  await prisma.carouselSlide.updateMany({
    where: { carouselId: c.id },
    data: { status: "pending", attempts: 0, error: null, generationId: null },
  });
  await reconcileCarousel(c.id);
}

export async function addSlide(c: CarouselRow, position: number | undefined, idea?: string) {
  if (c.slides.length >= CAROUSEL_MAX_SLIDES) {
    throw new Error(`A carousel can have at most ${CAROUSEL_MAX_SLIDES} slides`);
  }
  // Default: just before the final call-to-action slide.
  const at = Math.min(Math.max(position ?? c.slides.length - 1, 1), c.slides.length);
  const planned = await planExtraSlide(c, at, idea);
  await prisma.carouselSlide.updateMany({
    where: { carouselId: c.id, position: { gte: at } },
    data: { position: { increment: 1 } },
  });
  await prisma.carouselSlide.create({
    data: {
      carouselId: c.id,
      position: at,
      role: "content",
      title: planned.title,
      body: planned.body,
      visual: planned.visual,
      productLabel: planned.productLabel,
    },
  });
  await reopen(c);
  await reconcileCarousel(c.id);
}

export async function removeSlide(c: CarouselRow, slideId: string) {
  const slide = c.slides.find((s) => s.id === slideId);
  if (!slide) throw new Error("Slide not found");
  if (slide.generationId && slide.status === "generating") {
    await prisma.generation.updateMany({
      where: { id: slide.generationId, status: { in: ["pending", "processing"] } },
      data: { status: "cancelled", error: "Slide removed" },
    });
  }
  await prisma.carouselSlide.delete({ where: { id: slideId } });
  await renumber(c.id);
  await reconcileCarousel(c.id);
}

export async function reorderSlides(c: CarouselRow, slideIds: string[]) {
  const ids = new Set(c.slides.map((s) => s.id));
  if (slideIds.length !== ids.size || !slideIds.every((id) => ids.has(id))) {
    throw new Error("The new order must list every slide exactly once");
  }
  await Promise.all(
    slideIds.map((id, position) => prisma.carouselSlide.update({ where: { id }, data: { position } })),
  );
  await syncHost((await loadCarousel(c.id))!);
}

async function renumber(carouselId: string) {
  const slides = await prisma.carouselSlide.findMany({
    where: { carouselId },
    orderBy: { position: "asc" },
    select: { id: true, position: true },
  });
  await Promise.all(
    slides
      .map((s, i) => (s.position === i ? null : prisma.carouselSlide.update({ where: { id: s.id }, data: { position: i } })))
      .filter(Boolean),
  );
}

/** "Replace image": the user's own upload, fitted to the carousel's exact size. */
export async function replaceSlideImage(c: CarouselRow, slideId: string, imageUrl: string) {
  const slide = c.slides.find((s) => s.id === slideId);
  if (!slide) throw new Error("Slide not found");
  const res = await fetch(imageUrl, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`Could not read the uploaded image (${res.status})`);
  const aspect = (c.aspect as CarouselAspect) in CAROUSEL_DIMENSIONS ? (c.aspect as CarouselAspect) : "square";
  const dims = CAROUSEL_DIMENSIONS[aspect];
  const fitted = await fitImageToSize(Buffer.from(await res.arrayBuffer()), dims.width, dims.height);
  const url = await storeImage({
    buffer: fitted,
    mimeType: "image/png",
    keyPrefix: `carousels/${c.id}/${slide.id}-upload-${Date.now()}`,
  });
  if (slide.generationId && slide.status === "generating") {
    await prisma.generation.updateMany({
      where: { id: slide.generationId, status: { in: ["pending", "processing"] } },
      data: { status: "cancelled", error: "Replaced by an upload" },
    });
  }
  await prisma.carouselSlide.update({
    where: { id: slideId },
    data: { imageUrl: url, source: "upload", status: "completed", error: null, generationId: null },
  });
  await reconcileCarousel(c.id);
}

/** Sweeper hook: finish anything that went quiet (lost worker hook, crash mid-plan). */
export async function sweepCarousels(): Promise<void> {
  const stalePlanning = await prisma.carousel.findMany({
    where: { status: "planning", updatedAt: { lt: new Date(Date.now() - 10 * 60_000) } },
    select: { id: true, generationId: true },
    take: 50,
  });
  for (const c of stalePlanning) {
    const error = "Carousel planning was interrupted - please try again.";
    await prisma.carousel.update({ where: { id: c.id }, data: { status: "failed", error } });
    await prisma.generation.updateMany({
      where: { id: c.generationId, status: { in: ["pending", "processing"] } },
      data: { status: "failed", error },
    });
    publishGenerationEvent({ generationId: c.generationId, status: "failed", error });
  }
  const active = await prisma.carousel.findMany({
    where: { status: "generating", updatedAt: { lt: new Date(Date.now() - 2 * 60_000) } },
    select: { id: true },
    take: 50,
  });
  for (const c of active) await reconcileCarousel(c.id);
}
