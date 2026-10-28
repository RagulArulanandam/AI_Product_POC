import { describe, expect, it } from "vitest";
import { DEFAULT_BUSINESS_HOURS } from "@/lib/validation/hours";
import { computeSlots, formatSlot, isSlotAvailable, localDate, zonedToUtc, type SlotInput } from "@/products/missed-call/slots";

const TZ = "Europe/London";
// Wednesday 28 Oct 2026, 08:00 UK time (clocks went back on 25 Oct, so UK time is UTC).
const NOW = new Date("2026-10-28T08:00:00Z");

const base: SlotInput = {
  hours: DEFAULT_BUSINESS_HOURS,
  timezone: TZ,
  now: NOW,
  durationMinutes: 30,
  bufferMinutes: 0,
  busy: [],
};

const iso = (slots: { start: Date }[]) => slots.map((s) => s.start.toISOString());

describe("zonedToUtc", () => {
  it("converts wall-clock time in summer and winter", () => {
    expect(zonedToUtc("2026-07-01", 9 * 60, TZ)?.toISOString()).toBe("2026-07-01T08:00:00.000Z");
    expect(zonedToUtc("2026-12-01", 9 * 60, TZ)?.toISOString()).toBe("2026-12-01T09:00:00.000Z");
  });

  it("returns null for a time that does not exist when clocks go forward", () => {
    expect(zonedToUtc("2026-03-29", 90, TZ)).toBeNull();
    expect(zonedToUtc("2026-03-29", 120, TZ)?.toISOString()).toBe("2026-03-29T01:00:00.000Z");
  });

  it("works for zones ahead of UTC on the previous UTC day", () => {
    expect(zonedToUtc("2026-10-29", 30, "Asia/Tokyo")?.toISOString()).toBe("2026-10-28T15:30:00.000Z");
  });
});

describe("computeSlots", () => {
  it("offers the first free slot of each of the next days when no day is preferred", () => {
    // 08:00 now, 60 minutes notice: today's first slot is 09:00.
    expect(iso(computeSlots(base))).toEqual(["2026-10-28T09:00:00.000Z", "2026-10-29T09:00:00.000Z", "2026-10-30T09:00:00.000Z"]);
  });

  it("keeps to the notice period", () => {
    const slots = computeSlots({ ...base, now: new Date("2026-10-28T09:20:00Z") });
    expect(slots[0].start.toISOString()).toBe("2026-10-28T10:30:00.000Z");
  });

  it("skips closed days (weekend)", () => {
    // Friday 30 Oct afternoon, after hours: next weekday slots are Mon 2 Nov onwards.
    const slots = computeSlots({ ...base, now: new Date("2026-10-30T17:30:00Z") });
    expect(iso(slots)).toEqual(["2026-11-02T09:00:00.000Z", "2026-11-03T09:00:00.000Z", "2026-11-04T09:00:00.000Z"]);
  });

  it("never offers a slot that runs past closing time", () => {
    const hours = { ...DEFAULT_BUSINESS_HOURS, wed: { open: "09:00", close: "10:00" } };
    const slots = computeSlots({ ...base, hours, now: new Date("2026-10-28T00:00:00Z"), preferredDate: "2026-10-28", count: 10 });
    const wed = slots.filter((s) => s.start.toISOString().startsWith("2026-10-28"));
    expect(iso(wed)).toEqual(["2026-10-28T09:00:00.000Z", "2026-10-28T09:30:00.000Z"]);
  });

  it("avoids busy time and its buffer", () => {
    const busy = [{ start: new Date("2026-10-29T09:00:00Z"), end: new Date("2026-10-29T10:00:00Z") }];
    const noBuffer = computeSlots({ ...base, busy, preferredDate: "2026-10-29", count: 20 });
    expect(iso(noBuffer)).not.toContain("2026-10-29T09:00:00.000Z");
    expect(iso(noBuffer)).not.toContain("2026-10-29T09:30:00.000Z");
    expect(iso(noBuffer)).toContain("2026-10-29T10:00:00.000Z");

    const buffered = computeSlots({ ...base, busy, bufferMinutes: 30, preferredDate: "2026-10-29", count: 20 });
    expect(iso(buffered)).not.toContain("2026-10-29T10:00:00.000Z");
    expect(iso(buffered)).toContain("2026-10-29T10:30:00.000Z");
  });

  it("puts the preferred day first and spreads the offers through it", () => {
    const slots = computeSlots({ ...base, preferredDate: "2026-10-29" });
    expect(iso(slots)).toEqual(["2026-10-29T09:00:00.000Z", "2026-10-29T13:00:00.000Z", "2026-10-29T16:30:00.000Z"]);
  });

  it("chooses the times closest to the preferred time", () => {
    const slots = computeSlots({ ...base, preferredDate: "2026-10-29", preferredTime: "14:00" });
    expect(iso(slots)).toEqual(["2026-10-29T13:30:00.000Z", "2026-10-29T14:00:00.000Z", "2026-10-29T14:30:00.000Z"]);
  });

  it("fills up from later days when the preferred day is nearly full", () => {
    const busy = [{ start: new Date("2026-10-29T00:00:00Z"), end: new Date("2026-10-29T16:00:00Z") }];
    const slots = computeSlots({ ...base, busy, preferredDate: "2026-10-29" });
    expect(iso(slots)).toEqual(["2026-10-29T16:00:00.000Z", "2026-10-29T16:30:00.000Z", "2026-10-30T09:00:00.000Z"]);
  });

  it("ignores a preferred date in the past or in a bad format", () => {
    expect(iso(computeSlots({ ...base, preferredDate: "2026-10-01" }))).toEqual(iso(computeSlots(base)));
    expect(iso(computeSlots({ ...base, preferredDate: "next tuesday" }))).toEqual(iso(computeSlots(base)));
  });

  it("returns nothing when the business is never open or is fully booked", () => {
    const closed = Object.fromEntries(Object.keys(DEFAULT_BUSINESS_HOURS).map((d) => [d, null])) as unknown as SlotInput["hours"];
    expect(computeSlots({ ...base, hours: closed })).toEqual([]);
    const busy = [{ start: new Date("2026-10-28T00:00:00Z"), end: new Date("2026-12-31T00:00:00Z") }];
    expect(computeSlots({ ...base, busy })).toEqual([]);
  });

  it("uses the business timezone for opening hours, including summer time", () => {
    const slots = computeSlots({ ...base, now: new Date("2026-07-01T00:00:00Z"), preferredDate: "2026-07-01", count: 1 });
    expect(iso(slots)).toEqual(["2026-07-01T08:00:00.000Z"]);
  });

  it("gives slots the length of the appointment", () => {
    const [slot] = computeSlots({ ...base, durationMinutes: 45, count: 1 });
    expect(slot.end.getTime() - slot.start.getTime()).toBe(45 * 60_000);
  });
});

describe("isSlotAvailable", () => {
  const slot = { start: new Date("2026-10-29T10:00:00Z"), end: new Date("2026-10-29T10:30:00Z") };
  const input = { hours: base.hours, timezone: base.timezone, now: base.now, durationMinutes: base.durationMinutes, bufferMinutes: base.bufferMinutes, busy: base.busy };

  it("is true for a free slot inside hours", () => {
    expect(isSlotAvailable(slot, input)).toBe(true);
  });

  it("is false once the time is busy", () => {
    expect(isSlotAvailable(slot, { ...input, busy: [{ start: new Date("2026-10-29T10:15:00Z"), end: new Date("2026-10-29T11:00:00Z") }] })).toBe(false);
  });

  it("is false outside opening hours or for a time that is not a slot", () => {
    expect(isSlotAvailable({ start: new Date("2026-10-29T20:00:00Z"), end: new Date("2026-10-29T20:30:00Z") }, input)).toBe(false);
    expect(isSlotAvailable({ start: new Date("2026-10-31T10:00:00Z"), end: new Date("2026-10-31T10:30:00Z") }, input)).toBe(false);
  });

  it("is false when it is too soon", () => {
    expect(isSlotAvailable(slot, { ...input, now: new Date("2026-10-29T09:45:00Z") })).toBe(false);
  });
});

describe("formatting", () => {
  it("formats a slot in the business timezone", () => {
    expect(formatSlot({ start: new Date("2026-07-02T08:30:00Z"), end: new Date("2026-07-02T09:00:00Z") }, TZ)).toBe("Thu 2 Jul at 09:30");
  });

  it("gives the local date", () => {
    expect(localDate(new Date("2026-10-28T23:30:00Z"), "Asia/Tokyo")).toBe("2026-10-29");
  });
});
