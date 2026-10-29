import { describe, expect, it } from "vitest";
import nextConfig, { SECURITY_HEADERS } from "../../next.config";

describe("security headers", () => {
  it("applies to every route", async () => {
    const rules = await nextConfig.headers!();
    expect(rules).toEqual([{ source: "/:path*", headers: SECURITY_HEADERS }]);
  });

  it("stops framing, content sniffing and referrer leaks", () => {
    const byKey = Object.fromEntries(SECURITY_HEADERS.map((h) => [h.key, h.value]));
    expect(byKey["X-Frame-Options"]).toBe("DENY");
    expect(byKey["X-Content-Type-Options"]).toBe("nosniff");
    expect(byKey["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(byKey["Permissions-Policy"]).toContain("camera=()");
    expect(byKey["Strict-Transport-Security"]).toMatch(/max-age=\d+/);
  });
});
