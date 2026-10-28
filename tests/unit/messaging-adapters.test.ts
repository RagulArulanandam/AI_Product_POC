import twilio from "twilio";
import { describe, expect, it, vi } from "vitest";
import { mapTwilioError } from "@/adapters/messaging/errors";
import { FakeMessagingAdapter } from "@/adapters/messaging/fake";
import type { MessagingAdapter } from "@/adapters/messaging/interface";
import { VOICE_REJECT_TWIML } from "@/adapters/messaging/parse";
import { TwilioMessagingAdapter, type TwilioLikeClient } from "@/adapters/messaging/twilio";
import { getFakeMessaging, getMessaging } from "@/adapters/messaging";
import { AdapterError } from "@/lib/errors";
import { voiceCall } from "../fixtures/twilio/payloads";

const AUTH_TOKEN = "test-auth-token-0123456789";
const BASE = "https://tunnel.example.com";

type CreateArgs = Parameters<TwilioLikeClient["messages"]["create"]>[0];

function twilioWithStub(
  create: TwilioLikeClient["messages"]["create"] = vi.fn(async (args: CreateArgs) => {
    void args;
    return { sid: "SMstub000001" };
  }),
) {
  const client: TwilioLikeClient = { messages: { create } };
  const adapter = new TwilioMessagingAdapter(
    { accountSid: "ACtest", authToken: AUTH_TOKEN, whatsappFrom: "whatsapp:+447460077297", publicBaseUrl: BASE },
    client,
  );
  return { adapter, create };
}

// The same behaviour is required of every implementation (integrations.md section 8).
const implementations: [string, () => MessagingAdapter][] = [
  ["fake", () => new FakeMessagingAdapter()],
  ["twilio (stubbed client)", () => twilioWithStub().adapter],
];

describe.each(implementations)("messaging adapter contract: %s", (_name, make) => {
  it("sends to an E.164 number and returns a provider SID", async () => {
    const result = await make().sendMessage({ to: "+447887153223", body: "Hello" });
    expect(result.providerSid).toMatch(/^SM/);
  });

  it("rejects recipients that are not E.164, without retrying", async () => {
    for (const to of ["07887153223", "whatsapp:+447887153223", "", "+0123"]) {
      const error = await make().sendMessage({ to, body: "Hello" }).catch((e) => e);
      expect(error).toBeInstanceOf(AdapterError);
      expect(error.code).toBe("invalid_request");
      expect(error.retryable).toBe(false);
    }
  });

  it("rejects an empty body", async () => {
    const error = await make().sendMessage({ to: "+447887153223", body: "   " }).catch((e) => e);
    expect(error).toMatchObject({ code: "invalid_request" });
  });

  it("answers incoming calls with a reject response", () => {
    expect(make().voiceResponse()).toBe(VOICE_REJECT_TWIML);
  });

  it("parses voice payloads the same way", () => {
    expect(make().parseVoice(voiceCall)?.callSid).toBe(voiceCall.CallSid);
  });
});

describe("TwilioMessagingAdapter", () => {
  it("sends from the configured WhatsApp sender with a whatsapp: recipient and a status callback", async () => {
    const { adapter, create } = twilioWithStub();
    await adapter.sendMessage({ to: "+447887153223", body: "Hi there" });
    expect(create).toHaveBeenCalledWith({
      from: "whatsapp:+447460077297",
      to: "whatsapp:+447887153223",
      body: "Hi there",
      statusCallback: "https://tunnel.example.com/api/webhooks/whatsapp/status",
    });
  });

  it("copes with a trailing slash on the public base URL", async () => {
    const create = vi.fn(async (args: CreateArgs) => {
      void args;
      return { sid: "SMstub000002" };
    });
    const adapter = new TwilioMessagingAdapter(
      { accountSid: "ACtest", authToken: AUTH_TOKEN, whatsappFrom: "whatsapp:+447460077297", publicBaseUrl: `${BASE}//` },
      { messages: { create } },
    );
    await adapter.sendMessage({ to: "+447887153223", body: "x" });
    expect(create.mock.calls[0][0].statusCallback).toBe("https://tunnel.example.com/api/webhooks/whatsapp/status");
  });

  it("maps vendor failures to AdapterError", async () => {
    const create = vi.fn(async () => {
      throw Object.assign(new Error("Channel Sandbox can only send messages to phone numbers that have joined"), { status: 400, code: 63015 });
    });
    const error = await twilioWithStub(create).adapter.sendMessage({ to: "+447887153223", body: "x" }).catch((e) => e);
    expect(error).toBeInstanceOf(AdapterError);
    expect(error).toMatchObject({ code: "unreachable_recipient", retryable: false });
  });
});

describe("Twilio signature validation", () => {
  const { adapter } = twilioWithStub();
  const url = "https://tunnel.example.com/api/webhooks/voice";
  const params = { CallSid: voiceCall.CallSid, From: voiceCall.From, To: voiceCall.To };
  const sign = (u: string, p: Record<string, string>) => twilio.getExpectedTwilioSignature(AUTH_TOKEN, u, p);

  it("accepts a correctly signed request", () => {
    expect(adapter.validateWebhook({ url, params, signature: sign(url, params) })).toBe(true);
  });

  it("rejects a tampered parameter", () => {
    expect(adapter.validateWebhook({ url, params: { ...params, From: "+447000000000" }, signature: sign(url, params) })).toBe(false);
  });

  it("rejects a signature made for a different URL (for example the local host instead of the tunnel)", () => {
    const local = "http://localhost:3000/api/webhooks/voice";
    expect(adapter.validateWebhook({ url, params, signature: sign(local, params) })).toBe(false);
  });

  it("rejects a signature made with a different auth token", () => {
    const other = twilio.getExpectedTwilioSignature("some-other-token-0123456789", url, params);
    expect(adapter.validateWebhook({ url, params, signature: other })).toBe(false);
  });

  it("rejects missing or garbage signatures", () => {
    expect(adapter.validateWebhook({ url, params, signature: null })).toBe(false);
    expect(adapter.validateWebhook({ url, params, signature: "" })).toBe(false);
    expect(adapter.validateWebhook({ url, params, signature: "not-a-signature" })).toBe(false);
  });
});

describe("mapTwilioError", () => {
  it.each([
    [{ code: 63016, status: 400 }, "outside_window", false],
    [{ code: 63015, status: 400 }, "unreachable_recipient", false],
    [{ code: 21211, status: 400 }, "invalid_request", false],
    [{ code: 20003, status: 401 }, "auth", false],
    [{ code: 20429, status: 429 }, "rate_limited", true],
    [{ status: 401 }, "auth", false],
    [{ status: 403 }, "auth", false],
    [{ status: 429 }, "rate_limited", true],
    [{ status: 404 }, "not_found", false],
    [{ status: 400 }, "invalid_request", false],
    [{ status: 500 }, "provider_unavailable", true],
    [{ status: 503 }, "provider_unavailable", true],
    [{}, "provider_unavailable", true],
  ])("maps %j to %s (retryable: %s)", (input, code, retryable) => {
    const error = mapTwilioError(Object.assign(new Error("boom"), input));
    expect(error.code).toBe(code);
    expect(error.retryable).toBe(retryable);
  });

  it("copes with non-error values and keeps the cause", () => {
    expect(mapTwilioError(undefined).code).toBe("provider_unavailable");
    const cause = new Error("x");
    expect(mapTwilioError(cause).cause).toBe(cause);
  });
});

describe("FakeMessagingAdapter", () => {
  it("records sends, numbers the SIDs, and can be told to fail", async () => {
    const fake = new FakeMessagingAdapter();
    const first = await fake.sendMessage({ to: "+447887153223", body: "one" });
    const second = await fake.sendMessage({ to: "+447887153223", body: "two" });
    expect([first.providerSid, second.providerSid]).toEqual(["SMfake000001", "SMfake000002"]);
    expect(fake.sent.map((m) => m.body)).toEqual(["one", "two"]);

    fake.failNext(new AdapterError("rate_limited", "slow down"));
    await expect(fake.sendMessage({ to: "+447887153223", body: "three" })).rejects.toMatchObject({ code: "rate_limited" });
    expect(fake.sent).toHaveLength(2);
    await expect(fake.sendMessage({ to: "+447887153223", body: "four" })).resolves.toBeDefined();

    fake.reset();
    expect(fake.sent).toEqual([]);
  });

  it("validates only its own signature value", () => {
    const fake = new FakeMessagingAdapter();
    const input = { url: "u", params: {} };
    expect(fake.validateWebhook({ ...input, signature: "fake-valid" })).toBe(true);
    expect(fake.validateWebhook({ ...input, signature: "other" })).toBe(false);
    expect(fake.validateWebhook({ ...input, signature: null })).toBe(false);
  });
});

describe("getMessaging", () => {
  it("returns the shared fake under test, so tests can inspect sends", () => {
    expect(getMessaging()).toBe(getFakeMessaging());
    expect(getMessaging()).toBe(getMessaging());
  });
});
