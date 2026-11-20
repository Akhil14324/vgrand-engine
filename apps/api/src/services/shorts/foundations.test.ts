import { describe, expect, it } from "vitest";
import { canTransition, SHORTS_SEED_CHANNELS, SHORTS_STATUSES, SHORTS_TRANSITIONS } from "@catgpt/types";
import { checkShortsEnv, formatHealthReport } from "./env-check-logic.js";
import { backoffMs } from "./jobs-logic.js";
import { validateChannelConfig } from "./channels.js";

const FULL = {
  DATABASE_URL: "postgresql://x",
  ANTHROPIC_API_KEY: "k",
  ANTHROPIC_MODEL: "m",
  ELEVENLABS_API_KEY: "k",
  PEXELS_API_KEY: "k",
  PIXABAY_API_KEY: "k",
  YOUTUBE_API_KEY: "k",
  PATH_C_MONTHLY_BUDGET: "50",
  BUDGET_CURRENCY: "usd",
  APP_BASE_URL: "https://app.example.com",
};
const TOOLS = { ffmpeg: true, ffprobe: true };

describe("shorts startup check", () => {
  it("passes with every required var and both tools", () => {
    const h = checkShortsEnv(FULL, TOOLS);
    expect(h.ok).toBe(true);
    expect(h.missingRequired).toEqual([]);
    expect(h.budget).toEqual({ amount: 50, currency: "USD" });
    expect(h.timezone).toBe("Asia/Kolkata");
    expect(h.features.youtubeOAuth).toBe(false);
    expect(h.features.pathC).toBe(false);
  });

  it("names every missing variable and tool", () => {
    const h = checkShortsEnv({}, { ffmpeg: false, ffprobe: true });
    expect(h.ok).toBe(false);
    expect(h.missingRequired).toEqual([
      "DATABASE_URL",
      "ANTHROPIC_API_KEY",
      "ANTHROPIC_MODEL",
      "ELEVENLABS_API_KEY",
      "PEXELS_API_KEY",
      "PIXABAY_API_KEY",
      "YOUTUBE_API_KEY",
      "PATH_C_MONTHLY_BUDGET",
      "BUDGET_CURRENCY",
      "APP_BASE_URL",
      "ffmpeg (tool not found on PATH)",
    ]);
    expect(formatHealthReport(h)).toContain("MISSING  ANTHROPIC_API_KEY");
  });

  it("requires TOKEN_ENCRYPTION_KEY once Google OAuth is configured", () => {
    const g = { ...FULL, GOOGLE_CLIENT_ID: "a", GOOGLE_CLIENT_SECRET: "b", GOOGLE_REDIRECT_URI: "https://api.x/shorts/oauth/callback" };
    expect(checkShortsEnv(g, TOOLS).missingRequired).toContain("TOKEN_ENCRYPTION_KEY (required because Google OAuth is configured)");
    const ok = checkShortsEnv({ ...g, TOKEN_ENCRYPTION_KEY: "a".repeat(64) }, TOOLS);
    expect(ok.ok).toBe(true);
    expect(ok.features.youtubeOAuth).toBe(true);
    expect(checkShortsEnv({ ...g, TOKEN_ENCRYPTION_KEY: "short" }, TOOLS).invalid[0]).toMatch(/TOKEN_ENCRYPTION_KEY/);
  });

  it("flags half-configured Google OAuth and Path C, bad budget, bad timezone", () => {
    const h = checkShortsEnv(
      { ...FULL, GOOGLE_CLIENT_ID: "a", VIDEO_GEN_PROVIDER: "sora", PATH_C_MONTHLY_BUDGET: "lots", TIMEZONE: "Mars/Base" },
      TOOLS,
    );
    expect(h.ok).toBe(false);
    expect(h.invalid.join("\n")).toMatch(/partly configured/);
    expect(h.invalid.join("\n")).toMatch(/Set both VIDEO_GEN_PROVIDER/);
    expect(h.invalid.join("\n")).toMatch(/PATH_C_MONTHLY_BUDGET/);
    expect(h.invalid.join("\n")).toMatch(/Mars\/Base/);
  });

  it("enables Path C only for a known provider with a key", () => {
    expect(checkShortsEnv({ ...FULL, VIDEO_GEN_PROVIDER: "Kling", VIDEO_GEN_API_KEY: "k" }, TOOLS).features.pathC).toBe(true);
    expect(checkShortsEnv({ ...FULL, VIDEO_GEN_PROVIDER: "sora", VIDEO_GEN_API_KEY: "k" }, TOOLS).features.pathC).toBe(false);
  });
});

describe("shorts state machine", () => {
  it("follows the spec's pipeline order", () => {
    const happy = ["idea", "scripted", "assets_ready", "rendered", "awaiting_approval", "approved", "scheduled", "posted"] as const;
    for (let i = 0; i < happy.length - 1; i++) expect(canTransition(happy[i]!, happy[i + 1]!)).toBe(true);
    expect(canTransition("approved", "manual_pending")).toBe(true);
    expect(canTransition("manual_pending", "manual_posted")).toBe(true);
  });

  it("never lets a posted video move again, and never skips approval backwards", () => {
    expect(SHORTS_TRANSITIONS.posted).toEqual([]);
    expect(SHORTS_TRANSITIONS.manual_posted).toEqual([]);
    expect(canTransition("idea", "approved")).toBe(false);
    expect(canTransition("awaiting_approval", "posted")).toBe(false);
  });

  it("has a transition entry for every status", () => {
    for (const s of SHORTS_STATUSES) expect(SHORTS_TRANSITIONS[s]).toBeDefined();
  });
});

describe("channel seed and config", () => {
  it("seeds exactly the 10 channels with the right paths", () => {
    expect(SHORTS_SEED_CHANNELS.map((c) => `${c.slug}:${c.path}${c.fallbackPath ?? ""}`)).toEqual([
      "oddly-satisfying:A",
      "weird-science:A",
      "cats:B",
      "dogs:B",
      "wild-animals:B",
      "food:B",
      "wholesome:B",
      "memes-relatable:B",
      "fails:CB",
      "insane-skills:CB",
    ]);
    for (const c of SHORTS_SEED_CHANNELS) {
      if (c.path === "B") expect(c.stockKeywords.length).toBeGreaterThan(0);
    }
  });

  it("validates merged channel config", () => {
    expect(validateChannelConfig({ path: "C", fallbackPath: "B", videosPerDay: 2, postingTimes: ["09:00", "18:00"] })).toBeNull();
    expect(validateChannelConfig({ path: "B", fallbackPath: "B", videosPerDay: 1, postingTimes: ["09:00"] })).toMatch(/differ/);
    expect(validateChannelConfig({ path: "C", fallbackPath: "A", videosPerDay: 1, postingTimes: ["09:00"] })).toMatch(/Path A/);
    expect(validateChannelConfig({ path: "B", fallbackPath: null, videosPerDay: 2, postingTimes: ["09:00"] })).toMatch(/one posting time/);
  });
});

describe("job backoff", () => {
  it("grows exponentially and caps at two hours", () => {
    expect(backoffMs(1)).toBe(30_000);
    expect(backoffMs(2)).toBe(120_000);
    expect(backoffMs(3)).toBe(480_000);
    expect(backoffMs(20)).toBe(2 * 60 * 60_000);
  });
});
