/** Exponential backoff after attempt N (1-based): 30s, 2m, 8m, 32m, capped at 2h. */
export function backoffMs(attempt: number): number {
  const base = 30_000 * 4 ** Math.max(0, attempt - 1);
  return Math.min(base, 2 * 60 * 60_000);
}

/** Idempotency keys. One per (video, step) so a step is enqueued at most once per round. */
export const jobKey = {
  script: (videoId: string, round = 0) => `script:${videoId}:${round}`,
  assets: (videoId: string, round = 0) => `assets:${videoId}:${round}`,
  render: (videoId: string, round = 0) => `render:${videoId}:${round}`,
  upload: (videoId: string, round = 0) => `upload:${videoId}:${round}`,
  publicSync: (videoId: string, checkpoint: string) => `sync:${videoId}:${checkpoint}`,
  channelAnalytics: (channelId: string, day: string) => `analytics:${channelId}:${day}`,
  dailySync: (userId: string, day: string) => `dailysync:${userId}:${day}`,
  weeklyReport: (userId: string, weekStart: string) => `report:${userId}:${weekStart}`,
  ingest: (sha: string) => `ingest:${sha}`,
};
