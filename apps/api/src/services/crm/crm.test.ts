/** Capture, access and import behaviour against an in-memory stand-in for the tables used. */
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ t: {} as Record<string, any[]> }));

vi.mock("@catgpt/db", async (original) => {
  const real: any = await original();
  let n = 0;
  const duplicate = () => new real.Prisma.PrismaClientKnownRequestError("duplicate", { code: "P2002", clientVersion: "test" });
  /** Enough of Prisma's `where` for the queries the CRM makes. */
  const matches = (row: any, where: any = {}): boolean =>
    Object.entries(where).every(([key, want]: [string, any]) => {
      if (want === undefined) return true;
      if (key === "brandId_phone") return row.brandId === want.brandId && row.phone === want.phone;
      if (key === "brandId_igUserId") return row.brandId === want.brandId && row.igUserId === want.igUserId;
      if (key === "number") return db.t.whatsappNumber!.some((x) => x.id === row.numberId && matches(x, want));
      if (key === "OR") return want.some((w: any) => matches(row, w));
      if (key === "workspace") return false; // personal brands only in these tests, unless set by userId
      if (want && typeof want === "object" && "in" in want) return want.in.includes(row[key]);
      return row[key] === want;
    });
  const join = (name: string, row: any) => {
    if (!row) return null;
    const copy = { ...row };
    if (name === "whatsappContact") copy.number = db.t.whatsappNumber!.find((x) => x.id === row.numberId);
    if (name === "igAutomationEvent") {
      const a = db.t.socialAccount!.find((x) => x.id === row.accountId);
      copy.account = { ...a, crmRoute: db.t.crmInstagramRoute!.find((r) => r.accountId === row.accountId) ?? null };
    }
    return copy;
  };
  const unique = (name: string, row: any) =>
    name === "crmLead" && db.t.crmLead!.some((x) => x.id !== row.id && x.brandId === row.brandId && ((row.phone && x.phone === row.phone) || (row.igUserId && x.igUserId === row.igUserId)));
  const write = (name: string, row: any, data: any) => {
    const { activities, ...rest } = data;
    const next = { ...row, ...rest };
    if (unique(name, next)) throw duplicate();
    Object.assign(row, rest);
    for (const a of [activities?.create ?? []].flat()) db.t.crmActivity!.push({ id: `act${++n}`, leadId: row.id, createdAt: new Date(), userId: null, ...a });
    return { ...row };
  };
  const table = (name: string) => {
    const rows = () => db.t[name]!;
    const find = (where: any) => rows().find((r) => matches(r, where));
    const create = (data: any) => {
      const row = { id: `${name}${++n}`, ...(name === "crmLead" ? { name: null, phone: null, igUserId: null, igUsername: null, stage: "new", fields: {}, ownerId: null, followUpOn: null, lastActivityAt: new Date(), createdAt: new Date() } : {}) };
      const out = write(name, row, data);
      rows().push(row);
      return out;
    };
    return {
      findUnique: async ({ where }: any) => join(name, find(where)),
      findUniqueOrThrow: async ({ where }: any) => join(name, find(where)),
      findFirst: async ({ where }: any) => join(name, find(where)),
      findMany: async ({ where }: any = {}) => rows().filter((r) => matches(r, where)).map((r) => join(name, r)),
      create: async ({ data }: any) => create(data),
      createMany: async ({ data }: any) => {
        let count = 0;
        for (const d of data) {
          try {
            create(d);
            count++;
          } catch {
            /* skipDuplicates */
          }
        }
        return { count };
      },
      update: async ({ where, data }: any) => write(name, find(where), data),
      delete: async ({ where }: any) => rows().splice(rows().indexOf(find(where)!), 1)[0],
    };
  };
  const prisma: any = Object.fromEntries(
    ["brand", "user", "crmLead", "crmActivity", "crmInstagramRoute", "whatsappContact", "whatsappNumber", "whatsappMessage", "igAutomationEvent", "socialAccount"].map((name) => [name, table(name)]),
  );
  return { ...real, prisma };
});

const { captureWhatsappLead, syncLeadFromInstagram, syncLeadFromWhatsapp } = await import("./capture.js");
const { createLead, deleteLead, exportLeads, importLeads, updateLead } = await import("./service.js");

const contact = (over: any = {}) => ({ id: "c1", numberId: "n1", waId: "919876543210", name: "Ravi", kind: "lead", stage: "new", fields: {}, lastInboundAt: new Date(), lastMessageAt: new Date(), ...over });
const leads = () => db.t.crmLead!;
const history = () => db.t.crmActivity!.map((a) => a.text);

beforeEach(() => {
  db.t = {
    brand: [{ id: "b1", userId: "owner", workspaceId: null, workspace: null }],
    user: [{ id: "owner", name: "Priya", email: "priya@example.com" }],
    crmLead: [], crmActivity: [], crmInstagramRoute: [], whatsappContact: [contact()], whatsappNumber: [{ id: "n1", brandId: "b1" }], whatsappMessage: [], igAutomationEvent: [],
    socialAccount: [{ id: "ig1", externalAccountId: "me" }],
  };
});

describe("WhatsApp capture", () => {
  it("creates one lead however often it runs", async () => {
    await captureWhatsappLead("c1");
    await captureWhatsappLead("c1");
    expect(leads()).toHaveLength(1);
    expect(leads()[0]).toMatchObject({ brandId: "b1", phone: "919876543210", name: "Ravi", source: "whatsapp" });
  });
  it("takes the bot's progress and details, and never moves a lead backwards", async () => {
    await captureWhatsappLead("c1");
    Object.assign(db.t.whatsappContact![0], { stage: "qualified", fields: { budget: "80 lakh" } });
    await captureWhatsappLead("c1");
    expect(leads()[0]).toMatchObject({ stage: "qualified", fields: { budget: "80 lakh" } });
    db.t.whatsappContact![0].stage = "engaged";
    await captureWhatsappLead("c1");
    expect(leads()[0].stage).toBe("qualified");
    expect(db.t.whatsappContact![0].stage).toBe("qualified");
  });
  it("accepts a person's choice from the inbox, even backwards", async () => {
    db.t.whatsappContact![0].stage = "site_visit";
    await captureWhatsappLead("c1");
    db.t.whatsappContact![0].stage = "engaged";
    await syncLeadFromWhatsapp("c1", "manual", "owner");
    expect(leads()[0].stage).toBe("engaged");
    expect(history()).toContain("Stage: site visit → engaged");
  });
  it("keeps two chats of one person in step, so the older one cannot undo newer details", async () => {
    db.t.whatsappContact!.push(contact({ id: "c2", fields: { budget: "90" } }));
    db.t.whatsappContact![0].fields = { budget: "70" };
    await captureWhatsappLead("c1");
    await captureWhatsappLead("c2");
    await captureWhatsappLead("c1");
    expect(leads()[0].fields).toEqual({ budget: "90" });
  });
  it("leaves imported buyers out", async () => {
    db.t.whatsappContact![0].kind = "buyer";
    await captureWhatsappLead("c1");
    expect(leads()).toHaveLength(0);
  });
  it("never throws into the webhook", async () => {
    db.t.whatsappNumber = [];
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(captureWhatsappLead("c1")).resolves.toBeUndefined();
    quiet.mockRestore();
  });
});

describe("Instagram capture", () => {
  const event = (over: any = {}) => ({ id: "e1", accountId: "ig1", kind: "comment", ruleId: "r1", fromId: "u9", fromUsername: "sita", text: "price?", occurredAt: new Date("2026-11-20T10:00:00Z"), ...over });
  it("needs a chosen brand and a matched rule, and ignores our own account", async () => {
    db.t.igAutomationEvent = [event(), event({ id: "e2", ruleId: null }), event({ id: "e3", fromId: "me" })];
    expect(await syncLeadFromInstagram("e1")).toBe(false);
    db.t.crmInstagramRoute = [{ accountId: "ig1", brandId: "b1" }];
    expect(await syncLeadFromInstagram("e2")).toBe(false);
    expect(await syncLeadFromInstagram("e3")).toBe(false);
    expect(await syncLeadFromInstagram("e1")).toBe(true);
    expect(leads()[0]).toMatchObject({ source: "instagram", igUsername: "sita", phone: null });
  });
  it("records a retried event once", async () => {
    db.t.crmInstagramRoute = [{ accountId: "ig1", brandId: "b1" }];
    db.t.igAutomationEvent = [event()];
    await syncLeadFromInstagram("e1");
    await syncLeadFromInstagram("e1");
    expect(leads()).toHaveLength(1);
    expect(history()).toEqual(["Commented: “price?”"]);
  });
});

describe("access, edits and import", () => {
  const add = (userId = "owner") => createLead(userId, { brandId: "b1", name: "Kumar", phone: "9812345678", source: "walk_in", stage: "new", ownerId: null, followUpOn: null, fields: {}, note: "" });

  it("hides a brand from people without access", async () => {
    await expect(add("stranger")).rejects.toMatchObject({ statusCode: 404 });
    const { id } = await add();
    await expect(updateLead("stranger", id, { stage: "won" })).rejects.toMatchObject({ statusCode: 404, message: "Lead not found" });
  });
  it("lets members work leads but keeps import, export and delete for the owner", async () => {
    Object.assign(db.t.brand![0], { workspaceId: "w1", workspace: { userId: "owner", members: [{ userId: "member" }] } });
    // The member reaches the brand through the workspace.
    db.t.brand![0].userId = "owner";
    const { prisma } = (await import("@catgpt/db")) as any;
    prisma.brand.findFirst = async () => db.t.brand![0];
    const { id } = await add("member");
    await updateLead("member", id, { stage: "engaged" });
    expect(leads()[0].stage).toBe("engaged");
    await expect(importLeads("member", { brandId: "b1", rows: [{ phone: "9876500000" }] })).rejects.toMatchObject({ statusCode: 403 });
    await expect(exportLeads("member", "b1")).rejects.toMatchObject({ statusCode: 403 });
    await expect(deleteLead("member", id)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects a bad phone, a repeated phone and an outside owner", async () => {
    await add();
    await expect(add()).rejects.toMatchObject({ statusCode: 409 });
    await expect(updateLead("owner", leads()[0].id, { phone: "12" })).rejects.toMatchObject({ statusCode: 400 });
    await expect(updateLead("owner", leads()[0].id, { ownerId: "stranger" })).rejects.toMatchObject({ statusCode: 400 });
  });
  it("copies a team edit to the WhatsApp chat, including a cleared field", async () => {
    Object.assign(db.t.whatsappContact![0], { fields: { budget: "80", bhk: "2" } });
    await captureWhatsappLead("c1");
    await updateLead("owner", leads()[0].id, { stage: "lost", fields: { bhk: "" } });
    expect(db.t.whatsappContact![0]).toMatchObject({ stage: "lost", fields: { budget: "80" } });
    expect(db.t.whatsappContact![0].fields).not.toHaveProperty("bhk");
  });
  it("takes chat progress when a lead is given a number that already chats", async () => {
    Object.assign(db.t.whatsappContact![0], { stage: "site_visit", fields: { budget: "80", bhk: "2" } });
    const { id } = await createLead("owner", { brandId: "b1", name: "Typed", phone: "", source: "call", stage: "new", ownerId: null, followUpOn: null, fields: { bhk: "3" }, note: "" });
    await updateLead("owner", id, { phone: "9876543210" });
    expect(leads()[0]).toMatchObject({ stage: "site_visit", fields: { budget: "80", bhk: "3" } });
    expect(db.t.whatsappContact![0]).toMatchObject({ stage: "site_visit", fields: { budget: "80", bhk: "3" } });
  });
  it("imports without overwriting what the team already entered", async () => {
    await add();
    const result = await importLeads("owner", {
      brandId: "b1",
      rows: [{ phone: "9812345678", name: "Other name", budget: "70" }, { phone: "9876500000", name: "New" }, { phone: "+91 98765 00000" }, { phone: "abc" }],
    });
    expect(result).toEqual({ added: 1, updated: 1, unchanged: 0, invalid: 1 });
    expect(leads()[0]).toMatchObject({ name: "Kumar", fields: { budget: "70" } });
  });
});
