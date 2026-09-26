import { prisma } from "@catgpt/db";
import type { BestTimeSlotDto, SocialPlatform } from "@catgpt/types";
import { badRequest } from "../../lib/errors.js";
import { findUsableAccount } from "./accounts.js";

/**
 * General audience-activity patterns per platform, in the viewer's LOCAL time.
 * These are broad industry norms, not this brand's own numbers (the app does
 * not read engagement back yet), so the UI labels them as suggestions.
 * `days` is indexed 0 = Sunday .. 6 = Saturday.
 */
const PROFILES: Record<SocialPlatform, { peaks: [hour: number, weight: number][]; days: number[] }> = {
  instagram: {
    peaks: [[11, 0.9], [13, 0.8], [19, 1], [21, 0.75]],
    days: [0.6, 0.85, 0.95, 1, 0.95, 0.85, 0.6],
  },
  facebook: {
    peaks: [[9, 0.8], [13, 1], [15, 0.7]],
    days: [0.6, 0.85, 0.95, 1, 1, 0.9, 0.55],
  },
  x: {
    peaks: [[8, 0.8], [12, 1], [17, 0.9]],
    days: [0.55, 0.9, 1, 1, 0.95, 0.85, 0.5],
  },
  youtube: {
    peaks: [[15, 0.9], [18, 1], [20, 0.8]],
    days: [0.85, 0.7, 0.75, 0.85, 0.95, 1, 1],
  },
};

const HOUR_MS = 3_600_000;
const SPREAD = 1.8;
/** Slots must be at least this far apart so the suggestions are real alternatives. */
const MIN_PICK_GAP_HOURS = 3;
const TOP_N = 3;
/** Another post on the same account this close makes the slot much worse. */
const CROWDED_MS = 2 * HOUR_MS;

/** 0-1 strength of an hour of the day: the strongest nearby peak, smoothly decaying. */
function hourStrength(platform: SocialPlatform, hour: number): number {
  let best = 0.02;
  for (const [peak, weight] of PROFILES[platform].peaks) {
    const d = Math.abs(hour - peak);
    best = Math.max(best, weight * Math.exp(-((d / SPREAD) ** 2)));
  }
  return best;
}

export const platformSlotScore = (platform: SocialPlatform, weekday: number, hour: number) =>
  PROFILES[platform].days[weekday]! * hourStrength(platform, hour);

interface LocalParts {
  ymd: string;
  weekday: number;
  hour: number;
  minute: number;
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function makeLocalParts(timezone: string): (ms: number) => LocalParts {
  let fmt: Intl.DateTimeFormat;
  try {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    throw badRequest("Unknown time zone");
  }
  return (ms) => {
    const p: Record<string, string> = {};
    for (const part of fmt.formatToParts(new Date(ms))) p[part.type] = part.value;
    return {
      ymd: `${p.year}-${p.month}-${p.day}`,
      weekday: WEEKDAYS[p.weekday!] ?? 0,
      hour: Number(p.hour) % 24,
      minute: Number(p.minute),
    };
  };
}

export interface BestTimeInput {
  platforms: SocialPlatform[];
  timezone: string;
  /** Local calendar day to restrict to, or omitted for the next 7 days. */
  date?: string;
  now?: number;
  /** Instants (ms) already scheduled on the selected accounts. */
  taken?: number[];
}

/** Pure ranking so it can be tested without a database. */
export function rankBestTimes(input: BestTimeInput): BestTimeSlotDto[] {
  const platforms = [...new Set(input.platforms)];
  if (platforms.length === 0) return [];
  const local = makeLocalParts(input.timezone);
  const now = input.now ?? Date.now();
  const taken = input.taken ?? [];
  // The API rejects times under a minute away; leave real headroom.
  const earliest = now + 5 * 60_000;

  const base = now + 65 * 60_000;
  const start = input.date
    ? Math.max(base, Date.parse(`${input.date}T00:00:00Z`) - 14 * HOUR_MS)
    : base;
  const steps = input.date ? 24 + 28 + 2 : 8 * 24;

  const takenDays = new Set(taken.map((t) => local(t).ymd));
  const slots: { at: number; score: number; platforms: SocialPlatform[] }[] = [];

  for (let k = 0; k < steps; k++) {
    const raw = start + k * HOUR_MS;
    const parts = local(raw);
    const at = raw - parts.minute * 60_000; // snap to the local hour (handles :30 zones)
    if (at < earliest) continue;
    const p = at === raw ? parts : local(at);
    if (input.date && p.ymd !== input.date) continue;

    const per = platforms.map((pl) => platformSlotScore(pl, p.weekday, p.hour));
    let score = per.reduce((a, b) => a + b, 0) / per.length;
    if (taken.some((t) => Math.abs(t - at) < CROWDED_MS)) score *= 0.35;
    else if (takenDays.has(p.ymd)) score *= 0.85;

    slots.push({
      at,
      score,
      platforms: platforms.filter((_, i) => per[i]! >= 0.75),
    });
  }

  slots.sort((a, b) => b.score - a.score || a.at - b.at);
  const picked: typeof slots = [];
  for (const s of slots) {
    if (picked.every((x) => Math.abs(x.at - s.at) >= MIN_PICK_GAP_HOURS * HOUR_MS)) picked.push(s);
    if (picked.length === TOP_N) break;
  }
  return picked.map((s) => ({
    at: new Date(s.at).toISOString(),
    score: Math.round(s.score * 100),
    platforms: s.platforms,
  }));
}

/** Suggestions for the accounts a post is going to, avoiding times they're already booked. */
export async function suggestBestTimes(
  userId: string,
  accountIds: string[],
  timezone: string,
  date?: string,
): Promise<BestTimeSlotDto[]> {
  const ids = [...new Set(accountIds)].slice(0, 12);
  // Membership check for every id - the client-supplied list is never trusted.
  const accounts = await Promise.all(ids.map((id) => findUsableAccount(userId, id)));
  const platforms = accounts.map((a) => a.platform as SocialPlatform);

  const booked = await prisma.socialPost.findMany({
    where: { accountId: { in: ids }, status: "scheduled", scheduledFor: { gte: new Date() } },
    select: { scheduledFor: true },
    take: 500,
  });
  return rankBestTimes({
    platforms,
    timezone,
    date,
    taken: booked.flatMap((b) => (b.scheduledFor ? [b.scheduledFor.getTime()] : [])),
  });
}
