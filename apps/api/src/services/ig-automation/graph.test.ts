import { afterEach, describe, expect, it, vi } from "vitest";
import { GraphError, endpoints, subscribePage } from "./graph.js";

const base = endpoints.base;

/** Fake fetch that answers each POST /subscribed_apps from a queue and records the fields asked for. */
function fakeMeta(answers: { status: number; body: unknown }[]) {
  const asked: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL) => {
      asked.push(new URL(String(input)).searchParams.get("subscribed_fields") ?? "");
      const a = answers.shift() ?? { status: 500, body: {} };
      return new Response(JSON.stringify(a.body), { status: a.status, headers: { "content-type": "application/json" } });
    }),
  );
  return asked;
}

const pagesMessagingError = {
  status: 400,
  body: { error: { code: 200, message: "(#200) To subscribe to the messages field, one of these permissions is needed: pages_messaging" } },
};

describe("subscribePage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    endpoints.base = base;
  });

  it("subscribes with every field when Meta accepts them", async () => {
    endpoints.base = () => "https://graph.test";
    const asked = fakeMeta([{ status: 200, body: { success: true } }]);
    await expect(subscribePage("T", "P1")).resolves.toEqual(["feed", "messages", "messaging_postbacks"]);
    expect(asked).toEqual(["feed,messages,messaging_postbacks"]);
  });

  it("falls back to feed when the messages field needs pages_messaging (#200)", async () => {
    endpoints.base = () => "https://graph.test";
    const asked = fakeMeta([pagesMessagingError, { status: 200, body: { success: true } }]);
    await expect(subscribePage("T", "P1")).resolves.toEqual(["feed"]);
    expect(asked).toEqual(["feed,messages,messaging_postbacks", "feed"]);
  });

  it("throws the feed error when feed is refused too", async () => {
    endpoints.base = () => "https://graph.test";
    fakeMeta([
      pagesMessagingError,
      { status: 400, body: { error: { code: 200, message: "(#200) Requires pages_manage_metadata permission to manage the object" } } },
    ]);
    const err = await subscribePage("T", "P1").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GraphError);
    expect((err as GraphError).message).toContain("pages_manage_metadata");
  });

  it("does not retry on an expired token", async () => {
    endpoints.base = () => "https://graph.test";
    const asked = fakeMeta([{ status: 400, body: { error: { code: 190, message: "Error validating access token" } } }]);
    await expect(subscribePage("T", "P1")).rejects.toMatchObject({ kind: "auth" });
    expect(asked).toHaveLength(1);
  });
});
