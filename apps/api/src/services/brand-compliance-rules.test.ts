import { describe, expect, it } from "vitest";
import {
  checkAspect,
  checkPalette,
  checkStampedLogo,
  checkTextRules,
  normalizeText,
  overallStatus,
  paletteCoverage,
} from "./brand-compliance-rules.js";

const profile = {
  forbiddenWords: ["cheap", "guaranteed"],
  forbiddenClaims: ["cures diseases", "100% safe"],
  requiredPhrases: ["Made fresh daily"],
};
const byId = (fs: ReturnType<typeof checkTextRules>, id: string) => fs.find((f) => f.id === id)!;

describe("checkTextRules", () => {
  it("fails on forbidden words as whole words, ignoring case and punctuation", () => {
    const f = checkTextRules(profile, "Our CHEAP, tasty juice - Made fresh daily!");
    expect(byId(f, "forbidden_words")).toMatchObject({ severity: "fail" });
    expect(byId(f, "forbidden_words").detail).toContain('"cheap"');
  });

  it("does not flag a forbidden word inside another word", () => {
    const f = checkTextRules(profile, "Cheapskate deals? Never. Guaranteeing joy.");
    expect(byId(f, "forbidden_words").severity).toBe("pass");
  });

  it("matches forbidden claim phrases across punctuation and spacing", () => {
    const f = checkTextRules(profile, "It's 100%  safe, seriously.");
    expect(byId(f, "forbidden_claims").severity).toBe("fail");
    expect(byId(checkTextRules(profile, "This cures diseases."), "forbidden_claims").severity).toBe("fail");
  });

  it("says plainly that paraphrased claims are not caught by the rules", () => {
    const f = checkTextRules(profile, "Helps you feel better naturally");
    expect(byId(f, "forbidden_claims")).toMatchObject({ severity: "pass" });
    expect(byId(f, "forbidden_claims").detail).toMatch(/AI review/);
  });

  it("treats approved phrases as informational, never a failure", () => {
    expect(byId(checkTextRules(profile, "Fresh juice"), "approved_phrases").severity).toBe("info");
    expect(byId(checkTextRules(profile, "made FRESH daily"), "approved_phrases").severity).toBe("pass");
  });

  it("emits no findings for lists the brand has not set", () => {
    expect(checkTextRules({}, "anything")).toEqual([]);
  });

  it("works for non-Latin scripts", () => {
    const f = checkTextRules({ forbiddenWords: ["सस्ता"] }, "यह सस्ता नहीं है, बल्कि बढ़िया है");
    expect(f[0]!.severity).toBe("fail");
    expect(normalizeText("Hello,   WORLD!!")).toBe("hello world");
  });
});

const solid = (r: number, g: number, b: number, n = 100) => new Uint8ClampedArray(Array.from({ length: n }, () => [r, g, b, 255]).flat());

describe("palette", () => {
  it("measures coverage within a perceptual tolerance", () => {
    const cover = paletteCoverage(["#e11d48", "#0a2540"], solid(225, 29, 72));
    expect(cover[0]!.share).toBe(1);
    expect(cover[1]!.share).toBe(0);
    // A slightly different red is still "the brand red".
    expect(paletteCoverage(["#e11d48"], solid(220, 40, 80))[0]!.share).toBe(1);
  });

  it("never fails: missing brand colours are only informational", () => {
    expect(checkPalette(["#e11d48"], solid(0, 0, 255))!.severity).toBe("info");
    expect(checkPalette(["#e11d48"], solid(225, 29, 72))!.severity).toBe("pass");
    expect(checkPalette([], solid(0, 0, 0))).toBeNull();
  });

  it("ignores transparent pixels", () => {
    const px = new Uint8ClampedArray([225, 29, 72, 255, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(paletteCoverage(["#e11d48"], px)[0]!.share).toBe(1);
  });
});

describe("format and logo", () => {
  it("checks Instagram range only when Instagram is a target", () => {
    expect(checkAspect(1024, 1536, ["facebook"])).toBeNull();
    expect(checkAspect(1024, 1536, ["instagram"])!.severity).toBe("info");
    expect(checkAspect(1088, 1360, ["instagram"])!.severity).toBe("pass");
  });

  it("recognises a logo stamped by the brand kit", () => {
    expect(checkStampedLogo({ brandKitStamped: true })!.severity).toBe("pass");
    expect(checkStampedLogo({ brandKit: { logo: true } })!.severity).toBe("pass");
    expect(checkStampedLogo({})).toBeNull();
  });
});

describe("overallStatus", () => {
  const rule = (severity: "pass" | "info" | "warn" | "fail") => ({ id: "x", label: "x", severity, detail: "" });
  const concern = { aspect: "Tone of voice", verdict: "concern" as const, note: "n" };

  it("is blocked only by a failed rule", () => {
    expect(overallStatus([rule("fail")], null)).toBe("blocked");
    expect(overallStatus([rule("pass")], [concern])).toBe("attention"); // AI opinion never blocks
  });
  it("is pass when rules pass, info is ignored and AI has no concerns", () => {
    expect(overallStatus([rule("pass"), rule("info")], [{ ...concern, verdict: "ok" }])).toBe("pass");
    expect(overallStatus([rule("warn")], null)).toBe("attention");
  });
});
