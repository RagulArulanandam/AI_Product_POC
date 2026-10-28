import { z } from "zod";

/**
 * What the model must return (product-missed-call.md, "AI contract"). The model only proposes;
 * our code validates this and decides what happens (see decide.ts).
 *
 * Kept free of length and range keywords because structured-output schemas do not support
 * them reliably; the limits are enforced in code instead (confidence range here, reply length
 * in decide.ts).
 */
export const INTENTS = ["book_appointment", "enquiry", "complaint", "other", "needs_human", "opt_out"] as const;
export const NEXT_ACTIONS = ["ask_question", "offer_slots", "confirm_booking", "escalate", "close"] as const;

export const aiReplySchema = z.object({
  intent: z.enum(INTENTS),
  confidence: z.number().refine((n) => n >= 0 && n <= 1, "confidence must be between 0 and 1"),
  extracted: z.object({
    name: z.string().nullable(),
    service: z.string().nullable(),
    preferred_date: z.string().nullable(),
    preferred_time: z.string().nullable(),
  }),
  next_action: z.enum(NEXT_ACTIONS),
  /** 1-based number of the offered time the customer picked, or null. Code checks it against what was offered. */
  chosen_slot: z.number().nullable(),
  reply: z.string(),
});

export type AiReply = z.infer<typeof aiReplySchema>;
export type Intent = (typeof INTENTS)[number];

export const SCHEMA_NAME = "missed_call_reply";

/** Fixed rules, not configurable in the POC (product-missed-call.md, "Config"). */
export const CONFIDENCE_THRESHOLD = 0.6;
export const TURN_CAP = 8;
export const MAX_REPLY_LENGTH = 1000;
