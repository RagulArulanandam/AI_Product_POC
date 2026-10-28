import type { MessagingAdapter } from "@/adapters/messaging/interface";
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
