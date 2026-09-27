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

/** Throws 429 when the user doesn't have `count` images left in today's quota. Chat is never gated. */
export async function assertImageQuota(userId: string, count = 1) {
  const usage = await getImageUsage(userId);
  if (usage.remaining < count) {
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
 * Record `count` images against today's quota — atomically, all-or-nothing.
 * The capacity check and the inserts happen in a single statement, so two
 * requests racing at the limit cannot both pass (the old count-then-insert
 * let each see room for itself), and a carousel request either reserves
 * every image it asked for or none of them. Returns false when there wasn't
 * room for the full count.
 */
export async function recordImageUsage(
  userId: string,
  generationId: string,
  count = 1,
): Promise<boolean> {
  const start = startOfUtcDay();
  const ids = Array.from({ length: count }, () => randomUUID());
  const inserted = await prisma.$executeRaw`
    INSERT INTO "ImageUsage" ("id", "userId", "generationId", "createdAt")
    SELECT unnest(${ids}::uuid[]), ${userId}, ${generationId}, now()
    WHERE (
      SELECT COUNT(*) FROM "ImageUsage"
      WHERE "userId" = ${userId} AND "createdAt" >= ${start}
    ) + ${count} <= ${env.IMAGE_DAILY_LIMIT}`;
  return inserted === count;
}

/** Give the quota back when a generation fails. */
export async function refundImageUsage(generationId: string) {
  await prisma.imageUsage.deleteMany({ where: { generationId } });
}
