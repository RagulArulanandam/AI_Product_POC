import { describe, expect, it } from "vitest";
import { createOAuthState, verifyOAuthState } from "@/lib/oauth-state";

const BUSINESS = "11111111-1111-4111-8111-111111111111";

describe("OAuth state", () => {
  it("accepts the nonce Google sends back for the same business", () => {
    const { nonce, cookie } = createOAuthState(BUSINESS);
    expect(verifyOAuthState(cookie, nonce, BUSINESS)).toBe(true);
  });

  it("makes a new nonce every time", () => {
    expect(createOAuthState(BUSINESS).nonce).not.toBe(createOAuthState(BUSINESS).nonce);
  });

  it("rejects a different nonce, a missing cookie or a missing state", () => {
    const { nonce, cookie } = createOAuthState(BUSINESS);
    expect(verifyOAuthState(cookie, `${nonce}x`, BUSINESS)).toBe(false);
    expect(verifyOAuthState(cookie, createOAuthState(BUSINESS).nonce, BUSINESS)).toBe(false);
    expect(verifyOAuthState(undefined, nonce, BUSINESS)).toBe(false);
    expect(verifyOAuthState(cookie, null, BUSINESS)).toBe(false);
    expect(verifyOAuthState(cookie, "", BUSINESS)).toBe(false);
  });

  it("rejects it when the signed-in business is not the one that started the flow", () => {
    const { nonce, cookie } = createOAuthState(BUSINESS);
    expect(verifyOAuthState(cookie, nonce, "22222222-2222-4222-8222-222222222222")).toBe(false);
  });

  it("rejects a cookie that is not valid or has the wrong shape", () => {
    expect(verifyOAuthState("not json", "x", BUSINESS)).toBe(false);
    expect(verifyOAuthState(JSON.stringify({ nonce: 1, businessId: BUSINESS }), "1", BUSINESS)).toBe(false);
    expect(verifyOAuthState(JSON.stringify({}), "x", BUSINESS)).toBe(false);
    expect(verifyOAuthState(JSON.stringify(null), "x", BUSINESS)).toBe(false);
  });
});
