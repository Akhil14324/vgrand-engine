import "dotenv/config";
import { startGenerationWorker } from "./services/generation-worker.js";

/**
 * Standalone worker entry — run with `pnpm --filter @prompthub/api worker`
 * when you want generation jobs on separate compute from the web server.
 * (With WORKER_INLINE=true the API process already runs one.)
 */
const worker = startGenerationWorker();
console.log("generation worker listening for jobs");

const shutdown = async () => {
  await worker.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
