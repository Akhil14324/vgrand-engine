import { log } from "./log.js";
import { scanIngestFolders } from "./ingest.js";

/**
 * Periodic Shorts work, run in the process that runs the job worker:
 * - Path A watch folders, every minute.
 * (Phase 8 adds daily generation slots, metric syncs and the weekly report.)
 */
const TICK_MS = 60_000;
let timer: NodeJS.Timeout | null = null;
let running = false;

export async function schedulerTick(now = new Date()): Promise<void> {
  if (running) return;
  running = true;
  try {
    const r = await scanIngestFolders();
    if (r.queued || r.skipped.length) log.info("scheduler.ingest_scan", { ...r, at: now.toISOString() });
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
