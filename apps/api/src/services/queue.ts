import { Queue } from "bullmq";
import IORedis from "ioredis";
import { env } from "../env.js";

export const GENERATION_QUEUE = "image-generation";

/** Shared by BullMQ Queue (server) and Worker. */
export function createRedisConnection(): IORedis {
  return new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
}

export const generationQueue = new Queue<{ generationId: string }>(
  GENERATION_QUEUE,
  {
    connection: createRedisConnection(),
    defaultJobOptions: { attempts: 1, removeOnComplete: 100, removeOnFail: 200 },
  },
);

export async function enqueueGeneration(generationId: string) {
  // jobId = generationId keeps the queue idempotent on retries/duplicate POSTs.
  await generationQueue.add("generate", { generationId }, { jobId: generationId });
}
