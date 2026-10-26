import { prisma } from "@catgpt/db";
import { canTransitionVideoProject, type ReelBrief, type ReelScript } from "@catgpt/types";
import { HttpError } from "../lib/errors.js";
import { createSocialPosts } from "./social/posts.js";

/** The fields approval needs from a project. */
export interface ApprovableProject {
  id: string;
  userId: string;
  brandId: string;
  title: string;
  brief: unknown;
  script: unknown;
  status: string;
  outputUrl: string | null;
}

export interface ApprovalResult {
  generationId: string;
  /** Set when the reel was part of a plan and the post was queued. */
  postQueued: boolean;
  postError: string | null;
}

/** Caption for a planned post: the plan's own caption, else the script's hook and call to action. */
export function captionFor(item: { caption: string | null }, script: ReelScript | null): string {
  if (item.caption) return item.caption;
  if (!script) return "";
  return `${script.hook}\n\n${script.cta}`.trim();
}

/**
 * Approves a reviewed reel. The reel goes into the Library as a completed video.
 * If it was planned, the post is queued for the planned time on the plan's
 * accounts. Nothing is posted without this approval.
 */
export async function approveReel(project: ApprovableProject): Promise<ApprovalResult> {
  if (!canTransitionVideoProject(project.status, "approved") || !project.outputUrl) {
    throw new HttpError(409, "Only a rendered reel that is ready for review can be approved", "INVALID_STATE");
  }
  const claimed = await prisma.videoProject.updateMany({
    where: { id: project.id, status: "review" },
    data: { status: "approved" },
  });
  if (claimed.count === 0) {
    throw new HttpError(409, "This reel changed while approving. Reload and try again.", "INVALID_STATE");
  }

  const brief = project.brief as ReelBrief;
  const generation = await prisma.generation.create({
    data: {
      userId: project.userId,
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

  const item = await prisma.reelPlanItem.findFirst({ where: { projectId: project.id } });
  if (!item) return { generationId: generation.id, postQueued: false, postError: null };

  await prisma.reelPlanItem.update({
    where: { id: item.id },
    data: { status: "approved", generationId: generation.id },
  });
  return schedulePlannedPost(item.id);
}

/**
 * Queues an approved plan item on its accounts at `postAt`. A past time is
 * refused, not posted immediately: a reel approved late shouldn't go out at a
 * random moment. The error is kept on the item for the person to see.
 */
export async function schedulePlannedPost(itemId: string): Promise<ApprovalResult> {
  const item = await prisma.reelPlanItem.findUniqueOrThrow({ where: { id: itemId } });
  const project = item.projectId
    ? await prisma.videoProject.findUnique({ where: { id: item.projectId }, select: { script: true } })
    : null;
  const generationId = item.generationId!;

  try {
    if (item.postAt.getTime() <= Date.now()) {
      throw new Error("The planned time has already passed. Pick a new time and approve again.");
    }
    const caption = captionFor(item, (project?.script as ReelScript | null) ?? null);
    await createSocialPosts(item.userId, generationId, {
      posts: item.accountIds.map((accountId) => ({ accountId, content: { caption } })),
      scheduledFor: item.postAt.toISOString(),
    });
    await prisma.reelPlanItem.update({
      where: { id: item.id },
      data: { status: "posted", error: null },
    });
    return { generationId, postQueued: true, postError: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : "The post could not be queued.";
    await prisma.reelPlanItem.update({ where: { id: item.id }, data: { error: message } });
    return { generationId, postQueued: false, postError: message };
  }
}
