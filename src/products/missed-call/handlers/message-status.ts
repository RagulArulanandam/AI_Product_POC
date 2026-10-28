import type { ProductHandler } from "@/engine/types";
import { eventData } from "./shared";

const RANK: Record<string, number> = { queued: 0, sent: 1, delivered: 2 };
const STATUS_LOOKUP_RETRY_SECONDS = 30;

/**
 * A delivery status for a message we sent. Statuses can arrive out of order, so a message only
 * ever moves forward (sent, then delivered). A failure on the first message, before the
 * customer has written, ends the conversation.
 */
export const messageStatus: ProductHandler = async (ctx) => {
  const { admin, business, now } = ctx;
  const data = eventData(ctx);
  const providerSid = typeof data.providerSid === "string" ? data.providerSid : null;
  const status = typeof data.status === "string" ? data.status : null;
  if (!providerSid || !status) return { fail: "bad_status_event" };

  const { data: message } = await admin
    .from("messages")
    .select("id, status, conversation_id")
    .eq("business_id", business.id)
    .eq("provider_sid", providerSid)
    .maybeSingle();
  // The callback can beat our own bookkeeping, so look again shortly.
  if (!message) {
    return { retryAt: new Date(now.getTime() + STATUS_LOOKUP_RETRY_SECONDS * 1000), reason: "message_not_found" };
  }

  if (status === "failed") {
    if (message.status === "delivered") return { skip: "already_delivered" };

    const errorCode = typeof data.errorCode === "string" ? data.errorCode : null;
    await admin
      .from("messages")
      .update({ status: "failed", error: errorCode ? `twilio_${errorCode}` : "delivery_failed" })
      .eq("id", message.id);

    const { data: conversation } = await admin
      .from("conversations")
      .select("state, last_inbound_at")
      .eq("id", message.conversation_id)
      .single();
    if (conversation && ["pending_send", "awaiting_reply"].includes(conversation.state) && !conversation.last_inbound_at) {
      await admin.from("conversations").update({ state: "failed" }).eq("id", message.conversation_id);
    }
    await ctx.log.step({ step: "action", status: "error", reason: "delivery_failed", details: { errorCode, messageId: message.id } });
    return "done";
  }

  if ((RANK[status] ?? -1) > (RANK[message.status] ?? -1)) {
    await admin.from("messages").update({ status }).eq("id", message.id);
  }
  return "done";
};
