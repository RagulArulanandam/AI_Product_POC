import { z } from "zod";

export const uuidSchema = z.string().uuid();

export const subscriptionSchema = z.object({
  status: z.enum(["trial", "active", "past_due", "cancelled"]),
  plan: z.string().trim().min(1, "Enter a plan name").max(40, "Keep the plan name under 40 characters"),
  /** A date from a date input ("2026-12-31") or empty. Stored as the end of that day in UTC. */
  currentPeriodEnd: z
    .string()
    .trim()
    .refine((v) => v === "" || /^\d{4}-\d{2}-\d{2}$/.test(v), "Use a valid date")
    .transform((v) => (v === "" ? null : new Date(`${v}T23:59:59Z`).toISOString())),
  notes: z.string().trim().max(500, "Keep notes under 500 characters"),
});

export type SubscriptionFormInput = z.output<typeof subscriptionSchema>;
