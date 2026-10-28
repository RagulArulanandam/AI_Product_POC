import { enqueueAction } from "@/engine/queue";
import type { ProductHandler } from "@/engine/types";
import { CONVERSATION_WINDOW_HOURS, PRODUCT_KEY, REPLYABLE_STATES } from "./shared";

/**
 * Marks a conversation `expired` once the customer has been silent for 24 hours, which is also
 * the end of the WhatsApp reply window. If they wrote since this check was scheduled, the clock
 * restarts from their last message, so a new check is queued instead.
 */
export const expireConversation: ProductHandler = async (ctx) => {
  const { admin, business, action, now } = ctx;
  const conversationId = action.conversation_id;
  if (!conversationId) return { fail: "no_conversation" };

  const { data: conversation } = await admin
    .from("conversations")
    .select("state, started_at, last_inbound_at, last_outbound_at")
    .eq("id", conversationId)
    .maybeSingle();
  if (!conversation) return { skip: "conversation_not_found" };
  if (!(REPLYABLE_STATES as readonly string[]).includes(conversation.state)) return { skip: "conversation_closed" };

  const basis = conversation.last_inbound_at ?? conversation.last_outbound_at ?? conversation.started_at;
  const expiresAt = new Date(new Date(basis).getTime() + CONVERSATION_WINDOW_HOURS * 3_600_000);

  if (now.getTime() >= expiresAt.getTime()) {
    await admin.from("conversations").update({ state: "expired" }).eq("id", conversationId);
    await ctx.log.step({ step: "action", status: "ok", reason: "conversation_expired" });
    return "done";
  }

  // Not due yet: queue the next check for when it will be. A new dedupe key, so it is a new action.
  await enqueueAction(admin, {
    businessId: business.id,
    conversationId,
    type: "expire_conversation",
    productKey: PRODUCT_KEY,
    runAt: expiresAt,
    dedupeKey: `expire:${conversationId}:${expiresAt.getTime()}`,
  });
  return "done";
};
