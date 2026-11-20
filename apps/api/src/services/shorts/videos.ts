import { Prisma, prisma } from "@catgpt/db";
import { canTransition, type ShortsStatus } from "@catgpt/types";
import { recordEvent } from "./log.js";

export type ShortsVideoRow = Prisma.ShortsVideoGetPayload<object>;

/** The status a video was moved from is not what the caller expected (someone else moved it). */
export class StaleTransitionError extends Error {}

/**
 * Moves a video along the state machine with a conditional update, so two workers
 * can never both perform the same transition. Returns the updated row, or null
 * when the video was no longer in `from` (already handled elsewhere).
 */
export async function transition(
  videoId: string,
  from: ShortsStatus | ShortsStatus[],
  to: ShortsStatus,
  data: Prisma.ShortsVideoUpdateManyMutationInput = {},
  note?: string,
): Promise<ShortsVideoRow | null> {
  const fromList = Array.isArray(from) ? from : [from];
  for (const f of fromList) {
    if (!canTransition(f, to)) throw new Error(`illegal transition ${f} -> ${to}`);
  }
  const r = await prisma.shortsVideo.updateMany({
    where: { id: videoId, status: { in: fromList } },
    data: { ...data, status: to },
  });
  if (r.count === 0) return null;
  const row = await prisma.shortsVideo.findUniqueOrThrow({ where: { id: videoId } });
  await recordEvent({
    videoId,
    channelId: row.channelId,
    type: "status",
    message: `${fromList.join("|")} -> ${to}${note ? `: ${note}` : ""}`,
    data: { to },
  });
  return row;
}

export async function getVideo(videoId: string): Promise<ShortsVideoRow> {
  return prisma.shortsVideo.findUniqueOrThrow({ where: { id: videoId } });
}
