import type { EscalationReason } from "../escalation-email";
import { CONFIDENCE_THRESHOLD, MAX_REPLY_LENGTH, TURN_CAP, type AiReply } from "./contract";
import { BOOKING_PENDING_REPLY, FALLBACK_REPLY } from "./replies";
import type { Safety } from "./safety";

/**
 * "The AI proposes, code decides." Turns what the model proposed, the keyword safety net and the
 * conversation so far into one decision. Pure, so every rule is easy to test.
 */

export interface EscalateOn {
  complaint: boolean;
  wants_human: boolean;
  low_confidence: boolean;
}

export interface DecisionInput {
  /** null when the model was not asked (urgent or medical wording is escalated without it). */
  ai: AiReply | null;
  safety: Safety;
  escalateOn: EscalateOn;
  /** Customer messages so far, including this one. */
  turnCount: number;
}

export type Decision =
  | { kind: "escalate"; reason: EscalationReason }
  | { kind: "opt_out" }
  | { kind: "reply"; reply: string; state: "in_conversation" | "enquiry_logged" };

/** Strips control characters, collapses whitespace runs and enforces the length limit. */
export function sanitizeReply(text: string): string {
  const cleaned = text
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return cleaned.length > MAX_REPLY_LENGTH ? `${cleaned.slice(0, MAX_REPLY_LENGTH - 1)}…` : cleaned;
}

export function decide(input: DecisionInput): Decision {
  const { ai, safety, escalateOn, turnCount } = input;

  // Always escalated, and cannot be switched off.
  if (safety.urgent) return { kind: "escalate", reason: "urgent" };
  if (safety.medical) return { kind: "escalate", reason: "medical_advice" };
  if (turnCount >= TURN_CAP) return { kind: "escalate", reason: "turn_cap" };

  if (!ai) return { kind: "escalate", reason: "invalid_model_output" };

  if (ai.intent === "opt_out") return { kind: "opt_out" };

  // The owner can switch these three off in the product config.
  const wantsHuman = safety.wantsHuman || ai.intent === "needs_human";
  const complaint = safety.complaint || ai.intent === "complaint";
  if (wantsHuman && escalateOn.wants_human) return { kind: "escalate", reason: "wants_human" };
  if (complaint && escalateOn.complaint) return { kind: "escalate", reason: "complaint" };

  // A model request for a person, when it is not one of the categories the owner turned off.
  if (ai.next_action === "escalate" && !wantsHuman && !complaint) return { kind: "escalate", reason: "model_requested" };

  if (ai.confidence < CONFIDENCE_THRESHOLD && escalateOn.low_confidence) {
    return { kind: "escalate", reason: "low_confidence" };
  }

  // Booking is not available until calendar booking exists: take the details, tell the customer
  // the team will confirm, and log the enquiry. The model's own text is not used because it may
  // promise a slot.
  if (ai.intent === "book_appointment" || ai.next_action === "offer_slots" || ai.next_action === "confirm_booking") {
    return { kind: "reply", reply: BOOKING_PENDING_REPLY, state: "enquiry_logged" };
  }

  const reply = sanitizeReply(ai.reply) || FALLBACK_REPLY;
  return { kind: "reply", reply, state: ai.next_action === "close" ? "enquiry_logged" : "in_conversation" };
}
