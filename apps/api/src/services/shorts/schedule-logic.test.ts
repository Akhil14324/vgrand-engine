import { describe, expect, it } from "vitest";
import { localDate, nextFreeSlot, slotsForDay, tzOffsetMinutes, upcomingSlots, zonedToUtc } from "./schedule-logic.js";

describe("IST slots", () => {
  it("converts IST wall time to UTC (+05:30, no DST)", () => {
    expect(tzOffsetMinutes(new Date("2026-06-01T00:00:00Z"), "Asia/Kolkata")).toBe(330);
    expect(zonedToUtc("2026-11-20", "08:30", "Asia/Kolkata").toISOString()).toBe("2026-11-20T03:00:00.000Z");
    expect(zonedToUtc("2026-11-20", "00:15", "Asia/Kolkata").toISOString()).toBe("2026-11-19T18:45:00.000Z");
  });
  it("lists a day's slots sorted, and the local date of an instant", () => {
    expect(slotsForDay(["18:00", "09:00"], "2026-11-20", "Asia/Kolkata").map((d) => d.toISOString())).toEqual([
      "2026-11-20T03:30:00.000Z",
      "2026-11-20T12:30:00.000Z",
    ]);
    expect(localDate(new Date("2026-11-20T20:00:00Z"), "Asia/Kolkata")).toBe("2026-11-21");
  });
  it("upcoming slots within a horizon cross midnight correctly", () => {
    const from = new Date("2026-11-20T15:00:00Z"); // 20:30 IST
    const s = upcomingSlots(["08:30", "21:30"], "Asia/Kolkata", from, 24 * 3600_000).map((d) => d.toISOString());
    expect(s).toEqual(["2026-11-20T16:00:00.000Z", "2026-11-21T03:00:00.000Z"]);
  });
  it("next free slot skips taken ones", () => {
    const from = new Date("2026-11-20T00:00:00Z");
    const taken = new Set([new Date("2026-11-20T03:00:00Z").getTime()]);
    expect(nextFreeSlot(["08:30"], "Asia/Kolkata", from, taken)?.toISOString()).toBe("2026-11-21T03:00:00.000Z");
    expect(nextFreeSlot([], "Asia/Kolkata", from, taken)).toBeNull();
  });
  it("handles a DST zone", () => {
    expect(zonedToUtc("2026-07-01", "09:00", "America/New_York").toISOString()).toBe("2026-07-01T13:00:00.000Z");
    expect(zonedToUtc("2026-12-01", "09:00", "America/New_York").toISOString()).toBe("2026-12-01T14:00:00.000Z");
  });
});
