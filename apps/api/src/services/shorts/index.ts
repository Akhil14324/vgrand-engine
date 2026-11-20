import { startShortsJobWorker } from "./jobs.js";
import { log } from "./log.js";
import { registerPipelineHandlers } from "./pipeline.js";

/** Job handlers are registered by any process that may run Shorts jobs (API, worker, CLI). */
export function registerShortsHandlers(): void {
  registerPipelineHandlers();
}

let started = false;

/**
 * Starts the Shorts job worker (and, from later phases, the scheduler). Called from
 * startGenerationWorker, so it runs wherever generation jobs run: inline in the API
 * process, or in the separate worker process.
 */
export function startShortsFactory(): void {
  if (started || process.env.SHORTS_DISABLED === "1") return;
  started = true;
  try {
    registerShortsHandlers();
    startShortsJobWorker();
  } catch (err) {
    log.error("factory.start_failed", { error: String(err) });
  }
}
