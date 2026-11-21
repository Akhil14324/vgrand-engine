import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildDmMessage,
  classifyGraphError,
  containsKeyword,
  dmTextWithLink,
  equalsKeyword,
  missingPermissions,
  parseWebhook,
  pickRule,
  pickVariant,
  planCommentActions,
  renderTemplate,
  ruleProblems,
  verifySignature,
  type RuleLike,
} from "./logic.js";

const rule = (over: Partial<RuleLike> = {}): RuleLike => ({
  id: "r1",
  active: true,
  trigger: "comment",
  matchMode: "keywords",
  keywords: ["link"],
  mediaScope: "all",
  mediaIds: [],
  priority: 100,
  createdAt: new Date("2026-11-01"),
  ...over,
});

describe("keyword matching", () => {
  it("matches whole words and phrases, ignoring case, accents and punctuation", () => {
    expect(containsKeyword("Send me the LINK!!", "link")).toBe(true);
    expect(containsKeyword("linked in", "link")).toBe(false);
    expect(containsKeyword("I want the free guide please", "free guide")).toBe(true);
    expect(containsKeyword("Café recipe?", "cafe")).toBe(true);
    expect(containsKeyword("price?", "price")).toBe(true);
    expect(containsKeyword("मुझे लिंक चाहिए", "लिंक")).toBe(true);
    expect(containsKeyword("🔥🔥", "🔥")).toBe(true);
    expect(containsKeyword("anything", "  ")).toBe(false);
  });
  it("exact mode needs the whole comment to be the keyword", () => {
    expect(equalsKeyword("  Guide!! ", "guide")).toBe(true);
    expect(equalsKeyword("guide please", "guide")).toBe(false);
  });
  it("respects trigger, active flag and post scope", () => {
    const r = rule({ mediaScope: "selected", mediaIds: ["m1"] });
    expect(pickRule([r], { trigger: "comment", text: "link", mediaId: "m1" })).toBe(r);
    expect(pickRule([r], { trigger: "comment", text: "link", mediaId: "m2" })).toBeNull();
    expect(pickRule([r], { trigger: "dm", text: "link", mediaId: null })).toBeNull();
    expect(pickRule([{ ...r, active: false }], { trigger: "comment", text: "link", mediaId: "m1" })).toBeNull();
    expect(pickRule([rule({ matchMode: "any", keywords: [] })], { trigger: "comment", text: "nice", mediaId: "x" })).not.toBeNull();
  });
  it("picks by priority, then post-specific over all-posts, then oldest", () => {
    const all = rule({ id: "all" });
    const specific = rule({ id: "spec", mediaScope: "selected", mediaIds: ["m1"] });
    const urgent = rule({ id: "urgent", priority: 1 });
    expect(pickRule([all, specific], { trigger: "comment", text: "link", mediaId: "m1" })?.id).toBe("spec");
    expect(pickRule([all, specific, urgent], { trigger: "comment", text: "link", mediaId: "m1" })?.id).toBe("urgent");
  });
});

describe("reply content", () => {
  it("picks the same variant for the same comment every time", () => {
    const v = ["A", "B", "C"];
    expect(pickVariant(v, "c1")).toBe(pickVariant(v, "c1"));
    expect(new Set(["c1", "c2", "c3", "c4", "c5", "c6"].map((s) => pickVariant(v, s))).size).toBeGreaterThan(1);
    expect(pickVariant(["  ", ""], "x")).toBeNull();
  });
  it("fills {username} and tidies spacing", () => {
    expect(renderTemplate("Hey {username}, check your DMs!", { username: "ana" })).toBe("Hey @ana, check your DMs!");
    expect(renderTemplate("Hey {username}, sent!", { username: null })).toBe("Hey, sent!");
  });
  it("builds a button template or plain text, and a text fallback with the link", () => {
    expect(buildDmMessage({ text: "Here you go" })).toEqual({ text: "Here you go" });
    expect(buildDmMessage({ text: "Here", buttonTitle: "Open guide", buttonUrl: "https://x.co/g" })).toEqual({
      attachment: { type: "template", payload: { template_type: "button", text: "Here", buttons: [{ type: "web_url", url: "https://x.co/g", title: "Open guide" }] } },
    });
    expect(dmTextWithLink({ text: "Here", buttonTitle: "Open guide", buttonUrl: "https://x.co/g" })).toEqual({ text: "Here\n\nOpen guide: https://x.co/g" });
  });
  it("validates rules", () => {
    const base = { trigger: "comment", matchMode: "keywords", keywords: ["link"], mediaScope: "all", mediaIds: [], publicReplies: ["Sent!"], dmText: "Here", dmButtonTitle: null, dmButtonUrl: null };
    expect(ruleProblems(base)).toEqual([]);
    expect(ruleProblems({ ...base, keywords: [] })[0]).toMatch(/keyword/);
    expect(ruleProblems({ ...base, publicReplies: [], dmText: null })[0]).toMatch(/public reply, a DM/);
    expect(ruleProblems({ ...base, mediaScope: "selected" })[0]).toMatch(/Pick at least one post/);
    expect(ruleProblems({ ...base, dmButtonTitle: "Go" })[0]).toMatch(/both a title and a URL/);
    expect(ruleProblems({ ...base, dmButtonTitle: "Go", dmButtonUrl: "http://x.co" })[0]).toMatch(/https/);
    expect(ruleProblems({ ...base, trigger: "dm" })[0]).toMatch(/DM rules can't post public replies/);
  });
});

describe("webhook", () => {
  it("verifies X-Hub-Signature-256 over the raw body", () => {
    const body = Buffer.from('{"object":"instagram"}');
    const sig = `sha256=${createHmac("sha256", "secret").update(body).digest("hex")}`;
    expect(verifySignature(body, sig, "secret")).toBe(true);
    expect(verifySignature(body, sig, "other")).toBe(false);
    expect(verifySignature(Buffer.from('{"object":"instagram" }'), sig, "secret")).toBe(false);
    expect(verifySignature(body, undefined, "secret")).toBe(false);
  });
  it("parses comment (comment_id and legacy id), live comment and message events; drops echoes", () => {
    const ev = parseWebhook({
      object: "instagram",
      entry: [
        {
          id: "IG1",
          time: 1795200000,
          changes: [
            { field: "comments", value: { from: { id: "U1", username: "ana" }, media: { id: "M1", media_product_type: "REELS" }, comment_id: "C1", text: "LINK please" } },
            { field: "comments", value: { from: { id: "U2" }, media: { id: "M1" }, id: "C2", parent_id: "C1", text: "me too" } },
            { field: "live_comments", value: { from: { id: "U3" }, media: { id: "L1" }, comment_id: "C3", text: "link" } },
            { field: "mentions", value: { media_id: "X" } },
          ],
          messaging: [
            { sender: { id: "U1" }, recipient: { id: "IG1" }, timestamp: 1795200000123, message: { mid: "mid1", text: "guide" } },
            { sender: { id: "IG1" }, recipient: { id: "U1" }, timestamp: 1795200000999, message: { mid: "mid2", text: "hi", is_echo: true } },
          ],
        },
      ],
    });
    expect(ev).toHaveLength(4);
    expect(ev[0]).toMatchObject({ kind: "comment", igAccountId: "IG1", commentId: "C1", mediaId: "M1", fromUsername: "ana", text: "LINK please", live: false });
    expect(ev[0]!.occurredAt.toISOString()).toBe("2026-11-20T18:40:00.000Z");
    expect(ev[1]).toMatchObject({ commentId: "C2", parentId: "C1" });
    expect(ev[2]).toMatchObject({ commentId: "C3", live: true });
    expect(ev[3]).toMatchObject({ kind: "message", mid: "mid1", senderId: "U1", text: "guide" });
    expect(parseWebhook({ nothing: true })).toEqual([]);
  });
});

describe("planning and errors", () => {
  const now = new Date("2026-11-21T00:00:00Z");
  it("no public reply to replies or live comments; no DM after 7 days", () => {
    const r = { publicReplies: ["ok"], dmText: "hi" };
    expect(planCommentActions({ ev: { parentId: null, live: false, occurredAt: now }, rule: r, now })).toMatchObject({ publicReply: true, dm: true });
    expect(planCommentActions({ ev: { parentId: "p", live: false, occurredAt: now }, rule: r, now })).toMatchObject({ publicReply: false, dm: true });
    expect(planCommentActions({ ev: { parentId: null, live: true, occurredAt: now }, rule: r, now }).publicReplyNote).toMatch(/live/);
    expect(planCommentActions({ ev: { parentId: null, live: false, occurredAt: new Date("2026-11-13T00:00:00Z") }, rule: r, now })).toMatchObject({ dm: false });
  });
  it("classifies Graph errors", () => {
    expect(classifyGraphError(400, { error: { code: 4 } }).kind).toBe("rate_limit");
    expect(classifyGraphError(400, { error: { code: 190 } }).kind).toBe("auth");
    expect(classifyGraphError(403, { error: { code: 200, message: "Permissions error" } }).kind).toBe("permission");
    expect(classifyGraphError(400, { error: { code: 10, error_subcode: 2018278 } }).kind).toBe("window");
    expect(classifyGraphError(400, { error: { code: 100, error_subcode: 33 } }).kind).toBe("unsupported_path");
    expect(classifyGraphError(500, {}).kind).toBe("retryable");
    expect(classifyGraphError(400, { error: { code: 100, message: "bad text" } }).kind).toBe("invalid");
  });
  it("lists missing permissions", () => {
    expect(missingPermissions(["instagram_basic", "pages_show_list"])).toEqual([
      "instagram_manage_comments",
      "instagram_manage_messages",
      "pages_manage_metadata",
      "pages_read_engagement",
    ]);
  });
});
