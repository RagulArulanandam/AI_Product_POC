import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { FakeMessagingAdapter } from "@/adapters/messaging/fake";
import type { EngineDeps } from "@/engine/runner";
import type { Admin } from "@/engine/types";
import { ingestWebhookEvent } from "@/engine/webhooks";
import { runDueActions } from "@/engine/worker";
import { AdapterError } from "@/lib/errors";
import { getProduct } from "@/products/registry";
import { serviceClient } from "../helpers/db";
import { missedCallProductId } from "../helpers/tenant-tables";
import { cleanupTenants, createTenant, type Tenant } from "../helpers/tenants";

// Product 1 outbound behaviour (product-missed-call.md scenarios 1 and 2, plus the conditions),
// against the real database with a fake messenger. Times are far in the future so scheduled
// actions are never due until a test makes them due.

const admin = serviceClient() as unknown as Admin;
const fake = new FakeMessagingAdapter();
const CUSTOMER = "+447700900401";
const DIALLED = "+447700900499";
const MIN = 60_000;
const HOUR = 3_600_000;

// Monday 7 January 2030, 10:00 GMT (business open). 20:00 is closed.
const MONDAY_10 = new Date("2030-01-07T10:00:00Z");
const clock = { now: MONDAY_10 };
const at = (h: number, m = 0) => new Date(Date.UTC(2030, 0, 7, h, m));

const deps: EngineDeps = {
  admin,
  products: [getProduct("missed-call")!],
  now: () => clock.now,
  services: { messaging: () => fake },
};

let tenant: Tenant;
let productId: string;

async function configure(config: Record<string, unknown> = {}, enabled = true) {
  const { error } = await admin
    .from("business_products")
    .upsert({ business_id: tenant.businessId, product_id: productId, enabled, config: config as never }, { onConflict: "business_id,product_id" });
  if (error) throw new Error(error.message);
}

async function receiveCall(options: { from?: string | null; callSid?: string; provider?: string; skipDedupe?: boolean } = {}) {
  const callSid = options.callSid ?? `CA${randomUUID().replace(/-/g, "")}`;
  const result = await ingestWebhookEvent(admin, options.provider ?? "test", {
    eventId: callSid,
    type: "call.missed",
    data: { from: options.from === undefined ? CUSTOMER : options.from, to: DIALLED, ...(options.skipDedupe ? { skip_dedupe: true } : {}) },
    businessId: tenant.businessId,
  });
  return { callSid, ...result };
}

async function receiveStatus(providerSid: string, status: string, errorCode: string | null = null) {
  return ingestWebhookEvent(admin, "test", {
    eventId: `${providerSid}:${status}:${randomUUID()}`,
    type: "message.status",
    data: { providerSid, status, errorCode },
    businessId: tenant.businessId,
  });
}

const drain = () => runDueActions(deps);

/** Makes pending actions of the given types due now (their scheduled times are far in the future). */
async function makeDue(...types: string[]) {
  await admin
    .from("scheduled_actions")
    .update({ run_at: "2000-01-01T00:00:00Z" })
    .eq("business_id", tenant.businessId)
    .eq("status", "pending")
    .in("type", types);
}

async function conversations() {
  const { data } = await admin.from("conversations").select("*").eq("business_id", tenant.businessId).order("started_at");
  return data ?? [];
}
async function actions(type: string) {
  const { data } = await admin.from("scheduled_actions").select("*").eq("business_id", tenant.businessId).eq("type", type).order("created_at");
  return data ?? [];
}
async function messages() {
  const { data } = await admin.from("messages").select("*").eq("business_id", tenant.businessId).order("created_at");
  return data ?? [];
}
async function logReasons() {
  const { data } = await admin.from("automation_logs").select("reason").eq("business_id", tenant.businessId);
  return (data ?? []).map((l) => l.reason);
}

/** Runs the missed call and the first send; returns the conversation. */
async function sendFirstMessage() {
  await receiveCall();
  await drain();
  await makeDue("send_first_message");
  await drain();
  return (await conversations())[0];
}

beforeAll(async () => {
  tenant = await createTenant("p1out");
  productId = await missedCallProductId(admin);
});

beforeEach(async () => {
  fake.reset();
  clock.now = MONDAY_10;
  for (const table of ["scheduled_actions", "webhook_events", "automation_logs", "conversations", "customers"] as const) {
    await admin.from(table).delete().eq("business_id", tenant.businessId);
  }
  await admin.from("opt_outs").delete().eq("phone_e164", CUSTOMER);
  await admin.from("businesses").update({ status: "active" }).eq("id", tenant.businessId);
  await admin.from("subscriptions").update({ status: "trial" }).eq("business_id", tenant.businessId);
  await configure({});
});

afterAll(async () => {
  await admin.from("opt_outs").delete().eq("phone_e164", CUSTOMER);
  await cleanupTenants();
});

describe("scenario 1: missed call during hours -> message after the delay", () => {
  it("opens a conversation, waits for the configured delay, then sends the first message", async () => {
    await receiveCall({ callSid: "CAscenario1" });
    const summary = await drain();
    expect(summary).toMatchObject({ claimed: 1, done: 1 });

    const [conversation] = await conversations();
    expect(conversation).toMatchObject({ state: "pending_send", trigger_call_sid: "CAscenario1" });
    expect(new Date(conversation.started_at).getTime()).toBe(MONDAY_10.getTime());
    const { data: customer } = await admin.from("customers").select("phone_e164").eq("id", conversation.customer_id).single();
    expect(customer?.phone_e164).toBe(CUSTOMER);

    // Scheduled two minutes out (the default delay), and nothing is sent yet.
    const [send] = await actions("send_first_message");
    expect(send).toMatchObject({ status: "pending", conversation_id: conversation.id });
    expect(new Date(send.run_at).getTime()).toBe(MONDAY_10.getTime() + 2 * MIN);
    expect(fake.sent).toHaveLength(0);
    expect(await logReasons()).toContain("first_message_scheduled");

    // When the delay has passed, the message goes out.
    await makeDue("send_first_message");
    expect(await drain()).toMatchObject({ claimed: 1, done: 1 });

    expect(fake.sent).toHaveLength(1);
    expect(fake.sent[0].to).toBe(CUSTOMER);
    expect(fake.sent[0].body).toBe(`Hi, this is ${await businessName()}. Sorry we missed your call. How can we help?`);

    const [after] = await conversations();
    expect(after.state).toBe("awaiting_reply");
    expect(new Date(after.expires_at!).getTime()).toBe(MONDAY_10.getTime() + 24 * HOUR);
    expect(new Date(after.last_outbound_at!).getTime()).toBe(MONDAY_10.getTime());

    const [message] = await messages();
    expect(message).toMatchObject({ direction: "outbound", status: "sent", provider_sid: fake.sent[0].providerSid, sender: "system" });
    const [expire] = await actions("expire_conversation");
    expect(new Date(expire.run_at).getTime()).toBe(MONDAY_10.getTime() + 24 * HOUR);
    expect(await logReasons()).toContain("first_message_sent");
  });

  async function businessName() {
    const { data } = await admin.from("businesses").select("name").eq("id", tenant.businessId).single();
    return data!.name;
  }

  it("honours a longer delay from the config", async () => {
    await configure({ delay_minutes: 10 });
    await receiveCall();
    await drain();
    const [send] = await actions("send_first_message");
    expect(new Date(send.run_at).getTime()).toBe(MONDAY_10.getTime() + 10 * MIN);
  });

  it("can send straight away with a zero delay", async () => {
    await configure({ delay_minutes: 0 });
    await receiveCall();
    await drain();
    await makeDue("send_first_message");
    await drain();
    expect(fake.sent).toHaveLength(1);
  });

  it("uses the business's own template text", async () => {
    await configure({ first_message_template: "Hello from {{business_name}}! Call back soon." });
    await sendFirstMessage();
    expect(fake.sent[0].body).toMatch(/^Hello from .+! Call back soon\.$/);
  });
});

describe("scenario 2: a second call inside the dedupe window joins the first", () => {
  it("skips a repeat call within 30 minutes and allows one after", async () => {
    await receiveCall();
    await drain();

    clock.now = new Date(MONDAY_10.getTime() + 5 * MIN);
    const repeat = await receiveCall();
    expect(await drain()).toMatchObject({ claimed: 1, skipped: 1 });
    expect(await conversations()).toHaveLength(1);
    const { data: action } = await admin.from("scheduled_actions").select("status, last_error").eq("dedupe_key", `evt:${repeat.webhookEventId}`).single();
    expect(action).toEqual({ status: "cancelled", last_error: "duplicate_in_window" });

    clock.now = new Date(MONDAY_10.getTime() + 31 * MIN);
    await receiveCall();
    expect(await drain()).toMatchObject({ claimed: 1, done: 1 });
    expect(await conversations()).toHaveLength(2);
  });

  it("does not treat a retry of the same call as a repeat", async () => {
    const { callSid, webhookEventId } = await receiveCall();
    await drain();
    // Redelivery of the same action (for example after a worker crash).
    await admin.from("scheduled_actions").update({ status: "pending", run_at: "2000-01-01T00:00:00Z" }).eq("dedupe_key", `evt:${webhookEventId}`);
    expect(await drain()).toMatchObject({ claimed: 1, done: 1 });

    const convos = await conversations();
    expect(convos).toHaveLength(1);
    expect(convos[0].trigger_call_sid).toBe(callSid);
    expect(await actions("send_first_message")).toHaveLength(1);
  });

  it("lets only the simulate endpoint bypass the window", async () => {
    await receiveCall({ provider: "simulated", skipDedupe: true });
    await receiveCall({ provider: "simulated", skipDedupe: true });
    await drain();
    expect(await conversations()).toHaveLength(2);

    // A real provider cannot ask for the same bypass.
    await receiveCall({ provider: "test", skipDedupe: true });
    expect(await drain()).toMatchObject({ skipped: 1 });
    expect(await conversations()).toHaveLength(2);
  });
});

describe("conditions that stop a conversation from starting", () => {
  async function expectSkip(reason: string) {
    expect(await drain()).toMatchObject({ claimed: 1, skipped: 1 });
    expect(await conversations()).toHaveLength(0);
    expect(await actions("send_first_message")).toHaveLength(0);
    const { data } = await admin.from("scheduled_actions").select("last_error").eq("business_id", tenant.businessId).eq("type", "handle_event");
    expect(data?.map((a) => a.last_error)).toEqual([reason]);
  }

  it("skips a caller who has opted out (platform-wide)", async () => {
    await admin.from("opt_outs").insert({ phone_e164: CUSTOMER });
    await receiveCall();
    await expectSkip("opted_out");
  });

  it("skips a withheld caller number", async () => {
    await receiveCall({ from: null });
    await expectSkip("no_caller_id");
  });

  it("skips outside opening hours when the business turned that off", async () => {
    clock.now = at(20);
    await configure({ send_outside_hours: false });
    await receiveCall();
    await expectSkip("outside_hours_disabled");
  });

  it("skips when the business is disabled", async () => {
    await admin.from("businesses").update({ status: "disabled" }).eq("id", tenant.businessId);
    await receiveCall();
    await expectSkip("business_inactive");
  });

  it("skips when Product 1 is switched off", async () => {
    await configure({}, false);
    await receiveCall();
    await expectSkip("product_disabled");
  });
});

describe("outside opening hours", () => {
  it("sends the outside-hours message by default", async () => {
    clock.now = at(20);
    await sendFirstMessage();
    expect(fake.sent).toHaveLength(1);
    expect(fake.sent[0].body).toContain("closed now");
  });

  it("uses the product's own opening hours instead of the business profile's when set", async () => {
    // Profile hours are Mon-Fri 09-17, but this product says Monday 18:00-22:00.
    clock.now = at(20);
    await configure({ business_hours: { mon: { open: "18:00", close: "22:00" }, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null } });
    await sendFirstMessage();
    expect(fake.sent[0].body).not.toContain("closed now");
  });

  it("re-checks hours when the message is finally sent", async () => {
    // Call at 16:55 (open), delay 10 minutes, send at 17:05 (closed).
    clock.now = at(16, 55);
    await configure({ delay_minutes: 10 });
    await receiveCall();
    await drain();

    clock.now = at(17, 5);
    await makeDue("send_first_message");
    await drain();
    expect(fake.sent[0].body).toContain("closed now");
  });

  it("gives up on the conversation if the business closed and does not send outside hours", async () => {
    clock.now = at(16, 55);
    await configure({ delay_minutes: 10, send_outside_hours: false });
    await receiveCall();
    await drain();

    clock.now = at(17, 5);
    await makeDue("send_first_message");
    expect(await drain()).toMatchObject({ skipped: 1 });
    expect(fake.sent).toHaveLength(0);
    expect((await conversations())[0].state).toBe("expired");
  });
});

describe("the first message can still be stopped during the delay", () => {
  it("does not send if the customer opted out in the meantime", async () => {
    await receiveCall();
    await drain();
    await admin.from("opt_outs").insert({ phone_e164: CUSTOMER });

    await makeDue("send_first_message");
    expect(await drain()).toMatchObject({ skipped: 1 });
    expect(fake.sent).toHaveLength(0);
    expect((await conversations())[0].state).toBe("opted_out");
  });

  it("does not send if Product 1 was switched off in the meantime", async () => {
    await receiveCall();
    await drain();
    await configure({}, false);
    await makeDue("send_first_message");
    expect(await drain()).toMatchObject({ skipped: 1 });
    expect(fake.sent).toHaveLength(0);
  });

  it("skips a conversation that is no longer waiting to send", async () => {
    await receiveCall();
    await drain();
    await admin.from("conversations").update({ state: "escalated" }).eq("business_id", tenant.businessId);
    await makeDue("send_first_message");
    expect(await drain()).toMatchObject({ skipped: 1 });
    expect(fake.sent).toHaveLength(0);
  });
});

describe("send failures", () => {
  async function callAndSendDue() {
    await receiveCall();
    await drain();
    await makeDue("send_first_message");
  }

  it("fails at once, and ends the conversation, when the number cannot receive WhatsApp", async () => {
    await callAndSendDue();
    fake.failNext(new AdapterError("unreachable_recipient", "not on WhatsApp"));
    expect(await drain()).toMatchObject({ claimed: 1, failed: 1 });

    expect((await conversations())[0].state).toBe("failed");
    const [send] = await actions("send_first_message");
    expect(send).toMatchObject({ status: "failed", attempts: 1 });
    expect((await messages())[0]).toMatchObject({ status: "failed", provider_sid: null });
  });

  it("retries a temporary failure and then sends exactly once", async () => {
    await callAndSendDue();
    fake.failNext(new AdapterError("rate_limited", "slow down"));
    expect(await drain()).toMatchObject({ retried: 1 });
    expect((await conversations())[0].state).toBe("pending_send");

    await makeDue("send_first_message");
    expect(await drain()).toMatchObject({ done: 1 });
    expect(fake.sent).toHaveLength(1);
    expect((await conversations())[0].state).toBe("awaiting_reply");
    const rows = await messages();
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("sent");
  });

  it("marks the conversation failed after the last retry", async () => {
    await callAndSendDue();
    fake.failNext(new AdapterError("provider_unavailable", "down"), 3);
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await drain();
      await makeDue("send_first_message");
    }
    const [send] = await actions("send_first_message");
    expect(send).toMatchObject({ status: "failed", attempts: 3 });
    expect((await conversations())[0].state).toBe("failed");
    expect(fake.sent).toHaveLength(0);
  });

  it("never sends twice when the same send is delivered again", async () => {
    await sendFirstMessage();
    const [send] = await actions("send_first_message");
    await admin.from("scheduled_actions").update({ status: "pending", attempts: 0, run_at: "2000-01-01T00:00:00Z" }).eq("id", send.id);
    expect(await drain()).toMatchObject({ done: 1 });
    expect(fake.sent).toHaveLength(1);
    expect(await messages()).toHaveLength(1);
    expect((await conversations())[0].state).toBe("awaiting_reply");
    expect(await logReasons()).toContain("first_message_already_sent");
  });
});

describe("delivery status updates", () => {
  it("moves a message forward to delivered and never back", async () => {
    await sendFirstMessage();
    const sid = fake.sent[0].providerSid;

    await receiveStatus(sid, "delivered");
    await drain();
    expect((await messages())[0].status).toBe("delivered");

    await receiveStatus(sid, "sent"); // arrives late
    await drain();
    expect((await messages())[0].status).toBe("delivered");
  });

  it("records a failed delivery and ends a conversation the customer never answered", async () => {
    await sendFirstMessage();
    await receiveStatus(fake.sent[0].providerSid, "failed", "63016");
    await drain();

    expect((await messages())[0]).toMatchObject({ status: "failed", error: "twilio_63016" });
    expect((await conversations())[0].state).toBe("failed");
    expect(await logReasons()).toContain("delivery_failed");
  });

  it("leaves a conversation alone when the customer has already replied", async () => {
    await sendFirstMessage();
    await admin
      .from("conversations")
      .update({ state: "in_conversation", last_inbound_at: MONDAY_10.toISOString() })
      .eq("business_id", tenant.businessId);
    await receiveStatus(fake.sent[0].providerSid, "failed", "63016");
    await drain();
    expect((await conversations())[0].state).toBe("in_conversation");
  });

  it("ignores a failure report for a message that was already delivered", async () => {
    await sendFirstMessage();
    const sid = fake.sent[0].providerSid;
    await receiveStatus(sid, "delivered");
    await drain();
    await receiveStatus(sid, "failed");
    await drain();
    expect((await messages())[0].status).toBe("delivered");
    expect((await conversations())[0].state).toBe("awaiting_reply");
  });

  it("looks again later for a status whose message is not saved yet", async () => {
    await receiveStatus("SMnot-saved-yet", "delivered");
    expect(await drain()).toMatchObject({ claimed: 1, retried: 1 });
    const { data } = await admin.from("scheduled_actions").select("status, last_error, run_at").eq("business_id", tenant.businessId).eq("type", "handle_event");
    expect(data?.[0]).toMatchObject({ status: "pending", last_error: "message_not_found" });
    expect(new Date(data![0].run_at).getTime()).toBe(MONDAY_10.getTime() + 30_000);
  });
});

describe("expiry after 24 hours of silence", () => {
  async function sentAt() {
    const convo = await sendFirstMessage();
    return new Date(convo.last_outbound_at!).getTime();
  }

  it("keeps the conversation open before 24 hours and queues the next check", async () => {
    const sent = await sentAt();
    clock.now = new Date(sent + 23 * HOUR);
    await makeDue("expire_conversation");
    expect(await drain()).toMatchObject({ done: 1 });
    expect((await conversations())[0].state).toBe("awaiting_reply");

    const pending = (await actions("expire_conversation")).filter((a) => a.status === "pending");
    expect(pending).toHaveLength(1);
    expect(new Date(pending[0].run_at).getTime()).toBe(sent + 24 * HOUR);
  });

  it("expires the conversation after 24 hours with no reply", async () => {
    const sent = await sentAt();
    clock.now = new Date(sent + 24 * HOUR);
    await makeDue("expire_conversation");
    await drain();
    expect((await conversations())[0].state).toBe("expired");
    expect(await logReasons()).toContain("conversation_expired");
  });

  it("restarts the clock from the customer's last message", async () => {
    const sent = await sentAt();
    const replied = sent + 20 * HOUR;
    await admin
      .from("conversations")
      .update({ state: "in_conversation", last_inbound_at: new Date(replied).toISOString() })
      .eq("business_id", tenant.businessId);

    clock.now = new Date(sent + 25 * HOUR); // past the original 24h, but only 5h since the reply
    await makeDue("expire_conversation");
    await drain();
    expect((await conversations())[0].state).toBe("in_conversation");
    const pending = (await actions("expire_conversation")).filter((a) => a.status === "pending");
    expect(new Date(pending[0].run_at).getTime()).toBe(replied + 24 * HOUR);
  });

  it("leaves finished conversations alone", async () => {
    const sent = await sentAt();
    await admin.from("conversations").update({ state: "escalated" }).eq("business_id", tenant.businessId);
    clock.now = new Date(sent + 48 * HOUR);
    await makeDue("expire_conversation");
    expect(await drain()).toMatchObject({ skipped: 1 });
    expect((await conversations())[0].state).toBe("escalated");
  });
});
