import { randomUUID } from "node:crypto";
import twilio from "twilio";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { afterTasks } = vi.hoisted(() => ({ afterTasks: [] as (() => Promise<unknown>)[] }));
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return {
    ...actual,
    // `after` only works inside a real request, so capture what the routes schedule.
    after: (task: () => Promise<unknown>) => {
      afterTasks.push(task);
    },
  };
});

import { POST as voicePost } from "@/app/api/webhooks/voice/route";
import { POST as statusPost } from "@/app/api/webhooks/whatsapp/status/route";
import { getFakeMessaging } from "@/adapters/messaging";
import { TwilioMessagingAdapter } from "@/adapters/messaging/twilio";
import { twilioStatusProvider, twilioVoiceProvider } from "@/engine/providers/twilio";
import { handleWebhook, type WebhookDeps } from "@/engine/webhooks";
import type { Admin } from "@/engine/types";
import { serviceClient } from "../helpers/db";
import { ensureConversation } from "../helpers/tenant-tables";
import { cleanupTenants, createTenant, type Tenant } from "../helpers/tenants";
import { statusCallback, voiceCall, voiceCallWithheld } from "../fixtures/twilio/payloads";

const admin = serviceClient() as unknown as Admin;
const fake = getFakeMessaging();
const PUBLIC_BASE = "https://tunnel.example.com";
const savedBase = process.env.PUBLIC_BASE_URL;

let tenant: Tenant;
let dialled: string;

function post(path: string, params: Record<string, string>, signature: string | null = "fake-valid") {
  return new Request(`http://localhost:3000${path}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", ...(signature ? { "x-twilio-signature": signature } : {}) },
    body: new URLSearchParams(params).toString(),
  });
}

async function eventsFor(provider: string, eventId: string) {
  const { data } = await admin.from("webhook_events").select("*").eq("provider", provider).eq("provider_event_id", eventId);
  return data ?? [];
}

async function actionsFor(webhookEventId: string) {
  const { data } = await admin.from("scheduled_actions").select("*").eq("dedupe_key", `evt:${webhookEventId}`);
  return data ?? [];
}

beforeAll(async () => {
  process.env.PUBLIC_BASE_URL = PUBLIC_BASE;
  tenant = await createTenant("hooks");
  dialled = `+447700900${Math.floor(Math.random() * 800) + 100}`;
  await admin.from("phone_numbers").insert({ business_id: tenant.businessId, e164: dialled });
});

beforeEach(() => {
  afterTasks.length = 0;
  fake.reset();
  vi.restoreAllMocks();
});

afterAll(async () => {
  if (savedBase === undefined) delete process.env.PUBLIC_BASE_URL;
  else process.env.PUBLIC_BASE_URL = savedBase;
  await cleanupTenants();
});

describe("POST /api/webhooks/voice", () => {
  const params = (callSid: string, overrides: Record<string, string> = {}) => ({ ...voiceCall, CallSid: callSid, To: dialled, ...overrides });

  it("turns a call on a forwarding number into a call.missed event for that business, and rejects the call", async () => {
    const sid = `CA${randomUUID().replace(/-/g, "")}`;
    const res = await voicePost(post("/api/webhooks/voice", params(sid)));

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/xml");
    expect(await res.text()).toContain('<Reject reason="busy"/>');

    const [event] = await eventsFor("twilio-voice", sid);
    expect(event).toMatchObject({ business_id: tenant.businessId, status: "received" });
    expect(event.payload).toEqual({ type: "call.missed", data: { from: voiceCall.From, to: dialled } });
    const actions = await actionsFor(event.id);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ type: "handle_event", business_id: tenant.businessId, status: "pending" });
    expect(afterTasks).toHaveLength(1); // the worker runs after the response
  });

  it("stores a repeat delivery once but still answers with the reject", async () => {
    const sid = `CA${randomUUID().replace(/-/g, "")}`;
    const first = await voicePost(post("/api/webhooks/voice", params(sid)));
    const second = await voicePost(post("/api/webhooks/voice", params(sid)));
    expect(await first.text()).toContain("Reject");
    expect(await second.text()).toContain("Reject");

    const events = await eventsFor("twilio-voice", sid);
    expect(events).toHaveLength(1);
    expect(await actionsFor(events[0].id)).toHaveLength(1);
    expect(afterTasks).toHaveLength(1);
  });

  it("rejects the call but queues nothing for a number that belongs to no business", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const sid = `CA${randomUUID().replace(/-/g, "")}`;
    const res = await voicePost(post("/api/webhooks/voice", params(sid, { To: "+447700900099" })));
    expect(await res.text()).toContain("Reject");

    const [event] = await eventsFor("twilio-voice", sid);
    expect(event).toMatchObject({ business_id: null, status: "skipped" });
    expect(await actionsFor(event.id)).toHaveLength(0);
    expect(afterTasks).toHaveLength(0);
  });

  it("keeps a withheld caller number as null so the product can skip it", async () => {
    const sid = `CA${randomUUID().replace(/-/g, "")}`;
    await voicePost(post("/api/webhooks/voice", params(sid, { From: voiceCallWithheld.From })));
    const [event] = await eventsFor("twilio-voice", sid);
    expect((event.payload as { data: { from: unknown } }).data.from).toBeNull();
  });

  it("answers 403 and stores nothing for a bad or missing signature", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const sid = `CA${randomUUID().replace(/-/g, "")}`;
    for (const signature of ["forged", null]) {
      const res = await voicePost(post("/api/webhooks/voice", params(sid), signature));
      expect(res.status).toBe(403);
    }
    expect(await eventsFor("twilio-voice", sid)).toHaveLength(0);
    expect(afterTasks).toHaveLength(0);
  });

  it("answers 400 when the call SID is missing", async () => {
    const res = await voicePost(post("/api/webhooks/voice", { ...voiceCall, CallSid: "", To: dialled }));
    expect(res.status).toBe(400);
  });

  it("checks the signature against the public tunnel URL, not the local host", async () => {
    const spy = vi.spyOn(fake, "validateWebhook");
    await voicePost(post("/api/webhooks/voice?src=x", params(`CA${randomUUID().replace(/-/g, "")}`)));
    expect(spy.mock.calls[0][0].url).toBe("https://tunnel.example.com/api/webhooks/voice?src=x");
  });
});

describe("POST /api/webhooks/whatsapp/status", () => {
  let providerSid: string;

  beforeAll(async () => {
    const conversationId = await ensureConversation(admin, tenant.businessId);
    providerSid = `SM${randomUUID().replace(/-/g, "")}`;
    await admin.from("messages").insert({
      business_id: tenant.businessId, conversation_id: conversationId, direction: "outbound", sender: "system",
      status: "sent", body: "hi", provider_sid: providerSid,
    });
  });

  const status = (s: string, extra: Record<string, string> = {}) => statusCallback(s, { MessageSid: providerSid, ...extra });

  it("turns a delivery status into a message.status event for the message's business", async () => {
    const res = await statusPost(post("/api/webhooks/whatsapp/status", status("delivered")));
    expect(res.status).toBe(200);

    const [event] = await eventsFor("twilio-status", `${providerSid}:delivered`);
    expect(event).toMatchObject({ business_id: tenant.businessId });
    expect(event.payload).toEqual({ type: "message.status", data: { providerSid, status: "delivered", errorCode: null } });
    expect(await actionsFor(event.id)).toHaveLength(1);
  });

  it("keeps the error code when delivery fails", async () => {
    await statusPost(post("/api/webhooks/whatsapp/status", status("undelivered", { ErrorCode: "63016" })));
    const [event] = await eventsFor("twilio-status", `${providerSid}:failed`);
    expect((event.payload as { data: { errorCode: string } }).data.errorCode).toBe("63016");
  });

  it("treats each status of a message as its own event, and a repeat as a duplicate", async () => {
    await statusPost(post("/api/webhooks/whatsapp/status", status("sent")));
    await statusPost(post("/api/webhooks/whatsapp/status", status("sent")));
    expect(await eventsFor("twilio-status", `${providerSid}:sent`)).toHaveLength(1);
  });

  it("acknowledges in-flight statuses without storing anything", async () => {
    for (const s of ["queued", "sending", "accepted"]) {
      const res = await statusPost(post("/api/webhooks/whatsapp/status", status(s)));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true, ignored: true });
    }
    expect(await eventsFor("twilio-status", `${providerSid}:queued`)).toHaveLength(0);
  });

  it("rejects a bad signature and a payload without a message SID", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect((await statusPost(post("/api/webhooks/whatsapp/status", status("delivered"), "forged"))).status).toBe(403);
    expect((await statusPost(post("/api/webhooks/whatsapp/status", { MessageStatus: "delivered" }))).status).toBe(400);
  });
});

describe("status provider lookup", () => {
  it("waits briefly for a message SID that has not been saved yet, then gives up as unresolved", async () => {
    const provider = twilioStatusProvider(fake, { lookupAttempts: 2, lookupDelayMs: 5 });
    const event = await provider.parse(statusCallback("delivered", { MessageSid: "SMnever-saved" }), admin);
    expect(event).toMatchObject({ businessId: null, eventId: "SMnever-saved:delivered" });
  });

  it("finds the message on a later attempt when it is saved just after the callback", async () => {
    const conversationId = await ensureConversation(admin, tenant.businessId);
    const sid = `SM${randomUUID().replace(/-/g, "")}`;
    const provider = twilioStatusProvider(fake, { lookupAttempts: 12, lookupDelayMs: 50 });

    const parsing = provider.parse(statusCallback("delivered", { MessageSid: sid }), admin);
    const saved = new Promise<{ error: { message: string } | null }>((resolve) => {
      setTimeout(async () => {
        resolve(
          await admin.from("messages").insert({
            business_id: tenant.businessId, conversation_id: conversationId, direction: "outbound", sender: "system",
            status: "sent", body: "late", provider_sid: sid,
          }),
        );
      }, 60);
    });

    const event = await parsing;
    expect((await saved).error).toBeNull();
    expect(event).toMatchObject({ businessId: tenant.businessId });
  });
});

describe("with real Twilio signatures", () => {
  const authToken = "test-auth-token-0123456789";
  const adapter = new TwilioMessagingAdapter(
    { accountSid: "ACtest", authToken, whatsappFrom: "whatsapp:+447460077297", publicBaseUrl: PUBLIC_BASE },
    { messages: { create: async () => ({ sid: "SMx" }) } },
  );
  const deps = (): WebhookDeps => ({ admin, publicBaseUrl: PUBLIC_BASE, schedule: () => {}, runWorker: async () => {} });

  function signed(path: string, params: Record<string, string>, token = authToken) {
    const signature = twilio.getExpectedTwilioSignature(token, `${PUBLIC_BASE}${path}`, params);
    return post(path, params, signature);
  }

  it("accepts a correctly signed voice request and rejects a tampered or wrongly signed one", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const sid = `CA${randomUUID().replace(/-/g, "")}`;
    const params = { ...voiceCall, CallSid: sid, To: dialled };
    const provider = twilioVoiceProvider(adapter);

    expect((await handleWebhook(signed("/api/webhooks/voice", params), provider, deps())).status).toBe(200);
    expect(await eventsFor("twilio-voice", sid)).toHaveLength(1);

    const tamperedSid = `CA${randomUUID().replace(/-/g, "")}`;
    const tampered = post("/api/webhooks/voice", { ...params, CallSid: tamperedSid, From: "+447000000000" }, twilio.getExpectedTwilioSignature(authToken, `${PUBLIC_BASE}/api/webhooks/voice`, params));
    expect((await handleWebhook(tampered, provider, deps())).status).toBe(403);

    const wrongToken = signed("/api/webhooks/voice", { ...params, CallSid: `CA${randomUUID().replace(/-/g, "")}` }, "another-token-0123456789");
    expect((await handleWebhook(wrongToken, provider, deps())).status).toBe(403);
    expect(await eventsFor("twilio-voice", tamperedSid)).toHaveLength(0);
  });
});
