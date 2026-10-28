import { getAppBaseUrl } from "@/lib/env";
import type { ProductHandler } from "@/engine/types";
import { buildEscalationEmail, type EscalationReason, REASON_LABELS } from "../escalation-email";
import { configOf, requireEmail } from "./shared";

/** The owner's address: the one in the product config, else the owner's login email. */
async function ownerEmail(ctx: Parameters<ProductHandler>[0]): Promise<string | null> {
  const configured = configOf(ctx).escalation_email;
  if (configured) return configured;

  const { data: membership } = await ctx.admin
    .from("memberships")
    .select("user_id")
    .eq("business_id", ctx.business.id)
    .eq("role", "owner")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!membership) return null;

  const { data } = await ctx.admin.auth.admin.getUserById(membership.user_id);
  return data.user?.email ?? null;
}

/**
 * Emails the owner about an escalated conversation, once. The conversation is already flagged
 * in the database, so a failure here only delays the email (the engine retries it).
 */
export const sendEscalationEmail: ProductHandler = async (ctx) => {
  const { admin, business, action, now } = ctx;
  const conversationId = action.conversation_id;
  if (!conversationId) return { fail: "no_conversation" };

  // Already sent (an action redelivered after success): never email twice.
  const { count } = await admin
    .from("automation_logs")
    .select("*", { count: "exact", head: true })
    .eq("conversation_id", conversationId)
    .eq("reason", "escalation_email_sent");
  if ((count ?? 0) > 0) return { skip: "already_sent" };

  const { data: conversation } = await admin
    .from("conversations")
    .select("escalation_reason, customer:customers(phone_e164, name)")
    .eq("id", conversationId)
    .maybeSingle();
  if (!conversation || !conversation.customer) return { skip: "conversation_not_found" };

  const to = await ownerEmail(ctx);
  if (!to) return { fail: "no_escalation_email" };

  const { data: last } = await admin
    .from("messages")
    .select("body")
    .eq("conversation_id", conversationId)
    .eq("direction", "inbound")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const payload = (action.payload ?? {}) as { reason?: string };
  const reason = (payload.reason ?? conversation.escalation_reason ?? "model_requested") as EscalationReason;
  const email = buildEscalationEmail({
    businessName: business.name,
    reason: reason in REASON_LABELS ? reason : "model_requested",
    customerPhone: conversation.customer.phone_e164,
    customerName: conversation.customer.name,
    lastMessage: last?.body ?? null,
    conversationUrl: `${getAppBaseUrl().replace(/\/+$/, "")}/conversations/${conversationId}`,
    at: now,
    timezone: business.timezone,
  });

  const { providerId } = await requireEmail(ctx).send({ to, ...email });
  await ctx.log.step({ step: "action", status: "ok", reason: "escalation_email_sent", details: { providerId } });
  return "done";
};
