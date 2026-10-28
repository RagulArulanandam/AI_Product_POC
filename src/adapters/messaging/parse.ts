import type { InboundMessage, MessageStatusUpdate, VoiceCall } from "./interface";

/** Pure parsing of Twilio webhook payloads, shared by the real and fake adapters. */

const E164 = /^\+[1-9]\d{6,14}$/;
// Placeholders Twilio sends when the caller hides or the network drops the number.
const WITHHELD = new Set(["+266696687", "+86282452253531"]);

export function stripWhatsAppPrefix(value: string | undefined): string {
  return (value ?? "").replace(/^whatsapp:/i, "").trim();
}

export function parseInboundMessage(params: Record<string, string>): InboundMessage | null {
  const providerSid = params.MessageSid || params.SmsMessageSid;
  const from = stripWhatsAppPrefix(params.From);
  if (!providerSid || !E164.test(from)) return null;
  return { providerSid, from, body: params.Body ?? "", hasMedia: Number(params.NumMedia ?? "0") > 0 };
}

export function parseMessageStatus(params: Record<string, string>): MessageStatusUpdate | null {
  const providerSid = params.MessageSid || params.SmsSid;
  if (!providerSid) return null;

  const raw = (params.MessageStatus || params.SmsStatus || "").toLowerCase();
  const status: MessageStatusUpdate["status"] | null =
    raw === "sent"
      ? "sent"
      : raw === "delivered" || raw === "read"
        ? "delivered"
        : raw === "failed" || raw === "undelivered"
          ? "failed"
          : null;
  if (!status) return null;

  return { providerSid, status, ...(params.ErrorCode ? { errorCode: params.ErrorCode } : {}) };
}

export function parseVoice(params: Record<string, string>): VoiceCall | null {
  const callSid = params.CallSid;
  const to = (params.To ?? "").trim();
  if (!callSid || !E164.test(to)) return null;

  const from = (params.From ?? "").trim();
  return { callSid, to, from: E164.test(from) && !WITHHELD.has(from) ? from : null };
}

/** Rejecting an incoming call is free and tells the caller we are busy (integrations.md). */
export const VOICE_REJECT_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response><Reject reason="busy"/></Response>';

export function isE164(value: string): boolean {
  return E164.test(value);
}
