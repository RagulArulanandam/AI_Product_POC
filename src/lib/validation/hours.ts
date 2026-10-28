import { z } from "zod";

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM (24 hour)");

const day = z
  .object({ open: time, close: time })
  .refine((d) => d.open < d.close, { message: "Closing time must be after opening time" });

/** Opening hours per weekday in the business timezone; null means closed. */
export const businessHoursSchema = z.object({
  mon: day.nullable(),
  tue: day.nullable(),
  wed: day.nullable(),
  thu: day.nullable(),
  fri: day.nullable(),
  sat: day.nullable(),
  sun: day.nullable(),
});

export type BusinessHours = z.infer<typeof businessHoursSchema>;

export const DEFAULT_BUSINESS_HOURS: BusinessHours = {
  mon: { open: "09:00", close: "17:00" },
  tue: { open: "09:00", close: "17:00" },
  wed: { open: "09:00", close: "17:00" },
  thu: { open: "09:00", close: "17:00" },
  fri: { open: "09:00", close: "17:00" },
  sat: null,
  sun: null,
};
