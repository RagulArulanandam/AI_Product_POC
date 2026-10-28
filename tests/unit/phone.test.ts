import { describe, expect, it } from "vitest";
import { formatPhone, toE164 } from "@/lib/phone";

describe("toE164", () => {
  it("normalises UK numbers typed in national format", () => {
    expect(toE164("07911 123456")).toBe("+447911123456");
    expect(toE164("020 7946 0958")).toBe("+442079460958");
  });

  it("accepts international format", () => {
    expect(toE164("+44 7911 123456")).toBe("+447911123456");
  });

  it("rejects invalid numbers", () => {
    expect(toE164("12345")).toBeNull();
    expect(toE164("not a number")).toBeNull();
    expect(toE164("")).toBeNull();
  });
});

describe("formatPhone", () => {
  it("shows UK numbers in national format", () => {
    expect(formatPhone("+447911123456")).toBe("07911 123456");
  });

  it("falls back to the raw value when unparseable", () => {
    expect(formatPhone("nope")).toBe("nope");
  });
});
