import { describe, expect, it } from "vitest";
import { guavaContentAuditRequestSchema, guavaContentReportSchema, normalizeIgHandle } from "@catgpt/types";
import {
  cleanForJson,
  clip,
  competitorErrorReason,
  computePerformance,
  engagementAverages,
  matchBrand,
  pickMedia,
  rankReels,
  toIgMedia,
  type IgMedia,
} from "./guava-content-logic.js";
import { parseJsonObject } from "./gemini.js";

const media = (id: string, over: Partial<IgMedia> = {}): IgMedia => ({
  id,
  caption: "",
  mediaType: "VIDEO",
  productType: "REELS",
  mediaUrl: `https://cdn.example/${id}.mp4`,
  thumbnailUrl: null,
  permalink: null,
  timestamp: "2026-11-01T00:00:00+0000",
  likes: null,
  comments: null,
  ...over,
});

describe("normalizeIgHandle", () => {
  it("accepts handles, @handles and profile links", () => {
    expect(normalizeIgHandle("@Cat.GPT_")).toBe("cat.gpt_");
    expect(normalizeIgHandle(" catgpt ")).toBe("catgpt");
    expect(normalizeIgHandle("https://www.instagram.com/rival_brand/?hl=en")).toBe("rival_brand");
  });
  it("rejects anything that could inject into the Graph field expansion", () => {
    expect(normalizeIgHandle("a){id}")).toBeNull();
    expect(normalizeIgHandle("has space")).toBeNull();
    expect(normalizeIgHandle("x".repeat(31))).toBeNull();
    expect(normalizeIgHandle("")).toBeNull();
  });
});

describe("guavaContentAuditRequestSchema", () => {
  const accountId = "6f1b2a3c-1d2e-4f50-9a6b-7c8d9e0f1a2b";
  it("normalises and de-duplicates competitors, ignoring blanks", () => {
    const r = guavaContentAuditRequestSchema.parse({ accountId, competitors: ["@Rival", "rival", "", "other"] });
    expect(r.competitors).toEqual(["rival", "other"]);
  });
  it("refuses invalid handles and more than three competitors", () => {
    expect(guavaContentAuditRequestSchema.safeParse({ accountId, competitors: ["bad handle"] }).success).toBe(false);
    expect(guavaContentAuditRequestSchema.safeParse({ accountId, competitors: ["a", "b", "c", "d"] }).success).toBe(false);
  });
});

describe("toIgMedia / pickMedia", () => {
  it("maps Graph fields and drops objects without an id", () => {
    expect(toIgMedia({ caption: "x" })).toBeNull();
    const m = toIgMedia({ id: "1", media_type: "VIDEO", media_product_type: "REELS", like_count: 5, comments_count: "3" });
    expect(m).toMatchObject({ id: "1", likes: 5, comments: null, productType: "REELS" });
  });

  it("puts newest reels first, then fills with other posts, skipping stories", () => {
    const list = [
      media("old-reel", { timestamp: "2026-10-01T00:00:00+0000" }),
      media("photo", { mediaType: "IMAGE", productType: "FEED", mediaUrl: "https://cdn/p.jpg", timestamp: "2026-11-05T00:00:00+0000" }),
      media("new-reel", { timestamp: "2026-11-03T00:00:00+0000" }),
      media("story", { productType: "STORY", timestamp: "2026-11-06T00:00:00+0000" }),
    ];
    expect(pickMedia(list, 3).map((m) => m.id)).toEqual(["new-reel", "old-reel", "photo"]);
    expect(pickMedia(list, 1).map((m) => m.id)).toEqual(["new-reel"]);
  });
});

describe("engagementAverages", () => {
  it("averages only posts that report the number", () => {
    expect(engagementAverages([{ likes: 10, comments: null }, { likes: 21, comments: 4 }])).toEqual({ likes: 16, comments: 4 });
    expect(engagementAverages([{ likes: null, comments: null }])).toEqual({ likes: null, comments: null });
  });
});

describe("competitorErrorReason", () => {
  it("explains personal / missing accounts and permission problems", () => {
    expect(competitorErrorReason("Invalid user id (code 110/2207013)")).toMatch(/Business or Creator/);
    expect(competitorErrorReason("(#10) Application does not have permission")).toMatch(/permission/);
  });
});

describe("Gemini output handling", () => {
  it("accepts fenced JSON", () => {
    expect(parseJsonObject('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(() => parseJsonObject("[1]")).toThrow();
  });
  it("keeps a usable report when the model returns odd values", () => {
    const r = guavaContentReportSchema.parse({
      headline: "h",
      brandFit: { verdict: "great", score: "140" },
      improvements: [{ title: "t", priority: "urgent" }, "junk"],
    });
    expect(r.brandFit.verdict).toBe("partly");
    expect(r.improvements).toHaveLength(1);
    expect(r.improvements[0]!.priority).toBe("medium");
    expect(r.competitors).toEqual([]);
  });
});

describe("computePerformance", () => {
  it("computes engagement rate and best/weakest post from Instagram numbers", () => {
    const p = computePerformance(1000, [
      { mediaId: "a", likes: 50, comments: 10 },
      { mediaId: "b", likes: 10, comments: 0 },
      { mediaId: "c", likes: null, comments: null },
    ]);
    expect(p).toMatchObject({ avgLikes: 30, avgComments: 5, engagementRatePct: 3.5, bestMediaId: "a", weakestMediaId: "b", postsReviewed: 3 });
  });
  it("gives no rate without followers and no weakest with a single post", () => {
    const p = computePerformance(null, [{ mediaId: "a", likes: 5, comments: 1 }]);
    expect(p.engagementRatePct).toBeNull();
    expect(p.weakestMediaId).toBeNull();
  });
});

describe("matchBrand", () => {
  const brands = [
    { id: "1", name: "Vgrand Infra" },
    { id: "2", name: "One layer" },
  ];
  it("matches names ignoring case, spaces and punctuation", () => {
    expect(matchBrand("vgrand infra", brands)?.id).toBe("1");
    expect(matchBrand("One-Layer", brands)?.id).toBe("2");
  });
  it("returns null for none or unknown names", () => {
    expect(matchBrand("none", brands)).toBeNull();
    expect(matchBrand("Planet", brands)).toBeNull();
    expect(matchBrand("", brands)).toBeNull();
  });
});

describe("rankReels", () => {
  it("labels one strong, one average and one weak reel against the account average", () => {
    const r = rankReels([
      { mediaId: "a", likes: 200, comments: 20 },
      { mediaId: "b", likes: 100, comments: 10 },
      { mediaId: "c", likes: 20, comments: 2 },
    ]);
    expect(r.map((x) => [x.mediaId, x.tier, x.rank])).toEqual([
      ["a", "strong", 1],
      ["b", "average", 2],
      ["c", "weak", 3],
    ]);
    expect(r[0]!.vsAvgPct).toBeGreaterThan(20);
    expect(r[2]!.vsAvgPct).toBeLessThan(-20);
  });
  it("calls everything average when reels perform alike, or when there is only one", () => {
    expect(rankReels([{ mediaId: "a", likes: 100, comments: 0 }, { mediaId: "b", likes: 105, comments: 0 }]).map((x) => x.tier)).toEqual(["average", "average"]);
    expect(rankReels([{ mediaId: "a", likes: 5, comments: 1 }])[0]!.tier).toBe("average");
    expect(rankReels([{ mediaId: "a", likes: null, comments: null }])).toEqual([]);
  });
});

const lone = (s: string) => !/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(s);

describe("saving captions with emoji", () => {
  it("clip never leaves half an emoji", () => {
    const s = "ab" + "😀".repeat(5);
    for (let n = 2; n <= 10; n++) expect(lone(clip(s, n))).toBe(true);
    expect(clip("short", 10)).toBe("short");
  });
  it("cleanForJson fixes lone surrogates and NUL so Postgres accepts the JSON", () => {
    const bad = { caption: "hi \ud83d there\u0000", nested: ["\ude00"] };
    const ok = cleanForJson(bad);
    expect(lone(ok.caption)).toBe(true);
    expect(ok.caption).not.toContain("\u0000");
    expect(lone(ok.nested[0]!)).toBe(true);
    expect(cleanForJson({ a: "😀 fine", n: 3 })).toEqual({ a: "😀 fine", n: 3 });
  });
});
