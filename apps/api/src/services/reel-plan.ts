import { Prisma, prisma } from "@catgpt/db";
import {
  estimateReelCostMicroUsd,
  REEL_PLAN_LEAD_MS,
  type CreateReelPlanRequest,
  type ReelBrief,
  type ReelPlanItemDto,
  type ReelPlanStatus,
  type ReelScript,
} from "@catgpt/types";
import { env } from "../env.js";
import { badRequest, HttpError } from "../lib/errors.js";
import { findAccessibleBrand } from "../lib/brand.js";
import { runRenderJob } from "./video-render.js";
import { runScriptJob } from "./video-script.js";

const TICK_MS = 60_000;
/** A post must be at least this far away, so the reel has time to be produced and reviewed. */
const MIN_LEAD_MS = 5 * 60 * 1000;

export type ReelPlanRow = Prisma.ReelPlanItemGetPayload<object>;

export const toReelPlanItemDto = (r: ReelPlanRow): ReelPlanItemDto => ({
  id: r.id,
  brandId: r.brandId,
  folderId: r.folderId,
  title: r.title,
  brief: r.brief as ReelBrief,
  postAt: r.postAt.toISOString(),
  accountIds: r.accountIds,
  caption: r.caption,
  status: r.status as ReelPlanStatus,
  projectId: r.projectId,
  generationId: r.generationId,
  error: r.error,
  createdAt: r.createdAt.toISOString(),
});

/** Adds planned reels for a brand. Every account must be one this user connected. */
export async function createReelPlanItems(userId: string, body: CreateReelPlanRequest) {
  await findAccessibleBrand(userId, body.brandId);
  const now = Date.now();
  const accountIds = [...new Set(body.items.flatMap((i) => i.accountIds))];
  const owned = await prisma.socialAccount.findMany({
    where: { id: { in: accountIds }, userId },
    select: { id: true },
  });
  if (owned.length !== accountIds.length) {
    throw badRequest("One of the accounts isn't connected to your user");
  }
  const folderIds = [...new Set(body.items.map((i) => i.folderId).filter((v): v is string => Boolean(v)))];
  if (folderIds.length) {
    const folders = await prisma.sourceFolder.findMany({ where: { id: { in: folderIds }, brandId: body.brandId }, select: { id: true } });
    if (folders.length !== folderIds.length) throw badRequest("A folder doesn't belong to this brand");
  }

  const rows = body.items.map((item) => {
    const postAt = new Date(item.postAt);
    if (postAt.getTime() - now < MIN_LEAD_MS) {
      throw badRequest(`"${item.title}" must be posted at least 5 minutes from now`);
    }
    return {
      userId,
      brandId: body.brandId,
      folderId: item.folderId ?? null,
      title: item.title,
      brief: item.brief as unknown as Prisma.InputJsonValue,
      postAt,
      accountIds: item.accountIds,
      caption: item.caption ?? null,
    };
  });
  const created = await prisma.$transaction(rows.map((data) => prisma.reelPlanItem.create({ data })));
  return created.map(toReelPlanItemDto);
}

/**
 * Makes one planned reel: script, render, then stop at review. The person
 * approves it; the autopilot never posts on its own. Runs one reel at a time.
 */
export async function produceReel(itemId: string): Promise<void> {
  const item = await prisma.reelPlanItem.findUniqueOrThrow({ where: { id: itemId } });
  const brief = item.brief as unknown as ReelBrief;
  const project = await prisma.videoProject.create({
    data: {
      userId: item.userId,
      brandId: item.brandId,
      folderId: item.folderId,
      title: item.title,
      brief: item.brief as Prisma.InputJsonValue,
      // The script job only writes its result while the project is `scripting`, so start there.
      status: "scripting",
      estimatedCostMicroUsd: estimateReelCostMicroUsd(brief.videoModel, brief.resolution, brief.durationSec),
    },
  });
  await prisma.reelPlanItem.update({ where: { id: item.id }, data: { projectId: project.id } });

  await runScriptJob(project.id);
  const scripted = await prisma.videoProject.findUniqueOrThrow({ where: { id: project.id } });
  if (scripted.status !== "scripted" || !scripted.script) {
    await failItem(item.id, scripted.errorMessage ?? "The script could not be written.");
    return;
  }

  const hasGenerated = (scripted.script as unknown as ReelScript).shots.some((s) => s.kind === "generate");
  const target = hasGenerated ? "generating" : "editing";
  await prisma.videoProject.updateMany({
    where: { id: project.id, status: "scripted" },
    data: { status: target, errorMessage: null },
  });
  await runRenderJob(project.id);

  const rendered = await prisma.videoProject.findUniqueOrThrow({ where: { id: project.id } });
  if (rendered.status === "review") {
    await prisma.reelPlanItem.update({ where: { id: item.id }, data: { status: "ready", error: null } });
  } else {
    await failItem(item.id, rendered.errorMessage ?? "The reel could not be rendered.");
  }
}

async function failItem(itemId: string, message: string) {
  await prisma.reelPlanItem.update({ where: { id: itemId }, data: { status: "failed", error: message } });
}

/** Produces the next planned reel whose post time is inside the lead window. */
async function produceNext(): Promise<void> {
  const next = await prisma.reelPlanItem.findFirst({
    where: { status: "planned", postAt: { lte: new Date(Date.now() + REEL_PLAN_LEAD_MS) } },
    orderBy: { postAt: "asc" },
  });
  if (!next) return;
  const claimed = await prisma.reelPlanItem.updateMany({
    where: { id: next.id, status: "planned" },
    data: { status: "producing" },
  });
  if (claimed.count === 0) return;
  try {
    await produceReel(next.id);
  } catch (err) {
    console.error("[reel-autopilot] produce failed", next.id, err);
    await failItem(next.id, "The reel could not be produced. Try again.");
  }
}

let running = false;
async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    await produceNext();
  } catch (err) {
    console.error("[reel-autopilot] tick failed", err);
  } finally {
    running = false;
  }
}

/**
 * Starts the autopilot. It stays off unless REEL_AUTOPILOT_ENABLED is set, and
 * it also needs VIDEO_MONTHLY_CAP_USD: production spends money without you
 * pressing anything, so it must not run without a budget.
 */
let started = false;
export function startReelAutopilot(): void {
  if (started) return;
  if (!env.REEL_AUTOPILOT_ENABLED) return;
  if (env.VIDEO_MONTHLY_CAP_USD === undefined) {
    console.warn("[reel-autopilot] disabled: set VIDEO_MONTHLY_CAP_USD before enabling it");
    return;
  }
  started = true;
  // Anything left in `producing` when the process restarted can't be resumed safely.
  void prisma.reelPlanItem
    .updateMany({ where: { status: "producing" }, data: { status: "failed", error: "Interrupted by a restart. Try again." } })
    .catch((err) => console.error("[reel-autopilot] recovery failed", err));
  setInterval(() => void tick(), TICK_MS);
  void tick();
}

export async function removePlanItem(userId: string, id: string): Promise<void> {
  const item = await prisma.reelPlanItem.findFirst({ where: { id, userId } });
  if (!item) throw new HttpError(404, "Plan item not found");
  if (!["planned", "skipped", "failed", "ready"].includes(item.status)) {
    throw new HttpError(409, "Only planned, ready or failed items can be removed", "INVALID_STATE");
  }
  await prisma.reelPlanItem.delete({ where: { id } });
}
