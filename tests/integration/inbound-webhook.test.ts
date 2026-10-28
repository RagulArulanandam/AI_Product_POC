import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { afterTasks } = vi.hoisted(() => ({ afterTasks: [] as (() => Promise<unknown>)[] }));
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: (task: () => Promise<unknown>) => void afterTasks.push(task) };
});

import { POST } from "@/app/api/webhooks/whatsapp/route";
import { getFakeMessaging } from "@/adapters/messaging";
import { resolveOpenConversation } from "@/engine/providers/twilio";
import type { Admin } from "@/engine/types";
import { serviceClient } from "../helpers/db";
import { missedCallProductId } from "../helpers/tenant-tables";
import { cleanupTenants, createTenant, type Tenant } from "../helpers/tenants";
import { inboundMedia, inboundMessage } from "../fixtures/twilio/payloads";

const admin = serviceClient() as unknown as Admin;
const fake = getFakeMessaging();
const PHONE = "+447700900501";
const savedBase = process.env.PUBLIC_BASE_URL;

let a: Tenant;
let b: Tenant;
let productId: string;

function post(params: Record<string, string>, signature: string | null = "fake-valid") {
  return POST(
    new Request("http://localhost:3000/api/webhooks/whatsapp", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", ...(signature ? { "x-twilio-signature": signature } : {}) },
      body: new URLSearchParams(params).toString(),
    }),
  );
}

const message = (body: string, sid = `SM${randomUUID().replace(/-/g, "")}`) => ({
  ...inboundMessage,
  MessageSid: sid,
  SmsMessageSid: sid,
  From: `whatsapp:${PHONE}`,
  Body: body,
});

async function openConversation(tenant: Tenant, state = "awaiting_reply", startedAt = new Date()): Promise<string> {
  const { data: customer } = await admin
    .from("customers")
    .upsert({ business_id: tenant.businessId, phone_e164: PHONE }, { onConflict: "business_id,phone_e164" })
    .select("id")
    .single();
  const { data } = await admin
    .from("conversations")
    .insert({ business_id: tenant.businessId, customer_id: customer!.id, product_id: productId, state, started_at: startedAt.toISOString() })
    .select("id")
    .single();
  return data!.id;
}

async function eventsFor(sid: string) {
  const { data } = await admin.from("webhook_events").select("*").eq("provider", "twilio-whatsapp").eq("provider_event_id", sid);
  return data ?? [];
}

beforeAll(async () => {
  process.env.PUBLIC_BASE_URL = "https://tunnel.example.com";
  a = await createTenant("in-a");
  b = await createTenant("in-b");
  productId = await missedCallProductId(admin);
});

beforeEach(async () => {
  afterTasks.length = 0;
  fake.reset();
  vi.restoreAllMocks();
  for (const t of [a, b]) {
    for (const table of ["scheduled_actions", "webhook_events", "conversations"] as const) {
      await admin.from(table).delete().eq("business_id", t.businessId);
    }
  }
  await admin.from("opt_outs").delete().eq("phone_e164", PHONE);
});

afterAll(async () => {
  await admin.from("opt_outs").delete().eq("phone_e164", PHONE);
  if (savedBase === undefined) delete process.env.PUBLIC_BASE_URL;
  else process.env.PUBLIC_BASE_URL = savedBase;
  await cleanupTenants();
});

describe("POST /api/webhooks/whatsapp: routing", () => {
  it("turns a reply into a message.inbound event for the customer's open conversation", async () => {
    const conversationId = await openConversation(a);
    const params = message("What are your opening hours?");
    const res = await post(params);
    expect(res.status).toBe(200);

    const [event] = await eventsFor(params.MessageSid);
    expect(event).toMatchObject({ business_id: a.businessId, status: "received" });
    expect(event.payload).toEqual({
      type: "message.inbound",
      data: { from: PHONE, body: "What are your opening hours?", hasMedia: false },
      conversation_id: conversationId,
    });

    const { data: action } = await admin.from("scheduled_actions").select("*").eq("dedupe_key", `evt:${event.id}`).single();
    expect(action).toMatchObject({ type: "handle_event", business_id: a.businessId, conversation_id: conversationId, status: "pending" });
    expect(afterTasks).toHaveLength(1);
  });

  it("stores a provider retry of the same message once", async () => {
    await openConversation(a);
    const params = message("Hello");
    for (let i = 0; i < 3; i += 1) expect((await post(params)).status).toBe(200);

    const events = await eventsFor(params.MessageSid);
    expect(events).toHaveLength(1);
    const { count } = await admin.from("scheduled_actions").select("*", { count: "exact", head: true }).eq("dedupe_key", `evt:${events[0].id}`);
    expect(count).toBe(1);
    expect(afterTasks).toHaveLength(1);
  });

  it("flags media messages", async () => {
    await openConversation(a);
    const params = { ...inboundMedia, From: `whatsapp:${PHONE}` };
    await post(params);
    const [event] = await eventsFor(params.MessageSid);
    expect((event.payload as { data: { hasMedia: boolean } }).data.hasMedia).toBe(true);
  });

  it("records but does not queue a reply from someone with no open conversation", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const params = message("Hello?");
    expect((await post(params)).status).toBe(200);
    const [event] = await eventsFor(params.MessageSid);
    expect(event).toMatchObject({ business_id: null, status: "skipped" });
    expect(afterTasks).toHaveLength(0);
  });

  it.each(["booked", "escalated", "expired", "opted_out", "failed", "enquiry_logged"])(
    "does not route to a %s conversation",
    async (state) => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      await openConversation(a, state);
      const params = message("Hi again");
      await post(params);
      expect((await eventsFor(params.MessageSid))[0]).toMatchObject({ business_id: null, status: "skipped" });
    },
  );

  it.each(["pending_send", "awaiting_reply", "in_conversation", "offering_slots"])("routes to a %s conversation", async (state) => {
    await openConversation(a, state);
    const params = message("Hi");
    await post(params);
    expect((await eventsFor(params.MessageSid))[0].business_id).toBe(a.businessId);
  });

  it("routes to the most recent open conversation when several businesses are talking to the same number", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await openConversation(a, "awaiting_reply", new Date(Date.now() - 3_600_000));
    const newer = await openConversation(b, "awaiting_reply", new Date());
    const params = message("Which one is this for?");
    await post(params);

    const [event] = await eventsFor(params.MessageSid);
    expect(event.business_id).toBe(b.businessId);
    expect((event.payload as { conversation_id: string }).conversation_id).toBe(newer);
    expect(warn.mock.calls.map((c) => JSON.parse(String(c[0])).event)).toContain("webhook_ambiguous_conversation");
  });

  it("never routes to another number's conversation", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await openConversation(a);
    const params = { ...message("Hi"), From: "whatsapp:+447700900599" };
    await post(params);
    expect((await eventsFor(params.MessageSid))[0].business_id).toBeNull();
  });
});

describe("STOP handling at the webhook", () => {
  async function optedOut() {
    const { data } = await admin.from("opt_outs").select("phone_e164").eq("phone_e164", PHONE);
    return (data ?? []).length === 1;
  }

  it("opts a number out even when there is no conversation to attach the message to", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const text of ["STOP", "stop", " Unsubscribe "]) {
      await admin.from("opt_outs").delete().eq("phone_e164", PHONE);
      await post(message(text));
      expect(await optedOut(), text).toBe(true);
    }
  });

  it("is harmless to repeat", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await post(message("STOP"));
    await post(message("STOP"));
    expect(await optedOut()).toBe(true);
  });

  it("does not opt anyone out for ordinary words when nothing matches", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await post(message("please don't stop by"));
    expect(await optedOut()).toBe(false);
  });

  it("leaves a STOP with a conversation for the conversation handler (it also acknowledges)", async () => {
    await openConversation(a);
    const params = message("STOP");
    await post(params);
    expect(await optedOut()).toBe(false); // recorded by the handler, after the acknowledgement
    expect((await eventsFor(params.MessageSid))[0].business_id).toBe(a.businessId);
  });
});

describe("POST /api/webhooks/whatsapp: security", () => {
  it("rejects a bad or missing signature and stores nothing", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await openConversation(a);
    const params = message("Hello");
    expect((await post(params, "forged")).status).toBe(403);
    expect((await post(params, null)).status).toBe(403);
    expect(await eventsFor(params.MessageSid)).toHaveLength(0);
    expect(afterTasks).toHaveLength(0);
  });

  it("does not let a forged STOP opt anyone out", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await post(message("STOP"), "forged");
    const { data } = await admin.from("opt_outs").select("id").eq("phone_e164", PHONE);
    expect(data ?? []).toHaveLength(0);
  });

  it("answers 400 for a payload without a sender or message id", async () => {
    expect((await post({ Body: "hi" })).status).toBe(400);
    expect((await post({ ...message("hi"), From: "whatsapp:nonsense" })).status).toBe(400);
  });
});

describe("resolveOpenConversation", () => {
  it("returns null for numbers we have never spoken to", async () => {
    expect(await resolveOpenConversation(admin, "+447700900588")).toBeNull();
  });

  it("serialises one conversation's messages by putting the conversation on the queued action", async () => {
    const conversationId = await openConversation(a);
    await post(message("first"));
    await post(message("second"));

    const first = await admin.rpc("claim_due_actions", { batch: 1 });
    expect(first.data).toHaveLength(1);
    expect(first.data![0].conversation_id).toBe(conversationId);
    // The second message of the same conversation waits until the first is finished.
    const second = await admin.rpc("claim_due_actions", { batch: 1 });
    expect(second.data).toHaveLength(0);
  });
});
