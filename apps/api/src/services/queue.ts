import { Queue } from "bullmq";
import IORedis from "ioredis";
import { env } from "../env.js";

export const GENERATION_QUEUE = "image-generation";
/** Separate queue so a burst of PDF uploads can't hold up anyone's chat turn. */
export const INGEST_QUEUE = "document-ingestion";

/** One job per SocialPost - a failing platform never blocks the others. */
export const SOCIAL_QUEUE = "social-posts";
export const SOCIAL_MAX_ATTEMPTS = 3;
export const SOCIAL_BACKOFF_MS = 30_000;

export interface SocialPostJob {
  socialPostId: string;
}
export interface GenerationJob {
  generationId: string;
}
export interface IngestJob {
  documentId: string;
  mimeType: string;
}

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
const queues = new Map<string, Queue>();
function getQueue<T>(name: string): Queue<T> {
  let queue = queues.get(name);
  if (!queue) {
    queue = new Queue(name, {
      connection: createRedisConnection(),
      defaultJobOptions: {
        attempts: 1,
        removeOnComplete: 100,
        removeOnFail: 200,
      },
    });
    // BullMQ re-emits connection errors on the Queue — must be listened for.
    queue.on("error", (err) => console.error(`[queue:${name}] error:`, err));
    queues.set(name, queue);
  }
  return queue as unknown as Queue<T>;
}

/**
 * BullMQ runs prioritized jobs BEFORE unprioritized ones, and lower numbers
 * first — so foreground turns get priority 1 and `background` jobs
 * (auto-spawned campaign creatives) get 10, which makes a batch of posters
 * sit behind other users' chat turns instead of jumping ahead of them.
 */
export async function enqueueGeneration(
  generationId: string,
  opts: { background?: boolean } = {},
) {
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
  await getQueue<GenerationJob>(GENERATION_QUEUE).add(
    "generate",
    { generationId },
    { jobId: generationId, priority: opts.background ? 10 : 1 },
  );
}

/**
 * Force a fresh queue entry for a generation — the stale-work sweep uses this
 * when the original job may still exist in a dead/failed state, where BullMQ
 * would otherwise dedupe the re-add and the row would never run again.
 * Removing a live/locked job throws (swallowed), and the dedupe then keeps
 * the real job — safe either way.
 */
export async function requeueGeneration(generationId: string) {
  if (!env.redisConfigured) {
    await enqueueGeneration(generationId);
    return;
  }
  await getQueue<GenerationJob>(GENERATION_QUEUE)
    .remove(generationId)
    .catch(() => {});
  await enqueueGeneration(generationId);
}

/** Document ingestion (PDF/DOCX → chunks + embeddings) — off the request thread. */
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
  await getQueue<IngestJob>(INGEST_QUEUE).add(
    "ingest-document",
    { documentId, mimeType },
    { jobId: `ingest-${documentId}` },
  );
}

/**
 * Publish one SocialPost. BullMQ: jobId = SocialPost id (duplicate enqueues
 * dedupe), 3 attempts, exponential backoff. `force` first drops the finished
 * job that would otherwise make BullMQ ignore the re-add (manual retry, recovery);
 * a live/locked job can't be removed, so it keeps deduping. No Redis: runs
 * in-process with the same attempt count and backoff schedule.
 */
export async function enqueueSocialPost(
  socialPostId: string,
  opts: { force?: boolean } = {},
) {
  if (!env.redisConfigured) {
    const { runSocialPostInline } = await import("./social/publish.js");
    void runSocialPostInline(socialPostId).catch((err) =>
      console.error(`[inline] social post ${socialPostId} failed:`, err),
    );
    return;
  }
  const queue = getQueue<SocialPostJob>(SOCIAL_QUEUE);
  if (opts.force) await queue.remove(socialPostId).catch(() => {});
  await queue.add(
    "publish",
    { socialPostId },
    {
      jobId: socialPostId,
      attempts: SOCIAL_MAX_ATTEMPTS,
      backoff: { type: "exponential", delay: SOCIAL_BACKOFF_MS },
    },
  );
}

/** Queue depth for /health — shows whether jobs are piling up unconsumed. */
export async function queueStats() {
  if (!env.redisConfigured) return { mode: "inline" as const };
  const counts = await getQueue(GENERATION_QUEUE).getJobCounts(
    "waiting",
    "active",
    "failed",
  );
  return { mode: "redis" as const, workerInline: env.WORKER_INLINE, ...counts };
}
