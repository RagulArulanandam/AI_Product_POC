/** Webhook payloads in the shape Twilio posts them (form fields). Fake numbers and SIDs only. */

export const voiceCall = {
  CallSid: "CA11111111111111111111111111111111",
  CallStatus: "ringing",
  Direction: "inbound",
  From: "+447887153223",
  To: "+447460041934",
};

export const voiceCallWithheld = { ...voiceCall, CallSid: "CA22222222222222222222222222222222", From: "+266696687" };
export const voiceCallAnonymous = { ...voiceCall, CallSid: "CA33333333333333333333333333333333", From: "anonymous" };

export const inboundMessage = {
  MessageSid: "SM11111111111111111111111111111111",
  SmsMessageSid: "SM11111111111111111111111111111111",
  From: "whatsapp:+447887153223",
  To: "whatsapp:+447460077297",
  Body: "I'd like a check-up Thursday",
  NumMedia: "0",
  ProfileName: "Test Customer",
};

export const inboundMedia = { ...inboundMessage, MessageSid: "SM44444444444444444444444444444444", Body: "", NumMedia: "1" };

export function statusCallback(status: string, extra: Record<string, string> = {}) {
  return {
    MessageSid: "SM55555555555555555555555555555555",
    MessageStatus: status,
    From: "whatsapp:+447460077297",
    To: "whatsapp:+447887153223",
    ...extra,
  };
}
