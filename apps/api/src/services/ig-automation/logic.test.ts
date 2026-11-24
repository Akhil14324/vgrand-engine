import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildDmMessage,
  buildOptionReply,
  classifyGraphError,
  containsKeyword,
  dmTextWithLink,
  equalsKeyword,
  missingPermissions,
  parseOptionPayload,
  parseWebhook,
  pickRule,
  pickVariant,
  planCommentActions,
  renderTemplate,
  ruleProblems,
  readOptions,
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

describe("tap-to-select options", () => {
  const options = [
    { id: "a1", title: "Floor plan", kind: "image", url: "https://x.test/plan.jpg", text: "Here is the floor plan" },
    { id: "b2", title: "Brochure", kind: "link", url: "https://x.test/brochure.pdf", text: null },
    { id: "c3", title: "3D walkthrough", kind: "video", url: "https://x.test/walk.mp4", text: null },
  ];

  it("sends the options as postback buttons carrying rule and option ids", () => {
    const msg = buildDmMessage({ text: "What would you like to see?", ruleId: "r1", options }) as any;
    const buttons = msg.attachment.payload.buttons;
    expect(buttons).toHaveLength(3);
    expect(buttons[0]).toEqual({ type: "postback", title: "Floor plan", payload: "opt:r1:a1" });
    expect(buttons[2].title).toBe("3D walkthrough");
  });

  it("puts the guide link in the text and keeps all 3 option buttons", () => {
    const msg = buildDmMessage({ text: "What would you like to see?", ruleId: "r1", options, buttonTitle: "Guide", buttonUrl: "https://x.test/guide" }) as any;
    expect(msg.attachment.payload.template_type).toBe("button");
    expect(msg.attachment.payload.text).toContain("Guide: https://x.test/guide");
    expect(msg.attachment.payload.text).toContain("What would you like to see?");
    expect(msg.attachment.payload.buttons).toHaveLength(3);
    expect(msg.attachment.payload.buttons.every((b: any) => b.type === "postback")).toBe(true);
  });

  it("checks that the text plus the link fit with options", () => {
    const base = { trigger: "dm", matchMode: "any", keywords: [], mediaScope: "all", mediaIds: [], publicReplies: [], dmButtonTitle: "Guide", dmButtonUrl: "https://x.test/g", dmOptions: options };
    expect(ruleProblems({ ...base, dmText: "Pick one" })).toEqual([]);
    expect(ruleProblems({ ...base, dmText: "x".repeat(640) }).join()).toContain("640");
  });

  it("parses the payload back and rejects anything else", () => {
    expect(parseOptionPayload("opt:r1:a1")).toEqual({ ruleId: "r1", optionId: "a1" });
    expect(parseOptionPayload("hello")).toBeNull();
    expect(parseOptionPayload(null)).toBeNull();
  });

  it("answers an image option with the image itself and a link option with an open button", () => {
    const img = buildOptionReply(options[0]!);
    expect((img.message as any).attachment).toEqual({ type: "image", payload: { url: "https://x.test/plan.jpg" } });
    const link = buildOptionReply(options[1]!);
    const btn = (link.message as any).attachment.payload.buttons[0];
    expect(btn).toEqual({ type: "web_url", url: "https://x.test/brochure.pdf", title: "Open Brochure" });
    expect(link.fallbackText).toContain("https://x.test/brochure.pdf");
  });

  it("parses a postback tap from the webhook", () => {
    const evs = parseWebhook({
      object: "instagram",
      entry: [{ id: "ig1", time: 1700000000, messaging: [{ sender: { id: "u9" }, recipient: { id: "ig1" }, timestamp: 1700000000000, postback: { mid: "m1", title: "Floor plan", payload: "opt:r1:a1" } }] }],
    });
    expect(evs).toHaveLength(1);
    expect(evs[0]).toMatchObject({ kind: "postback", senderId: "u9", mid: "m1", payload: "opt:r1:a1", title: "Floor plan" });
  });

  it("validates options on a rule and ignores malformed stored ones", () => {
    const base = { trigger: "dm", matchMode: "any", keywords: [], mediaScope: "all", mediaIds: [], publicReplies: [], dmText: "Pick one", dmButtonTitle: null, dmButtonUrl: null };
    expect(ruleProblems({ ...base, dmOptions: options })).toEqual([]);
    expect(ruleProblems({ ...base, dmText: null, dmOptions: options })).toContain("Write the DM text that comes with the options");
    expect(ruleProblems({ ...base, dmOptions: [options[0]!, { ...options[1]!, title: "floor plan" }] })).toContain("Option titles must be different");
    expect(ruleProblems({ ...base, dmOptions: [{ ...options[0]!, url: "http://x.test/a" }] }).join()).toContain("https");
    expect(readOptions([{ id: "a", title: "T", url: "https://x.test" }, { nope: 1 }, null])).toHaveLength(1);
    expect(readOptions(null)).toEqual([]);
  });
});
