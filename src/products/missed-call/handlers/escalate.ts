import { enqueueAction } from "@/engine/queue";
import { sendToCustomer } from "@/engine/send";
import type { HandlerContext } from "@/engine/types";
import type { EscalationReason } from "../escalation-email";
import { ESCALATION_ACK } from "../ai/replies";
import { OPEN_STATES, PRODUCT_KEY, requireMessaging } from "./shared";

export interface EscalateInput {
  conversationId: string;
  customerId: string;
  customerPhone: string;
  reason: EscalationReason;
  intent?: string;
}

/**
 * Hands a conversation to a person (product-missed-call.md, "Escalation"): flags it with the
 * reason, queues the owner's email, tells the customer once that the team will be in touch,
 * and stops further automatic replies. Returns false when it was already escalated, so the
 * owner is never emailed twice.
 */
export async function escalateConversation(ctx: HandlerContext, input: EscalateInput): Promise<boolean> {
  const { admin, business, now } = ctx;

  const { data: updated } = await admin
    .from("conversations")
    .update({
      state: "escalated",
      escalation_reason: input.reason,
      escalated_at: now.toISOString(),
      ...(input.intent ? { last_intent: input.intent } : {}),
    })
    .eq("id", input.conversationId)
    .is("escalated_at", null)
    .in("state", [...OPEN_STATES])
    .select("id");
  if (!updated || updated.length === 0) return false;

  // A queued first message must not go out once a person is involved.
  await admin
    .from("scheduled_actions")
    .update({ status: "cancelled", last_error: "conversation_escalated" })
    .eq("conversation_id", input.conversationId)
    .eq("type", "send_first_message")
    .eq("status", "pending");

  await enqueueAction(admin, {
    businessId: business.id,
    conversationId: input.conversationId,
    type: "send_escalation_email",
    productKey: PRODUCT_KEY,
    payload: { reason: input.reason },
    dedupeKey: `escalation-email:${input.conversationId}`,
  });

  await ctx.log.step({ step: "action", status: "ok", reason: "escalated", details: { reason: input.reason } });

  // Best effort: the escalation stands even if the acknowledgement cannot be sent.
  try {
    await sendToCustomer(
      { admin, messaging: requireMessaging(ctx) },
      {
        businessId: business.id,
        conversationId: input.conversationId,
        customerId: input.customerId,
        to: input.customerPhone,
        body: ESCALATION_ACK,
        kind: "reply",
        sender: "ai",
        now,
      },
    );
  } catch (error) {
    await ctx.log.step({
      step: "action",
      status: "error",
      reason: "escalation_ack_failed",
      details: { message: error instanceof Error ? error.message : "unknown" },
    });
  }
  return true;
}
