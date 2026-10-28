import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getPublicEnv, getServerEnv, getWorkerSecret } from "@/lib/env";

const KEYS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "APP_BASE_URL",
  "WORKER_SECRET",
] as const;

describe("env", () => {
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

  it("rejects missing public vars", () => {
    expect(() => getPublicEnv()).toThrow();
  });

  it("rejects a malformed Supabase URL", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "not-a-url";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
    expect(() => getPublicEnv()).toThrow();
  });

  it("returns public vars when valid", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
    expect(getPublicEnv().NEXT_PUBLIC_SUPABASE_URL).toBe("http://127.0.0.1:54321");
  });

  it("requires a worker secret of at least 16 characters", () => {
    expect(() => getWorkerSecret()).toThrow();
    process.env.WORKER_SECRET = "too-short";
    expect(() => getWorkerSecret()).toThrow();
    process.env.WORKER_SECRET = "a-long-enough-secret";
    expect(getWorkerSecret()).toBe("a-long-enough-secret");
  });

  it("requires the service role key and defaults APP_BASE_URL", () => {
    expect(() => getServerEnv()).toThrow();
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
    expect(getServerEnv().APP_BASE_URL).toBe("http://localhost:3000");
  });
});
