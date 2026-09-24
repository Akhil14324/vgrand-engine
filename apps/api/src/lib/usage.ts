import { prisma } from "@catgpt/db";
import { HttpError } from "./errors.js";
import { env } from "../env.js";

/** Start of the current UTC day — the window the daily image quota resets on. */
function startOfUtcDay(now = new Date()): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

export async function getImageUsage(userId: string) {
  const start = startOfUtcDay();
  // Failed generations don't cost the user quota.
  const used = await prisma.generation.count({
    where: {
      userId,
      kind: "image",
      status: { not: "failed" },
      createdAt: { gte: start },
    },
  });
  return {
    used,
    limit: env.IMAGE_DAILY_LIMIT,
    remaining: Math.max(0, env.IMAGE_DAILY_LIMIT - used),
    resetsAt: new Date(start.getTime() + 24 * 60 * 60 * 1000).toISOString(),
  };
}

/** Throws 429 when the user has spent today's image quota. Chat is never gated. */
export async function assertImageQuota(userId: string) {
  const usage = await getImageUsage(userId);
  if (usage.remaining <= 0) {
    throw new HttpError(
      429,
      `Daily image limit reached (${usage.limit}/day). Chatting is still unlimited — image generation resets at midnight UTC.`,
      "IMAGE_LIMIT",
    );
  }
}
