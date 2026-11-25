import { describe, expect, it } from "vitest";
import {
  advanceStage, buildMenuPayload, canFreeReply, isOptOut, normalizePhone, parseAiReply, parseWebhook,
  placeholderCount, renderTemplateBody, resolveVariable, splitText, templateToMeta, validateTemplate, wantsHuman,
} from "./logic.js";
import { waTemplateInputSchema } from "@catgpt/types";

describe("whatsapp logic", () => {
  it("normalizes phones", () => {
    expect(normalizePhone("98765 43210")).toBe("919876543210");
    expect(normalizePhone("+1 (415) 555-0100")).toBe("14155550100");
    expect(normalizePhone("09876543210")).toBe("919876543210");
    expect(normalizePhone("12")).toBeNull();
  });
  it("enforces the 24h window", () => {
    const now = new Date("2026-11-24T12:00:00Z");
    expect(canFreeReply(new Date("2026-11-23T13:00:00Z"), now)).toBe(true);
    expect(canFreeReply(new Date("2026-11-23T11:00:00Z"), now)).toBe(false);
    expect(canFreeReply(null, now)).toBe(false);
  });
  it("detects opt-out and handoff", () => {
    expect(isOptOut("STOP")).toBe(true);
    expect(isOptOut("please stop calling")).toBe(false);
    expect(wantsHuman("Can I talk to a human?", [])).toBe(true);
    expect(wantsHuman("price of 2bhk", ["site visit"])).toBe(false);
    expect(wantsHuman("I want a site visit", ["site visit"])).toBe(true);
  });
  it("splits long text", () => {
    const parts = splitText("a".repeat(5000) + "\n\n" + "b".repeat(100), 4096);
    expect(parts.every((p) => p.length <= 4096)).toBe(true);
    expect(parts.join("").replace(/\s/g, "").length).toBe(5100);
  });
  it("parses messages, button replies and statuses", () => {
    const ev = parseWebhook({
      object: "whatsapp_business_account",
      entry: [{ changes: [{ field: "messages", value: {
        metadata: { phone_number_id: "111" },
        contacts: [{ wa_id: "919876543210", profile: { name: "Ravi" } }],
        messages: [
          { id: "w1", from: "919876543210", timestamp: "1700000000", type: "text", text: { body: "hi" } },
          { id: "w2", from: "919876543210", timestamp: "1700000001", type: "interactive", interactive: { type: "list_reply", list_reply: { id: "m:price", title: "Pricing" } } },
        ],
        statuses: [{ id: "w9", status: "failed", timestamp: "1700000002", errors: [{ code: 131026, title: "Undeliverable" }] }],
      } }] }],
    });
    expect(ev).toHaveLength(3);
    expect(ev[0]).toMatchObject({ kind: "message", text: "hi", profileName: "Ravi", waId: "919876543210" });
    expect(ev[1]).toMatchObject({ replyId: "m:price", text: "Pricing" });
    expect(ev[2]).toMatchObject({ kind: "status", status: "failed", error: "Undeliverable (131026)" });
    expect(parseWebhook({ object: "instagram" })).toEqual([]);
  });
  it("builds buttons for <=3 items and a list for more", () => {
    const item = (n: number) => ({ id: `i${n}`, title: `Item ${n}`, kind: "reply" as const, text: "", url: null, imageUrl: null });
    const few = buildMenuPayload("91", "hi", [item(1), item(2)]) as any;
    expect(few.interactive.type).toBe("button");
    const many = buildMenuPayload("91", "hi", [1, 2, 3, 4].map(item)) as any;
    expect(many.interactive.type).toBe("list");
    expect(many.interactive.action.sections[0].rows[0].id).toBe("m:i1");
  });
  it("validates and converts templates", () => {
    const t = waTemplateInputSchema.parse({ name: "new_launch", body: "Hi {{1}}, {{2}} is now open for booking.", variables: ["name", "project"], examples: ["Ravi", "Vgrand Heights"], buttons: [{ type: "url", text: "View", url: "https://vgrandgroup.com" }] });
    expect(placeholderCount(t.body)).toBe(2);
    expect(validateTemplate(t)).toBeNull();
    expect(validateTemplate({ ...t, examples: ["x"] })).toMatch(/example/);
    expect(validateTemplate({ ...t, body: "{{1}} hello {{2}}" })).toMatch(/start or end/);
    const meta = templateToMeta(t) as any;
    expect(meta.components.map((c: any) => c.type)).toEqual(["BODY", "BUTTONS"]);
    expect(meta.components[0].example.body_text).toEqual([["Ravi", "Vgrand Heights"]]);
    expect(renderTemplateBody(t.body, ["Ravi", "Vgrand"])).toBe("Hi Ravi, Vgrand is now open for booking.");
  });
  it("resolves variables", () => {
    const c = { name: "Ravi Kumar", fields: { bhk: "3" } };
    expect(resolveVariable("name", c)).toBe("Ravi");
    expect(resolveVariable("field:bhk", c)).toBe("3");
    expect(resolveVariable("text:Diwali", c)).toBe("Diwali");
    expect(resolveVariable("name", { name: null, fields: {} })).toBe("there");
  });
  it("parses AI replies defensively and only advances stage", () => {
    const r = parseAiReply('{"reply":"Hello","fields":{"budget":"80L","Bad Key":"x"},"handoff":true,"stage":"qualified"}');
    expect(r).toEqual({ reply: "Hello", fields: { budget: "80L" }, handoff: true, stage: "qualified" });
    expect(parseAiReply("plain text").reply).toBe("plain text");
    expect(advanceStage("qualified", "engaged")).toBe("qualified");
    expect(advanceStage("new", "qualified")).toBe("qualified");
    expect(advanceStage("won", "qualified")).toBe("won");
  });
});
