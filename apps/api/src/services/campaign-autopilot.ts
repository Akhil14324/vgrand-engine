import { prisma } from "@catgpt/db";
import type { BrandProfile, CampaignPlanDto, CampaignPostDto } from "@catgpt/types";
import { env } from "../env.js";
import { brandImageGuidance, brandReferenceUrls, loadBrandContext } from "../lib/brand.js";
import {
  buildFinalPrompt,
  CAMPAIGN_CREATIVE_STYLE,
  resolveProvider,
} from "../lib/prompt.js";
import {
  getImageUsage,
  recordImageUsage,
  refundImageUsage,
} from "../lib/usage.js";
import { getClient } from "./chat.js";
import { enqueueGeneration } from "./queue.js";

interface PlannedPost {
  prompt: string;
  caption: string | null;
  platform: string | null;
}

export function toCampaignPostDto(post: {
  id: string;
  planId: string;
  generationId: string | null;
  scheduledFor: Date;
  platform: string | null;
  prompt: string;
  caption: string | null;
  status: string;
  error: string | null;
  approvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  generation?: { imageUrls: string[] } | null;
}): CampaignPostDto {
  return {
    id: post.id,
    planId: post.planId,
    generationId: post.generationId,
    scheduledFor: post.scheduledFor.toISOString(),
    platform: post.platform,
    prompt: post.prompt,
    caption: post.caption,
    status: post.status as CampaignPostDto["status"],
    error: post.error,
    approvedAt: post.approvedAt?.toISOString() ?? null,
    imageUrl: post.generation?.imageUrls[0] ?? null,
    createdAt: post.createdAt.toISOString(),
    updatedAt: post.updatedAt.toISOString(),
  };
}

export function toCampaignPlanDto(plan: {
  id: string;
  brandId: string;
  conversationId: string | null;
  title: string;
  status: string;
  timezone: string;
  createdAt: Date;
  updatedAt: Date;
  posts: Parameters<typeof toCampaignPostDto>[0][];
}): CampaignPlanDto {
  return {
    id: plan.id,
    brandId: plan.brandId,
    conversationId: plan.conversationId,
    title: plan.title,
    status: plan.status as CampaignPlanDto["status"],
    timezone: plan.timezone,
    posts: plan.posts.map(toCampaignPostDto),
    createdAt: plan.createdAt.toISOString(),
    updatedAt: plan.updatedAt.toISOString(),
  };
}

/** Ask the chat model for a compact, date-aligned set of draft briefs. */
export async function planAutopilotPosts(params: {
  brandSummary: string;
  startAt: Date;
  days: number;
  platform: string;
  instructions?: string;
}): Promise<PlannedPost[]> {
  const dates = Array.from({ length: params.days }, (_, i) =>
    new Date(params.startAt.getTime() + i * 86_400_000).toISOString().slice(0, 10),
  );
  const res = await getClient().chat.completions.create({
    model: env.CHAT_MODEL,
    temperature: 0.6,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You plan practical social campaign drafts. Return JSON only with this shape: {\"posts\":[{\"date\":\"YYYY-MM-DD\",\"platform\":\"Instagram\",\"prompt\":\"standalone image brief\",\"caption\":\"ready-to-post caption\"}]}. Produce exactly one item for each requested date. Image prompts must be complete and stand alone. Never invent prices, claims, discounts, awards, testimonials, or event dates. Captions must not include image-generation instructions.",
      },
      {
        role: "user",
        content: `Brand context:\n${params.brandSummary}\n\nPlatform: ${params.platform}\nDates: ${dates.join(", ")}\nExtra instructions: ${params.instructions?.trim() || "none"}\n\nReturn the JSON schedule now.`,
      },
    ],
  });
  const parsed = JSON.parse(res.choices[0]?.message.content ?? "{}") as {
    posts?: { prompt?: string; caption?: string; platform?: string }[];
  };
  const posts = (parsed.posts ?? [])
    .filter((post) => post.prompt?.trim())
    .slice(0, params.days)
    .map((post) => ({
      prompt: post.prompt!.trim(),
      caption: post.caption?.trim() || null,
      platform: post.platform?.trim() || params.platform,
    }));
  if (posts.length !== params.days) {
    throw new Error("campaign planner did not return the requested schedule");
  }
  return posts;
}

async function processDueCampaignPosts(): Promise<void> {
  const due = await prisma.campaignPost.findMany({
    where: {
      status: "scheduled",
      scheduledFor: { lte: new Date() },
      plan: { status: "active" },
    },
    include: { plan: { include: { brand: true } } },
    orderBy: { scheduledFor: "asc" },
    take: 5,
  });

  for (const post of due) {
    const claimed = await prisma.campaignPost.updateMany({
      where: { id: post.id, status: "scheduled" },
      data: { status: "generating", error: null },
    });
    if (claimed.count === 0) continue;

    let generationId: string | null = null;
    try {
      const usage = await getImageUsage(post.plan.userId);
      if (usage.remaining <= 0) {
        await prisma.campaignPost.update({
          where: { id: post.id },
          data: {
            status: "failed",
            error: `Daily image limit reached (${usage.limit}/day)`,
          },
        });
        continue;
      }
      const brand = await loadBrandContext(post.plan.brandId, post.plan.userId);
      if (!brand) throw new Error("brand is no longer accessible");
      const profile = (brand.profile ?? {}) as BrandProfile;
      const refs = brandReferenceUrls(brand.assets, brand.mascot?.asset.url);
      const generation = await prisma.generation.create({
        data: {
          userId: post.plan.userId,
          conversationId: post.plan.conversationId,
          kind: "image",
          prompt: post.prompt,
          finalPrompt:
            buildFinalPrompt(null, post.prompt) +
            brandImageGuidance(
              brand.name,
              profile,
              brand.assets.some((asset) => asset.kind === "logo"),
              brand.mascot,
            ) +
            CAMPAIGN_CREATIVE_STYLE,
          provider: resolveProvider(null),
          metadata: {
            brandId: brand.id,
            campaignPostId: post.id,
            campaignDraft: true,
            quality: env.CAMPAIGN_IMAGE_QUALITY,
            size: "1088x1360",
            ...(refs.length
              ? { referenceImageUrl: refs[0], referenceImageUrls: refs }
              : {}),
          },
        },
      });
      generationId = generation.id;
      await prisma.campaignPost.update({
        where: { id: post.id },
        data: { generationId },
      });
      if (!(await recordImageUsage(post.plan.userId, generation.id))) {
        throw new Error(`Daily image limit reached (${usage.limit}/day)`);
      }
      await enqueueGeneration(generation.id, { background: true });
    } catch (err) {
      if (generationId) {
        await prisma.generation
          .updateMany({
            where: {
              id: generationId,
              status: { in: ["pending", "processing"] },
            },
            data: { status: "failed", error: "Scheduled draft could not start" },
          })
          .catch(() => {});
        await refundImageUsage(generationId).catch(() => {});
      }
      await prisma.campaignPost.update({
        where: { id: post.id },
        data: {
          status: "failed",
          error: err instanceof Error ? err.message : "scheduled draft failed",
        },
      });
    }
  }
}

let schedulerStarted = false;

/** Polls scheduled rows in whichever process owns generation work. */
export function startCampaignScheduler(): void {
  if (schedulerStarted) return;
  schedulerStarted = true;
  const tick = () =>
    void processDueCampaignPosts().catch((err) =>
      console.error("[campaign-scheduler]", err),
    );
  setInterval(tick, 30_000);
  void tick();
}
