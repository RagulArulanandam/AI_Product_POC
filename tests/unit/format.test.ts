import { describe, expect, it } from "vitest";
import { formatDate, formatDateTime, timeAgo } from "@/lib/format";

const NOW = new Date("2026-10-28T12:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe("timeAgo", () => {
  it.each([
    [10_000, "just now"],
    [44_000, "just now"],
    [2 * MIN, "2 minutes ago"],
    [MIN, "1 minute ago"],
    [59 * MIN, "59 minutes ago"],
    [HOUR, "1 hour ago"],
    [5 * HOUR, "5 hours ago"],
    [23 * HOUR, "23 hours ago"],
    [DAY, "yesterday"],
    [3 * DAY, "3 days ago"],
  ])("says %s ms ago as %j", (ms, expected) => {
    expect(timeAgo(ago(ms), NOW, "Europe/London")).toBe(expected);
  });

  it("falls back to a date after a week", () => {
    expect(timeAgo(ago(10 * DAY), NOW, "Europe/London")).toBe("18 October 2026");
  });

  it("accepts ISO strings", () => {
    expect(timeAgo("2026-10-28T11:55:00Z", NOW, "Europe/London")).toBe("5 minutes ago");
  });
});

describe("formatDateTime and formatDate", () => {
  it("formats in the business timezone", () => {
    // 28 Oct 2026 14:30 UTC is 14:30 GMT in London and 15:30 in Paris.
    expect(formatDateTime("2026-10-28T14:30:00Z", "Europe/London")).toBe("28 Oct 2026, 14:30");
    expect(formatDateTime("2026-10-28T14:30:00Z", "Europe/Paris")).toBe("28 Oct 2026, 15:30");
  });

  it("follows daylight saving", () => {
    expect(formatDateTime("2026-07-01T12:00:00Z", "Europe/London")).toBe("1 Jul 2026, 13:00");
  });

  it("can roll the date over with the timezone", () => {
    expect(formatDate("2026-10-28T23:30:00Z", "Europe/London")).toBe("28 October 2026");
    expect(formatDate("2026-10-28T23:30:00Z", "Asia/Tokyo")).toBe("29 October 2026");
  });
});
