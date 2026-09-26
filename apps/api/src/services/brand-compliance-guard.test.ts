import { beforeEach, describe, expect, it, vi } from "vitest";

const findBrand = vi.fn();
const createCheck = vi.fn();
vi.mock("@catgpt/db", () => ({
  prisma: { brand: { findUnique: findBrand }, complianceCheck: { create: createCheck } },
  Prisma: { JsonNull: null },
}));

const { enforceBrandRulesOnPosts } = await import("./brand-compliance.js");
const gen = { id: "g1", brandId: "b1", metadata: null };

beforeEach(() => {
  findBrand.mockReset();
  createCheck.mockReset();
  findBrand.mockResolvedValue({ profile: { forbiddenWords: ["cheap"], forbiddenClaims: ["cures diseases"] } });
});

describe("enforceBrandRulesOnPosts", () => {
  it("lets clean copy through without recording anything", async () => {
    await expect(enforceBrandRulesOnPosts("u1", gen, [{ caption: "Fresh juice today" }], false)).resolves.toBeUndefined();
    expect(createCheck).not.toHaveBeenCalled();
  });

  it("blocks a forbidden word with a 409 COMPLIANCE_BLOCKED and structured findings", async () => {
    const err = await enforceBrandRulesOnPosts("u1", gen, [{ caption: "So cheap!" }], false).catch((e) => e);
    expect(err).toMatchObject({ statusCode: 409, code: "COMPLIANCE_BLOCKED" });
    expect((err.details as { findings: { id: string }[] }).findings.map((f) => f.id)).toEqual(["forbidden_words"]);
    expect(createCheck).not.toHaveBeenCalled();
  });

  it("checks hashtags, titles and descriptions too, not just the caption", async () => {
    await expect(enforceBrandRulesOnPosts("u1", gen, [{ caption: "ok", hashtags: ["cheap"] }], false)).rejects.toMatchObject({ code: "COMPLIANCE_BLOCKED" });
    await expect(enforceBrandRulesOnPosts("u1", gen, [{ title: "t", description: "It cures diseases" }], false)).rejects.toMatchObject({ code: "COMPLIANCE_BLOCKED" });
  });

  it("allows an override and records it against the brand", async () => {
    await enforceBrandRulesOnPosts("u1", gen, [{ caption: "So cheap!" }], true);
    expect(createCheck).toHaveBeenCalledTimes(1);
    expect(createCheck.mock.calls[0]![0].data).toMatchObject({ brandId: "b1", generationId: "g1", userId: "u1", status: "blocked", overridden: true });
  });

  it("does nothing for generations that have no brand", async () => {
    await enforceBrandRulesOnPosts("u1", { id: "g2", brandId: null, metadata: null }, [{ caption: "So cheap!" }], false);
    expect(findBrand).not.toHaveBeenCalled();
  });

  it("falls back to metadata.brandId for older generations", async () => {
    await expect(
      enforceBrandRulesOnPosts("u1", { id: "g3", brandId: null, metadata: { brandId: "b9" } }, [{ caption: "cheap" }], false),
    ).rejects.toMatchObject({ code: "COMPLIANCE_BLOCKED" });
    expect(findBrand).toHaveBeenCalledWith({ where: { id: "b9" }, select: { profile: true } });
  });
});
