import { enqueueAction } from "@/engine/queue";
import { sendToCustomer } from "@/engine/send";
import type { HandlerContext, ProductHandler } from "@/engine/types";
import { AdapterError } from "@/lib/errors";
import { renderTemplate } from "../template";
import { CONVERSATION_WINDOW_HOURS, PRODUCT_KEY, configOf, isOpenNow, requireMessaging } from "./shared";

async function setState(ctx: HandlerContext, conversationId: string, state: string): Promise<void> {
  await ctx.admin.from("conversations").update({ state }).eq("id", conversationId).eq("state", "pending_send");
}

/**
 * The delayed first WhatsApp message. Conditions are checked again here because they may have
 * changed during the delay (the customer opted out, the business closed, the product was turned off).
 */
export const sendFirstMessage: ProductHandler = async (ctx) => {
  const { admin, business, action, now } = ctx;
  const config = configOf(ctx);
  const conversationId = action.conversation_id;
  if (!conversationId) return { fail: "no_conversation" };

  const { data: conversation } = await admin
    .from("conversations")
    .select("id, state, customer:customers(id, phone_e164)")
    .eq("id", conversationId)
    .maybeSingle();
  if (!conversation || !conversation.customer) return { fail: "conversation_not_found" };
  // A retry after a successful send still needs the state update below, so `awaiting_reply` is allowed.
  if (conversation.state !== "pending_send" && conversation.state !== "awaiting_reply") {
    return { skip: "conversation_not_pending" };
  }
  const customer = conversation.customer;

  const open = isOpenNow(ctx);
  if (!open && !config.send_outside_hours) {
    await setState(ctx, conversationId, "expired");
    return { skip: "outside_hours_disabled" };
  }
  const template = open ? config.first_message_template : config.outside_hours_template;
  const body = renderTemplate(template, { business_name: business.name });

  let result;
  try {
    result = await sendToCustomer(
      { admin, messaging: requireMessaging(ctx) },
      {
        businessId: business.id,
        conversationId,
        customerId: customer.id,
        to: customer.phone_e164,
        body,
        kind: "first",
        now,
      },
    );
  } catch (error) {
    // Give up on the conversation when this was the last attempt or the error cannot be retried.
    const final = action.attempts >= action.max_attempts || (error instanceof AdapterError && !error.retryable);
    if (final) await setState(ctx, conversationId, "failed");
    throw error;
  }

  if (result.status === "blocked") {
    await setState(ctx, conversationId, result.reason === "opted_out" ? "opted_out" : "failed");
    return { skip: result.reason };
  }

  const expiresAt = new Date(now.getTime() + CONVERSATION_WINDOW_HOURS * 3_600_000);
  await admin
    .from("conversations")
    .update({ state: "awaiting_reply", expires_at: expiresAt.toISOString() })
    .eq("id", conversationId)
    .eq("state", "pending_send");

  await enqueueAction(admin, {
    businessId: business.id,
    conversationId,
    type: "expire_conversation",
    productKey: PRODUCT_KEY,
    runAt: expiresAt,
    dedupeKey: `expire:${conversationId}`,
  });

  await ctx.log.step({
    step: "action",
    status: "ok",
    reason: result.duplicate ? "first_message_already_sent" : "first_message_sent",
    details: { messageId: result.messageId, outsideHours: !open },
  });
  return "done";
};
