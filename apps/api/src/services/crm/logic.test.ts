import { describe, expect, it } from "vitest";
import { crmLeadCreateSchema, crmLeadUpdateSchema, csvToImportRows, followUpDue, parseCsv, toCsv } from "@catgpt/types";
import { cleanFields, editFields, mergeLeads, type Mergeable } from "./logic.js";

const lead = (over: Partial<Mergeable> = {}): Mergeable => ({
  name: null, phone: null, igUserId: null, igUsername: null, stage: "new", ownerId: null, followUpOn: null, fields: {},
  lastActivityAt: new Date("2026-11-01"), createdAt: new Date("2026-11-01"), ...over,
});

describe("follow-ups", () => {
  it("buckets by calendar day", () => {
    expect(followUpDue(null, "2026-11-28")).toBe("none");
    expect(followUpDue("2026-11-27", "2026-11-28")).toBe("overdue");
    expect(followUpDue("2026-11-28", "2026-11-28")).toBe("today");
    expect(followUpDue("2026-12-01", "2026-11-28")).toBe("upcoming");
  });
});

describe("CSV", () => {
  it("reads quoted cells, doubled quotes and CRLF", () => {
    expect(parseCsv('a,b\r\n"x, y","say ""hi"""\r\n\r\n')).toEqual([["a", "b"], ["x, y", 'say "hi"']]);
  });
  it("matches columns by title, whatever the order", () => {
    expect(csvToImportRows("\uFEFFName,Budget,Mobile\nRavi,80 lakh,9876543210\nNoPhone,1,")).toEqual([{ name: "Ravi", budget: "80 lakh", phone: "9876543210" }]);
  });
  it("reads 'phone, name' without a title row, including tabs from Excel", () => {
    expect(csvToImportRows("9876543210,Ravi")).toEqual([{ phone: "9876543210", name: "Ravi" }]);
    expect(csvToImportRows("9876543210\tSita")).toEqual([{ phone: "9876543210", name: "Sita" }]);
  });
  it("neutralises formulas and escapes on export", () => {
    expect(toCsv([["=1+1", "@x", "a,b", 'q"q', "నమస్తే"]])).toBe(`'=1+1,'@x,"a,b","q""q",నమస్తే`);
  });
});

describe("input", () => {
  it("needs a name or a phone", () => {
    expect(crmLeadCreateSchema.safeParse({ brandId: "b", source: "call" }).success).toBe(false);
    expect(crmLeadCreateSchema.safeParse({ brandId: "b", source: "call", name: "Ravi" }).success).toBe(true);
  });
  it("does not let a person claim an automatic source, a bad date or an unknown field", () => {
    expect(crmLeadCreateSchema.safeParse({ brandId: "b", name: "R", source: "whatsapp" }).success).toBe(false);
    expect(crmLeadUpdateSchema.safeParse({ followUpOn: "2026-13-40" }).success).toBe(false);
    expect(crmLeadUpdateSchema.safeParse({ followUpOn: "2026-02-31" }).success).toBe(false);
    expect(crmLeadUpdateSchema.safeParse({ fields: { password: "x" } }).success).toBe(false);
  });
  it("keeps an edit partial", () => {
    expect(crmLeadUpdateSchema.parse({ fields: { bhk: "2" } })).toEqual({ fields: { bhk: "2" } });
  });
});

describe("fields", () => {
  it("drops blanks and non-text values", () => {
    expect(cleanFields({ a: " x ", b: "", c: { n: 1 }, d: 3 })).toEqual({ a: "x", d: "3" });
    expect(cleanFields(["x"])).toEqual({});
  });
  it("changes only the keys sent and reports cleared ones", () => {
    expect(editFields({ budget: "80", bhk: "2" }, { bhk: "", location: "Kondapur" })).toEqual({ fields: { budget: "80", location: "Kondapur" }, cleared: ["bhk"] });
  });
});

describe("merge", () => {
  it("joins an Instagram lead and a WhatsApp lead without losing anything", () => {
    const keep = lead({ phone: "919876543210", stage: "qualified", fields: { budget: "90" }, followUpOn: new Date("2026-12-05") });
    const other = lead({ name: "Ravi", igUserId: "ig1", igUsername: "ravi", stage: "engaged", fields: { budget: "80", bhk: "2" }, followUpOn: new Date("2026-12-01"), createdAt: new Date("2026-10-01") });
    expect(mergeLeads(keep, other)).toMatchObject({
      data: { name: "Ravi", phone: "919876543210", igUserId: "ig1", stage: "qualified", fields: { budget: "90", bhk: "2" }, followUpOn: new Date("2026-12-01"), createdAt: new Date("2026-10-01") },
    });
  });
  it("refuses two different phones or two different Instagram accounts", () => {
    expect(mergeLeads(lead({ phone: "1" }), lead({ phone: "2" }))).toHaveProperty("problem");
    expect(mergeLeads(lead({ igUserId: "a" }), lead({ igUserId: "b" }))).toHaveProperty("problem");
  });
});
