import { prisma } from "@catgpt/db";
import { isOverVideoBudget } from "@catgpt/types";
import { HttpError } from "./errors.js";
import { env } from "../env.js";

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

export async function getVideoBudget(userId: string) {
  const spentMicroUsd = await getVideoSpendThisMonth(userId);
  const capUsd = env.VIDEO_MONTHLY_CAP_USD;
  return {
    spentUsd: spentMicroUsd / 1_000_000,
    capUsd: capUsd ?? null,
    remainingUsd: capUsd === undefined ? null : Math.max(0, capUsd - spentMicroUsd / 1_000_000),
    resetsAt: new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 1)).toISOString(),
  };
}

/** Throws 429 when `estimateMicroUsd` would take the user past the monthly cap. */
export async function assertVideoBudget(userId: string, estimateMicroUsd: number): Promise<void> {
  const spent = await getVideoSpendThisMonth(userId);
  if (isOverVideoBudget(spent, estimateMicroUsd, env.VIDEO_MONTHLY_CAP_USD)) {
    throw new HttpError(
      429,
      `Monthly video budget reached ($${env.VIDEO_MONTHLY_CAP_USD}). It resets on the 1st (UTC).`,
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
