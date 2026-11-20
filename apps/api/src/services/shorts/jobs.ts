import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import { Prisma, prisma } from "@catgpt/db";
import { backoffMs } from "./jobs-logic.js";
import { log } from "./log.js";
import { ShortsConfigError } from "./env-check.js";

/**
 * Postgres-backed job queue for the Shorts Factory (see DECISIONS.md).
 *
 * - enqueue is idempotent: `idempotencyKey` is UNIQUE, a repeat returns the existing row.
 * - claim uses FOR UPDATE SKIP LOCKED plus a lease; a crashed worker's lease
 *   expires and another worker re-claims the job.
 * - complete/fail only apply while this worker still holds the lease.
 */

export type ShortsJobRow = Prisma.ShortsJobGetPayload<object>;

export const LEASE_MS = 10 * 60_000;
const HEARTBEAT_MS = 60_000;

/** A failure that retrying won't fix (bad config, invalid content). */
export class PermanentJobError extends Error {}

export interface EnqueueInput {
  type: string;
  key: string;
  videoId?: string | null;
  channelId?: string | null;
  payload?: Record<string, unknown>;
  runAt?: Date;
  maxAttempts?: number;
}

export async function enqueueJob(input: EnqueueInput): Promise<{ job: ShortsJobRow; created: boolean }> {
  try {
    const job = await prisma.shortsJob.create({
      data: {
        type: input.type,
        idempotencyKey: input.key,
        videoId: input.videoId ?? null,
        channelId: input.channelId ?? null,
        payload: (input.payload ?? {}) as Prisma.InputJsonValue,
        runAt: input.runAt ?? new Date(),
        maxAttempts: input.maxAttempts ?? 4,
      },
    });
    return { job, created: true };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const job = await prisma.shortsJob.findUniqueOrThrow({ where: { idempotencyKey: input.key } });
      return { job, created: false };
    }
    throw err;
  }
}

/**
 * Re-arms a finished/dead job under the same key (owner pressed "retry").
 * A job that is queued or running is left alone.
 */
export async function rearmJob(key: string, runAt = new Date()): Promise<boolean> {
  const r = await prisma.shortsJob.updateMany({
    where: { idempotencyKey: key, status: { in: ["done", "dead"] } },
    data: { status: "queued", attempts: 0, runAt, lastError: null, lockedBy: null, lockedUntil: null, finishedAt: null },
  });
  return r.count > 0;
}

export const workerId = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;

/** Claims up to `limit` due jobs (queued and due, or running with an expired lease). Earliest runAt first. */
export async function claimJobs(
  limit: number,
  filter: { types?: string[]; videoIds?: string[] } = {},
  owner = workerId,
): Promise<ShortsJobRow[]> {
  const typeFilter = filter.types?.length ? Prisma.sql`AND "type" IN (${Prisma.join(filter.types)})` : Prisma.empty;
  const videoFilter = filter.videoIds?.length ? Prisma.sql`AND "videoId" IN (${Prisma.join(filter.videoIds)})` : Prisma.empty;
  const rows = await prisma.$queryRaw<ShortsJobRow[]>`
    UPDATE "shorts_jobs" SET
      "status" = 'running',
      "attempts" = "attempts" + 1,
      "lockedBy" = ${owner},
      "lockedUntil" = now() + make_interval(secs => ${LEASE_MS / 1000}),
      "updatedAt" = now()
    WHERE "id" IN (
      SELECT "id" FROM "shorts_jobs"
      WHERE (("status" = 'queued' AND "runAt" <= now())
          OR ("status" = 'running' AND "lockedUntil" < now()))
      ${typeFilter}
      ${videoFilter}
      ORDER BY "runAt" ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING *`;
  return rows;
}

async function heartbeat(job: ShortsJobRow, owner: string): Promise<void> {
  await prisma.shortsJob.updateMany({
    where: { id: job.id, lockedBy: owner, status: "running" },
    data: { lockedUntil: new Date(Date.now() + LEASE_MS) },
  });
}

export async function completeJob(job: ShortsJobRow, owner = workerId): Promise<void> {
  await prisma.shortsJob.updateMany({
    where: { id: job.id, lockedBy: owner, status: "running" },
    data: { status: "done", finishedAt: new Date(), lockedUntil: null, lastError: null },
  });
}

/** Returns "retry" or "dead". */
export async function failJob(
  job: ShortsJobRow,
  err: unknown,
  owner = workerId,
): Promise<"retry" | "dead"> {
  const message = err instanceof Error ? err.message : String(err);
  // Missing configuration won't fix itself between retries: fail now with the reason.
  const permanent = err instanceof PermanentJobError || err instanceof ShortsConfigError;
  const dead = permanent || job.attempts >= job.maxAttempts;
  await prisma.shortsJob.updateMany({
    where: { id: job.id, lockedBy: owner, status: "running" },
    data: dead
      ? { status: "dead", lastError: message.slice(0, 4000), finishedAt: new Date(), lockedUntil: null }
      : {
          status: "queued",
          lastError: message.slice(0, 4000),
          runAt: new Date(Date.now() + backoffMs(job.attempts)),
          lockedUntil: null,
          lockedBy: null,
        },
  });
  return dead ? "dead" : "retry";
}

/** Puts a job back to `queued` at `runAt` without counting an attempt (a step that waits, e.g. polling). */
export async function deferJob(job: ShortsJobRow, runAt: Date, owner = workerId): Promise<void> {
  await prisma.shortsJob.updateMany({
    where: { id: job.id, lockedBy: owner, status: "running" },
    data: { status: "queued", runAt, attempts: { decrement: 1 }, lockedUntil: null, lockedBy: null },
  });
}

/* ------------------------------- the worker -------------------------------- */

export type JobResult = void | { deferUntil: Date };
export type JobHandler = (job: ShortsJobRow) => Promise<JobResult>;

const handlers = new Map<string, { run: JobHandler; onDead?: (job: ShortsJobRow, message: string) => Promise<void> }>();

export function registerJobHandler(
  type: string,
  run: JobHandler,
  onDead?: (job: ShortsJobRow, message: string) => Promise<void>,
): void {
  handlers.set(type, { run, onDead });
}

/** Runs one claimed job to completion with a lease heartbeat. Exported for tests and the CLI. */
export async function runClaimedJob(job: ShortsJobRow, owner = workerId): Promise<"done" | "retry" | "dead" | "deferred"> {
  const h = handlers.get(job.type);
  if (!h) {
    await failJob(job, new PermanentJobError(`no handler for job type ${job.type}`), owner);
    return "dead";
  }
  const beat = setInterval(() => void heartbeat(job, owner).catch(() => {}), HEARTBEAT_MS);
  beat.unref();
  const started = Date.now();
  try {
    const result = await h.run(job);
    if (result && "deferUntil" in result) {
      await deferJob(job, result.deferUntil, owner);
      return "deferred";
    }
    await completeJob(job, owner);
    log.info("job.done", { jobId: job.id, type: job.type, videoId: job.videoId, ms: Date.now() - started });
    return "done";
  } catch (err) {
    const outcome = await failJob(job, err, owner);
    const message = err instanceof Error ? err.message : String(err);
    log.warn("job.failed", { jobId: job.id, type: job.type, videoId: job.videoId, attempt: job.attempts, outcome, error: message });
    if (outcome === "dead" && h.onDead) {
      await h.onDead(job, message).catch((e) => log.error("job.onDead_failed", { jobId: job.id, error: String(e) }));
    }
    return outcome;
  } finally {
    clearInterval(beat);
  }
}

/** Claims and runs due jobs until none are left (or `max` were run). Used by the CLI and tests. */
export async function drainJobs(opts: { max?: number; types?: string[]; videoIds?: string[] } = {}): Promise<number> {
  let ran = 0;
  const max = opts.max ?? 1000;
  while (ran < max) {
    const [job] = await claimJobs(1, { types: opts.types, videoIds: opts.videoIds });
    if (!job) break;
    await runClaimedJob(job);
    ran++;
  }
  return ran;
}

let timer: NodeJS.Timeout | null = null;
let active = 0;
let stopping = false;

export const SHORTS_WORKER_CONCURRENCY = Number(process.env.SHORTS_WORKER_CONCURRENCY ?? 2) || 2;

export function startShortsJobWorker(pollMs = 5_000): void {
  if (timer) return;
  stopping = false;
  const tick = async () => {
    if (stopping) return;
    const free = SHORTS_WORKER_CONCURRENCY - active;
    if (free <= 0) return;
    let jobs: ShortsJobRow[] = [];
    try {
      jobs = await claimJobs(free);
    } catch (err) {
      log.error("worker.claim_failed", { error: String(err) });
      return;
    }
    for (const job of jobs) {
      active++;
      void runClaimedJob(job).finally(() => {
        active--;
      });
    }
  };
  timer = setInterval(() => void tick(), pollMs);
  timer.unref();
  void tick();
  log.info("worker.started", { workerId, concurrency: SHORTS_WORKER_CONCURRENCY });
}

export function stopShortsJobWorker(): void {
  stopping = true;
  if (timer) clearInterval(timer);
  timer = null;
}
