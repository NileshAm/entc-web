import { describe, expect, it } from "vitest";
import { normalizeSiteUrl } from "../lib/env";

describe("site URL normalization", () => {
  it("upgrades deployed origins to HTTPS", () => {
    expect(normalizeSiteUrl("http://bid.nilesh.uk/anything")).toBe(
      "https://bid.nilesh.uk",
    );
  });

  it("keeps HTTP for localhost development", () => {
    expect(normalizeSiteUrl("http://localhost:3000/")).toBe(
      "http://localhost:3000",
    );
  });

  it("adds HTTPS when the scheme is omitted", () => {
    expect(normalizeSiteUrl("bid.nilesh.uk")).toBe("https://bid.nilesh.uk");
  });

  it("rejects unsupported URL schemes", () => {
    expect(() => normalizeSiteUrl("javascript:alert(1)")).toThrow(
      "must use HTTP or HTTPS",
    );
  });
});
