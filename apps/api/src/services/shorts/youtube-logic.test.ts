import { describe, expect, it } from "vitest";
import {
  classifyYoutubeError,
  insertBody,
  pacificDay,
  parsePublicStats,
  parseYoutubeId,
  privateLockReason,
  shortsSnippet,
  uploadDecision,
} from "./youtube-logic.js";

describe("parseYoutubeId", () => {
  it.each([
    ["https://youtube.com/shorts/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/shorts/dQw4w9WgXcQ?feature=share", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=3", "dQw4w9WgXcQ"],
    ["https://m.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://youtu.be/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["dQw4w9WgXcQ", "dQw4w9WgXcQ"],
  ])("%s", (url, id) => expect(parseYoutubeId(url)).toBe(id));

  it.each(["https://vimeo.com/123", "https://evil.com/shorts/dQw4w9WgXcQ", "https://youtube.com/shorts/short", "not a url"])("rejects %s", (url) =>
    expect(parseYoutubeId(url)).toBeNull(),
  );
});

describe("upload decision", () => {
  const ok = { ytStatus: "connected", ytStatusReason: null, ytRefreshTokenEnc: "enc" };
  it("uploads only when OAuth is configured, the channel is connected and quota is left", () => {
    expect(uploadDecision({ oauthConfigured: true, channel: ok, quotaLeft: 5 })).toEqual({ upload: true });
    expect(uploadDecision({ oauthConfigured: false, channel: ok, quotaLeft: 5 })).toMatchObject({ upload: false, reason: expect.stringMatching(/not configured/) });
    expect(uploadDecision({ oauthConfigured: true, channel: { ...ok, ytStatus: "disconnected" }, quotaLeft: 5 })).toMatchObject({ reason: expect.stringMatching(/not connected/) });
    expect(uploadDecision({ oauthConfigured: true, channel: { ...ok, ytStatus: "reauth_required" }, quotaLeft: 5 })).toMatchObject({ reason: expect.stringMatching(/reconnect/) });
    expect(uploadDecision({ oauthConfigured: true, channel: ok, quotaLeft: 0 })).toMatchObject({ reason: expect.stringMatching(/quota/) });
  });
});

describe("insert body", () => {
  const now = new Date("2026-11-20T00:00:00Z");
  it("schedules with private + publishAt and discloses synthetic media", () => {
    const b = insertBody({ title: "Cats", description: "d", tags: ["a"], synthetic: true, publishAt: new Date("2026-11-20T12:00:00Z") }, now);
    expect(b.status).toEqual({ privacyStatus: "private", publishAt: "2026-11-20T12:00:00.000Z", selfDeclaredMadeForKids: false, containsSyntheticMedia: true });
    expect(b.snippet.title).toBe("Cats #Shorts");
    expect(b.snippet.description).toContain("#Shorts");
  });
  it("publishes public now when the slot is past or imminent", () => {
    const b = insertBody({ title: "Dogs #shorts", description: "d", tags: [], synthetic: false, publishAt: new Date("2026-11-20T00:05:00Z") }, now);
    expect(b.status.privacyStatus).toBe("public");
    expect(b.status).not.toHaveProperty("publishAt");
    expect(b.status.containsSyntheticMedia).toBe(false);
    expect(b.snippet.title).toBe("Dogs #shorts");
  });
  it("keeps the title within 100 characters", () => {
    expect(shortsSnippet("x".repeat(99), "", []).title.length).toBeLessThanOrEqual(100);
  });
});

describe("errors, quota day, private lock, stats", () => {
  it("classifies quota, auth, invalid and retryable errors", () => {
    expect(classifyYoutubeError(403, { error: { errors: [{ reason: "quotaExceeded" }] } }).kind).toBe("quota");
    expect(classifyYoutubeError(400, { error: { errors: [{ reason: "uploadLimitExceeded" }] } }).kind).toBe("quota");
    expect(classifyYoutubeError(401, {}).kind).toBe("auth");
    expect(classifyYoutubeError(400, { error: { message: "bad title" } })).toMatchObject({ kind: "invalid", message: "bad title" });
    expect(classifyYoutubeError(503, {}).kind).toBe("retryable");
  });
  it("uses the Pacific-time day for quota", () => {
    expect(pacificDay(new Date("2026-11-20T07:30:00Z"))).toBe("2026-11-19");
    expect(pacificDay(new Date("2026-11-20T08:30:00Z"))).toBe("2026-11-20");
  });
  it("detects a private lock", () => {
    const now = new Date("2026-11-20T12:00:00Z");
    expect(privateLockReason({ requested: "public", publishAt: null, actualPrivacy: "private", actualPublishAt: null, now })).toMatch(/private/);
    expect(privateLockReason({ requested: "public", publishAt: null, actualPrivacy: "public", actualPublishAt: null, now })).toBeNull();
    const future = new Date("2026-11-20T18:00:00Z");
    expect(privateLockReason({ requested: "private", publishAt: future, actualPrivacy: "private", actualPublishAt: future.toISOString(), now })).toBeNull();
    expect(privateLockReason({ requested: "private", publishAt: future, actualPrivacy: "private", actualPublishAt: null, now })).toMatch(/dropped/);
    const past = new Date("2026-11-20T11:00:00Z");
    expect(privateLockReason({ requested: "private", publishAt: past, actualPrivacy: "private", actualPublishAt: past.toISOString(), now })).toMatch(/still private/);
  });
  it("parses videos.list statistics and leaves missing ids absent", () => {
    const m = parsePublicStats({ items: [{ id: "a", statistics: { viewCount: "10", likeCount: "2" }, status: { privacyStatus: "public" } }] });
    expect(m.get("a")).toEqual({ views: 10, likes: 2, comments: null, privacyStatus: "public" });
    expect(m.has("b")).toBe(false);
  });
});
