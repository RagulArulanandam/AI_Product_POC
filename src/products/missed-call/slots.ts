import type { BusyInterval } from "@/adapters/calendar/interface";
import type { BusinessHours } from "@/lib/validation/hours";
import { localTime } from "./hours";

/**
 * Slot computation (integrations.md section 6): the calendar only reports busy time, so working
 * out which times to offer is our logic. Pure and timezone-aware, so it is easy to test.
 */

export interface Slot {
  start: Date;
  end: Date;
}

export interface SlotInput {
  hours: BusinessHours;
  timezone: string;
  now: Date;
  durationMinutes: number;
  bufferMinutes: number;
  busy: BusyInterval[];
  /** Local date `YYYY-MM-DD` the customer asked for, if any. */
  preferredDate?: string | null;
  /** Local time `HH:MM` the customer asked for, if any. */
  preferredTime?: string | null;
  /** How many slots to offer. */
  count?: number;
}

export const SLOT_STEP_MINUTES = 30;
/** Nobody can book something starting in the next hour: the team needs notice. */
export const MIN_LEAD_MINUTES = 60;
export const HORIZON_DAYS = 14;
export const DEFAULT_SLOT_COUNT = 3;

const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
const MINUTE = 60_000;

function toMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

/** `YYYY-MM-DD` of `instant` in the timezone. */
export function localDate(instant: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(instant);
}

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function weekdayOf(date: string): (typeof WEEKDAYS)[number] {
  const [y, m, d] = date.split("-").map(Number);
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

/**
 * The UTC instant for a wall-clock time on a local date, or null when that time does not exist
 * (the hour skipped when clocks go forward).
 */
export function zonedToUtc(date: string, minutes: number, timezone: string): Date | null {
  const [y, m, d] = date.split("-").map(Number);
  const asIfUtc = Date.UTC(y, m - 1, d, 0, minutes);
  let guess = asIfUtc;
  // The offset can change between the guess and the answer, so settle in two passes.
  for (let i = 0; i < 2; i += 1) {
    const seen = localTime(new Date(guess), timezone);
    const seenDate = localDate(new Date(guess), timezone);
    const seenMs = Date.UTC(Number(seenDate.slice(0, 4)), Number(seenDate.slice(5, 7)) - 1, Number(seenDate.slice(8, 10)), 0, seen.minutes);
    guess += asIfUtc - seenMs;
  }
  const check = localTime(new Date(guess), timezone);
  return localDate(new Date(guess), timezone) === date && check.minutes === minutes ? new Date(guess) : null;
}

function isFree(slot: Slot, busy: BusyInterval[], bufferMinutes: number): boolean {
  const from = slot.start.getTime() - bufferMinutes * MINUTE;
  const to = slot.end.getTime() + bufferMinutes * MINUTE;
  return !busy.some((b) => b.start.getTime() < to && b.end.getTime() > from);
}

/** Every free slot on one local date, in time order. */
function slotsOnDate(date: string, input: SlotInput): Slot[] {
  const day = input.hours[weekdayOf(date)];
  if (!day) return [];

  const earliest = input.now.getTime() + MIN_LEAD_MINUTES * MINUTE;
  const open = toMinutes(day.open);
  const close = toMinutes(day.close);
  const slots: Slot[] = [];
  for (let minutes = open; minutes + input.durationMinutes <= close; minutes += SLOT_STEP_MINUTES) {
    const start = zonedToUtc(date, minutes, input.timezone);
    if (!start || start.getTime() < earliest) continue;
    const slot = { start, end: new Date(start.getTime() + input.durationMinutes * MINUTE) };
    if (isFree(slot, input.busy, input.bufferMinutes)) slots.push(slot);
  }
  return slots;
}

/** Picks `count` slots spread across the day so the customer sees real choice, not three adjacent times. */
function spread(slots: Slot[], count: number): Slot[] {
  if (slots.length <= count) return slots;
  if (count <= 1) return slots.slice(0, count);
  const picked: Slot[] = [];
  for (let i = 0; i < count; i += 1) picked.push(slots[Math.round((i * (slots.length - 1)) / (count - 1))]);
  return picked;
}

/**
 * The times to offer. With a preferred date, slots on that day come first (closest to the
 * preferred time when given, else spread through the day), topped up from the following days.
 * Without one, the first free slot of each of the next days.
 */
export function computeSlots(input: SlotInput): Slot[] {
  const count = input.count ?? DEFAULT_SLOT_COUNT;
  const today = localDate(input.now, input.timezone);
  const preferred = input.preferredDate && /^\d{4}-\d{2}-\d{2}$/.test(input.preferredDate) && input.preferredDate >= today ? input.preferredDate : null;
  const firstDay = preferred ?? today;
  const preferredMinutes = input.preferredTime && /^\d{1,2}:\d{2}$/.test(input.preferredTime) ? toMinutes(input.preferredTime) : null;

  const offered: Slot[] = [];
  const seen = new Set<number>();
  const add = (slot: Slot) => {
    if (seen.has(slot.start.getTime())) return;
    seen.add(slot.start.getTime());
    offered.push(slot);
  };

  for (let offset = 0; offset < HORIZON_DAYS && offered.length < count; offset += 1) {
    const date = addDays(firstDay, offset);
    const free = slotsOnDate(date, input);
    if (free.length === 0) continue;

    if (preferred && offset === 0) {
      const chosen =
        preferredMinutes === null
          ? spread(free, count)
          : [...free]
              .sort((a, b) => Math.abs(localTime(a.start, input.timezone).minutes - preferredMinutes) - Math.abs(localTime(b.start, input.timezone).minutes - preferredMinutes))
              .slice(0, count)
              .sort((a, b) => a.start.getTime() - b.start.getTime());
      chosen.forEach(add);
    } else {
      add(free[0]);
    }
  }
  return offered.slice(0, count).sort((a, b) => a.start.getTime() - b.start.getTime());
}

/** Whether `slot` is still bookable: inside opening hours, far enough ahead, and clear of busy time. */
export function isSlotAvailable(slot: Slot, input: Omit<SlotInput, "preferredDate" | "preferredTime" | "count">): boolean {
  const date = localDate(slot.start, input.timezone);
  return slotsOnDate(date, { ...input, busy: input.busy }).some((s) => s.start.getTime() === slot.start.getTime());
}

/** "Thu 29 Oct at 10:00" in the business's timezone. */
export function formatSlot(slot: Slot, timezone: string): string {
  const day = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, weekday: "short", day: "numeric", month: "short" }).format(slot.start);
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(slot.start);
  return `${day.replace(",", "")} at ${time}`;
}
