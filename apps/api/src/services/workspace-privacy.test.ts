import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  generation: { findMany: vi.fn(), deleteMany: vi.fn() },
  brandAsset: { findMany: vi.fn() },
  socialPost: { findMany: vi.fn() },
  conversation: { count: vi.fn(), deleteMany: vi.fn() },
  document: { findMany: vi.fn() },
  brand: { findFirst: vi.fn() },
  consentRecord: { create: vi.fn(), updateMany: vi.fn(), findFirst: vi.fn(), findUniqueOrThrow: vi.fn() },
  workspace: { update: vi.fn() },
  deleteStoredFiles: vi.fn(),
  findWorkspaceForUser: vi.fn(),
}));

vi.mock("@catgpt/db", () => ({ prisma: m }));
vi.mock("./storage.js", () => ({ deleteStoredFiles: m.deleteStoredFiles }));
vi.mock("../lib/workspace-access.js", () => ({ findWorkspaceForUser: m.findWorkspaceForUser }));

const svc = await import("./workspace-privacy.js");

beforeEach(() => {
  vi.clearAllMocks();
  m.brandAsset.findMany.mockResolvedValue([]);
  m.socialPost.findMany.mockResolvedValue([]);
  m.findWorkspaceForUser.mockResolvedValue({ id: "w1", name: "Acme" });
});

describe("purgeExpiredMedia", () => {
  const NOW = Date.parse("2030-06-01T00:00:00Z");

  it("only selects finished images older than the window that no post or campaign uses", async () => {
    m.generation.findMany.mockResolvedValueOnce([]);
    await svc.purgeExpiredMedia("w1", 90, NOW);
    const where = m.generation.findMany.mock.calls[0]![0].where;
    expect(where.kind).toBe("image");
    expect(where.createdAt.lt.toISOString()).toBe(new Date(NOW - 90 * 86_400_000).toISOString());
    expect(where.status.in).toEqual(["completed", "failed", "cancelled"]); // never in-flight work
    expect(where.conversation).toEqual({ workspaceId: "w1" });
    expect(where.socialPosts).toEqual({ none: {} });
    expect(where.campaignPost).toEqual({ is: null });
  });

  it("deletes the rows and their files, but keeps files another record still points at", async () => {
    m.generation.findMany.mockResolvedValueOnce([
      { id: "g1", imageUrls: ["https://s/a.png"] },
      { id: "g2", imageUrls: ["https://s/mascot.png", "https://s/b.png"] },
    ]);
    m.brandAsset.findMany.mockResolvedValue([{ url: "https://s/mascot.png" }]);
    const n = await svc.purgeExpiredMedia("w1", 30, NOW);
    expect(n).toBe(2);
    expect(m.generation.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ["g1", "g2"] } } });
    expect(m.deleteStoredFiles).toHaveBeenCalledWith(["https://s/a.png", "https://s/b.png"]);
  });

  it("does nothing when nothing has expired", async () => {
    m.generation.findMany.mockResolvedValueOnce([]);
    expect(await svc.purgeExpiredMedia("w1", 30, NOW)).toBe(0);
    expect(m.generation.deleteMany).not.toHaveBeenCalled();
    expect(m.deleteStoredFiles).not.toHaveBeenCalled();
  });
});

describe("deleteWorkspaceContent", () => {
  it("refuses unless the exact workspace name is typed, and deletes nothing", async () => {
    await expect(svc.deleteWorkspaceContent("u1", "w1", "acme")).rejects.toMatchObject({ statusCode: 400 });
    expect(m.conversation.deleteMany).not.toHaveBeenCalled();
    expect(m.findWorkspaceForUser).toHaveBeenCalledWith("u1", "w1", { ownerOnly: true });
  });

  it("deletes chats and reports counts once confirmed", async () => {
    m.generation.findMany.mockResolvedValue([{ imageUrls: ["https://s/a.png", "https://s/b.png"], kind: "image" }, { imageUrls: [], kind: "text" }]);
    m.document.findMany.mockResolvedValue([{ storageUrl: "https://s/d.pdf" }, { storageUrl: null }]);
    m.conversation.count.mockResolvedValue(3);
    const res = await svc.deleteWorkspaceContent("u1", "w1", " Acme ");
    expect(res).toEqual({ conversationsDeleted: 3, imagesDeleted: 2 });
    expect(m.conversation.deleteMany).toHaveBeenCalledWith({ where: { workspaceId: "w1" } });
    expect(m.deleteStoredFiles).toHaveBeenCalledWith(["https://s/a.png", "https://s/b.png", "https://s/d.pdf"]);
  });
});

describe("retention setting", () => {
  it("is owner-only", async () => {
    await svc.setRetention("u1", "w1", 90);
    expect(m.findWorkspaceForUser).toHaveBeenCalledWith("u1", "w1", { ownerOnly: true });
    expect(m.workspace.update).toHaveBeenCalledWith({ where: { id: "w1" }, data: { retentionDays: 90 } });
  });
});

describe("consent log", () => {
  it("rejects consent dated in the future and brands from another workspace", async () => {
    await expect(svc.addConsent("u1", "w1", { subject: "@a", kind: "ugc_repost", grantedAt: "2099-01-01T00:00:00.000Z" })).rejects.toMatchObject({ statusCode: 400 });
    m.brand.findFirst.mockResolvedValue(null);
    await expect(svc.addConsent("u1", "w1", { subject: "@a", kind: "ugc_repost", brandId: "b-other" })).rejects.toMatchObject({ statusCode: 400 });
    expect(m.consentRecord.create).not.toHaveBeenCalled();
  });

  it("records who added it and revokes by stamping, never deleting", async () => {
    m.consentRecord.create.mockResolvedValue({
      id: "c1", workspaceId: "w1", brandId: null, subject: "@a", kind: "ugc_repost", scope: null, evidenceUrl: null,
      grantedAt: new Date(), revokedAt: null, createdAt: new Date(),
    });
    await svc.addConsent("u1", "w1", { subject: "@a", kind: "ugc_repost" });
    expect(m.consentRecord.create.mock.calls[0]![0].data).toMatchObject({ workspaceId: "w1", createdBy: "u1", subject: "@a" });

    m.consentRecord.updateMany.mockResolvedValue({ count: 1 });
    m.consentRecord.findUniqueOrThrow.mockResolvedValue({
      id: "c1", workspaceId: "w1", brandId: null, subject: "@a", kind: "ugc_repost", scope: null, evidenceUrl: null,
      grantedAt: new Date(), revokedAt: new Date(), createdAt: new Date(),
    });
    const r = await svc.revokeConsent("u1", "w1", "c1");
    expect(r.revokedAt).not.toBeNull();
    expect(m.consentRecord.updateMany.mock.calls[0]![0].where).toEqual({ id: "c1", workspaceId: "w1", revokedAt: null });
  });

  it("404s for an unknown consent id", async () => {
    m.consentRecord.updateMany.mockResolvedValue({ count: 0 });
    m.consentRecord.findFirst.mockResolvedValue(null);
    await expect(svc.revokeConsent("u1", "w1", "nope")).rejects.toMatchObject({ statusCode: 404 });
  });
});
