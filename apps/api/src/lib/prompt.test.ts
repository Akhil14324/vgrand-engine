import { describe, expect, it } from "vitest";
import {
  DEFAULT_PROMPT_TEMPLATE,
  buildFinalPrompt,
  resolveProvider,
} from "./prompt.js";

describe("buildFinalPrompt", () => {
  it("falls back to the default template without a theme", () => {
    const out = buildFinalPrompt(null, "a neon diner");
    expect(out).toContain(DEFAULT_PROMPT_TEMPLATE);
    expect(out).toContain("User request: a neon diner");
  });

  it("uses the theme template and appends style guidance", () => {
    const out = buildFinalPrompt(
      {
        promptTemplate: "Design a festival poster.",
        styleGuide: {
          palette: ["#7C3AED", "#F59E0B"],
          layoutHints: "greeting centered",
          negativePrompt: "watermark",
        },
      },
      "diwali sale",
    );
    expect(out).toContain("Design a festival poster.");
    expect(out).toContain("User request: diwali sale");
    expect(out).toContain("#7C3AED, #F59E0B");
    expect(out).toContain("Layout guidance: greeting centered");
    expect(out).toContain("Avoid: watermark");
  });

  it("omits guidance sections the style guide doesn't provide", () => {
    const out = buildFinalPrompt(
      { promptTemplate: "T", styleGuide: {} },
      "x",
    );
    expect(out).not.toContain("Layout guidance");
    expect(out).not.toContain("Avoid:");
    expect(out).not.toContain("Preferred color palette");
  });
});

describe("resolveProvider", () => {
  it("honours a valid explicit override", () => {
    expect(resolveProvider(null, "flux")).toBe("flux");
  });

  it("ignores unknown provider names", () => {
    expect(resolveProvider(null, "bogus")).toBe("openai");
  });

  it("uses the theme's pinned provider", () => {
    expect(
      resolveProvider({ styleGuide: { preferredProvider: "ideogram" } }),
    ).toBe("ideogram");
  });

  it("explicit override beats the theme pin", () => {
    expect(
      resolveProvider({ styleGuide: { preferredProvider: "flux" } }, "openai"),
    ).toBe("openai");
  });
});
