import { Queue } from "bullmq";
import IORedis from "ioredis";
import { env } from "../env.js";

export const GENERATION_QUEUE = "image-generation";

/** Shared by BullMQ Queue (server) and Worker. */
export function createRedisConnection(): IORedis {
  const conn = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
  // An ioredis 'error' with no listener is an unhandled EventEmitter error and
  // kills the process — log instead of crashing when Redis is unreachable.
  conn.on("error", (err) => console.error("[redis] connection error:", err.message));
  return conn;
}

/**
 * Created lazily — when REDIS_URL isn't configured we never touch Redis and
 * jobs run in-process instead.
 */
let generationQueue: Queue<{ generationId: string }> | null = null;
function getQueue(): Queue<{ generationId: string }> {
  if (!generationQueue) {
    generationQueue = new Queue<{ generationId: string }>(GENERATION_QUEUE, {
      connection: createRedisConnection(),
      defaultJobOptions: {
        attempts: 1,
        removeOnComplete: 100,
        removeOnFail: 200,
      },
    });
    // BullMQ re-emits connection errors on the Queue — must be listened for.
    generationQueue.on("error", (err) => console.error("[queue] error:", err));
  }
  return generationQueue;
}

export async function enqueueGeneration(generationId: string) {
  if (!env.redisConfigured) {
    // No Redis — run the job in this process. Fire-and-forget: status and
    // errors are persisted on the Generation row by the worker itself.
    const { runGeneration } = await import("./generation-worker.js");
    void runGeneration(generationId).catch((err) =>
      console.error(`[inline] generation ${generationId} failed:`, err),
    );
    return;
  }
  // jobId = generationId keeps the queue idempotent on retries/duplicate POSTs.
  await getQueue().add("generate", { generationId }, { jobId: generationId });
}
