import { prisma } from "@catgpt/db";
import { env } from "../../env.js";
import { enqueueJob } from "./jobs.js";
import { jobKey } from "./jobs-logic.js";
import { log } from "./log.js";
import { scanIngestFolders } from "./ingest.js";
import { createVideo } from "./pipeline.js";
import { localDate, upcomingSlots, zonedToUtc } from "./schedule-logic.js";
import { expectedSlots } from "./scheduler-logic.js";

/**
 * Periodic Shorts work, run in the process that runs the job worker (every minute):
 * - generation: one video per posting slot, created 24 h ahead so manual review has time
 * - Path A watch folders
 * - daily stats sync (03:00 in TIMEZONE) and per-channel analytics
 * - weekly report (Monday 09:00 in TIMEZONE)
 * Every action is idempotent (unique slot per channel/source, job idempotency keys),
 * so overlapping ticks or several processes never double-generate.
 */
export const GENERATION_HORIZON_MS = 24 * 60 * 60_000;
const TICK_MS = 60_000;

/** Creates the videos for every slot in (now, now + horizon]. Returns how many were new. */
export async function generationTick(now: Date, opts: { source?: "scheduler" | "dry_run"; userId?: string; window?: { from: Date; to: Date } } = {}): Promise<number> {
  const channels = await prisma.shortsChannel.findMany({
    where: { enabled: true, path: { in: ["B", "C"] }, videosPerDay: { gt: 0 }, ...(opts.userId ? { userId: opts.userId } : {}) },
  });
  let created = 0;
  for (const c of channels) {
    for (const slotAt of upcomingSlots(c.postingTimes.slice(0, c.videosPerDay), env.TIMEZONE, now, GENERATION_HORIZON_MS)) {
      if (opts.window && (slotAt < opts.window.from || slotAt >= opts.window.to)) continue;
      try {
        const r = await createVideo({ channelId: c.id, slotAt, source: opts.source ?? "scheduler" });
        if (r.created) created++;
      } catch (err) {
        log.error("scheduler.create_failed", { channel: c.slug, slotAt: slotAt.toISOString(), error: String(err) });
      }
    }
  }
  return created;
}

/** Daily/weekly jobs, keyed by local date so they run once per day/week whatever the tick rate. */
export async function periodicJobsTick(now: Date): Promise<void> {
  const tz = env.TIMEZONE;
  const today = localDate(now, tz);
  const users = await prisma.shortsChannel.findMany({ distinct: ["userId"], select: { userId: true } });
  if (now >= zonedToUtc(today, "03:00", tz)) {
    for (const u of users) {
      await enqueueJob({ type: "daily_sync", key: jobKey.dailySync(u.userId, today), payload: { userId: u.userId } });
    }
    const connected = await prisma.shortsChannel.findMany({ where: { ytStatus: "connected" }, select: { id: true } });
    for (const c of connected) {
      await enqueueJob({ type: "channel_analytics", key: jobKey.channelAnalytics(c.id, today), channelId: c.id, maxAttempts: 3 });
    }
  }
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(now);
  if (weekday === "Mon" && now >= zonedToUtc(today, "09:00", tz)) {
    for (const u of users) {
      await enqueueJob({ type: "weekly_report", key: jobKey.weeklyReport(u.userId, today), payload: { userId: u.userId, weekOf: today }, maxAttempts: 3 });
    }
  }
}

let timer: NodeJS.Timeout | null = null;
let running = false;

export async function schedulerTick(now = new Date()): Promise<void> {
  if (running) return;
  running = true;
  try {
    const created = await generationTick(now);
    if (created) log.info("scheduler.generated", { created });
    const r = await scanIngestFolders();
    if (r.queued || r.skipped.length) log.info("scheduler.ingest_scan", { ...r });
    await periodicJobsTick(now);
  } catch (err) {
    log.error("scheduler.tick_failed", { error: String(err) });
  } finally {
    running = false;
  }
}

export function startShortsScheduler(): void {
  if (timer) return;
  timer = setInterval(() => void schedulerTick(), TICK_MS);
  timer.unref();
  void schedulerTick();
}

export { expectedSlots };
