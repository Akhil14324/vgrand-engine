import Fastify, { type FastifyRequest } from "fastify";
import { describe, expect, it, vi } from "vitest";
import { forbidden } from "../lib/errors.js";

const assertWebsiteViewer = vi.fn(async (userId: string) => {
  if (userId !== "allowed") throw forbidden("not on the list");
});
const websiteOverview = vi.fn(async (days: number) => ({ days, leads: 3 }));
const websiteLeads = vi.fn(async (page: number, q?: string) => ({ items: [], total: 0, page, pageSize: 50, q }));
vi.mock("../services/website/reader.js", () => ({
  assertWebsiteViewer,
  websiteOverview,
  websiteLeads,
  websiteConsents: vi.fn(),
  websiteLeadsCsv: vi.fn(async () => "Date,Name"),
}));

const { websiteRoutes } = await import("./website.js");

const app = async (userId: string) => {
  const a = Fastify();
  a.decorate("authenticate", async (req: FastifyRequest) => {
    (req as FastifyRequest & { userId: string }).userId = userId;
  });
  a.setErrorHandler((err: { statusCode?: number; message: string }, _req, reply) => reply.code(err.statusCode ?? 500).send({ message: err.message }));
  await a.register(websiteRoutes);
  return a;
};

describe("website routes", () => {
  it("refuses people who are not on the viewer list", async () => {
    const res = await (await app("someone")).inject({ url: "/website/overview" });
    expect(res.statusCode).toBe(403);
    expect(websiteOverview).not.toHaveBeenCalled();
  });

  it("serves the overview for 7, 30 or 90 days only", async () => {
    const a = await app("allowed");
    expect((await a.inject({ url: "/website/overview?days=7" })).json()).toEqual({ days: 7, leads: 3 });
    expect((await a.inject({ url: "/website/overview?days=12" })).statusCode).toBe(400);
  });

  it("passes the page and search to the leads list", async () => {
    const a = await app("allowed");
    const res = await a.inject({ url: "/website/leads?page=2&q=ravi" });
    expect(res.statusCode).toBe(200);
    expect(websiteLeads).toHaveBeenCalledWith(2, "ravi");
  });

  it("exports CSV as a download", async () => {
    const res = await (await app("allowed")).inject({ url: "/website/leads/export" });
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.headers["content-disposition"]).toContain("website-leads.csv");
  });
});
