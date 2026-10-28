import { isStopMessage } from "@/engine/optout";
import { sendToCustomer, type SendResult } from "@/engine/send";
import type { HandlerContext, ProductHandler } from "@/engine/types";
import { AdapterError } from "@/lib/errors";
import { aiReplySchema, SCHEMA_NAME, type AiReply } from "../ai/contract";
import { decide } from "../ai/decide";
import { buildPrompt, HISTORY_LIMIT, type StoredMessage } from "../ai/prompt";
import { MEDIA_REPLY, OPT_OUT_ACK } from "../ai/replies";
import { detectSafety } from "../ai/safety";
import type { EscalationReason } from "../escalation-email";
import { parseHours } from "../hours";
import { formatSlot, localDate } from "../slots";
import { parseOffered, runBooking, type CalendarIntegration } from "./booking";
import { escalateConversation } from "./escalate";
import { configOf, requireLlm, requireMessaging } from "./shared";

const UNIQUE_VIOLATION = "23505";
const CLOSED_STATES = ["escalated", "opted_out", "expired", "booked", "failed", "enquiry_logged"];

type Customer = { id: string; phone_e164: string; name: string | null };
type Conversation = {
  id: string;
  state: string;
  turn_count: number;
  offered_slots: unknown;
  booking_service: string | null;
  booking_event_id: string | null;
  customer: Customer;
};

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

async function reply(ctx: HandlerContext, conversation: Conversation, body: string): Promise<SendResult> {
  return sendToCustomer(
    { admin: ctx.admin, messaging: requireMessaging(ctx) },
    {
      businessId: ctx.business.id,
      conversationId: conversation.id,
      customerId: conversation.customer.id,
      to: conversation.customer.phone_e164,
      body,
      kind: "reply",
      sender: "ai",
      now: ctx.now,
    },
  );
}

async function markProcessed(ctx: HandlerContext, messageId: string, intent: string, confidence?: number): Promise<void> {
  await ctx.admin
    .from("messages")
    .update({ intent, ...(confidence === undefined ? {} : { confidence }) })
    .eq("id", messageId);
}

/** Stores the customer's message once. A redelivery finds the earlier row (unique SID). */
async function storeInbound(
  ctx: HandlerContext,
  conversationId: string,
  providerSid: string,
  body: string,
): Promise<{ id: string; isNew: boolean; processed: boolean }> {
  const { data, error } = await ctx.admin
    .from("messages")
    .insert({
      business_id: ctx.business.id,
      conversation_id: conversationId,
      direction: "inbound",
      sender: "customer",
      body,
      provider_sid: providerSid,
      status: "received",
    })
    .select("id")
    .single();
  if (!error && data) return { id: data.id, isNew: true, processed: false };
  if (error?.code !== UNIQUE_VIOLATION) throw new Error(`inbound message insert failed: ${error?.message}`);

  const { data: existing } = await ctx.admin.from("messages").select("id, intent").eq("provider_sid", providerSid).single();
  if (!existing) throw new Error("inbound message vanished");
  return { id: existing.id, isNew: false, processed: existing.intent !== null };
}

/** STOP, or the model reading the message as an opt-out. */
async function optOut(ctx: HandlerContext, conversation: Conversation, messageId: string): Promise<void> {
  const { admin, business } = ctx;
  const phone = conversation.customer.phone_e164;

  // Acknowledge first: once the number is on the opt-out list nothing more can be sent to it.
  try {
    await reply(ctx, conversation, OPT_OUT_ACK);
  } catch (error) {
    await ctx.log.step({
      step: "action",
      status: "error",
      reason: "opt_out_ack_failed",
      details: { message: error instanceof Error ? error.message : "unknown" },
    });
  }

  await admin.from("opt_outs").upsert({ phone_e164: phone, source_business_id: business.id }, { onConflict: "phone_e164", ignoreDuplicates: true });

  // Opt-out covers every business: end this number's open conversations and queued sends.
  const { data: customers } = await admin.from("customers").select("id").eq("phone_e164", phone);
  const customerIds = (customers ?? []).map((c) => c.id);
  if (customerIds.length > 0) {
    const { data: open } = await admin
      .from("conversations")
      .update({ state: "opted_out" })
      .in("customer_id", customerIds)
      .in("state", ["pending_send", "awaiting_reply", "in_conversation", "offering_slots"])
      .select("id");
    const ids = (open ?? []).map((c) => c.id);
    if (ids.length > 0) {
      await admin
        .from("scheduled_actions")
        .update({ status: "cancelled", last_error: "opted_out" })
        .in("conversation_id", ids)
        .eq("status", "pending")
        .in("type", ["send_first_message", "send_reply"]);
    }
  }

  await markProcessed(ctx, messageId, "opt_out");
  await ctx.log.step({ step: "action", status: "ok", reason: "opted_out" });
}

async function findCalendarIntegration(ctx: HandlerContext): Promise<CalendarIntegration | null> {
  const { data } = await ctx.admin
    .from("integrations")
    .select("id, status")
    .eq("business_id", ctx.business.id)
    .eq("provider", "google_calendar")
    .maybeSingle();
  // Disconnected on purpose: the same as never connected. A broken connection ("error") still counts,
  // so the customer is handed to a person instead of being told the team will confirm.
  return data && data.status !== "disconnected" ? data : null;
}

/** Asks the model, retrying once when its answer is unusable. */
async function askModel(
  ctx: HandlerContext,
  conversation: Conversation,
  calendarBooking: boolean,
): Promise<{ ok: true; ai: AiReply } | { ok: false }> {
  const config = configOf(ctx);
  const { data: rows } = await ctx.admin
    .from("messages")
    .select("sender, body")
    .eq("conversation_id", conversation.id)
    .order("created_at", { ascending: false })
    .limit(HISTORY_LIMIT);
  const history = (rows ?? []).reverse() as StoredMessage[];

  const prompt = buildPrompt({
    businessName: ctx.business.name,
    blurb: config.business_blurb,
    hours: parseHours(config.business_hours ?? ctx.business.business_hours),
    timezone: ctx.business.timezone,
    bookingEnabled: config.booking_enabled,
    calendarBooking,
    today: localDate(ctx.now, ctx.business.timezone),
    offeredSlots: parseOffered(conversation.offered_slots).map((s) => formatSlot(s, ctx.business.timezone)),
    history,
  });

  const llm = requireLlm(ctx);
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const { data } = await llm.completeJson({ ...prompt, schema: aiReplySchema, schemaName: SCHEMA_NAME });
      return { ok: true, ai: data };
    } catch (error) {
      // Unusable output gets one more try, then a person (below). Anything else is the engine's to retry.
      if (error instanceof AdapterError && error.code === "invalid_output") continue;
      throw error;
    }
  }
  return { ok: false };
}

/**
 * A customer's reply. Stores it once, then either answers it or hands the conversation to a
 * person. The model only proposes; decide() chooses (product-missed-call.md, "AI contract").
 */
export const messageInbound: ProductHandler = async (ctx) => {
  const { admin, business, event, action, now } = ctx;
  const config = configOf(ctx);
  const payload = (event?.payload ?? {}) as { data?: Record<string, unknown>; conversation_id?: string };
  const data = payload.data ?? {};
  const conversationId = action.conversation_id ?? payload.conversation_id ?? null;
  const rawBody = text(data.body);
  const hasMedia = data.hasMedia === true;
  if (!event || !conversationId) return { skip: "no_conversation" };

  const { data: found } = await admin
    .from("conversations")
    .select("id, state, turn_count, offered_slots, booking_service, booking_event_id, customer:customers(id, phone_e164, name)")
    .eq("id", conversationId)
    .eq("business_id", business.id)
    .maybeSingle();
  if (!found || !found.customer) return { skip: "conversation_not_found" };
  const conversation: Conversation = { ...found, customer: found.customer };

  const stored = await storeInbound(ctx, conversation.id, event.provider_event_id, hasMedia && !rawBody ? "[media not supported]" : rawBody);
  if (stored.processed) return { skip: "already_processed" };

  // The customer wrote: the window restarts, and a still-queued first message is pointless now.
  const isText = !hasMedia || rawBody.length > 0;
  const turnCount = conversation.turn_count + (stored.isNew && isText ? 1 : 0);
  const closed = CLOSED_STATES.includes(conversation.state);
  await admin
    .from("conversations")
    .update({
      last_inbound_at: now.toISOString(),
      turn_count: turnCount,
      ...(closed ? {} : { state: "in_conversation" }),
    })
    .eq("id", conversation.id);
  if (conversation.state === "pending_send") {
    await admin
      .from("scheduled_actions")
      .update({ status: "cancelled", last_error: "customer_replied_first" })
      .eq("conversation_id", conversation.id)
      .eq("type", "send_first_message")
      .eq("status", "pending");
  }

  // Messages after a conversation ended (escalated, opted out...) are kept but not answered.
  if (closed) {
    await markProcessed(ctx, stored.id, "none");
    await ctx.log.step({ step: "condition", status: "skipped", reason: "conversation_closed_message_stored", details: { state: conversation.state } });
    return "done";
  }

  // STOP is recognised before any model call.
  if (isStopMessage(rawBody)) {
    await optOut(ctx, conversation, stored.id);
    return "done";
  }

  if (hasMedia && !rawBody) {
    await reply(ctx, conversation, MEDIA_REPLY);
    await markProcessed(ctx, stored.id, "media");
    return "done";
  }

  // Booking runs against a connected Google Calendar. Booking switched on without a calendar
  // keeps the old behaviour: details are taken and the team confirms.
  const integration = config.booking_enabled ? await findCalendarIntegration(ctx) : null;
  const calendarBooking = integration !== null;

  // Urgent and health-safety wording goes straight to a person; the model is not asked.
  const safety = detectSafety(rawBody);
  let ai: AiReply | null = null;
  let modelFailed = false;
  if (!safety.urgent && !safety.medical && turnCount < 8) {
    try {
      const result = await askModel(ctx, conversation, calendarBooking);
      if (result.ok) ai = result.ai;
      else modelFailed = true;
    } catch (error) {
      // The last attempt, or an error that will never succeed: do not leave the customer hanging.
      const final = action.attempts >= action.max_attempts || (error instanceof AdapterError && !error.retryable);
      if (!final) throw error;
      await escalateConversation(ctx, {
        conversationId: conversation.id,
        customerId: conversation.customer.id,
        customerPhone: conversation.customer.phone_e164,
        reason: "ai_unavailable",
      });
      await markProcessed(ctx, stored.id, "needs_human");
      return "done";
    }
  }

  const decision = modelFailed
    ? ({ kind: "escalate", reason: "invalid_model_output" } as const)
    : decide({ ai, safety, escalateOn: config.escalate_on, turnCount, calendarBooking });

  await ctx.log.step({
    step: "ai",
    status: "ok",
    reason: decision.kind === "escalate" ? `escalate:${decision.reason}` : decision.kind,
    details: ai ? { intent: ai.intent, confidence: ai.confidence, nextAction: ai.next_action, turn: turnCount } : { turn: turnCount },
  });

  if (decision.kind === "opt_out") {
    await optOut(ctx, conversation, stored.id);
    return "done";
  }

  if (decision.kind === "escalate") {
    const reason: EscalationReason = decision.reason;
    await escalateConversation(ctx, {
      conversationId: conversation.id,
      customerId: conversation.customer.id,
      customerPhone: conversation.customer.phone_e164,
      reason,
      intent: ai?.intent,
    });
    await markProcessed(ctx, stored.id, reason === "complaint" ? "complaint" : (ai?.intent ?? "needs_human"), ai?.confidence);
    return "done";
  }

  let replyText: string;
  let state: string;
  let stateUpdate: Record<string, unknown> = {};
  if (decision.kind === "booking") {
    const outcome = await runBooking(ctx, conversation, ai as AiReply, integration as CalendarIntegration);
    if (outcome.kind === "escalate") {
      await escalateConversation(ctx, {
        conversationId: conversation.id,
        customerId: conversation.customer.id,
        customerPhone: conversation.customer.phone_e164,
        reason: outcome.reason,
        intent: ai?.intent,
      });
      await markProcessed(ctx, stored.id, ai?.intent ?? "needs_human", ai?.confidence);
      return "done";
    }
    ({ reply: replyText, state, update: stateUpdate } = outcome);
  } else {
    ({ reply: replyText, state } = decision);
  }

  const sent = await reply(ctx, conversation, replyText);
  if (sent.status === "blocked") {
    await ctx.log.step({ step: "action", status: "skipped", reason: `reply_blocked:${sent.reason}` });
  }

  await admin
    .from("conversations")
    .update({ state, ...stateUpdate, ...(ai ? { last_intent: ai.intent } : {}) })
    .eq("id", conversation.id);
  await markProcessed(ctx, stored.id, ai?.intent ?? "other", ai?.confidence);

  // Remember the customer's name when they gave it.
  const given = ai?.extracted.name?.replace(/[^\p{L}\p{M}' .-]/gu, "").trim().slice(0, 100);
  if (given && !conversation.customer.name) {
    await admin.from("customers").update({ name: given }).eq("id", conversation.customer.id);
  }
  return "done";
};
