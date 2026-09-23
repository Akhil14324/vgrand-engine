import IORedis from "ioredis";
import type { GenerationEvent } from "@prompthub/types";
import { env } from "../env.js";

const CHANNEL = "prompthub:generation-events";

let pub: IORedis | null = null;

/**
 * Redis pub/sub bridge between the BullMQ worker and the SSE routes — works
 * whether the worker runs inline (WORKER_INLINE=true) or as a separate process.
 */
export function publishGenerationEvent(evt: GenerationEvent): void {
  pub ??= new IORedis(env.REDIS_URL);
  // No 'error' listener => unhandled EventEmitter error => process crash when
  // Redis is down. Swallow it — publishes already fail soft via .catch().
  pub.on("error", () => {});
  pub.publish(CHANNEL, JSON.stringify(evt)).catch(() => {});
}

export function subscribeGenerationEvents(
  handler: (evt: GenerationEvent) => void,
): () => void {
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
