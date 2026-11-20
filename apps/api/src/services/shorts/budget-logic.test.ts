import { describe, expect, it } from "vitest";
import { checkBudget, clipPrompt, clipSecondsFor, monthStart, nextMonthStart, pricePerSecond } from "./budget-logic.js";

describe("Path C budget", () => {
  it("refuses a spend that would pass the cap, allows one that lands exactly on it", () => {
    expect(checkBudget(10, 9.2, 0.8)).toEqual({ ok: true, spent: 9.2, remaining: 0.8, estimate: 0.8 });
    expect(checkBudget(10, 9.3, 0.8).ok).toBe(false);
    expect(checkBudget(0, 0, 0.4).ok).toBe(false);
  });
  it("uses the owner's price, else the USD list price only for a USD budget", () => {
    expect(pricePerSecond({ setting: 3.5, currency: "INR", model: "veo-3.1-lite" })).toBe(3.5);
    expect(pricePerSecond({ setting: null, currency: "USD", model: "veo-3.1-lite" })).toBe(0.05);
    expect(pricePerSecond({ setting: null, currency: "INR", model: "veo-3.1-lite" })).toBeNull();
  });
  it("asks for the shortest clip that covers the beat, else the longest (looped)", () => {
    expect(clipSecondsFor("veo-3.1-lite", 3.2)).toBe(4);
    expect(clipSecondsFor("veo-3.1-lite", 7)).toBe(8);
    expect(clipSecondsFor("veo-3.1-lite", 12)).toBe(8);
    expect(clipSecondsFor("kling-3-standard", 6)).toBe(10);
  });
  it("months follow the app time zone", () => {
    // 2026-11-30 20:00 UTC is already 1 Dec in IST.
    expect(monthStart(new Date("2026-11-30T20:00:00Z"), "Asia/Kolkata").toISOString()).toBe("2026-11-30T18:30:00.000Z");
    expect(monthStart(new Date("2026-11-20T00:00:00Z"), "Asia/Kolkata").toISOString()).toBe("2026-10-31T18:30:00.000Z");
    expect(nextMonthStart(new Date("2026-12-15T00:00:00Z"), "Asia/Kolkata").toISOString()).toBe("2026-12-31T18:30:00.000Z");
  });
  it("prompts describe visuals and forbid text, logos and real people", () => {
    const p = clipPrompt({ niche: "fails", queries: ["cake falling"], narration: "He almost made it." });
    expect(p).toMatch(/^Vertical 9:16 realistic video, fails: cake falling\./);
    expect(p).toMatch(/no on-screen text, no logos/);
  });
});
