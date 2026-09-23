import "dotenv/config";
import { buildApp } from "./app.js";
import { env } from "./env.js";
import { startGenerationWorker } from "./services/generation-worker.js";

const app = await buildApp();

if (env.WORKER_INLINE) {
  startGenerationWorker();
  app.log.info("generation worker started inline");
}

try {
  await app.listen({ port: env.PORT, host: "0.0.0.0" });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
