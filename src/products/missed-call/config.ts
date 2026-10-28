import { z } from "zod";
import { businessHoursSchema } from "@/lib/validation/hours";

export const DEFAULT_FIRST_MESSAGE =
  "Hi, this is {{business_name}}. Sorry we missed your call. How can we help?";
export const DEFAULT_OUTSIDE_HOURS_MESSAGE =
  "Hi, this is {{business_name}}. We missed your call and are closed now. How can we help? We'll reply when we reopen.";

const template = z.string().trim().min(1, "Enter a message").max(1000, "Use at most 1000 characters");

/**
 * Product 1 config (product-missed-call.md, "Config"). Fixed in code, not configurable in the
 * POC: turn cap, guardrails and confidence threshold.
 */
export const missedCallConfigSchema = z.object({
  delay_minutes: z.number().int("Use a whole number").min(0).max(60).default(2),
  first_message_template: template.default(DEFAULT_FIRST_MESSAGE),
  outside_hours_template: template.default(DEFAULT_OUTSIDE_HOURS_MESSAGE),
  send_outside_hours: z.boolean().default(true),
  /** null means "use the business profile hours". */
  business_hours: businessHoursSchema.nullable().default(null),
  booking_enabled: z.boolean().default(false),
  appointment_duration_minutes: z.number().int("Use a whole number").min(5).max(240).default(30),
  buffer_minutes: z.number().int("Use a whole number").min(0).max(120).default(0),
  calendar_integration_id: z.uuid().nullable().default(null),
  /** null means "the owner's email". */
  escalation_email: z.email("Enter a valid email address").nullable().default(null),
  escalate_on: z
    .object({
      complaint: z.boolean().default(true),
      wants_human: z.boolean().default(true),
      low_confidence: z.boolean().default(true),
    })
    .default({ complaint: true, wants_human: true, low_confidence: true }),
  business_blurb: z.string().trim().max(1000, "Use at most 1000 characters").default(""),
});

export type MissedCallConfig = z.infer<typeof missedCallConfigSchema>;
