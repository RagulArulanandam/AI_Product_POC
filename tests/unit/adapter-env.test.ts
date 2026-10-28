import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getAdapterMode, getOpenAiEnv, getResendEnv } from "@/lib/env";

const KEYS = [
  "ADAPTER_MODE",
  "MESSAGING_ADAPTER",
  "LLM_ADAPTER",
  "EMAIL_ADAPTER",
  "CALENDAR_ADAPTER",
  "OPENAI_API_KEY",
  "OPENAI_MODEL",
  "RESEND_API_KEY",
  "RESEND_FROM_EMAIL",
] as const;

describe("adapter env", () => {
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

  describe("getAdapterMode", () => {
    it("defaults to real", () => {
      expect(getAdapterMode()).toBe("real");
      expect(getAdapterMode("llm")).toBe("real");
    });

    it("uses ADAPTER_MODE for every adapter", () => {
      process.env.ADAPTER_MODE = "fake";
      for (const kind of ["messaging", "llm", "email", "calendar"] as const) expect(getAdapterMode(kind)).toBe("fake");
    });

    it("lets one adapter override the default, and only that one", () => {
      process.env.ADAPTER_MODE = "real";
      process.env.MESSAGING_ADAPTER = "fake";
      expect(getAdapterMode("messaging")).toBe("fake");
      expect(getAdapterMode("llm")).toBe("real");
      expect(getAdapterMode("email")).toBe("real");

      process.env.ADAPTER_MODE = "fake";
      process.env.LLM_ADAPTER = "real";
      expect(getAdapterMode("llm")).toBe("real");
      expect(getAdapterMode("email")).toBe("fake");
    });

    it("treats empty values as unset and rejects unknown ones", () => {
      process.env.ADAPTER_MODE = "";
      expect(getAdapterMode()).toBe("real");
      process.env.LLM_ADAPTER = "maybe";
      expect(() => getAdapterMode("llm")).toThrow();
    });
  });

  describe("getOpenAiEnv", () => {
    it("requires a key and a model name, and never invents a model", () => {
      expect(() => getOpenAiEnv()).toThrow();
      process.env.OPENAI_API_KEY = "k".repeat(30);
      expect(() => getOpenAiEnv()).toThrow(); // no model
      process.env.OPENAI_MODEL = "some-model";
      expect(getOpenAiEnv()).toEqual({ OPENAI_API_KEY: "k".repeat(30), OPENAI_MODEL: "some-model" });
    });

    it("rejects a too-short key", () => {
      process.env.OPENAI_API_KEY = "short";
      process.env.OPENAI_MODEL = "m";
      expect(() => getOpenAiEnv()).toThrow();
    });
  });

  describe("getResendEnv", () => {
    it("requires a re_ key and a from address", () => {
      expect(() => getResendEnv()).toThrow();
      process.env.RESEND_API_KEY = "not-a-resend-key";
      process.env.RESEND_FROM_EMAIL = "onboarding@resend.dev";
      expect(() => getResendEnv()).toThrow();
      process.env.RESEND_API_KEY = "re_abc123";
      expect(getResendEnv().RESEND_FROM_EMAIL).toBe("onboarding@resend.dev");
      delete process.env.RESEND_FROM_EMAIL;
      expect(() => getResendEnv()).toThrow();
    });
  });
});
