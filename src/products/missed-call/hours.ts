import { businessHoursSchema, DEFAULT_BUSINESS_HOURS, type BusinessHours } from "@/lib/validation/hours";

type DayKey = keyof BusinessHours;

const DAY_BY_WEEKDAY: Record<string, DayKey> = {
  mon: "mon", tue: "tue", wed: "wed", thu: "thu", fri: "fri", sat: "sat", sun: "sun",
};

function toMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

/** The weekday and minutes since midnight at `instant` in the given IANA timezone. */
export function localTime(instant: Date, timezone: string): { day: DayKey; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const day = DAY_BY_WEEKDAY[get("weekday").toLowerCase().slice(0, 3)];
  return { day, minutes: Number(get("hour")) * 60 + Number(get("minute")) };
}

/** Reads hours from JSON, falling back to the defaults when the stored value is malformed. */
export function parseHours(value: unknown): BusinessHours {
  const parsed = businessHoursSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_BUSINESS_HOURS;
}

/**
 * Whether the business is open at `instant`, judged in the business's own timezone so daylight
 * saving changes are handled. Opening time is inclusive, closing time is exclusive.
 */
export function isOpenAt(hours: BusinessHours, timezone: string, instant: Date): boolean {
  const { day, minutes } = localTime(instant, timezone);
  const today = hours[day];
  if (!today) return false;
  return minutes >= toMinutes(today.open) && minutes < toMinutes(today.close);
}
