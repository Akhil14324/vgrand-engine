import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@catgpt/db";
import { env } from "../env.js";
import { encryptToken } from "../lib/social-crypto.js";
import { getContentAudit, startContentAudit } from "./guava-content.js";

/**
 * The whole Instagram review end to end: real Postgres, real review code, with
 * Instagram's Graph API, the Instagram CDN and Gemini faked at the fetch level.
 * Proves a review finishes, splits are computed, a post Gemini can't read is
 * skipped instead of failing the review, comments are read and rivals compared.
 * Opt-in: GUAVA_IT=1 DATABASE_URL=postgresql://... (a LOCAL database only).
 */
const RUN = process.env.GUAVA_IT === "1";
const IG = `17841${Math.floor(Math.random() * 1e10)}`;

/** 12 own reels: odd ones have a face in the first second and do ~3x better; #4 is a spike; #7 breaks Gemini. */
const OWN = Array.from({ length: 12 }, (_, i) => ({
  id: `own${i}`,
  caption: `Vgrand Infra flats in Koppolu, post ${i}`,
  media_type: "VIDEO",
  media_product_type: "REELS",
  media_url: `https://cdn.test/own${i}.mp4`,
  thumbnail_url: `https://cdn.test/own${i}.jpg`,
  permalink: `https://instagram.com/reel/own${i}`,
  timestamp: new Date(Date.UTC(2026, 10, 20 - i)).toISOString(),
  like_count: i === 4 ? 5000 : i % 2 ? 300 + i : 100 + i,
  comments_count: i % 3 === 0 ? 2 : 0,
}));
const RIVAL = Array.from({ length: 6 }, (_, i) => ({
  ...OWN[i]!,
  id: `rival${i}`,
  caption: `Rival builder post ${i}`,
  like_count: 50 + i,
}));

function fakeFetch(calls: string[]) {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    calls.push(`${init?.method ?? "GET"} ${url.host}${url.pathname}`);
    const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
      new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

    if (url.host === "graph.facebook.com") {
      if (url.pathname.endsWith("/debug_token")) return json({ data: { is_valid: true, expires_at: 0, scopes: [] } });
      if (url.pathname.endsWith(`/${IG}/media`)) return json({ data: OWN });
      if (url.pathname.endsWith("/comments")) {
        return json({ data: [{ text: "What is the price of a 3BHK?", like_count: 3 }, { text: "Nice site 👍", like_count: 1 }] });
      }
      if (url.pathname.endsWith(`/${IG}`)) {
        const fields = url.searchParams.get("fields") ?? "";
        if (fields.includes("business_discovery.username(rival_builder)")) {
          return json({ business_discovery: { username: "rival_builder", followers_count: 4000, media_count: 80, media: { data: RIVAL } } });
        }
        if (fields.includes("business_discovery")) {
          return json({ error: { message: "Invalid user id", code: 110, error_subcode: 2207013 } }, 400);
        }
        return json({ username: "vgrandinfra", name: "V Grand Infra", followers_count: 924, media_count: 122, biography: "Homes in Ongole" });
      }
      return json({ error: { message: `unexpected ${url.pathname}` } }, 404);
    }
    if (url.host === "cdn.test") {
      const video = url.pathname.endsWith(".mp4");
      return new Response(new Uint8Array(64), { status: 200, headers: { "content-type": video ? "video/mp4" : "image/jpeg" } });
    }
    if (url.host === "generativelanguage.googleapis.com") {
      if (url.pathname === "/upload/v1beta/files") {
        return new Response("{}", { status: 200, headers: { "x-goog-upload-url": "https://generativelanguage.googleapis.com/upload-session/1" } });
      }
      if (url.pathname.startsWith("/upload-session")) {
        return json({ file: { name: `files/${randomUUID()}`, uri: "https://generativelanguage.googleapis.com/v1beta/files/x", mimeType: "video/mp4", state: "ACTIVE" } });
      }
      if (init?.method === "DELETE") return json({});
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        systemInstruction: { parts: { text: string }[] };
        contents: { parts: { text?: string }[] }[];
      };
      const system = body.systemInstruction.parts[0]!.text;
      const text = body.contents[0]!.parts.map((p) => p.text ?? "").join("\n");
      const answer = (obj: unknown) => json({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] }, finishReason: "STOP" }] });
      if (system.startsWith("You sort Instagram posts")) {
        // Every own post is Vgrand Infra except one.
        const ids = [...text.matchAll(/## Post (\S+)/g)].map((m) => m[1]!);
        return answer({ posts: ids.map((id) => ({ mediaId: id, brand: id === "own11" ? "Planet" : "Vgrand Infra", category: "Walkthrough", reason: "name in caption" })) });
      }
      if (system.includes("video analyst")) {
        const id = text.match(/Caption:\n<caption>\n(?:Vgrand Infra flats in Koppolu, post |Rival builder post )(\d+)/)?.[1];
        const own = text.includes("Vgrand Infra flats");
        if (own && id === "7") {
          // Gemini sends cut-off JSON for this one on every try: the post must be skipped, not fail the review.
          return json({ candidates: [{ content: { parts: [{ text: '{"summary": "half' }] }, finishReason: "MAX_TOKENS" }] });
        }
        const face = Number(id) % 2 === 1;
        return answer({
          opening: face ? "0-1s builder speaks to camera" : "0-1s 3D render of the tower",
          losesPeople: face ? "nothing obvious" : "slow 3D fly-through for 6 seconds",
          signals: { faceInFirstSecond: face, speaksInFirstSecond: face, textOnScreenBySecondTwo: true, productInUse: !face, peopleOnCamera: face, mostlyStillShots: !face, voiceover: face, musicOnly: !face, lengthSec: face ? 25 : 40 },
          summary: face ? "Builder talks about payment plans on site" : "3D walkthrough",
          hook: "", format: face ? "talking head" : "3D render", visuals: "", audio: "", onScreenText: "", cta: "DM", tone: "", productsShown: "flats", audience: "home buyers", quality: "ok",
        });
      }
      if (system.startsWith("You are Guava")) {
        expect(text).toContain("# SPLITS");
        expect(text).toContain("Comments (");
        return answer({
          headline: "Your builder on camera beats the 3D renders",
          summary: "Posts with a face in the first second do about 3x better.",
          whatWorks: [{ title: "A face in the first second", detail: "typical 305 vs 104", mediaIds: ["own1", "own3"], confidence: "sure" }],
          whatLosesPeople: [{ title: "Slow 3D openings", detail: "6 still seconds", mediaIds: ["own0"], confidence: "i_think" }],
          tooCloseToCall: [],
          comments: { summary: "People ask about prices", praise: ["Nice site"], asks: ["3BHK price"], complaints: [], replyIdeas: ["Post a price walkthrough"] },
          doNext: { keep: ["Builder on camera"], start: ["Price on screen"], stop: ["Silent renders"], nextVideos: [{ title: "Payment plans on site", hook: "Builder: 'Here's what 3BHK costs'", scenes: ["site", "floor plan"], cta: "DM", why: "", basedOn: ["own1"] }] },
          brandBasis: "brand_data", brandBasisNote: "",
          brandFit: { verdict: "on_brand", score: 80, why: "" },
          brandGaps: [], reelComparison: { summary: "", reels: [], winningPatterns: [], losingPatterns: [], nextStrategy: [] },
          competitors: [{ handle: "rival_builder", summary: "Renders", travelling: "nothing above typical", take: [], leave: ["renders"], gap: "nobody films the site at 6am", differences: [], theyDoBetter: [], youDoBetter: [], ideasToTry: [] }],
        });
      }
      return json({ error: { message: "unexpected gemini call" } }, 500);
    }
    return json({ error: `unexpected host ${url.host}` }, 500);
  });
}

describe.skipIf(!RUN)("Instagram review end to end (fake Instagram + Gemini, real Postgres)", () => {
  const userId = randomUUID();
  const saved: Record<string, unknown> = {};
  const calls: string[] = [];

  beforeAll(async () => {
    for (const k of ["SOCIAL_TOKEN_KEY", "META_APP_ID", "META_APP_SECRET", "GOOGLE_AI_API_KEY"] as const) saved[k] = env[k];
    Object.assign(env, { SOCIAL_TOKEN_KEY: "c".repeat(64), META_APP_ID: "app1", META_APP_SECRET: "s", GOOGLE_AI_API_KEY: "test" });
    vi.stubGlobal("fetch", fakeFetch(calls));
    await prisma.user.create({ data: { id: userId, email: `${userId}@test.local` } });
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    Object.assign(env, saved);
    await prisma.instagramSetup.deleteMany({ where: { scopeKey: `user:${userId}` } });
    await prisma.user.delete({ where: { id: userId } }).catch(() => {});
  });

  it("runs a full review and stores a usable read", async () => {
    const brand = await prisma.brand.create({ data: { userId, name: "Vgrand Infra", summary: "Real estate developer in Ongole" } });
    await prisma.brand.create({ data: { userId, name: "Planet", summary: "Restaurant" } });
    const account = await prisma.socialAccount.create({
      data: { userId, platform: "instagram", externalAccountId: IG, handle: "vgrandinfra", accessTokenEnc: encryptToken("tok"), scopes: [] },
    });
    await prisma.instagramSetup.create({
      data: { scopeKey: `user:${userId}`, accountId: account.id, competitors: ["rival_builder", "private_one"] },
    });

    const started = await startContentAudit(brand, userId, null);
    expect(started.status).toBe("processing");

    let row = await prisma.guavaContentAudit.findUniqueOrThrow({ where: { id: started.id } });
    for (let i = 0; i < 600 && row.status === "processing"; i++) {
      await new Promise((r) => setTimeout(r, 100));
      row = await prisma.guavaContentAudit.findUniqueOrThrow({ where: { id: started.id } });
    }
    expect(row.error).toBeNull();
    expect(row.status).toBe("completed");

    const audit = await getContentAudit(brand.id, started.id);
    const own = audit.reels.filter((r) => r.isOwn);
    // 11 of 12 posts are this brand's; own7 broke Gemini every time and was skipped, not fatal.
    expect(own.map((r) => r.mediaId).sort()).toEqual(["own0", "own1", "own10", "own2", "own3", "own4", "own5", "own6", "own8", "own9"]);
    expect(own.every((r) => r.analysedFrom === "video")).toBe(true);

    // Spike: own4 (5000 likes) is far above the typical post and is left out of the splits.
    expect(audit.spikes.map((s) => s.mediaId)).toEqual(["own4"]);
    const face = audit.splits.find((s) => s.key === "faceInFirstSecond")!;
    expect(face.confidence).toBe("sure");
    expect(face.withTypical).toBeGreaterThan(face.withoutTypical * 2);

    // Comments were read on posts that have them; the rival that Instagram refused is listed as skipped.
    expect(audit.commentsRead).toBeGreaterThan(0);
    expect(audit.skippedCompetitors.map((s) => s.handle)).toEqual(["private_one"]);
    expect(audit.typical.find((t) => t.handle === "rival_builder")?.typical).toBe(53);

    expect(audit.report?.whatWorks[0]?.title).toBe("A face in the first second");
    expect(audit.report?.doNext.nextVideos).toHaveLength(1);
    expect(audit.report?.comments.asks).toEqual(["3BHK price"]);
  }, 90_000);
});
