import { prisma } from "@catgpt/db";
import type { VideoSettingsDto, VideoSettingsRequest } from "@catgpt/types";

/** Settings for a user who has never saved any: no cap, autopilot off. */
export const DEFAULT_VIDEO_SETTINGS: VideoSettingsDto = { monthlyCapUsd: null, autopilotEnabled: false };

export async function getVideoSettings(userId: string): Promise<VideoSettingsDto> {
  const row = await prisma.videoSettings.findUnique({ where: { userId } });
  if (!row) return DEFAULT_VIDEO_SETTINGS;
  return { monthlyCapUsd: row.monthlyCapUsd, autopilotEnabled: row.autopilotEnabled };
}

export async function saveVideoSettings(userId: string, s: VideoSettingsRequest): Promise<VideoSettingsDto> {
  const row = await prisma.videoSettings.upsert({
    where: { userId },
    create: { userId, monthlyCapUsd: s.monthlyCapUsd, autopilotEnabled: s.autopilotEnabled },
    update: { monthlyCapUsd: s.monthlyCapUsd, autopilotEnabled: s.autopilotEnabled },
  });
  return { monthlyCapUsd: row.monthlyCapUsd, autopilotEnabled: row.autopilotEnabled };
}
