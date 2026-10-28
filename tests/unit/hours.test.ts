import { describe, expect, it } from "vitest";
import { isOpenAt, localTime, parseHours } from "@/products/missed-call/hours";
import { DEFAULT_BUSINESS_HOURS, type BusinessHours } from "@/lib/validation/hours";

const LONDON = "Europe/London";
const at = (iso: string) => new Date(iso);

describe("localTime", () => {
  it("reads the weekday and minutes in the business timezone", () => {
    // Monday 2026-10-26 10:30 UTC is 10:30 GMT in London (clocks went back on 25 October).
    expect(localTime(at("2026-10-26T10:30:00Z"), LONDON)).toEqual({ day: "mon", minutes: 630 });
    // The same instant in New York is 06:30 EDT... still Monday.
    expect(localTime(at("2026-10-26T10:30:00Z"), "America/New_York")).toEqual({ day: "mon", minutes: 6 * 60 + 30 });
  });

  it("rolls over to the next local day", () => {
    // 23:30 UTC Sunday is already Monday 00:30 in Berlin? (CET, UTC+1 after the change.)
    expect(localTime(at("2026-10-25T23:30:00Z"), "Europe/Berlin")).toEqual({ day: "mon", minutes: 30 });
  });

  it("reports midnight as 00:00, never 24:00", () => {
    expect(localTime(at("2026-10-26T00:00:00Z"), LONDON).minutes).toBe(0);
  });
});

describe("isOpenAt (Mon-Fri 09:00-17:00 London)", () => {
  const open = (iso: string) => isOpenAt(DEFAULT_BUSINESS_HOURS, LONDON, at(iso));

  it("is open during the day and closed at night", () => {
    expect(open("2026-10-26T12:00:00Z")).toBe(true);
    expect(open("2026-10-26T20:00:00Z")).toBe(false);
    expect(open("2026-10-26T03:00:00Z")).toBe(false);
  });

  it("opens at exactly opening time and closes at exactly closing time", () => {
    expect(open("2026-10-26T08:59:00Z")).toBe(false);
    expect(open("2026-10-26T09:00:00Z")).toBe(true);
    expect(open("2026-10-26T16:59:00Z")).toBe(true);
    expect(open("2026-10-26T17:00:00Z")).toBe(false);
  });

  it("is closed on weekends", () => {
    expect(open("2026-10-24T12:00:00Z")).toBe(false); // Saturday
    expect(open("2026-10-25T12:00:00Z")).toBe(false); // Sunday
  });

  it("follows local time across the clock change on 25 October 2026 (BST ends)", () => {
    // Friday 23 Oct, still BST (UTC+1): 08:30 UTC = 09:30 local, open; 07:30 UTC = 08:30 local, closed.
    expect(open("2026-10-23T08:30:00Z")).toBe(true);
    expect(open("2026-10-23T07:30:00Z")).toBe(false);
    // Monday 26 Oct, GMT (UTC+0): 08:30 UTC = 08:30 local, closed; 09:30 UTC = 09:30 local, open.
    expect(open("2026-10-26T08:30:00Z")).toBe(false);
    expect(open("2026-10-26T09:30:00Z")).toBe(true);
    // 16:30 UTC is 17:30 local before the change (closed) but 16:30 local after it (open).
    expect(open("2026-10-23T16:30:00Z")).toBe(false);
    expect(open("2026-10-26T16:30:00Z")).toBe(true);
  });

  it("follows local time across the spring change on 29 March 2026 (BST starts)", () => {
    // Friday 27 March GMT: 16:30 UTC = 16:30 local, open. Monday 30 March BST: 16:30 UTC = 17:30 local, closed.
    expect(open("2026-03-27T16:30:00Z")).toBe(true);
    expect(open("2026-03-30T16:30:00Z")).toBe(false);
  });

  it("uses the business timezone, not the server's", () => {
    // 12:00 UTC Monday is 08:00 in New York (closed) but 12:00 in London (open).
    expect(isOpenAt(DEFAULT_BUSINESS_HOURS, "America/New_York", at("2026-10-26T12:00:00Z"))).toBe(false);
    expect(isOpenAt(DEFAULT_BUSINESS_HOURS, LONDON, at("2026-10-26T12:00:00Z"))).toBe(true);
  });

  it("handles split days and per-day hours", () => {
    const hours: BusinessHours = { ...DEFAULT_BUSINESS_HOURS, sat: { open: "10:00", close: "14:00" }, mon: null };
    expect(isOpenAt(hours, LONDON, at("2026-10-24T11:00:00Z"))).toBe(true); // Saturday
    expect(isOpenAt(hours, LONDON, at("2026-10-24T15:00:00Z"))).toBe(false);
    expect(isOpenAt(hours, LONDON, at("2026-10-26T12:00:00Z"))).toBe(false); // Monday closed
  });
});

describe("parseHours", () => {
  it("accepts valid hours and falls back to the defaults for malformed data", () => {
    expect(parseHours(DEFAULT_BUSINESS_HOURS)).toEqual(DEFAULT_BUSINESS_HOURS);
    expect(parseHours({ mon: "nope" })).toEqual(DEFAULT_BUSINESS_HOURS);
    expect(parseHours(null)).toEqual(DEFAULT_BUSINESS_HOURS);
  });
});
