import { describe, expect, it } from "vitest";
import { BACKOFF_MINUTES, nextRunAt } from "@/engine/backoff";
import { AdapterError, AppError } from "@/lib/errors";

describe("nextRunAt", () => {
  const now = new Date("2026-10-28T12:00:00Z");

  it("waits 1, 5 and 15 minutes after the first three failures", () => {
    expect(nextRunAt(1, now).toISOString()).toBe("2026-10-28T12:01:00.000Z");
    expect(nextRunAt(2, now).toISOString()).toBe("2026-10-28T12:05:00.000Z");
    expect(nextRunAt(3, now).toISOString()).toBe("2026-10-28T12:15:00.000Z");
    expect(BACKOFF_MINUTES).toEqual([1, 5, 15]);
  });

  it("clamps out-of-range attempt counts", () => {
    expect(nextRunAt(0, now).toISOString()).toBe("2026-10-28T12:01:00.000Z");
    expect(nextRunAt(99, now).toISOString()).toBe("2026-10-28T12:15:00.000Z");
  });

  it("does not modify the date it was given", () => {
    nextRunAt(1, now);
    expect(now.toISOString()).toBe("2026-10-28T12:00:00.000Z");
  });
});

describe("AdapterError", () => {
  it("marks transient codes as retryable and the rest as not", () => {
    for (const code of ["rate_limited", "provider_unavailable", "unknown"] as const) {
      expect(new AdapterError(code, "x").retryable, code).toBe(true);
    }
    for (const code of ["auth", "invalid_request", "not_found", "invalid_output", "unreachable_recipient", "outside_window"] as const) {
      expect(new AdapterError(code, "x").retryable, code).toBe(false);
    }
  });

  it("allows an explicit override and keeps the cause", () => {
    const cause = new Error("boom");
    const err = new AdapterError("auth", "nope", { retryable: true, cause });
    expect(err.retryable).toBe(true);
    expect(err.cause).toBe(cause);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("AdapterError");
  });
});

describe("AppError", () => {
  it("carries a code and HTTP status", () => {
    const err = new AppError("forbidden", "No access", 403);
    expect(err).toMatchObject({ code: "forbidden", status: 403, message: "No access" });
    expect(new AppError("x", "y").status).toBe(400);
  });
});
