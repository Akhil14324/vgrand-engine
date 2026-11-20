import { Prisma, prisma } from "@catgpt/db";
import {
  SHORTS_SEED_CHANNELS,
  type ShortsApprovalMode,
  type ShortsChannelDto,
  type ShortsPath,
  type ShortsStatus,
  type ShortsStyleNotes,
  type UpdateShortsChannelRequest,
} from "@catgpt/types";
import { badRequest, notFound } from "../../lib/errors.js";
import { recordEvent } from "./log.js";

export type ShortsChannelRow = Prisma.ShortsChannelGetPayload<object>;

/** Seeds the 10 experiment channels for this user. Idempotent: existing slugs are left untouched. */
export async function ensureSeeded(userId: string): Promise<number> {
  const r = await prisma.shortsChannel.createMany({
    data: SHORTS_SEED_CHANNELS.map((c) => ({
      userId,
      slug: c.slug,
      displayName: c.displayName,
      niche: c.niche,
      path: c.path,
      fallbackPath: c.fallbackPath,
      videosPerDay: c.postingTimes.length,
      postingTimes: c.postingTimes,
      approvalMode: "manual",
      styleNotes: c.styleNotes as unknown as Prisma.InputJsonValue,
      stockKeywords: c.stockKeywords,
    })),
    skipDuplicates: true,
  });
  return r.count;
}

export function toChannelDto(c: ShortsChannelRow, counts: Partial<Record<ShortsStatus, number>> = {}): ShortsChannelDto {
  return {
    id: c.id,
    slug: c.slug,
    displayName: c.displayName,
    niche: c.niche,
    path: c.path as ShortsPath,
    fallbackPath: (c.fallbackPath as ShortsPath | null) ?? null,
    videosPerDay: c.videosPerDay,
    postingTimes: c.postingTimes,
    approvalMode: c.approvalMode as ShortsApprovalMode,
    voiceId: c.voiceId,
    styleNotes: c.styleNotes as unknown as ShortsStyleNotes,
    stockKeywords: c.stockKeywords,
    enabled: c.enabled,
    youtube: {
      status: c.ytStatus as ShortsChannelDto["youtube"]["status"],
      channelId: c.ytChannelId,
      channelTitle: c.ytChannelTitle,
      reason: c.ytStatusReason,
      connectedAt: c.ytConnectedAt?.toISOString() ?? null,
    },
    counts,
  };
}

export async function listChannels(userId: string): Promise<ShortsChannelDto[]> {
  await ensureSeeded(userId);
  const [rows, grouped] = await Promise.all([
    prisma.shortsChannel.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
    prisma.shortsVideo.groupBy({ by: ["channelId", "status"], where: { userId }, _count: { _all: true } }),
  ]);
  const order = new Map(SHORTS_SEED_CHANNELS.map((c, i) => [c.slug, i]));
  rows.sort((a, b) => (order.get(a.slug) ?? 99) - (order.get(b.slug) ?? 99));
  return rows.map((r) => {
    const counts: Partial<Record<ShortsStatus, number>> = {};
    for (const g of grouped) if (g.channelId === r.id) counts[g.status as ShortsStatus] = g._count._all;
    return toChannelDto(r, counts);
  });
}

export async function getOwnedChannel(userId: string, id: string): Promise<ShortsChannelRow> {
  const c = await prisma.shortsChannel.findFirst({ where: { id, userId } });
  if (!c) throw notFound("Channel not found");
  return c;
}

/** Cross-field rules after merging the patch onto the stored channel. Returns an error message or null. */
export function validateChannelConfig(c: {
  path: string;
  fallbackPath: string | null;
  videosPerDay: number;
  postingTimes: string[];
}): string | null {
  if (c.fallbackPath && c.fallbackPath === c.path) return "Fallback path must differ from the main path";
  if (c.fallbackPath === "A") return "Path A can't be a fallback: it only ingests files rendered elsewhere";
  if (c.videosPerDay !== c.postingTimes.length) {
    return `Set one posting time per video: ${c.videosPerDay} video(s)/day but ${c.postingTimes.length} time(s)`;
  }
  return null;
}

export async function updateChannel(userId: string, id: string, patch: UpdateShortsChannelRequest): Promise<ShortsChannelDto> {
  const current = await getOwnedChannel(userId, id);
  const merged = {
    path: patch.path ?? current.path,
    fallbackPath: patch.fallbackPath !== undefined ? patch.fallbackPath : current.fallbackPath,
    videosPerDay: patch.videosPerDay ?? current.videosPerDay,
    postingTimes: patch.postingTimes ? [...patch.postingTimes].sort() : current.postingTimes,
  };
  const problem = validateChannelConfig(merged);
  if (problem) throw badRequest(problem);
  const updated = await prisma.shortsChannel.update({
    where: { id },
    data: {
      ...(patch.displayName !== undefined ? { displayName: patch.displayName } : {}),
      ...(patch.niche !== undefined ? { niche: patch.niche } : {}),
      path: merged.path,
      fallbackPath: merged.fallbackPath,
      videosPerDay: merged.videosPerDay,
      postingTimes: merged.postingTimes,
      ...(patch.approvalMode !== undefined ? { approvalMode: patch.approvalMode } : {}),
      ...(patch.voiceId !== undefined ? { voiceId: patch.voiceId } : {}),
      ...(patch.styleNotes !== undefined ? { styleNotes: patch.styleNotes as unknown as Prisma.InputJsonValue } : {}),
      ...(patch.stockKeywords !== undefined ? { stockKeywords: patch.stockKeywords } : {}),
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
    },
  });
  if (patch.approvalMode && patch.approvalMode !== current.approvalMode) {
    await recordEvent({
      channelId: id,
      type: "channel.approval_mode",
      message: `Approval mode changed ${current.approvalMode} -> ${patch.approvalMode} by the owner`,
    });
  }
  return toChannelDto(updated);
}
