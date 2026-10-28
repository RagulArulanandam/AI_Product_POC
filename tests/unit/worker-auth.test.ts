import { describe, expect, it } from "vitest";
import { isAuthorized } from "@/engine/worker-auth";

const SECRET = "a-long-enough-worker-secret-1234";

describe("isAuthorized", () => {
  it("accepts the right bearer token", () => {
    expect(isAuthorized(`Bearer ${SECRET}`, SECRET)).toBe(true);
  });

  it("rejects a missing or empty header", () => {
    expect(isAuthorized(null, SECRET)).toBe(false);
    expect(isAuthorized(undefined, SECRET)).toBe(false);
    expect(isAuthorized("", SECRET)).toBe(false);
  });

  it("rejects the wrong token, whatever its length", () => {
    expect(isAuthorized(`Bearer ${SECRET}x`, SECRET)).toBe(false);
    expect(isAuthorized(`Bearer ${SECRET.slice(0, -1)}`, SECRET)).toBe(false);
    expect(isAuthorized("Bearer nope", SECRET)).toBe(false);
    expect(isAuthorized(`Bearer ${"x".repeat(5000)}`, SECRET)).toBe(false);
  });

  it("rejects other schemes, casing and spacing", () => {
    expect(isAuthorized(SECRET, SECRET)).toBe(false);
    expect(isAuthorized(`Basic ${SECRET}`, SECRET)).toBe(false);
    expect(isAuthorized(`bearer ${SECRET}`, SECRET)).toBe(false);
    expect(isAuthorized(`Bearer  ${SECRET}`, SECRET)).toBe(false);
    expect(isAuthorized("Bearer ", SECRET)).toBe(false);
  });

  it("never authorises when no secret is configured", () => {
    expect(isAuthorized("Bearer ", "")).toBe(false);
    expect(isAuthorized("Bearer anything", "")).toBe(false);
  });
});
