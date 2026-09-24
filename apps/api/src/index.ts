import "dotenv/config";
import { buildApp } from "./app.js";
import { env } from "./env.js";
import { startGenerationWorker } from "./services/generation-worker.js";

const app = await buildApp();

const worker = env.WORKER_INLINE ? startGenerationWorker() : null;
if (worker) app.log.info("generation worker started inline");

// Railway sends SIGTERM on every deploy: stop taking requests/jobs and let
// in-flight ones finish instead of cutting streams and leaving rows stuck.
let stopping = false;
const shutdown = async () => {
  if (stopping) return;
  stopping = true;
  const force = setTimeout(() => process.exit(1), 25_000);
  force.unref();
  await Promise.allSettled([app.close(), worker?.close()]);
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

try {
  await app.listen({ port: env.PORT, host: "0.0.0.0" });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
