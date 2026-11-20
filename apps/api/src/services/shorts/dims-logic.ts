/**
 * Experiment dimensions tagged on every video, so analytics can group by them.
 */

export interface VideoDims {
  channel: string;
  niche: string;
  path: string;
  hookType: string | null;
  lengthBucket: string | null;
  voice: string | null;
  topic: string | null;
  postingHour: number | null;
  synthetic: boolean;
  [k: string]: string | number | boolean | null;
}

export const LENGTH_BUCKETS = ["<15s", "15-24s", "25-34s", "35-45s", ">45s"] as const;

export function lengthBucket(sec: number | null | undefined): string | null {
  if (sec === null || sec === undefined || !Number.isFinite(sec)) return null;
  if (sec < 15) return "<15s";
  if (sec < 25) return "15-24s";
  if (sec < 35) return "25-34s";
  if (sec <= 45.5) return "35-45s";
  return ">45s";
}

/** Hour of day (0-23) of `at` in time zone `tz`. */
export function hourIn(at: Date, tz: string): number {
  const h = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", hourCycle: "h23" }).format(at);
  return Number(h) % 24;
}

export function buildDims(
  channel: { slug: string; niche: string },
  v: {
    path: string;
    hookType?: string | null;
    durationSec?: number | null;
    voiceId?: string | null;
    topic?: string | null;
    slotAt?: Date | null;
    postedAt?: Date | null;
    synthetic: boolean;
  },
  tz: string,
): VideoDims {
  const at = v.postedAt ?? v.slotAt ?? null;
  return {
    channel: channel.slug,
    niche: channel.niche,
    path: v.path,
    hookType: v.hookType ?? null,
    lengthBucket: lengthBucket(v.durationSec),
    voice: v.voiceId ?? null,
    topic: v.topic ?? null,
    postingHour: at ? hourIn(at, tz) : null,
    synthetic: v.synthetic,
  };
}
