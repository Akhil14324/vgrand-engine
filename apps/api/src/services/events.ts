import { EventEmitter } from "node:events";
import IORedis from "ioredis";
import type { GenerationEvent } from "@prompthub/types";
import { env } from "../env.js";

const CHANNEL = "prompthub:generation-events";

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
    localBus.emit(CHANNEL, evt);
    return;
  }
  pub ??= new IORedis(env.REDIS_URL);
  // No 'error' listener => unhandled EventEmitter error => process crash when
  // Redis is down. Swallow it — publishes already fail soft via .catch().
  pub.on("error", () => {});
  pub.publish(CHANNEL, JSON.stringify(evt)).catch(() => {});
}

export function subscribeGenerationEvents(
  handler: (evt: GenerationEvent) => void,
): () => void {
  if (!env.redisConfigured) {
    localBus.on(CHANNEL, handler);
    return () => {
      localBus.off(CHANNEL, handler);
    };
  }
  const sub = new IORedis(env.REDIS_URL);
  sub.on("error", () => {});
  sub.subscribe(CHANNEL).catch(() => {});
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
