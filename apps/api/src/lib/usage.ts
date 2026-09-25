import { randomUUID } from "node:crypto";
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
    throw quotaError(usage.limit);
  }
}

export function quotaError(limit: number) {
  return new HttpError(
    429,
    `Daily image limit reached (${limit}/day). Chatting is still unlimited — image generation resets at midnight UTC.`,
    "IMAGE_LIMIT",
  );
}

/**
 * Record one image against today's quota — atomically. The count and the
 * insert happen in a single statement, so two requests racing at the limit
 * cannot both pass (the old count-then-insert let each see room for itself).
 * Returns false when the quota was already spent.
 */
export async function recordImageUsage(
  userId: string,
  generationId: string,
): Promise<boolean> {
  const start = startOfUtcDay();
  const inserted = await prisma.$executeRaw`
    INSERT INTO "ImageUsage" ("id", "userId", "generationId", "createdAt")
    SELECT ${randomUUID()}, ${userId}, ${generationId}, now()
    WHERE (
      SELECT COUNT(*) FROM "ImageUsage"
      WHERE "userId" = ${userId} AND "createdAt" >= ${start}
    ) < ${env.IMAGE_DAILY_LIMIT}`;
  return inserted === 1;
}

/** Give the quota back when a generation fails. */
export async function refundImageUsage(generationId: string) {
  await prisma.imageUsage.deleteMany({ where: { generationId } });
}
