import { EventEmitter } from "node:events";
import IORedis from "ioredis";
import type { GenerationEvent } from "@catgpt/types";
import { env } from "../env.js";

/**
 * Per-generation channels — each SSE stream only receives its own job's
 * events instead of fanning every event out to every connected subscriber.
 */
const channel = (generationId: string) => `catgpt:gen:${generationId}`;

let pub: IORedis | null = null;
let sub: IORedis | null = null;
/** generationId channel -> live SSE handlers, on one shared subscriber conn. */
const subscribers = new Map<string, Set<(evt: GenerationEvent) => void>>();

/** In-process bus used when there's no Redis — inline mode is same-process. */
const localBus = new EventEmitter();
localBus.setMaxListeners(0); // one listener per open SSE stream — don't warn.

function getPublisher(): IORedis {
  // No 'error' listener => unhandled EventEmitter error => process crash when
  // Redis is down. Attach once — publishes already fail soft via .catch().
  if (!pub) {
    pub = new IORedis(env.REDIS_URL);
    pub.on("error", () => {});
  }
  return pub;
}

/**
 * One shared subscriber connection for every open SSE stream — a connection
 * per stream multiplied Redis connections by concurrent viewers. Channels are
 * SUBSCRIBEd on the first handler and UNSUBSCRIBEd when the last one leaves.
 */
function getSubscriber(): IORedis {
  if (!sub) {
    sub = new IORedis(env.REDIS_URL);
    sub.on("error", () => {});
    sub.on("message", (ch, message) => {
      const handlers = subscribers.get(ch);
      if (!handlers) return;
      let evt: GenerationEvent;
      try {
        evt = JSON.parse(message) as GenerationEvent;
      } catch {
        return; // ignore malformed events
      }
      for (const handler of handlers) handler(evt);
    });
  }
  return sub;
}

/**
 * Redis pub/sub bridge between the BullMQ worker and the SSE routes — works
 * whether the worker runs inline (WORKER_INLINE=true) or as a separate process.
 * Without REDIS_URL everything is in-process anyway, so a local EventEmitter
 * carries the same events.
 */
export function publishGenerationEvent(evt: GenerationEvent): void {
  if (!env.redisConfigured) {
    localBus.emit(channel(evt.generationId), evt);
    return;
  }
  getPublisher()
    .publish(channel(evt.generationId), JSON.stringify(evt))
    .catch(() => {});
}

export function subscribeGenerationEvents(
  generationId: string,
  handler: (evt: GenerationEvent) => void,
): () => void {
  const ch = channel(generationId);
  if (!env.redisConfigured) {
    localBus.on(ch, handler);
    return () => {
      localBus.off(ch, handler);
    };
  }
  const conn = getSubscriber();
  let handlers = subscribers.get(ch);
  if (!handlers) {
    handlers = new Set();
    subscribers.set(ch, handlers);
    conn.subscribe(ch).catch(() => {});
  }
  handlers.add(handler);
  return () => {
    handlers.delete(handler);
    if (handlers.size === 0) {
      subscribers.delete(ch);
      conn.unsubscribe(ch).catch(() => {});
    }
  };
}
