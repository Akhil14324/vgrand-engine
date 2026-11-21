import { startShortsJobWorker } from "./jobs.js";
import { startShortsScheduler } from "./scheduler.js";
import { log } from "./log.js";
import { registerPipelineHandlers } from "./pipeline.js";
import { registerPostingHandlers } from "./posting.js";
import { registerSyncHandlers } from "./sync.js";
import { registerYoutubeHandlers } from "./youtube.js";
import { registerIngestHandlers } from "./ingest.js";
import { registerAnalyticsHandlers } from "./analytics.js";
import { registerIgAutomationHandlers } from "../ig-automation/processor.js";

/** Job handlers are registered by any process that may run Shorts jobs (API, worker, CLI). */
export function registerShortsHandlers(): void {
  registerPipelineHandlers();
  registerPostingHandlers();
  registerSyncHandlers();
  registerYoutubeHandlers();
  registerIngestHandlers();
  registerAnalyticsHandlers();
}

let started = false;

/**
 * Starts the Postgres job worker and everything that feeds it: Shorts Factory
 * (handlers + scheduler, unless SHORTS_DISABLED=1) and Instagram automation
 * (always). Called from startGenerationWorker, so it runs wherever generation
 * jobs run: inline in the API process, or in the separate worker process.
 */
export function startShortsFactory(): void {
  if (started) return;
  started = true;
  try {
    registerIgAutomationHandlers();
    if (process.env.SHORTS_DISABLED !== "1") {
      registerShortsHandlers();
      startShortsScheduler();
    }
    startShortsJobWorker();
  } catch (err) {
    log.error("factory.start_failed", { error: String(err) });
  }
}
