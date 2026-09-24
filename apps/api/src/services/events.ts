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

/** In-process bus used when there's no Redis — inline mode is same-process. */
const localBus = new EventEmitter();
localBus.setMaxListeners(0); // one listener per open SSE stream — don't warn.

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
  pub ??= new IORedis(env.REDIS_URL);
  // No 'error' listener => unhandled EventEmitter error => process crash when
  // Redis is down. Swallow it — publishes already fail soft via .catch().
  pub.on("error", () => {});
  pub
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
  const sub = new IORedis(env.REDIS_URL);
  sub.on("error", () => {});
  sub.subscribe(ch).catch(() => {});
  const onMessage = (_channel: string, message: string) => {
    try {
      handler(JSON.parse(message) as GenerationEvent);
    } catch {
      // ignore malformed events
    }
  };
  sub.on("message", onMessage);
  return () => {
    sub.off("message", onMessage);
    sub.disconnect();
  };
}
