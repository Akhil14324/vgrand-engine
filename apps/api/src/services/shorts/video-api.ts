import { Prisma, prisma } from "@catgpt/db";
import type { ShortsPath, ShortsStatus, ShortsVideoDetailDto, ShortsVideoDto } from "@catgpt/types";
import { notFound } from "../../lib/errors.js";
import { env } from "../../env.js";
import { nextFreeSlot } from "./schedule-logic.js";
import { signedFileUrl } from "./storage.js";

type Row = Awaited<ReturnType<typeof loadRows>>[number];

async function loadRows(where: Prisma.ShortsVideoWhereInput, take = 200) {
  return prisma.shortsVideo.findMany({
    where,
    orderBy: [{ slotAt: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
    take,
    include: {
      channel: { select: { slug: true, displayName: true, postingTimes: true } },
      snapshots: { orderBy: { capturedAt: "desc" }, take: 1 },
    },
  });
}

export function toVideoDto(v: Row): ShortsVideoDto {
  const s = v.snapshots[0];
  return {
    id: v.id,
    channelId: v.channelId,
    channelSlug: v.channel.slug,
    channelName: v.channel.displayName,
    status: v.status as ShortsStatus,
    path: v.path as ShortsPath,
    plannedPath: v.plannedPath as ShortsPath,
    source: v.source,
    slotAt: v.slotAt?.toISOString() ?? null,
    suggestedPostAt: (v.slotAt ?? nextFreeSlot(v.channel.postingTimes, env.TIMEZONE, new Date(), new Set()))?.toISOString() ?? null,
    title: v.title,
    description: v.description,
    tags: v.tags,
    hook: v.hook,
    hookType: v.hookType,
    topic: v.topic,
    narration: v.narration,
    durationSec: v.durationSec,
    synthetic: v.synthetic,
    dims: v.dims as ShortsVideoDto["dims"],
    youtubeVideoId: v.youtubeVideoId,
    youtubeUrl: v.youtubeUrl,
    publishAt: v.publishAt?.toISOString() ?? null,
    postedAt: v.postedAt?.toISOString() ?? null,
    privacyStatus: v.privacyStatus,
    privateLocked: v.privateLocked,
    manualReason: v.manualReason,
    error: v.error,
    manualViewedPct: v.manualViewedPct,
    fileUrl: v.filePath ? signedFileUrl(v.id) : null,
    createdAt: v.createdAt.toISOString(),
    updatedAt: v.updatedAt.toISOString(),
    latestStats: s ? { views: s.views, likes: s.likes, comments: s.comments, capturedAt: s.capturedAt.toISOString() } : null,
  };
}

export async function listVideos(userId: string, q: { status?: string[]; channelId?: string; includeDryRun?: boolean }): Promise<ShortsVideoDto[]> {
  const rows = await loadRows({
    userId,
    ...(q.status?.length ? { status: { in: q.status } } : {}),
    ...(q.channelId ? { channelId: q.channelId } : {}),
    ...(q.includeDryRun ? {} : { source: { not: "dry_run" } }),
  });
  return rows.map(toVideoDto);
}

export async function videoDetail(userId: string, id: string): Promise<ShortsVideoDetailDto> {
  const [row] = await loadRows({ id, userId }, 1);
  if (!row) throw notFound("Video not found");
  const [assets, events, full] = await Promise.all([
    prisma.shortsAsset.findMany({ where: { videoId: id }, orderBy: [{ kind: "asc" }, { beatIndex: "asc" }] }),
    prisma.shortsEvent.findMany({ where: { videoId: id }, orderBy: { createdAt: "asc" }, take: 200 }),
    prisma.shortsVideo.findUniqueOrThrow({ where: { id }, select: { validation: true, llmPrompt: true, llmResponse: true } }),
  ]);
  return {
    ...toVideoDto(row),
    assets: assets.map((a) => ({
      id: a.id,
      kind: a.kind,
      provider: a.provider,
      providerAssetId: a.providerAssetId,
      sourceUrl: a.sourceUrl,
      license: a.license,
      licenseUrl: a.licenseUrl,
      author: a.author,
      beatIndex: a.beatIndex,
    })),
    events: events.map((e) => ({ id: e.id, level: e.level, type: e.type, message: e.message, createdAt: e.createdAt.toISOString() })),
    validation: full.validation,
    llmPrompt: full.llmPrompt,
    llmResponse: full.llmResponse,
  };
}
