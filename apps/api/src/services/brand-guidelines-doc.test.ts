import { describe, expect, it } from "vitest";
import type { BrandProfile } from "@catgpt/types";
import {
  mergeIntoProfile,
  parseGuidelines,
  renderGuidelines,
  type GuidelinesNarrative,
} from "./brand-guidelines-doc.js";

const narrative: GuidelinesNarrative = {
  essence: "Fresh, honest smoothies for busy mornings.",
  audience: "Office workers aged 22-40.",
  dos: ["Keep it short"],
  donts: ["Use slang"],
  samplePosts: [{ platform: "Instagram", text: "Monday fuel is here." }],
  suggestions: { visualStyle: "Bright, sunny flat lays" },
};

const profile: BrandProfile = {
  tagline: "Blend better",
  tone: "Warm, playful and direct",
  colors: ["#E11D48", "#0A2540", "#FFD166"],
  typography: "Rounded sans-serif headlines",
  logoRules: "Keep clear space equal to the logo height",
  requiredPhrases: ["Made fresh daily"],
  forbiddenWords: ["cheap", "guaranteed"],
  forbiddenClaims: ["cures diseases"],
  defaultCta: "Order now",
};

describe("render -> parse round trip", () => {
  it("recovers every structured profile field", () => {
    const md = renderGuidelines("Papaya", profile, narrative);
    const { fields, present } = parseGuidelines(md);
    expect(present).toContain("colors");
    expect(fields.tagline).toBe("Blend better");
    expect(fields.tone).toBe("Warm, playful and direct");
    expect(fields.colors).toEqual(["#E11D48", "#0A2540", "#FFD166"]);
    expect(fields.forbiddenWords).toEqual(["cheap", "guaranteed"]);
    expect(fields.forbiddenClaims).toEqual(["cures diseases"]);
    expect(fields.requiredPhrases).toEqual(["Made fresh daily"]);
    expect(fields.defaultCta).toBe("Order now");
  });

  it("saving an unedited document changes nothing except adopting AI suggestions", () => {
    const md = renderGuidelines("Papaya", profile, narrative);
    const { profile: next, updatedFields } = mergeIntoProfile(profile, parseGuidelines(md));
    expect(updatedFields).toEqual(["visualStyle"]); // the model's suggestion for a field the brand had empty
    expect(next.visualStyle).toBe("Bright, sunny flat lays");
    expect(next.colors).toEqual(profile.colors);
  });

  it("shows '(not set)' for empty fields and parses them back as empty", () => {
    const md = renderGuidelines("Papaya", {}, { ...narrative, suggestions: {} });
    expect(md).toContain("(not set)");
    const { fields } = parseGuidelines(md);
    expect(fields.tone).toBeUndefined();
    expect(fields.forbiddenWords).toBeUndefined();
  });
});

describe("editing the document changes the profile", () => {
  const md = renderGuidelines("Papaya", profile, narrative);

  it("applies edits to text, lists and colours", () => {
    const edited = md
      .replace("Warm, playful and direct", "Confident and calm")
      .replace("- cheap", "- cheap\n- discount")
      .replace("#FFD166", "#00AA55");
    const { profile: next, updatedFields } = mergeIntoProfile(profile, parseGuidelines(edited));
    expect(next.tone).toBe("Confident and calm");
    expect(next.forbiddenWords).toEqual(["cheap", "discount", "guaranteed"]);
    expect(next.colors).toEqual(["#E11D48", "#0A2540", "#00AA55"]);
    expect(updatedFields).toEqual(expect.arrayContaining(["tone", "forbiddenWords", "colors"]));
  });

  it("clears a field when its section is emptied, and leaves fields whose section was deleted", () => {
    const cleared = md.replace(/## Words to avoid[\s\S]*?(?=## Claims)/, "## Words to avoid\n\n");
    const noCta = cleared.replace(/## Call to action[\s\S]*?(?=## |$)/, "");
    const { profile: next } = mergeIntoProfile(profile, parseGuidelines(noCta));
    expect(next.forbiddenWords).toBeUndefined();
    expect(next.defaultCta).toBe("Order now"); // section removed entirely -> untouched
  });

  it("truncates over-long values to the profile limits", () => {
    const longTone = md.replace("Warm, playful and direct", "x".repeat(900));
    const { profile: next } = mergeIntoProfile(profile, parseGuidelines(longTone));
    expect(next.tone).toHaveLength(300);
  });

  it("caps colours at six and lists at their max", () => {
    const many = md.replace("- #FFD166 - Accent", ["#111111", "#222222", "#333333", "#444444", "#555555"].map((c) => `- ${c}`).join("\n"));
    expect(parseGuidelines(many).fields.colors).toHaveLength(6);
  });

  it("accepts British spelling and ignores non-structured sections", () => {
    const { fields } = parseGuidelines("# X\n\n## Colours\n\n- #123456\n\n## Sample posts\n\n- #999999 not a colour section\n");
    expect(fields.colors).toEqual(["#123456"]);
  });
});

describe("PDF export header", () => {
  it("renders a valid PDF with the logo, swatches and the guidelines text", async () => {
    const { createCanvas } = await import("@napi-rs/canvas");
    const { PDFParse } = await import("pdf-parse");
    const { renderMarkdownPdf } = await import("./pdf-export.js");
    const { drawBrandHeader } = await import("./brand-guidelines-doc.js");

    const c = createCanvas(200, 80);
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#e11d48";
    ctx.fillRect(0, 0, 200, 80);
    const md = renderGuidelines("Papaya", profile, narrative);
    const pdf = await renderMarkdownPdf("Papaya Brand Guidelines", md, {
      bare: true,
      creator: "Papaya",
      beforeBody: (doc) => drawBrandHeader(doc, { logo: c.toBuffer("image/png"), colors: profile.colors ?? [] }),
    });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    const parser = new PDFParse({ data: new Uint8Array(pdf) });
    const text = (await parser.getText()).text;
    expect(text).toContain("#E11D48"); // swatch label
    expect(text).toContain("Papaya Brand Guidelines");
    expect(text).toContain("Made fresh daily");
    expect(text).toContain("Warm, playful and direct");
  });
});
