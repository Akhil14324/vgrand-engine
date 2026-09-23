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

export const generationQueue = new Queue<{ generationId: string }>(
  GENERATION_QUEUE,
  {
    connection: createRedisConnection(),
    defaultJobOptions: { attempts: 1, removeOnComplete: 100, removeOnFail: 200 },
  },
);
// BullMQ re-emits connection errors on the Queue — must be listened for.
generationQueue.on("error", (err) => console.error("[queue] error:", err));

export async function enqueueGeneration(generationId: string) {
  // jobId = generationId keeps the queue idempotent on retries/duplicate POSTs.
  await generationQueue.add("generate", { generationId }, { jobId: generationId });
}
