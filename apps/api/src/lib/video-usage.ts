import { prisma } from "@catgpt/db";
import { isOverVideoBudget } from "@catgpt/types";
import { HttpError } from "./errors.js";
import { getVideoSettings } from "./video-settings.js";

/** Start of the current UTC month — the window the video budget resets on. */
function startOfUtcMonth(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/** Micro-dollars spent on video this UTC month. */
export async function getVideoSpendThisMonth(userId: string): Promise<number> {
  const sum = await prisma.videoUsage.aggregate({
    where: { userId, createdAt: { gte: startOfUtcMonth() } },
    _sum: { costMicroUsd: true },
  });
  return sum._sum.costMicroUsd ?? 0;
}

/** The user's cap comes from their settings. No cap set = spend is recorded but never blocked. */
export async function getVideoBudget(userId: string) {
  const [spentMicroUsd, settings] = await Promise.all([getVideoSpendThisMonth(userId), getVideoSettings(userId)]);
  const capUsd = settings.monthlyCapUsd;
  const spentUsd = spentMicroUsd / 1_000_000;
  const now = new Date();
  return {
    spentUsd,
    capUsd,
    remainingUsd: capUsd === null ? null : Math.max(0, capUsd - spentUsd),
    resetsAt: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString(),
  };
}

/** Throws 429 when `estimateMicroUsd` would take the user past their monthly cap. */
export async function assertVideoBudget(userId: string, estimateMicroUsd: number): Promise<void> {
  const [spent, settings] = await Promise.all([getVideoSpendThisMonth(userId), getVideoSettings(userId)]);
  const capUsd = settings.monthlyCapUsd ?? undefined;
  if (isOverVideoBudget(spent, estimateMicroUsd, capUsd)) {
    throw new HttpError(
      429,
      `Monthly video budget reached ($${capUsd}). It resets on the 1st (UTC).`,
      "VIDEO_BUDGET",
    );
  }
}

/** Record spend once a render has actually been paid for. */
export async function recordVideoUsage(
  userId: string,
  projectId: string,
  costMicroUsd: number,
  seconds: number,
): Promise<void> {
  await prisma.videoUsage.create({
    data: { userId, projectId, costMicroUsd, seconds },
  });
}
