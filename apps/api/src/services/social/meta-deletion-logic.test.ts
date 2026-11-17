import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseMetaSignedRequest } from "./meta-deletion-logic.js";

const b64url = (b: Buffer | string) =>
  Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function sign(payload: object, secret: string) {
  const p = b64url(JSON.stringify(payload));
  const sig = b64url(createHmac("sha256", secret).update(p).digest());
  return `${sig}.${p}`;
}

describe("parseMetaSignedRequest", () => {
  it("accepts a correctly signed request", () => {
    const sr = sign({ algorithm: "HMAC-SHA256", user_id: "1234567890" }, "secret");
    expect(parseMetaSignedRequest(sr, "secret")).toEqual({ userId: "1234567890" });
  });

  it("rejects a wrong secret", () => {
    const sr = sign({ algorithm: "HMAC-SHA256", user_id: "1" }, "secret");
    expect(parseMetaSignedRequest(sr, "other")).toBeNull();
  });

  it("rejects a tampered payload", () => {
    const sr = sign({ algorithm: "HMAC-SHA256", user_id: "1" }, "secret");
    const [sig] = sr.split(".");
    const forged = `${sig}.${b64url(JSON.stringify({ algorithm: "HMAC-SHA256", user_id: "2" }))}`;
    expect(parseMetaSignedRequest(forged, "secret")).toBeNull();
  });

  it("rejects malformed input and non-numeric user ids", () => {
    expect(parseMetaSignedRequest(undefined, "secret")).toBeNull();
    expect(parseMetaSignedRequest("nodot", "secret")).toBeNull();
    expect(parseMetaSignedRequest("a.b.c", "secret")).toBeNull();
    expect(
      parseMetaSignedRequest(sign({ algorithm: "HMAC-SHA256", user_id: "abc" }, "secret"), "secret"),
    ).toBeNull();
  });

  it("rejects an unexpected algorithm", () => {
    expect(
      parseMetaSignedRequest(sign({ algorithm: "none", user_id: "1" }, "secret"), "secret"),
    ).toBeNull();
  });
});
