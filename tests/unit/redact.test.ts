import { describe, expect, it } from "vitest";
import { maskPhone, redact } from "@/lib/redact";

describe("redact", () => {
  it("hides values under sensitive keys, at any depth and case", () => {
    const out = redact({
      Authorization: "Bearer abc",
      nested: { access_token: "t", refreshToken: "r", api_key: "k", password: "p", ok: "fine" },
      list: [{ secret: "s" }],
    });
    expect(out).toEqual({
      Authorization: "[redacted]",
      nested: { access_token: "[redacted]", refreshToken: "[redacted]", api_key: "[redacted]", password: "[redacted]", ok: "fine" },
      list: [{ secret: "[redacted]" }],
    });
  });

  it("masks phone numbers to the last four digits", () => {
    expect(maskPhone("+447911123456")).toBe("+********3456");
    expect(redact("Call +447911123456 back")).toBe("Call +********3456 back");
    expect(redact({ note: "from +14155238886" })).toEqual({ note: "from +*******8886" });
  });

  it("scrubs bearer tokens and key-looking strings inside text", () => {
    expect(redact("header: Bearer abc.def-123")).toBe("header: Bearer [redacted]");
    expect(redact("key sk-abcdefghijklmnopqrstuvwxyz1234")).toBe("key [redacted]");
    expect(redact("sb_secret_abcdefghijklmnop")).toBe("[redacted]");
  });

  it("keeps primitives and converts dates and errors", () => {
    expect(redact(42)).toBe(42);
    expect(redact(true)).toBe(true);
    expect(redact(null)).toBeNull();
    expect(redact(undefined)).toBeUndefined();
    expect(redact(new Date("2026-10-28T12:00:00Z"))).toBe("2026-10-28T12:00:00.000Z");
    expect(redact(new Error("failed for +447911123456"))).toEqual({ name: "Error", message: "failed for +********3456" });
  });

  it("truncates long strings and deep structures", () => {
    const long = redact("x".repeat(600)) as string;
    expect(long.length).toBe(501);
    expect(long.endsWith("…")).toBe(true);

    let deep: Record<string, unknown> = { leaf: "value" };
    for (let i = 0; i < 10; i += 1) deep = { child: deep };
    expect(JSON.stringify(redact(deep))).toContain("[truncated]");
  });

  it("does not modify its input", () => {
    const input = { token: "secret", phone: "+447911123456" };
    redact(input);
    expect(input).toEqual({ token: "secret", phone: "+447911123456" });
  });
});
