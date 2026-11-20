import { addDays, slotsForDay } from "./schedule-logic.js";

/** Expected number of videos per channel per local day: one per posting time, for enabled B/C channels. */
export function expectedSlots(
  channels: { slug: string; path: string; enabled: boolean; videosPerDay: number; postingTimes: string[] }[],
  firstDate: string,
  days: number,
  tz: string,
): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const c of channels) {
    out[c.slug] = {};
    for (let i = 0; i < days; i++) {
      const date = addDays(firstDate, i);
      const generates = c.enabled && (c.path === "B" || c.path === "C");
      out[c.slug]![date] = generates ? slotsForDay(c.postingTimes.slice(0, c.videosPerDay), date, tz).length : 0;
    }
  }
  return out;
}
