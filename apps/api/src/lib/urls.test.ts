import { describe, expect, it } from "vitest";
import { isTrustedImageUrl } from "./urls.js";

/**
 * The SSRF allowlist for server-fetched reference images. env is stubbed in
 * vitest.config.ts: SUPABASE_URL=https://test.supabase.co and
 * API_PUBLIC_URL=http://localhost:4000.
 */
describe("isTrustedImageUrl", () => {
  it("accepts public object URLs on the configured Supabase host", () => {
    expect(
      isTrustedImageUrl(
        "https://test.supabase.co/storage/v1/object/public/generated-images/g/u/img.png",
      ),
    ).toBe(true);
  });

  it("rejects non-storage paths on the Supabase host", () => {
    expect(isTrustedImageUrl("https://test.supabase.co/rest/v1/users")).toBe(
      false,
    );
    expect(isTrustedImageUrl("https://test.supabase.co/auth/v1/admin")).toBe(
      false,
    );
  });

  it("accepts /uploads/ URLs on this API's origin", () => {
    expect(
      isTrustedImageUrl("http://localhost:4000/uploads/refs/u/abc.png"),
    ).toBe(true);
  });

  it("rejects internal and metadata endpoints", () => {
    expect(
      isTrustedImageUrl("http://169.254.169.254/latest/meta-data"),
    ).toBe(false);
    expect(isTrustedImageUrl("http://127.0.0.1:4000/uploads/x.png")).toBe(
      false,
    );
    expect(isTrustedImageUrl("http://localhost:4000/internal/secret")).toBe(
      false,
    );
  });

  it("rejects non-http schemes and embedded credentials", () => {
    expect(isTrustedImageUrl("javascript:alert(1)")).toBe(false);
    expect(isTrustedImageUrl("file:///etc/passwd")).toBe(false);
    expect(isTrustedImageUrl("data:image/png;base64,AAAA")).toBe(false);
    expect(
      isTrustedImageUrl(
        "http://user:pass@test.supabase.co/storage/v1/object/public/b/k.png",
      ),
    ).toBe(false);
  });

  it("rejects malformed and empty URLs", () => {
    expect(isTrustedImageUrl("not a url")).toBe(false);
    expect(isTrustedImageUrl("")).toBe(false);
  });
});
