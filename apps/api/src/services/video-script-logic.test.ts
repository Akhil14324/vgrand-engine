import { describe, expect, it } from "vitest";
import { reelBriefSchema, validateReelScript, type ReelScript } from "@catgpt/types";
import {
  buildFootageInventory,
  buildScriptMessages,
  checkScriptOutput,
  forbiddenTermsLine,
  scriptComplianceNotes,
} from "./video-script-logic.js";

const shot = (over: Partial<ReelScript["shots"][number]> & Pick<ReelScript["shots"][number], "id" | "startSec" | "endSec">) => ({
  kind: "footage" as const,
  description: "Product close-up on the counter",
  voiceover: null,
  onScreenText: null,
  sourceFile: "counter.mp4",
  ...over,
});

const goodScript = (): ReelScript => ({
  title: "Launch teaser",
  hook: "Fresh every morning",
  cta: "Visit us today",
  shots: [
    shot({ id: "1", startSec: 0, endSec: 4, voiceover: "Fresh every morning." }),
    shot({ id: "2", startSec: 4, endSec: 8, kind: "generate", sourceFile: null, description: "Steam rising from a fresh loaf" }),
    shot({ id: "3", startSec: 8, endSec: 15, kind: "motion_graphic", sourceFile: null, description: "CTA card", onScreenText: "Visit us today" }),
  ],
});

describe("validateReelScript", () => {
  it("accepts contiguous shots that end at the reel length", () => {
    expect(validateReelScript(goodScript(), 15)).toEqual([]);
  });

  it("reports a gap between shots", () => {
    const s = goodScript();
    s.shots[1]!.startSec = 4.5;
    expect(validateReelScript(s, 15).join(" ")).toMatch(/Gap of 0\.5s/);
  });

  it("reports an overlap", () => {
    const s = goodScript();
    s.shots[1]!.startSec = 3;
    expect(validateReelScript(s, 15).join(" ")).toMatch(/overlaps/);
  });

  it("reports a total length that doesn't match the brief", () => {
    expect(validateReelScript(goodScript(), 30).join(" ")).toMatch(/end at 15\.0s but the reel is 30s/);
  });

  it("rejects generated clips shorter than 4s or longer than 8s", () => {
    const short = goodScript();
    short.shots[1] = shot({ id: "2", startSec: 4, endSec: 6, kind: "generate", sourceFile: null, description: "Steam" });
    short.shots[2] = shot({ id: "3", startSec: 6, endSec: 15, kind: "motion_graphic", sourceFile: null, description: "CTA card" });
    expect(validateReelScript(short, 15).join(" ")).toMatch(/Generated shot 2 is 2\.0s/);
  });

  it("doesn't apply the generated-clip limit to footage shots", () => {
    const s = goodScript();
    s.shots[0] = shot({ id: "1", startSec: 0, endSec: 1.5 });
    s.shots[1]!.startSec = 1.5;
    s.shots[1]!.endSec = 5.5;
    s.shots[2]!.startSec = 5.5;
    expect(validateReelScript(s, 15).join(" ")).not.toMatch(/Generated shot/);
  });
});

describe("checkScriptOutput", () => {
  it("accepts valid JSON with usable timing", () => {
    const res = checkScriptOutput(JSON.stringify(goodScript()), 15);
    expect(res.ok).toBe(true);
  });

  it("treats omitted optional text as null", () => {
    const raw = JSON.stringify({
      ...goodScript(),
      shots: goodScript().shots.map((s) => ({ id: s.id, startSec: s.startSec, endSec: s.endSec, kind: s.kind, description: s.description })),
    });
    const res = checkScriptOutput(raw, 15);
    expect(res.ok && res.script.shots[0]!.voiceover).toBeNull();
  });

  it("rejects text that isn't JSON", () => {
    const res = checkScriptOutput("Here is your script:", 15);
    expect(res).toEqual({ ok: false, problems: ["The script was not valid JSON."] });
  });

  it("reports schema problems with the field path", () => {
    const raw = JSON.stringify({ ...goodScript(), hook: "" });
    const res = checkScriptOutput(raw, 15);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.problems[0]).toMatch(/^hook:/);
  });

  it("returns timing problems when the JSON is well-formed", () => {
    const res = checkScriptOutput(JSON.stringify(goodScript()), 30);
    expect(res.ok).toBe(false);
  });
});

describe("buildFootageInventory", () => {
  it("lists each file with its length and size, so shots can cite it by name", () => {
    const text = buildFootageInventory([
      { kind: "video", fileName: "counter.mp4", durationSec: 12.5, width: 1080, height: 1920 },
      { kind: "image", fileName: "menu.png", durationSec: null, width: null, height: null },
    ]);
    expect(text).toBe('- video "counter.mp4" 12.5s 1080x1920\n- image "menu.png"');
  });

  it("says so when there is no footage", () => {
    expect(buildFootageInventory([])).toMatch(/No source files/);
  });
});

describe("buildScriptMessages", () => {
  const brief = reelBriefSchema.parse({ goal: "Launch week teaser" });

  it("puts the forbidden terms and the length in the prompt", () => {
    const messages = buildScriptMessages({
      brandSummary: "Brand: Cafe",
      forbidden: "claims: best in town",
      brief,
      title: "Teaser",
      inventory: "none",
    });
    const user = messages[1]!.content;
    expect(user).toMatch(/Forbidden for this brand: claims: best in town/);
    expect(user).toMatch(/Length: 15 seconds, aspect ratio 9:16/);
  });

  it("lists the previous problems on a retry", () => {
    const messages = buildScriptMessages({
      brandSummary: "Brand: Cafe",
      forbidden: "none listed",
      brief,
      title: "Teaser",
      inventory: "none",
      problems: ["Gap of 1.0s before shot 2."],
    });
    expect(messages[1]!.content).toMatch(/- Gap of 1\.0s before shot 2\./);
  });
});

describe("forbiddenTermsLine", () => {
  it("says none when the brand lists nothing", () => {
    expect(forbiddenTermsLine(null)).toBe("none listed");
  });

  it("joins words and claims", () => {
    expect(forbiddenTermsLine({ forbiddenWords: ["cheap"], forbiddenClaims: ["guaranteed"] } as never)).toBe(
      "words: cheap | claims: guaranteed",
    );
  });
});

describe("scriptComplianceNotes", () => {
  it("returns nothing when there is no script or profile", () => {
    expect(scriptComplianceNotes(null, goodScript())).toEqual([]);
    expect(scriptComplianceNotes({} as never, null)).toEqual([]);
  });

  it("flags a forbidden word that appears in the voiceover", () => {
    const s = goodScript();
    s.shots[0]!.voiceover = "Our cheap coffee is the best.";
    const notes = scriptComplianceNotes({ forbiddenWords: ["cheap"] } as never, s);
    expect(notes.length).toBe(1);
    expect(notes[0]).toMatch(/cheap/);
  });

  it("returns nothing for a clean script", () => {
    expect(scriptComplianceNotes({ forbiddenWords: ["cheap"] } as never, goodScript())).toEqual([]);
  });
});
