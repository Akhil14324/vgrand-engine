import { Queue } from "bullmq";
import IORedis from "ioredis";
import { env } from "../env.js";

export const GENERATION_QUEUE = "image-generation";

/** Job payloads carried by the shared queue — discriminated by job name. */
export interface GenerationJob {
  generationId: string;
}
export interface IngestJob {
  documentId: string;
  mimeType: string;
}
export type QueueJob = GenerationJob | IngestJob;

/** Shared by BullMQ Queue (server) and Worker. */
export function createRedisConnection(): IORedis {
  const conn = new IORedis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    // Railway's private network (*.railway.internal) is IPv6-only; family 0
    // lets ioredis resolve either stack instead of hanging on IPv4.
    family: 0,
  });
  // An ioredis 'error' with no listener is an unhandled EventEmitter error and
  // kills the process — log instead of crashing when Redis is unreachable.
  conn.on("error", (err) => console.error("[redis] connection error:", err.message));
  return conn;
}

/**
 * Created lazily — when REDIS_URL isn't configured we never touch Redis and
 * jobs run in-process instead.
 */
let generationQueue: Queue<QueueJob> | null = null;
function getQueue(): Queue<QueueJob> {
  if (!generationQueue) {
    generationQueue = new Queue<QueueJob>(GENERATION_QUEUE, {
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

/**
 * Document ingestion (PDF/DOCX → chunks + embeddings) goes through the same
 * queue as image generation — off the request thread either way.
 */
export async function enqueueDocumentIngestion(
  documentId: string,
  mimeType: string,
) {
  if (!env.redisConfigured) {
    const { runDocumentIngestion } = await import("./documents.js");
    void runDocumentIngestion(documentId, mimeType).catch((err) =>
      console.error(`[inline] document ${documentId} ingest failed:`, err),
    );
    return;
  }
  await getQueue().add(
    "ingest-document",
    { documentId, mimeType },
    { jobId: `ingest-${documentId}` },
  );
}

/** Queue depth for /health — shows whether jobs are piling up unconsumed. */
export async function queueStats() {
  if (!env.redisConfigured) return { mode: "inline" as const };
  const counts = await getQueue().getJobCounts("waiting", "active", "failed");
  return { mode: "redis" as const, workerInline: env.WORKER_INLINE, ...counts };
}
