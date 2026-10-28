import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getTwilioEnv } from "@/lib/env";

const KEYS = [
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_WHATSAPP_FROM",
  "TWILIO_VOICE_NUMBER",
  "TWILIO_TRIAL_CONTENT_SID",
] as const;

// Obviously fake values that still match the formats.
const GOOD = {
  TWILIO_ACCOUNT_SID: `AC${"0".repeat(32)}`,
  TWILIO_AUTH_TOKEN: "0123456789abcdef0123",
  TWILIO_WHATSAPP_FROM: "whatsapp:+447700900001",
  TWILIO_VOICE_NUMBER: "+447700900002",
};

describe("getTwilioEnv", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("requires the account, token and numbers", () => {
    expect(() => getTwilioEnv()).toThrow();
    Object.assign(process.env, GOOD);
    expect(getTwilioEnv().TWILIO_WHATSAPP_FROM).toBe("whatsapp:+447700900001");
  });

  it("rejects malformed values", () => {
    Object.assign(process.env, GOOD, { TWILIO_WHATSAPP_FROM: "+447700900001" });
    expect(() => getTwilioEnv()).toThrow();
    Object.assign(process.env, GOOD, { TWILIO_ACCOUNT_SID: "nope" });
    expect(() => getTwilioEnv()).toThrow();
  });

  it("treats the trial template as optional, and validates it when present", () => {
    Object.assign(process.env, GOOD);
    expect(getTwilioEnv().TWILIO_TRIAL_CONTENT_SID).toBeUndefined();

    process.env.TWILIO_TRIAL_CONTENT_SID = "";
    expect(getTwilioEnv().TWILIO_TRIAL_CONTENT_SID).toBeUndefined();

    process.env.TWILIO_TRIAL_CONTENT_SID = `HX${"a".repeat(32)}`;
    expect(getTwilioEnv().TWILIO_TRIAL_CONTENT_SID).toBe(`HX${"a".repeat(32)}`);

    process.env.TWILIO_TRIAL_CONTENT_SID = "HXshort";
    expect(() => getTwilioEnv()).toThrow();
  });
});
