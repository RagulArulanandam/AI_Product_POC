import { validateRequest } from "twilio";
import { describe, expect, it } from "vitest";
import { buildSignedCall } from "../../scripts/simulate-twilio-call";

const TOKEN = "test-auth-token-1234567890";

describe("buildSignedCall", () => {
  it("produces a request our Twilio signature check accepts", () => {
    const call = buildSignedCall({ base: "https://app.example.com/", from: "+447700900123", to: "+447460041934", authToken: TOKEN });
    const params = Object.fromEntries(new URLSearchParams(call.body));

    expect(call.url).toBe("https://app.example.com/api/webhooks/voice");
    expect(validateRequest(TOKEN, call.signature, call.url, params)).toBe(true);
    expect(validateRequest("another-token-0987654321", call.signature, call.url, params)).toBe(false);
  });

  it("carries the caller, the dialled number and a fresh call id each time", () => {
    const a = buildSignedCall({ base: "https://x.test", from: "+447700900123", to: "+447460041934", authToken: TOKEN });
    const b = buildSignedCall({ base: "https://x.test", from: "+447700900123", to: "+447460041934", authToken: TOKEN });
    const params = Object.fromEntries(new URLSearchParams(a.body));

    expect(params).toMatchObject({ From: "+447700900123", To: "+447460041934", CallStatus: "ringing" });
    expect(a.callSid).toMatch(/^CA[0-9a-f]{32}$/);
    expect(a.callSid).not.toBe(b.callSid);
  });
});
