import { describe, expect, it } from "vitest";
import { parseInboundMessage, parseMessageStatus, parseVoice, stripWhatsAppPrefix, VOICE_REJECT_TWIML } from "@/adapters/messaging/parse";
import { inboundMedia, inboundMessage, statusCallback, voiceCall, voiceCallAnonymous, voiceCallWithheld } from "../fixtures/twilio/payloads";

describe("parseVoice", () => {
  it("returns the call SID, the caller and the dialled number", () => {
    expect(parseVoice(voiceCall)).toEqual({
      callSid: "CA11111111111111111111111111111111",
      from: "+447887153223",
      to: "+447460041934",
    });
  });

  it("treats withheld and anonymous callers as having no number", () => {
    expect(parseVoice(voiceCallWithheld)?.from).toBeNull();
    expect(parseVoice(voiceCallAnonymous)?.from).toBeNull();
    expect(parseVoice({ ...voiceCall, From: "" })?.from).toBeNull();
  });

  it("returns null when the call SID or dialled number is missing or malformed", () => {
    expect(parseVoice({ ...voiceCall, CallSid: "" })).toBeNull();
    expect(parseVoice({ ...voiceCall, To: "" })).toBeNull();
    expect(parseVoice({ ...voiceCall, To: "07460041934" })).toBeNull();
    expect(parseVoice({})).toBeNull();
  });
});

describe("parseInboundMessage", () => {
  it("strips the whatsapp: prefix and reads the body", () => {
    expect(parseInboundMessage(inboundMessage)).toEqual({
      providerSid: "SM11111111111111111111111111111111",
      from: "+447887153223",
      body: "I'd like a check-up Thursday",
      hasMedia: false,
    });
  });

  it("flags media messages", () => {
    expect(parseInboundMessage(inboundMedia)?.hasMedia).toBe(true);
  });

  it("rejects payloads without a SID or a usable sender", () => {
    expect(parseInboundMessage({ ...inboundMessage, MessageSid: "", SmsMessageSid: "" })).toBeNull();
    expect(parseInboundMessage({ ...inboundMessage, From: "whatsapp:nonsense" })).toBeNull();
  });

  it("strips the prefix in any case", () => {
    expect(stripWhatsAppPrefix("WhatsApp:+447887153223")).toBe("+447887153223");
    expect(stripWhatsAppPrefix(undefined)).toBe("");
  });
});

describe("parseMessageStatus", () => {
  it.each([
    ["sent", "sent"],
    ["delivered", "delivered"],
    ["read", "delivered"],
    ["failed", "failed"],
    ["undelivered", "failed"],
  ])("maps %s to %s", (raw, expected) => {
    expect(parseMessageStatus(statusCallback(raw))?.status).toBe(expected);
  });

  it.each(["queued", "accepted", "sending", "scheduled", "mystery", ""])("ignores in-flight or unknown status %j", (raw) => {
    expect(parseMessageStatus(statusCallback(raw))).toBeNull();
  });

  it("keeps the error code on failures", () => {
    expect(parseMessageStatus(statusCallback("undelivered", { ErrorCode: "63016" }))).toEqual({
      providerSid: "SM55555555555555555555555555555555",
      status: "failed",
      errorCode: "63016",
    });
    expect(parseMessageStatus(statusCallback("delivered"))).not.toHaveProperty("errorCode");
  });

  it("returns null without a message SID", () => {
    expect(parseMessageStatus({ MessageStatus: "delivered" })).toBeNull();
  });
});

describe("voice reject response", () => {
  it("rejects the call as busy", () => {
    expect(VOICE_REJECT_TWIML).toContain('<Reject reason="busy"/>');
  });
});
