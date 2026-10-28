import { describe, expect, it } from "vitest";
import { safeNextPath } from "@/lib/auth/safe-next";

describe("safeNextPath", () => {
  it("keeps same-origin paths and query strings", () => {
    expect(safeNextPath("/products")).toBe("/products");
    expect(safeNextPath("/conversations?state=escalated")).toBe("/conversations?state=escalated");
  });

  it("falls back for missing or empty input", () => {
    expect(safeNextPath(null)).toBe("/dashboard");
    expect(safeNextPath(undefined)).toBe("/dashboard");
    expect(safeNextPath("")).toBe("/dashboard");
  });

  it("rejects external and protocol-relative URLs", () => {
    expect(safeNextPath("https://evil.example/phish")).toBe("/dashboard");
    expect(safeNextPath("//evil.example")).toBe("/dashboard");
    expect(safeNextPath("/\\evil.example")).toBe("/dashboard");
    expect(safeNextPath("javascript:alert(1)")).toBe("/dashboard");
  });

  it("rejects control characters and login loops", () => {
    expect(safeNextPath("/ok\r\nSet-Cookie: x=1")).toBe("/dashboard");
    expect(safeNextPath("/login")).toBe("/dashboard");
    expect(safeNextPath("/signup")).toBe("/dashboard");
  });

  it("uses a custom fallback", () => {
    expect(safeNextPath("https://evil.example", "/onboarding")).toBe("/onboarding");
  });
});
