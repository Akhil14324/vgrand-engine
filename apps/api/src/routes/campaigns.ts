import type { FastifyInstance } from "fastify";
import { prisma } from "@catgpt/db";
import {
  createCampaignPlanSchema,
  updateCampaignPlanSchema,
  updateCampaignPostSchema,
} from "@catgpt/types";
import {
  HttpError,
  badRequest,
  notFound,
  parseBody,
} from "../lib/errors.js";
import { findAccessibleBrand, findManageableBrand } from "../lib/brand.js";
import {
  planAutopilotPosts,
  toCampaignPlanDto,
} from "../services/campaign-autopilot.js";

const PLAN_INCLUDE = {
  posts: {
    orderBy: { scheduledFor: "asc" as const },
    include: { generation: { select: { imageUrls: true } } },
  },
};

/** Scheduled campaign drafts — generation is automatic, publishing is not. */
export async function campaignRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  app.get("/campaigns", async (req) => {
    const { brandId } = req.query as { brandId?: string };
    if (!brandId) throw badRequest("brandId is required");
    await findAccessibleBrand(req.userId, brandId);
    const plans = await prisma.campaignPlan.findMany({
      where: { brandId },
      include: PLAN_INCLUDE,
      orderBy: { createdAt: "desc" },
    });
    return { items: plans.map(toCampaignPlanDto) };
  });

  app.post("/campaigns", async (req, reply) => {
    const body = parseBody(createCampaignPlanSchema, req.body);
    const brand = await findManageableBrand(req.userId, body.brandId);
    const startAt = new Date(body.startAt);
    if (Number.isNaN(startAt.getTime())) throw badRequest("invalid startAt");

    let planned: Awaited<ReturnType<typeof planAutopilotPosts>>;
    try {
      planned = await planAutopilotPosts({
        brandSummary: brand.summary,
        startAt,
        days: body.days ?? 7,
        platform: body.platform ?? "Instagram",
        instructions: body.instructions,
        timezone: body.timezone,
        brandName: brand.name,
      });
    } catch {
      throw new HttpError(
        502,
        "Could not create the schedule right now — please try again",
      );
    }

    const plan = await prisma.campaignPlan.create({
      data: {
        userId: req.userId,
        brandId: brand.id,
        conversationId: body.conversationId ?? null,
        title:
          body.title?.trim() ||
          `${body.days ?? 7}-day ${body.platform ?? "Instagram"} campaign`,
        timezone: body.timezone ?? "Asia/Kolkata",
        posts: {
          create: planned.map((post, index) => ({
            scheduledFor: new Date(startAt.getTime() + index * 86_400_000),
            platform: post.platform,
            prompt: post.prompt,
            caption: post.caption,
          })),
        },
      },
      include: PLAN_INCLUDE,
    });
    return reply.code(201).send(toCampaignPlanDto(plan));
  });

  /** Bring every not-yet-generated draft forward to the current time. */
  app.patch("/campaigns/:id", async (req) => {
    const { id } = req.params as { id: string };
    parseBody(updateCampaignPlanSchema, req.body);
    const plan = await prisma.campaignPlan.findUnique({ where: { id } });
    if (!plan) throw notFound("Campaign plan not found");
    await findManageableBrand(req.userId, plan.brandId);
    // A calendar plan starts paused ("proposed"); Generate all activates it.
    if (plan.status === "paused") {
      await prisma.campaignPlan.update({ where: { id }, data: { status: "active" } });
    }
    await prisma.campaignPost.updateMany({
      where: { planId: id, status: "scheduled" },
      data: { scheduledFor: new Date() },
    });
    const updated = await prisma.campaignPlan.findUniqueOrThrow({
      where: { id },
      include: PLAN_INCLUDE,
    });
    return toCampaignPlanDto(updated);
  });

  app.patch("/campaign-posts/:id", async (req) => {
    const { id } = req.params as { id: string };
    const body = parseBody(updateCampaignPostSchema, req.body);
    const post = await prisma.campaignPost.findUnique({
      where: { id },
      include: { plan: true },
    });
    if (!post) throw notFound("Campaign post not found");
    await findManageableBrand(req.userId, post.plan.brandId);

    if (body.action === "approve") {
      if (post.status !== "ready_for_review") {
        throw badRequest("only a generated draft can be approved");
      }
      await prisma.campaignPost.update({
        where: { id },
        data: { status: "approved", approvedAt: new Date() },
      });
    } else if (body.action === "cancel") {
      if (!["scheduled", "ready_for_review", "failed"].includes(post.status)) {
        throw badRequest("this post can no longer be cancelled");
      }
      if (post.generationId) {
        await prisma.generation.updateMany({
          where: { id: post.generationId, status: { in: ["pending", "processing"] } },
          data: { status: "cancelled", error: "Stopped" },
        });
      }
      await prisma.campaignPost.update({
        where: { id },
        data: { status: "cancelled", error: null },
      });
    } else if (body.action === "generate_now") {
      if (post.status !== "scheduled") {
        throw badRequest("only scheduled posts can be generated now");
      }
      await prisma.campaignPost.update({
        where: { id },
        data: { scheduledFor: new Date(), error: null },
      });
    } else {
      if (!["failed", "cancelled"].includes(post.status)) {
        throw badRequest("only failed or cancelled posts can be retried");
      }
      await prisma.campaignPost.update({
        where: { id },
        data: {
          status: "scheduled",
          scheduledFor: new Date(),
          error: null,
          approvedAt: null,
        },
      });
    }

    const updated = await prisma.campaignPlan.findUniqueOrThrow({
      where: { id: post.planId },
      include: PLAN_INCLUDE,
    });
    return toCampaignPlanDto(updated);
  });
}
