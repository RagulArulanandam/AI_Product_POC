import { describe, expect, it } from "vitest";
import { scanText } from "../../scripts/check-secrets";

describe("check-secrets scanText", () => {
  it("flags credential-looking strings", () => {
    expect(scanText("key=sk-" + "a".repeat(30))).toContain("OpenAI key");
    expect(scanText("sid=AC" + "0123456789abcdef".repeat(2))).toContain("Twilio account SID");
    expect(scanText("sb_secret_" + "x".repeat(20))).toContain("Supabase secret key");
    expect(scanText("-----BEGIN PRIVATE KEY-----")).toContain("Private key block");
  });

  it("ignores ordinary text and variable names", () => {
    expect(scanText("OPENAI_API_KEY= and TWILIO_AUTH_TOKEN=")).toEqual([]);
    expect(scanText("just some prose about sk learners")).toEqual([]);
  });
});
