/**
 * Posting slots: channel posting times ("HH:MM") interpreted in the app time
 * zone (default Asia/Kolkata), converted to UTC instants. Works for zones with
 * DST too (the offset is resolved per date).
 */

/** Offset in minutes of `tz` from UTC at instant `at` (e.g. +330 for IST). */
export function tzOffsetMinutes(at: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  return Math.round((asUtc - at.getTime()) / 60_000);
}

/** Calendar date (YYYY-MM-DD) of `at` in `tz`. */
export function localDate(at: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

/** UTC instant of local wall time `date` + `hhmm` in `tz`. */
export function zonedToUtc(date: string, hhmm: string, tz: string): Date {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const [hh, mm] = hhmm.split(":").map(Number) as [number, number];
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  // Two passes handle a DST change between the guess and the real instant.
  let utc = guess - tzOffsetMinutes(new Date(guess), tz) * 60_000;
  utc = guess - tzOffsetMinutes(new Date(utc), tz) * 60_000;
  return new Date(utc);
}

export const addDays = (date: string, n: number): string => {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

/** All slots for one local day. */
export function slotsForDay(postingTimes: string[], date: string, tz: string): Date[] {
  return [...postingTimes].sort().map((t) => zonedToUtc(date, t, tz));
}

/** Slots strictly after `from` and at most `horizonMs` ahead. */
export function upcomingSlots(postingTimes: string[], tz: string, from: Date, horizonMs: number): Date[] {
  const out: Date[] = [];
  const end = from.getTime() + horizonMs;
  const start = localDate(from, tz);
  for (let i = 0; i <= Math.ceil(horizonMs / 86_400_000) + 1; i++) {
    for (const s of slotsForDay(postingTimes, addDays(start, i), tz)) {
      if (s.getTime() > from.getTime() && s.getTime() <= end) out.push(s);
    }
  }
  return out;
}

/** Next slot after `from` that isn't already taken. */
export function nextFreeSlot(postingTimes: string[], tz: string, from: Date, taken: Set<number>): Date | null {
  if (!postingTimes.length) return null;
  for (const s of upcomingSlots(postingTimes, tz, from, 30 * 86_400_000)) if (!taken.has(s.getTime())) return s;
  return null;
}
