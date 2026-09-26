import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  strategy: { findUnique: vi.fn() },
  deliverable: { findUnique: vi.fn() },
  execTask: { findUnique: vi.fn() },
  brand: { findFirst: vi.fn() },
  campaignResult: { create: vi.fn() },
}));
vi.mock("@catgpt/db", () => ({ prisma: db }));
// bcamp.ts imports the model client; it is never called in these tests.
vi.mock("./chat.js", () => ({ getClient: vi.fn() }));

import { loadManageableStrategy, loadStrategy } from "./bcamp.js";
import { addResult, deliverableAction, updateTask } from "./execution.js";

const OWN = "user-a";
const strategy = { id: "s1", brandId: "brand-b", plan: {}, title: "T", status: "active" };

beforeEach(() => vi.clearAllMocks());

/** brand.findFirst is used for both "can access" and "can manage"; script it per test. */
const brandAccess = (access: boolean, manage: boolean) => {
  db.brand.findFirst.mockImplementation(async (args: { where: { OR: { userId?: string; workspace?: object }[] } }) => {
    // The manage query filters on `workspace: { userId }`; the access query on `workspace: workspaceAccess`.
    const isManage = args.where.OR.some((c) => c.workspace && "userId" in c.workspace && !("OR" in c.workspace));
    return (isManage ? manage : access) ? { id: "brand-b", workspaceId: null, userId: "owner" } : null;
  });
};

describe("business isolation", () => {
  it("returns 404 for a strategy that belongs to another business", async () => {
    db.strategy.findUnique.mockResolvedValue(strategy);
    brandAccess(false, false);
    await expect(loadStrategy(OWN, "s1")).rejects.toMatchObject({ statusCode: 404 });
  });

  it("returns 404 for another business's deliverable and task, not 403", async () => {
    brandAccess(false, false);
    db.deliverable.findUnique.mockResolvedValue({ id: "d1", brandId: "brand-b", strategyId: "s1", strategy });
    db.execTask.findUnique.mockResolvedValue({ id: "t1", brandId: "brand-b", strategyId: "s1", strategy });
    await expect(deliverableAction(OWN, "d1", "approve")).rejects.toMatchObject({ statusCode: 404 });
    await expect(updateTask(OWN, "t1", { status: "done" })).rejects.toMatchObject({ statusCode: 404 });
  });

  it("lets a member read but not manage strategy", async () => {
    db.strategy.findUnique.mockResolvedValue(strategy);
    brandAccess(true, false);
    await expect(loadStrategy(OWN, "s1")).resolves.toMatchObject({ canManage: false });
    await expect(loadManageableStrategy(OWN, "s1")).rejects.toMatchObject({ statusCode: 403 });
  });

  it("stops a member approving work or recording results", async () => {
    brandAccess(true, false);
    db.deliverable.findUnique.mockResolvedValue({ id: "d1", brandId: "brand-b", strategyId: "s1", status: "awaiting_approval", strategy });
    await expect(deliverableAction(OWN, "d1", "approve")).rejects.toMatchObject({ statusCode: 403 });
    db.strategy.findUnique.mockResolvedValue(strategy);
    await expect(
      addResult(OWN, {
        strategyId: "s1", metric: "orders", value: 1, source: "user_entered", sourceNote: "POS",
        periodStart: "2026-10-01T00:00:00.000Z", periodEnd: "2026-10-02T00:00:00.000Z",
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(db.campaignResult.create).not.toHaveBeenCalled();
  });
});
