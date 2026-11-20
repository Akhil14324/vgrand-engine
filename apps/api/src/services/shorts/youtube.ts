import { prisma } from "@catgpt/db";
import type { ShortsChannelRow } from "./channels.js";
import { pacificDay, UPLOADS_PER_DAY } from "./youtube-logic.js";
import type { ShortsVideoRow } from "./videos.js";

/** Uploads left in today's (Pacific time) budget. */
export async function quotaLeftToday(): Promise<number> {
  const row = await prisma.shortsQuotaDay.findUnique({ where: { day: pacificDay() } });
  return UPLOADS_PER_DAY - (row?.uploads ?? 0);
}

/** Phase 5 replaces this with the resumable upload. */
export async function uploadVideo(_video: ShortsVideoRow, _channel: ShortsChannelRow): Promise<void> {
  throw new Error("YouTube upload is not implemented yet");
}
