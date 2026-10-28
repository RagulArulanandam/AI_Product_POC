import { z } from "zod";
import { toE164 } from "@/lib/phone";

export function supportedTimezones(): string[] {
  return Intl.supportedValuesOf("timeZone");
}

/** Onboarding input. The phone is normalised to E.164 here, so everything downstream sees E.164. */
export const createBusinessSchema = z.object({
  name: z.string().trim().min(1, "Enter your business name").max(120, "Use at most 120 characters"),
  phone: z
    .string()
    .trim()
    .min(1, "Enter your business phone number")
    .transform((value, ctx) => {
      const e164 = toE164(value);
      if (!e164) {
        ctx.addIssue({ code: "custom", message: "Enter a valid phone number, e.g. 020 7946 0000" });
        return z.NEVER;
      }
      return e164;
    }),
  timezone: z.string().refine((tz) => supportedTimezones().includes(tz), "Choose a timezone from the list"),
});

export type CreateBusinessInput = z.infer<typeof createBusinessSchema>;
