import { describe, expect, it, vi } from "vitest";

// chat.ts pulls in the Prisma client at module level; never used here.
vi.mock("@catgpt/db", () => ({ prisma: {} }));

import { wantsDocumentConvert, wantsDocumentEdit } from "./chat.js";

const CTX = { attachedNow: true, jevSays: null as boolean | null };
const NO_DOC = { attachedNow: false, jevSays: null as boolean | null };

describe("wantsDocumentConvert", () => {
  it("catches the reported failure: 'give me in pdf'", () => {
    expect(wantsDocumentConvert("give me in pdf", CTX)).toBe(true);
  });

  it("matches the usual export phrasings", () => {
    for (const p of [
      "export this as pdf",
      "convert this document to pdf",
      "download the menu as a pdf",
      "turn it into a word doc",
      "save it in pdf format",
      "make a pdf of this menu",
      "a pdf version please",
    ]) {
      expect(wantsDocumentConvert(p, CTX), p).toBe(true);
    }
  });

  it("does not hijack document questions or edits", () => {
    for (const p of [
      "summarize this pdf",
      "what does the pdf say about pricing",
      "give me feedback on this pdf",
      "rewrite the second paragraph",
      "thanks!",
    ]) {
      expect(wantsDocumentConvert(p, CTX), p).toBe(false);
    }
  });

  it("lets a Jev verdict fire on phrasing the regex misses", () => {
    expect(
      wantsDocumentConvert("render this file differently", {
        attachedNow: false,
        jevSays: true,
      }),
    ).toBe(true);
    expect(
      wantsDocumentConvert("render this file differently", {
        attachedNow: false,
        jevSays: false,
      }),
    ).toBe(false);
  });
});

describe("wantsDocumentEdit — described edits", () => {
  it("routes natural-language edits on an attached pdf/docx to the pipeline", () => {
    for (const p of [
      "change the price of paneer to 250",
      "remove the second item",
      "add a desserts section at the end",
      "update the address on page 1",
      "replace the logo text with VGrand",
      "delete page 3",
    ]) {
      expect(wantsDocumentEdit(p, CTX), p).toBe(true);
    }
  });

  it("still needs a doc signal when nothing is attached this turn", () => {
    // No doc noun, nothing attached, no Jev verdict — stays chat.
    expect(wantsDocumentEdit("change the wallpaper", NO_DOC)).toBe(false);
    // A document noun rescues the follow-up turn.
    expect(
      wantsDocumentEdit("change the price in the pdf", NO_DOC),
    ).toBe(true);
  });

  it("an edit instruction outranks a format ask (worker checks edit first)", () => {
    // Both intents match — the worker must run the EDIT, which returns a
    // PDF anyway, instead of converting the un-edited original.
    const p = "change the prices and give me a pdf version";
    expect(wantsDocumentEdit(p, CTX)).toBe(true);
    expect(wantsDocumentConvert(p, CTX)).toBe(true);
  });
});
