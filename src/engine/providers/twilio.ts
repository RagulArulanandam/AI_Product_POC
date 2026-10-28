import type { MessagingAdapter } from "@/adapters/messaging/interface";
import { isStopMessage } from "../optout";
import type { Admin } from "../types";
import type { WebhookProvider } from "../webhooks";

/** Twilio signs requests with this header (integrations.md section 2). */
const SIGNATURE_HEADER = "x-twilio-signature";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Incoming call on a business's forwarding number. With conditional forwarding every call that
 * arrives was already missed, so each one becomes a `call.missed` event. The dialled number
 * identifies the business; the answer is a reject, so nothing is billed.
 */
export function twilioVoiceProvider(messaging: MessagingAdapter): WebhookProvider {
  return {
    name: "twilio-voice",
    signatureHeader: SIGNATURE_HEADER,
    verify: (input) => messaging.validateWebhook(input),
    parse: async (params, admin) => {
      const call = messaging.parseVoice(params);
      if (!call) return null;

      const { data: number } = await admin.from("phone_numbers").select("business_id").eq("e164", call.to).maybeSingle();
      return {
        eventId: call.callSid,
        type: "call.missed",
        data: { from: call.from, to: call.to },
        businessId: number?.business_id ?? null,
      };
    },
    // Always reject the call, even for unknown numbers or repeat deliveries.
    respond: () => new Response(messaging.voiceResponse(), { headers: { "content-type": "text/xml" } }),
  };
}

export interface StatusProviderOptions {
  /**
   * A status can arrive a moment before we have saved the message's SID. The business is found
   * through that SID, so the lookup is repeated a few times.
   */
  lookupAttempts?: number;
  lookupDelayMs?: number;
}

/** Delivery status callbacks for messages we sent (queued, sent, delivered, failed). */
export function twilioStatusProvider(messaging: MessagingAdapter, options: StatusProviderOptions = {}): WebhookProvider {
  const attempts = options.lookupAttempts ?? 3;
  const delayMs = options.lookupDelayMs ?? 400;

  return {
    name: "twilio-status",
    signatureHeader: SIGNATURE_HEADER,
    verify: (input) => messaging.validateWebhook(input),
    parse: async (params, admin) => {
      if (!params.MessageSid && !params.SmsSid) return null;
      const update = messaging.parseMessageStatus(params);
      if (!update) return "ignore"; // queued, sending, and the like

      let businessId: string | null = null;
      for (let attempt = 1; attempt <= attempts && !businessId; attempt += 1) {
        const { data } = await admin.from("messages").select("business_id").eq("provider_sid", update.providerSid).maybeSingle();
        businessId = data?.business_id ?? null;
        if (!businessId && attempt < attempts) await sleep(delayMs);
      }

      return {
        eventId: `${update.providerSid}:${update.status}`,
        type: "message.status",
        data: { providerSid: update.providerSid, status: update.status, errorCode: update.errorCode ?? null },
        businessId,
      };
    },
  };
}

const OPEN_STATES = ["pending_send", "awaiting_reply", "in_conversation", "offering_slots"];

/**
 * The shared WhatsApp sender means a reply carries no business, only the customer's number. It
 * belongs to that number's most recent open conversation, across businesses (entities.md
 * section 5). Returns null when there is none, and flags when several businesses are in play.
 */
export async function resolveOpenConversation(
  admin: Admin,
  phone: string,
): Promise<{ conversationId: string; businessId: string; ambiguous: boolean } | null> {
  const { data: customers } = await admin.from("customers").select("id").eq("phone_e164", phone);
  const customerIds = (customers ?? []).map((c) => c.id);
  if (customerIds.length === 0) return null;

  const { data } = await admin
    .from("conversations")
    .select("id, business_id, started_at")
    .in("customer_id", customerIds)
    .in("state", OPEN_STATES)
    .order("started_at", { ascending: false });

  const rows = data ?? [];
  if (rows.length === 0) return null;
  const businesses = new Set(rows.map((r) => r.business_id));
  return { conversationId: rows[0].id, businessId: rows[0].business_id, ambiguous: businesses.size > 1 };
}

/** An inbound WhatsApp message from a customer, routed to their open conversation. */
export function twilioInboundProvider(messaging: MessagingAdapter): WebhookProvider {
  return {
    name: "twilio-whatsapp",
    signatureHeader: SIGNATURE_HEADER,
    verify: (input) => messaging.validateWebhook(input),
    parse: async (params, admin) => {
      const message = messaging.parseInboundMessage(params);
      if (!message) return null;

      const open = await resolveOpenConversation(admin, message.from);
      if (open?.ambiguous) {
        console.warn(JSON.stringify({ event: "webhook_ambiguous_conversation", provider: "twilio-whatsapp" }));
      }
      return {
        eventId: message.providerSid,
        type: "message.inbound",
        data: { from: message.from, body: message.body, hasMedia: message.hasMedia },
        businessId: open?.businessId ?? null,
        conversationId: open?.conversationId ?? null,
      };
    },
    // A STOP from someone we have no open conversation with must still opt them out.
    onUnresolved: async (event, admin) => {
      const from = typeof event.data.from === "string" ? event.data.from : null;
      const body = typeof event.data.body === "string" ? event.data.body : "";
      if (from && isStopMessage(body)) {
        await admin.from("opt_outs").upsert({ phone_e164: from }, { onConflict: "phone_e164", ignoreDuplicates: true });
      }
    },
    // Twilio only needs a 2xx. (The trial environment does not support TwiML replies anyway.)
    respond: () => new Response(null, { status: 200 }),
  };
}
