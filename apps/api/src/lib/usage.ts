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
  // Ledger rows outlive chats (deleting a conversation doesn't refund quota);
  // failed generations remove their own row so they never cost the user.
  const used = await prisma.imageUsage.count({
    where: { userId, createdAt: { gte: start } },
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

/** Record one image against today's quota. */
export async function recordImageUsage(userId: string, generationId: string) {
  await prisma.imageUsage.create({ data: { userId, generationId } });
}

/** Give the quota back when a generation fails. */
export async function refundImageUsage(generationId: string) {
  await prisma.imageUsage.deleteMany({ where: { generationId } });
}
