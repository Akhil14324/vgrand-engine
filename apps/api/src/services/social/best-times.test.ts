import { describe, expect, it } from "vitest";
import { rankBestTimes } from "./best-times.js";

// Monday 2030-01-07 00:00 UTC.
const NOW = Date.parse("2030-01-07T00:00:00Z");
const localHour = (iso: string, tz: string) =>
  Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", hour: "2-digit" }).format(new Date(iso)));

describe("rankBestTimes", () => {
  it("returns up to three well-separated future slots on local hours", () => {
    const slots = rankBestTimes({ platforms: ["instagram"], timezone: "Asia/Kolkata", now: NOW });
    expect(slots).toHaveLength(3);
    for (const s of slots) {
      expect(Date.parse(s.at)).toBeGreaterThan(NOW);
      expect(new Date(s.at).getUTCMinutes()).toBe(30); // IST is UTC+5:30, so local :00 is UTC :30
    }
    const times = slots.map((s) => Date.parse(s.at)).sort((a, b) => a - b);
    expect(times[1]! - times[0]!).toBeGreaterThanOrEqual(3 * 3_600_000);
  });

  it("prefers waking hours over the middle of the night", () => {
    const slots = rankBestTimes({ platforms: ["x", "facebook"], timezone: "America/New_York", now: NOW });
    for (const s of slots) expect(localHour(s.at, "America/New_York")).toBeGreaterThanOrEqual(7);
  });

  it("restricts to the requested local day", () => {
    const slots = rankBestTimes({
      platforms: ["instagram"],
      timezone: "America/New_York",
      date: "2030-01-10",
      now: NOW,
    });
    expect(slots.length).toBeGreaterThan(0);
    for (const s of slots) {
      const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(s.at));
      expect(day).toBe("2030-01-10");
    }
  });

  it("steers away from a time that's already booked", () => {
    const first = rankBestTimes({ platforms: ["instagram"], timezone: "UTC", now: NOW })[0]!;
    const next = rankBestTimes({
      platforms: ["instagram"],
      timezone: "UTC",
      now: NOW,
      taken: [Date.parse(first.at)],
    });
    expect(next.map((s) => s.at)).not.toContain(first.at);
  });

  it("rejects an unknown time zone", () => {
    expect(() => rankBestTimes({ platforms: ["x"], timezone: "Mars/Base", now: NOW })).toThrow();
  });
});
