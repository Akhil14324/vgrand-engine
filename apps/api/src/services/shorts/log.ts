import { Prisma, prisma } from "@catgpt/db";

/**
 * Structured logs for the Shorts Factory: one JSON line per event on stdout/stderr
 * (`{"ts","level","scope":"shorts","event",...}`), so a log drain can filter them.
 */
type Level = "info" | "warn" | "error";

function emit(level: Level, event: string, data: Record<string, unknown> = {}) {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, scope: "shorts", event, ...data });
  if (level === "info") console.log(line);
  else console.error(line);
}

export const log = {
  info: (event: string, data?: Record<string, unknown>) => emit("info", event, data),
  warn: (event: string, data?: Record<string, unknown>) => emit("warn", event, data),
  error: (event: string, data?: Record<string, unknown>) => emit("error", event, data),
};

/** Also persisted so the UI can show a video's history (transitions, fallbacks, refusals). */
export async function recordEvent(input: {
  videoId?: string | null;
  channelId?: string | null;
  level?: Level;
  type: string;
  message: string;
  data?: Record<string, unknown>;
}): Promise<void> {
  emit(input.level ?? "info", input.type, { videoId: input.videoId, channelId: input.channelId, message: input.message, ...input.data });
  await prisma.shortsEvent
    .create({
      data: {
        videoId: input.videoId ?? null,
        channelId: input.channelId ?? null,
        level: input.level ?? "info",
        type: input.type,
        message: input.message,
        data: (input.data ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    })
    .catch((err) => emit("error", "event.persist_failed", { error: String(err) }));
}
