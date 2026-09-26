import { prisma } from "@catgpt/db";
import type {
  BrandProfile,
  CalendarDayPostDto,
  CalendarDayPostRequest,
  CalendarFillRequest,
  CalendarPlanItemDto,
  CampaignPlanStatus,
  CampaignPostStatus,
  HolidayDto,
} from "@catgpt/types";
import { env } from "../env.js";
import { brandImageGuidance, brandReferenceUrls, findAccessibleBrand, loadBrandContext } from "../lib/brand.js";
import { badRequest, HttpError } from "../lib/errors.js";
import { buildFinalPrompt, CAMPAIGN_CREATIVE_STYLE, resolveProvider } from "../lib/prompt.js";
import { getImageUsage, recordImageUsage, refundImageUsage } from "../lib/usage.js";
import { planAutopilotPosts, safeTimezone } from "./campaign-autopilot.js";
import { enqueueGeneration } from "./queue.js";

const DAY_MS = 86_400_000;
const MAX_FILL_POSTS = 31;

/** Wall-clock time in an IANA zone -> the matching UTC instant (DST-safe). */
export function zonedToUtc(date: string, time: string, tz: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const guess = Date.UTC(y!, m! - 1, d!, hh, mm);
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  });
  const offset = (t: number) => {
    const parts = fmt.formatToParts(new Date(t));
    const g = (k: string) => Number(parts.find((p) => p.type === k)!.value);
    return Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second")) - t;
  };
  const first = guess - offset(guess);
  return new Date(guess - offset(first));
}

const todayIn = (tz: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

export async function listHolidays(from: string, to: string): Promise<HolidayDto[]> {
  const rows = await prisma.holiday.findMany({
    where: {
      date: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) },
      country: { in: ["IN", "ALL"] },
    },
    orderBy: [{ date: "asc" }, { name: "asc" }],
  });
  return rows.map((h) => ({
    id: h.id,
    date: isoDate(h.date),
    name: h.name,
    country: h.country,
    region: h.region,
    type: h.type as HolidayDto["type"],
  }));
}

/** date -> one holiday name (national/festival preferred over generic observances). */
async function holidayMap(dates: string[]): Promise<Record<string, string>> {
  if (!dates.length) return {};
  const rank = { national: 0, festival: 1, observance: 2 } as const;
  const rows = await listHolidays(dates[0]!, dates[dates.length - 1]!);
  const wanted = new Set(dates);
  const best: Record<string, HolidayDto> = {};
  for (const h of rows) {
    if (!wanted.has(h.date)) continue;
    const cur = best[h.date];
    if (!cur || rank[h.type] < rank[cur.type]) best[h.date] = h;
  }
  return Object.fromEntries(Object.entries(best).map(([d, h]) => [d, h.name]));
}

/** Create + enqueue an on-brand image generation, charging (and on failure refunding) the daily quota. */
async function startBrandImage(
  userId: string,
  brandId: string | null,
  prompt: string,
  meta: Record<string, unknown>,
  opts: {
    /** Set for edits: the new image revises this generation (edit mode + edit model). */
    parent?: { id: string; provider: string };
    /** Runs after the row exists but BEFORE it is queued, so a fast worker can't finish unlinked. */
    onCreated?: (generationId: string) => Promise<void>;
  } = {},
) {
  const usage = await getImageUsage(userId);
  if (usage.remaining <= 0) throw new HttpError(429, `Daily image limit reached (${usage.limit}/day)`);
  // Brandless drafts (e.g. a chat image) are edited without brand guidance.
  const brand = brandId ? await loadBrandContext(brandId, userId) : null;
  if (brandId && !brand) throw new HttpError(404, "Brand not found");
  const profile = (brand?.profile ?? {}) as BrandProfile;
  const refs = brand ? brandReferenceUrls(brand.assets, brand.mascot?.asset.url) : [];
  const generation = await prisma.generation.create({
    data: {
      userId,
      brandId: brand?.id ?? null,
      kind: "image",
      prompt,
      finalPrompt:
        buildFinalPrompt(null, prompt) +
        (brand
          ? brandImageGuidance(brand.name, profile, brand.assets.some((a) => a.kind === "logo"), brand.mascot) +
            CAMPAIGN_CREATIVE_STYLE
          : ""),
      provider: resolveProvider(null, opts.parent?.provider),
      parentId: opts.parent?.id ?? null,
      metadata: {
        ...(brand ? { brandId: brand.id } : {}),
        quality: env.CAMPAIGN_IMAGE_QUALITY,
        size: "1088x1360",
        ...(refs.length ? { referenceImageUrl: refs[0], referenceImageUrls: refs } : {}),
        ...meta,
      },
    },
  });
  try {
    await opts.onCreated?.(generation.id);
    if (!(await recordImageUsage(userId, generation.id))) {
      throw new HttpError(429, `Daily image limit reached (${usage.limit}/day)`);
    }
    await enqueueGeneration(generation.id, { background: true });
  } catch (err) {
    await prisma.generation
      .updateMany({
        where: { id: generation.id, status: { in: ["pending", "processing"] } },
        data: { status: "failed", error: "Could not start" },
      })
      .catch(() => {});
    await prisma.campaignPost
      .updateMany({
        where: { generationId: generation.id },
        data: { status: "failed", error: err instanceof Error ? err.message : "Could not start" },
      })
      .catch(() => {});
    await refundImageUsage(generation.id).catch(() => {});
    throw err;
  }
  return generation.id;
}

/** One hidden plan per user that holds calendar drafts (Papaya results, approved chat images). */
async function draftPlanId(userId: string): Promise<string> {
  const existing = await prisma.campaignPlan.findFirst({
    where: { userId, brandId: null, title: DRAFT_PLAN_TITLE },
    select: { id: true },
  });
  if (existing) return existing.id;
  // "completed" so the autopilot scheduler never picks its posts up.
  const created = await prisma.campaignPlan.create({
    data: { userId, brandId: null, title: DRAFT_PLAN_TITLE, status: "completed" },
    select: { id: true },
  });
  return created.id;
}

const DRAFT_PLAN_TITLE = "Calendar drafts";

/** "Papaya": pick an idea for one day (themed on a relevant holiday) and start the image. */
export async function createDayPost(userId: string, body: CalendarDayPostRequest): Promise<CalendarDayPostDto> {
  const brand = await findAccessibleBrand(userId, body.brandId);
  const tz = safeTimezone(body.timezone);
  if (body.date < todayIn(tz)) throw badRequest("Pick today or a future date");

  const holidays = await holidayMap([body.date]);
  let planned;
  try {
    [planned] = await planAutopilotPosts({
      brandSummary: brand.summary ?? brand.name,
      startAt: new Date(`${body.date}T00:00:00Z`),
      days: 1,
      dates: [body.date],
      holidays,
      platform: "Instagram",
      instructions: body.instructions,
      timezone: tz,
      brandName: brand.name,
    });
  } catch {
    throw new HttpError(502, "Could not come up with an idea right now - please try again");
  }
  const holiday = holidays[body.date] ?? null;
  const planId = await draftPlanId(userId);
  const publishAt = zonedToUtc(body.date, "10:00", tz);
  let postId = "";
  const generationId = await startBrandImage(
    userId,
    brand.id,
    planned!.prompt,
    { calendarDate: body.date, ...(holiday ? { holiday } : {}) },
    {
      // Linked before queueing, so the image is saved on its day even if the dialog is closed.
      onCreated: async (id) => {
        const post = await prisma.campaignPost.create({
          data: {
            planId,
            generationId: id,
            publishAt,
            scheduledFor: publishAt,
            platform: "Instagram",
            prompt: planned!.prompt,
            caption: planned!.caption,
            status: "generating",
          },
          select: { id: true },
        });
        postId = post.id;
      },
    },
  );
  return { generationId, postId, holiday, caption: planned!.caption };
}

/** "AI Fill": propose a plan. Creates a PAUSED plan - nothing is generated or posted until approved. */
export async function fillCalendar(userId: string, body: CalendarFillRequest) {
  const brand = await findAccessibleBrand(userId, body.brandId);
  const tz = safeTimezone(body.timezone);
  const today = todayIn(tz);
  const start = body.startDate < today ? today : body.startDate;
  if (body.endDate < start) throw badRequest("End date must be after the start date");

  const dates: string[] = [];
  for (
    let t = new Date(`${start}T00:00:00Z`).getTime();
    isoDate(new Date(t)) <= body.endDate;
    t += body.everyDays * DAY_MS
  ) {
    dates.push(isoDate(new Date(t)));
    if (dates.length > MAX_FILL_POSTS) throw badRequest(`That range makes more than ${MAX_FILL_POSTS} posts - shorten it`);
  }
  if (!dates.length) throw badRequest("No posting days in that range");

  const holidays = (body.holidays ?? "suggest") === "suggest" ? await holidayMap(dates) : {};
  let planned;
  try {
    planned = await planAutopilotPosts({
      brandSummary: brand.summary ?? brand.name,
      startAt: new Date(`${dates[0]}T00:00:00Z`),
      days: dates.length,
      dates,
      holidays,
      platform: body.platform ?? "Instagram",
      instructions: body.instructions,
      timezone: tz,
      brandName: brand.name,
    });
  } catch {
    throw new HttpError(502, "Could not create the content plan right now - please try again");
  }

  const plan = await prisma.campaignPlan.create({
    data: {
      userId,
      brandId: brand.id,
      title: `Content plan ${dates[0]} to ${dates[dates.length - 1]}`,
      status: "paused",
      timezone: tz,
      posts: {
        create: planned.map((post, i) => {
          const publishAt = zonedToUtc(dates[i]!, body.time, tz);
          return {
            publishAt,
            scheduledFor: publishAt,
            platform: post.platform,
            prompt: post.prompt,
            caption: post.caption,
          };
        }),
      },
    },
    select: { id: true, _count: { select: { posts: true } } },
  });
  return { planId: plan.id, posts: plan._count.posts };
}

/** Campaign posts placed on their publish dates, for the calendar. */
export async function listPlanItems(userId: string, from: Date, to: Date): Promise<CalendarPlanItemDto[]> {
  const rows = await prisma.campaignPost.findMany({
    where: {
      publishAt: { gte: from, lt: to },
      status: { not: "cancelled" },
      plan: { userId },
    },
    include: { plan: { select: { brandId: true, status: true } }, generation: { select: { imageUrls: true } } },
    orderBy: { publishAt: "asc" },
    take: 200,
  });
  return rows.map((r) => ({
    id: r.id,
    planId: r.planId,
    brandId: r.plan.brandId,
    publishAt: r.publishAt!.toISOString(),
    status: r.status as CampaignPostStatus,
    planStatus: r.plan.status as CampaignPlanStatus,
    platform: r.platform,
    prompt: r.prompt,
    caption: r.caption,
    generationId: r.generationId,
    imageUrl: r.generation?.imageUrls[0] ?? null,
    error: r.error,
  }));
}

/**
 * Regenerate a planned post's image using the user's feedback. The current image
 * is the edit base (so the good parts stay), and the post is relinked to the new
 * generation, which the worker then marks ready_for_review again.
 */
export async function regenerateCampaignPost(userId: string, postId: string, comment: string): Promise<{ generationId: string }> {
  const post = await prisma.campaignPost.findFirst({
    where: { id: postId, plan: { userId } },
    include: { plan: { select: { brandId: true } }, generation: true },
  });
  if (!post) throw new HttpError(404, "Post not found");
  if (!["ready_for_review", "approved", "failed"].includes(post.status)) {
    throw badRequest("This post can't be regenerated right now");
  }
  const current = post.generation;
  const currentImage = current?.imageUrls[0];
  const prompt = currentImage
    ? `${post.prompt}

Revise the attached image using this feedback, keeping everything else the same: ${comment}`
    : `${post.prompt}

Additional direction: ${comment}`;
  const meta = (current?.metadata ?? {}) as Record<string, unknown>;

  const brandId = post.plan.brandId ?? (typeof meta.brandId === "string" ? meta.brandId : null);
  const generationId = await startBrandImage(
    userId,
    brandId,
    prompt,
    {
      campaignPostId: post.id,
      campaignDraft: true,
      ...(currentImage
        ? {
            editOperation: "edit",
            referenceImageUrl: currentImage,
            referenceImageUrls: [
              currentImage,
              ...(Array.isArray(meta.referenceImageUrls)
                ? (meta.referenceImageUrls as unknown[]).filter((u): u is string => typeof u === "string" && u !== currentImage)
                : []),
            ].slice(0, 10),
          }
        : {}),
    },
    {
      parent: current ? { id: current.id, provider: current.provider } : undefined,
      onCreated: async (generationId) => {
        await prisma.campaignPost.update({
          where: { id: post.id },
          data: { generationId, status: "generating", error: null, approvedAt: null },
        });
      },
    },
  );
  return { generationId };
}

/**
 * "Approve for socials" on an existing image (e.g. from chat): puts it on the
 * calendar, on the day it was created, as an approved draft waiting to be scheduled.
 * Idempotent - a generation only ever has one draft.
 */
export async function approveGenerationForCalendar(userId: string, generationId: string) {
  const generation = await prisma.generation.findUnique({ where: { id: generationId } });
  if (!generation) throw new HttpError(404, "Image not found");
  if (generation.userId !== userId) throw new HttpError(403, "Forbidden");
  if (generation.status !== "completed" || generation.imageUrls.length === 0) {
    throw badRequest("Only finished images can be approved for social");
  }
  const existing = await prisma.campaignPost.findUnique({ where: { generationId } });
  if (existing) {
    if (existing.status === "ready_for_review") {
      await prisma.campaignPost.update({ where: { id: existing.id }, data: { status: "approved", approvedAt: new Date() } });
    }
    return { postId: existing.id, publishAt: (existing.publishAt ?? existing.scheduledFor).toISOString() };
  }
  const planId = await draftPlanId(userId);
  const post = await prisma.campaignPost.create({
    data: {
      planId,
      generationId,
      publishAt: generation.createdAt,
      scheduledFor: generation.createdAt,
      prompt: generation.prompt,
      status: "approved",
      approvedAt: new Date(),
    },
    select: { id: true, publishAt: true },
  });
  return { postId: post.id, publishAt: post.publishAt!.toISOString() };
}
