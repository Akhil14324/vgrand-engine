import { beforeEach, describe, expect, it, vi } from "vitest";
import { createReelPlanSchema, reelPlanItemSchema, type ReelScript } from "@catgpt/types";

const itemFindUnique = vi.fn();
const itemUpdate = vi.fn();
const projectFindUnique = vi.fn();
vi.mock("@catgpt/db", () => ({
  prisma: {
    reelPlanItem: {
      findUniqueOrThrow: (...a: unknown[]) => itemFindUnique(...a),
      update: (...a: unknown[]) => itemUpdate(...a),
    },
    videoProject: {
      findUnique: (...a: unknown[]) => projectFindUnique(...a),
    },
  },
}));

const createSocialPosts = vi.fn();
vi.mock("./social/posts.js", () => ({
  createSocialPosts: (...a: unknown[]) => createSocialPosts(...a),
}));

const { captionFor, schedulePlannedPost } = await import("./reel-approval.js");

const script: ReelScript = {
  title: "Teaser",
  hook: "Fresh every morning",
  cta: "Visit us today",
  shots: [],
};

const validItem = {
  title: "Monday teaser",
  brief: { goal: "Launch week teaser" },
  postAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
  accountIds: ["11111111-1111-4111-8111-111111111111"],
};

beforeEach(() => {
  itemFindUnique.mockReset();
  itemUpdate.mockReset().mockResolvedValue({});
  projectFindUnique.mockReset().mockResolvedValue({ script });
  createSocialPosts.mockReset().mockResolvedValue([]);
});

describe("captionFor", () => {
  it("uses the plan's own caption when there is one", () => {
    expect(captionFor({ caption: "Our weekend menu" }, script)).toBe("Our weekend menu");
  });

  it("falls back to the script's hook and call to action", () => {
    expect(captionFor({ caption: null }, script)).toBe("Fresh every morning\n\nVisit us today");
  });

  it("is empty when there's no script and no caption", () => {
    expect(captionFor({ caption: null }, null)).toBe("");
  });
});

describe("plan request validation", () => {
  it("accepts an item and fills in the brief defaults", () => {
    const parsed = reelPlanItemSchema.parse(validItem);
    expect(parsed.brief.durationSec).toBe(15);
    expect(parsed.brief.videoModel).toBe("veo-3.1-lite");
    expect(parsed.caption).toBeNull();
    expect(parsed.folderId).toBeNull();
  });

  it("refuses a plan with no accounts", () => {
    expect(reelPlanItemSchema.safeParse({ ...validItem, accountIds: [] }).success).toBe(false);
  });

  it("refuses more than five accounts for one reel", () => {
    const accountIds = Array.from({ length: 6 }, (_, i) => `00000000-0000-4000-8000-00000000000${i}`);
    expect(reelPlanItemSchema.safeParse({ ...validItem, accountIds }).success).toBe(false);
  });

  it("refuses a post time that isn't an ISO timestamp", () => {
    expect(reelPlanItemSchema.safeParse({ ...validItem, postAt: "next Monday" }).success).toBe(false);
  });

  it("caps a plan at 31 reels", () => {
    const items = Array.from({ length: 32 }, () => validItem);
    expect(createReelPlanSchema.safeParse({ brandId: "22222222-2222-4222-8222-222222222222", items }).success).toBe(false);
  });
});

describe("schedulePlannedPost", () => {
  it("never posts a reel whose planned time has already passed", async () => {
    itemFindUnique.mockResolvedValue({
      id: "item-1",
      userId: "u1",
      projectId: "p1",
      generationId: "g1",
      caption: null,
      accountIds: ["a1"],
      postAt: new Date(Date.now() - 60 * 60 * 1000),
    });

    const result = await schedulePlannedPost("item-1");

    expect(createSocialPosts).not.toHaveBeenCalled();
    expect(result.postQueued).toBe(false);
    expect(result.postError).toMatch(/already passed/);
    expect(itemUpdate).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ error: expect.stringMatching(/already passed/) }) }),
    );
  });

  it("queues the post at the planned time on the plan's accounts", async () => {
    const postAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    itemFindUnique.mockResolvedValue({
      id: "item-2",
      userId: "u1",
      projectId: "p1",
      generationId: "g2",
      caption: "Weekend menu",
      accountIds: ["a1", "a2"],
      postAt,
    });

    const result = await schedulePlannedPost("item-2");

    expect(result.postQueued).toBe(true);
    expect(createSocialPosts).toHaveBeenCalledWith("u1", "g2", {
      posts: [
        { accountId: "a1", content: { caption: "Weekend menu" } },
        { accountId: "a2", content: { caption: "Weekend menu" } },
      ],
      scheduledFor: postAt.toISOString(),
    });
    expect(itemUpdate).toHaveBeenLastCalledWith({ where: { id: "item-2" }, data: { status: "posted", error: null } });
  });
});
