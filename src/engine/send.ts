import type { MessagingAdapter } from "@/adapters/messaging/interface";
import { redact } from "@/lib/redact";
import type { Admin } from "./types";

/**
 * The only code path that sends a message to a customer (security-privacy.md section 9).
 * Every send passes the same checks: business active, opt-out, 24 hour window, send caps.
 * tests/unit/send-gate-imports.test.ts fails if anything else calls `sendMessage`.
 */

export const SEND_LIMITS = { customerPerHour: 10, businessPerDay: 200, windowHours: 24 };

export type SendBlockReason = "business_inactive" | "opted_out" | "outside_window" | "customer_cap" | "business_cap";

export type SendResult =
  | { status: "sent"; messageId: string; providerSid: string; duplicate: boolean }
  | { status: "blocked"; reason: SendBlockReason };

export interface SendDeps {
  admin: Admin;
  messaging: MessagingAdapter;
  limits?: Partial<typeof SEND_LIMITS>;
}

export interface SendInput {
  businessId: string;
  conversationId: string;
  customerId: string;
  to: string;
  body: string;
  /** `first` is the template message after a missed call; replies need an open 24h window. */
  kind: "first" | "reply" | "system";
  sender?: "ai" | "system";
  /** Pass the id of a previous attempt's row so a retry reuses it instead of adding another. */
  messageId?: string;
  now: Date;
}

interface MessageRow {
  id: string;
  provider_sid: string | null;
}

const HOUR_MS = 3_600_000;

async function findExisting(deps: SendDeps, input: SendInput): Promise<MessageRow | null> {
  if (input.messageId) {
    const { data } = await deps.admin
      .from("messages")
      .select("id, provider_sid")
      .eq("id", input.messageId)
      .eq("conversation_id", input.conversationId)
      .maybeSingle();
    return data;
  }
  if (input.kind === "first") {
    // The first message of a conversation is unique, so a retry finds the earlier attempt.
    const { data } = await deps.admin
      .from("messages")
      .select("id, provider_sid")
      .eq("conversation_id", input.conversationId)
      .eq("direction", "outbound")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    return data;
  }
  return null;
}

async function countOutbound(
  deps: SendDeps,
  filter: { customerId?: string; businessId?: string },
  since: Date,
): Promise<number> {
  let query = deps.admin
    .from("messages")
    .select("id, conversations!inner(customer_id)", { count: "exact", head: true })
    .eq("direction", "outbound")
    .in("status", ["queued", "sent", "delivered"])
    .gte("created_at", since.toISOString());
  if (filter.customerId) query = query.eq("conversations.customer_id", filter.customerId);
  if (filter.businessId) query = query.eq("business_id", filter.businessId);
  const { count, error } = await query;
  if (error) throw new Error(`send cap check failed: ${error.message}`);
  return count ?? 0;
}

export async function sendToCustomer(deps: SendDeps, input: SendInput): Promise<SendResult> {
  const limits = { ...SEND_LIMITS, ...deps.limits };

  // 1. Already sent (a retry after success): do nothing more.
  const existing = await findExisting(deps, input);
  if (existing?.provider_sid) {
    return { status: "sent", messageId: existing.id, providerSid: existing.provider_sid, duplicate: true };
  }

  // 2. Business must be active.
  const { data: business } = await deps.admin.from("businesses").select("status").eq("id", input.businessId).maybeSingle();
  if (!business || business.status !== "active") return { status: "blocked", reason: "business_inactive" };

  // 3. Opt-out is platform-wide, so another business's STOP also blocks this one.
  const { data: optOut } = await deps.admin.from("opt_outs").select("id").eq("phone_e164", input.to).maybeSingle();
  if (optOut) return { status: "blocked", reason: "opted_out" };

  // 4. Replies need the customer to have written within the window.
  if (input.kind === "reply") {
    const { data: conversation } = await deps.admin
      .from("conversations")
      .select("last_inbound_at")
      .eq("id", input.conversationId)
      .maybeSingle();
    const lastInbound = conversation?.last_inbound_at ? new Date(conversation.last_inbound_at).getTime() : null;
    if (lastInbound === null || input.now.getTime() - lastInbound > limits.windowHours * HOUR_MS) {
      return { status: "blocked", reason: "outside_window" };
    }
  }

  // 5. Send caps.
  const hourAgo = new Date(input.now.getTime() - HOUR_MS);
  if ((await countOutbound(deps, { customerId: input.customerId }, hourAgo)) >= limits.customerPerHour) {
    return { status: "blocked", reason: "customer_cap" };
  }
  const dayAgo = new Date(input.now.getTime() - 24 * HOUR_MS);
  if ((await countOutbound(deps, { businessId: input.businessId }, dayAgo)) >= limits.businessPerDay) {
    return { status: "blocked", reason: "business_cap" };
  }

  // 6. Record the message before sending, so a retry can find and reuse the row.
  let messageId = existing?.id;
  if (messageId) {
    await deps.admin.from("messages").update({ body: input.body, status: "queued", error: null }).eq("id", messageId);
  } else {
    const { data, error } = await deps.admin
      .from("messages")
      .insert({
        business_id: input.businessId,
        conversation_id: input.conversationId,
        direction: "outbound",
        sender: input.sender ?? (input.kind === "first" ? "system" : "ai"),
        body: input.body,
        status: "queued",
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(`message insert failed: ${error?.message}`);
    messageId = data.id;
  }

  // 7. Send.
  let providerSid: string;
  let templateSid: string | undefined;
  try {
    ({ providerSid, templateSid } = await deps.messaging.sendMessage({ to: input.to, body: input.body }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "send failed";
    await deps.admin.from("messages").update({ status: "failed", error: String(redact(message)) }).eq("id", messageId);
    throw error;
  }

  // In trial template mode the customer received a fixed template, not our text. Say so in the
  // record instead of showing text that was never sent.
  if (templateSid) {
    await deps.admin
      .from("messages")
      .update({ body: `[trial template ${templateSid}] ${input.body}` })
      .eq("id", messageId);
  }
  await recordSent(deps, input, messageId, providerSid);
  return { status: "sent", messageId, providerSid, duplicate: false };
}

/**
 * The provider accepted the message. If recording that fails, retrying the action would send
 * it twice, so try a few times and, as a last resort, log the SID instead of throwing.
 */
async function recordSent(deps: SendDeps, input: SendInput, messageId: string, providerSid: string): Promise<void> {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const sent = await deps.admin
        .from("messages")
        .update({ status: "sent", provider_sid: providerSid, error: null })
        .eq("id", messageId);
      if (sent.error) throw new Error(sent.error.message);

      const at = input.now.toISOString();
      await deps.admin.from("conversations").update({ last_outbound_at: at }).eq("id", input.conversationId);
      await deps.admin.from("customers").update({ last_contacted_at: at }).eq("id", input.customerId);
      return;
    } catch (error) {
      if (attempt === 3) {
        console.error(
          JSON.stringify({
            event: "send_bookkeeping_failed",
            messageId,
            providerSid,
            error: error instanceof Error ? error.message : "unknown",
          }),
        );
      }
    }
  }
}
