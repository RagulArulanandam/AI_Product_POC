import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { FakeCalendarAdapter } from "@/adapters/calendar/fake";
import { bookingEventId } from "@/adapters/calendar/interface";
import { FakeEmailAdapter } from "@/adapters/email/fake";
import { FakeLlmAdapter } from "@/adapters/llm/fake";
import { FakeMessagingAdapter } from "@/adapters/messaging/fake";
import type { EngineDeps } from "@/engine/runner";
import type { Admin } from "@/engine/types";
import { ingestWebhookEvent } from "@/engine/webhooks";
import { runDueActions } from "@/engine/worker";
import { AdapterError } from "@/lib/errors";
import type { AiReply } from "@/products/missed-call/ai/contract";
import { BOOKING_PENDING_REPLY, SLOT_TAKEN_PREFIX } from "@/products/missed-call/ai/replies";
import { getProduct } from "@/products/registry";
import { serviceClient } from "../helpers/db";
import { missedCallProductId } from "../helpers/tenant-tables";
import { cleanupTenants, createTenant, type Tenant } from "../helpers/tenants";

// Product 1 booking (product-missed-call.md, "Booking" and scenarios 4 and 10): real database,
// scripted model, fake messenger, email and calendar. The default business hours are Mon-Fri
// 09:00-17:00 UK time; NOW is Monday 10:00, so the first bookable time is 11:00.

const admin = serviceClient() as unknown as Admin;
const fakeMessaging = new FakeMessagingAdapter();
const fakeLlm = new FakeLlmAdapter();
const fakeEmail = new FakeEmailAdapter();
const fakeCalendar = new FakeCalendarAdapter();
const PHONE = "+447700900701";
const OWNER_EMAIL = "owner@example.com";
const NOW = new Date("2030-01-07T10:00:00Z");

const deps: EngineDeps = {
  admin,
  products: [getProduct("missed-call")!],
  now: () => NOW,
  services: { messaging: () => fakeMessaging, llm: () => fakeLlm, email: () => fakeEmail, calendar: () => fakeCalendar },
};

let tenant: Tenant;
let productId: string;
let customerId: string;
let conversationId: string;

const answer = (overrides: Partial<AiReply> = {}): AiReply => ({
  intent: "book_appointment",
  confidence: 0.9,
  extracted: { name: null, service: null, preferred_date: null, preferred_time: null },
  next_action: "offer_slots",
  chosen_slot: null,
  reply: "Great, you are booked for Thursday at 3pm!",
  ...overrides,
});

async function configure(config: Record<string, unknown> = {}) {
  await admin.from("business_products").upsert(
    {
      business_id: tenant.businessId,
      product_id: productId,
      enabled: true,
      config: { escalation_email: OWNER_EMAIL, booking_enabled: true, appointment_duration_minutes: 30, ...config } as never,
    },
    { onConflict: "business_id,product_id" },
  );
}

async function connectCalendar(status = "connected") {
  await admin.from("integrations").delete().eq("business_id", tenant.businessId);
  await admin.from("integrations").insert({ business_id: tenant.businessId, provider: "google_calendar", status, account_label: "owner@example.com" });
}

async function startConversation(state = "in_conversation") {
  const { data: customer } = await admin
    .from("customers")
    .upsert({ business_id: tenant.businessId, phone_e164: PHONE }, { onConflict: "business_id,phone_e164" })
    .select("id")
    .single();
  customerId = customer!.id;
  const { data } = await admin
    .from("conversations")
    .insert({ business_id: tenant.businessId, customer_id: customerId, product_id: productId, state, started_at: NOW.toISOString(), last_outbound_at: NOW.toISOString() })
    .select("id")
    .single();
  conversationId = data!.id;
  await admin.from("messages").insert({
    business_id: tenant.businessId, conversation_id: conversationId, direction: "outbound", sender: "system",
    body: "Hi, this is Test Clinic. Sorry we missed your call.", status: "delivered", provider_sid: `SMfirst${randomUUID().replace(/-/g, "")}`,
  });
}

async function customerSays(body: string, sid = `SM${randomUUID().replace(/-/g, "")}`) {
  await ingestWebhookEvent(admin, "test", {
    eventId: sid,
    type: "message.inbound",
    data: { from: PHONE, body, hasMedia: false },
    businessId: tenant.businessId,
    conversationId,
  });
  return runDueActions(deps);
}

async function conversation() {
  const { data } = await admin.from("conversations").select("*").eq("id", conversationId).single();
  return data!;
}
const sentTexts = () => fakeMessaging.sent.map((m) => m.body);
const offeredStarts = async () => ((await conversation()).offered_slots as { start: string }[]).map((s) => s.start);

beforeAll(async () => {
  tenant = await createTenant("book");
  productId = await missedCallProductId(admin);
});

beforeEach(async () => {
  fakeMessaging.reset();
  fakeLlm.reset();
  fakeEmail.reset();
  fakeCalendar.reset();
  for (const table of ["scheduled_actions", "webhook_events", "automation_logs", "conversations", "customers"] as const) {
    await admin.from(table).delete().eq("business_id", tenant.businessId);
  }
  await admin.from("opt_outs").delete().eq("phone_e164", PHONE);
  await admin.from("businesses").update({ status: "active" }).eq("id", tenant.businessId);
  await configure();
  await connectCalendar();
  await startConversation();
});

afterAll(async () => {
  await admin.from("opt_outs").delete().eq("phone_e164", PHONE);
  await cleanupTenants();
});

describe("offering times", () => {
  it("offers real times from the calendar, never the model's own text", async () => {
    fakeLlm.enqueue(answer());
    await customerSays("I'd like to book an appointment");

    const text = sentTexts()[0];
    expect(text).toContain("1. Mon 7 Jan at 11:00");
    expect(text).toContain("2. Tue 8 Jan at 09:00");
    expect(text).toContain("3. Wed 9 Jan at 09:00");
    expect(text).not.toContain("Thursday at 3pm");
    expect(await offeredStarts()).toEqual(["2030-01-07T11:00:00.000Z", "2030-01-08T09:00:00.000Z", "2030-01-09T09:00:00.000Z"]);
    expect(await conversation()).toMatchObject({ state: "offering_slots", last_intent: "book_appointment" });
    expect(fakeCalendar.events).toHaveLength(0);
  });

  it("uses the day the customer asked for", async () => {
    fakeLlm.enqueue(answer({ extracted: { name: null, service: "check-up", preferred_date: "2030-01-10", preferred_time: "14:00" } }));
    await customerSays("A check-up on Thursday at 2pm please");
    expect(await offeredStarts()).toEqual(["2030-01-10T13:30:00.000Z", "2030-01-10T14:00:00.000Z", "2030-01-10T14:30:00.000Z"]);
    expect((await conversation()).booking_service).toBe("check-up");
  });

  it("leaves out times that are busy in the calendar", async () => {
    fakeCalendar.busy = [{ start: new Date("2030-01-07T11:00:00Z"), end: new Date("2030-01-07T12:00:00Z") }];
    fakeLlm.enqueue(answer());
    await customerSays("Can I book?");
    expect((await offeredStarts())[0]).toBe("2030-01-07T12:00:00.000Z");
  });

  it("asks the model about the times already offered, so it can recognise the customer's pick", async () => {
    fakeLlm.enqueue(answer());
    await customerSays("Can I book?");
    fakeLlm.enqueue(answer({ chosen_slot: 2, next_action: "confirm_booking" }));
    await customerSays("The second one");
    const system = fakeLlm.calls[1].system;
    expect(system).toContain("1. Mon 7 Jan at 11:00");
    expect(system).toContain("2. Tue 8 Jan at 09:00");
  });
});

describe("booking a time", () => {
  async function offerThenPick(pick: number, replyText = "The second one please") {
    fakeLlm.enqueue(answer({ extracted: { name: "Priya", service: "check-up", preferred_date: null, preferred_time: null } }));
    await customerSays("I'd like a check-up, I'm Priya");
    fakeMessaging.reset();
    fakeLlm.enqueue(answer({ intent: "book_appointment", next_action: "confirm_booking", chosen_slot: pick, reply: "You're all set!" }));
    return customerSays(replyText);
  }

  it("creates the event, saves it on the conversation and confirms with the real time", async () => {
    await offerThenPick(2);

    const start = new Date("2030-01-08T09:00:00Z");
    expect(fakeCalendar.events).toHaveLength(1);
    expect(fakeCalendar.events[0]).toMatchObject({
      eventId: bookingEventId(conversationId, start),
      start,
      end: new Date("2030-01-08T09:30:00Z"),
    });
    expect(fakeCalendar.events[0].summary).toContain("check-up");
    expect(fakeCalendar.events[0].summary).toContain("Priya");

    expect(await conversation()).toMatchObject({
      state: "booked",
      booking_event_id: bookingEventId(conversationId, start),
      booking_start: "2030-01-08T09:00:00+00:00",
      booking_end: "2030-01-08T09:30:00+00:00",
      booking_service: "check-up",
      offered_slots: [],
    });
    expect(sentTexts()).toHaveLength(1);
    expect(sentTexts()[0]).toContain("Tue 8 Jan at 09:00");
    expect(sentTexts()[0]).toContain("You're booked in");
    expect(sentTexts()[0]).not.toContain("all set");
  });

  it("does not book twice when the same message is delivered again", async () => {
    fakeLlm.enqueue(answer());
    await customerSays("I'd like to book");
    const sid = `SM${randomUUID().replace(/-/g, "")}`;
    fakeLlm.enqueue(answer({ next_action: "confirm_booking", chosen_slot: 1 }));
    await customerSays("1", sid);
    await customerSays("1", sid);
    expect(fakeCalendar.events).toHaveLength(1);
    expect(sentTexts().filter((t) => t.includes("You're booked in"))).toHaveLength(1);
  });

  it("confirms without double booking when an earlier attempt already created the event", async () => {
    fakeLlm.enqueue(answer());
    await customerSays("I'd like to book");
    const start = new Date("2030-01-08T09:00:00Z");
    // The earlier attempt claimed the time and created the event, then failed before replying.
    await admin.from("conversations").update({ booking_event_id: bookingEventId(conversationId, start) }).eq("id", conversationId);
    await fakeCalendar.createEvent({ eventId: bookingEventId(conversationId, start), start, end: new Date("2030-01-08T09:30:00Z"), summary: "x", description: "" });
    fakeMessaging.reset();

    fakeLlm.enqueue(answer({ next_action: "confirm_booking", chosen_slot: 2 }));
    await customerSays("2");

    expect(fakeCalendar.events).toHaveLength(1);
    expect((await conversation()).state).toBe("booked");
    expect(sentTexts()[0]).toContain("You're booked in");
  });

  it("books once when creating the event fails temporarily and is retried later", async () => {
    fakeLlm.enqueue(answer());
    await customerSays("I'd like to book");
    fakeMessaging.reset();

    fakeCalendar.failNext("create", new AdapterError("provider_unavailable", "Google is down"));
    fakeLlm.enqueue(answer({ next_action: "confirm_booking", chosen_slot: 2 }));
    const first = await customerSays("2");
    expect(first.retried).toBe(1);
    expect(fakeCalendar.events).toHaveLength(0);
    expect(await offeredStarts()).toHaveLength(3);

    // The queue claims by the database clock, so make the retry due now; the handler's own clock
    // moves on ten minutes.
    await admin.from("scheduled_actions").update({ run_at: new Date(Date.now() - 1000).toISOString() }).eq("business_id", tenant.businessId).eq("status", "pending");
    const later = { ...deps, now: () => new Date(NOW.getTime() + 10 * 60_000) };
    fakeLlm.enqueue(answer({ next_action: "confirm_booking", chosen_slot: 2 }));
    await runDueActions(later);

    expect(fakeCalendar.events).toHaveLength(1);
    expect((await conversation()).state).toBe("booked");
    expect(sentTexts().filter((t) => t.includes("You're booked in"))).toHaveLength(1);
  });

  it("offers other times when the picked one was taken while the customer decided", async () => {
    fakeLlm.enqueue(answer());
    await customerSays("I'd like to book");
    fakeMessaging.reset();
    fakeCalendar.busy = [{ start: new Date("2030-01-08T09:00:00Z"), end: new Date("2030-01-08T10:00:00Z") }];

    fakeLlm.enqueue(answer({ next_action: "confirm_booking", chosen_slot: 2 }));
    await customerSays("2");

    expect(fakeCalendar.events).toHaveLength(0);
    expect(sentTexts()[0]).toContain(SLOT_TAKEN_PREFIX);
    expect(sentTexts()[0]).not.toContain("09:00");
    expect(await conversation()).toMatchObject({ state: "offering_slots" });
  });

  it("does not book a time that another conversation already holds", async () => {
    fakeLlm.enqueue(answer());
    await customerSays("I'd like to book");
    const { data: other } = await admin.from("customers").insert({ business_id: tenant.businessId, phone_e164: "+447700900702" }).select("id").single();
    await admin.from("conversations").insert({
      business_id: tenant.businessId, customer_id: other!.id, product_id: productId, state: "booked",
      booking_start: "2030-01-07T11:00:00Z", booking_end: "2030-01-07T11:30:00Z",
    });
    fakeMessaging.reset();
    fakeLlm.enqueue(answer({ next_action: "confirm_booking", chosen_slot: 1 }));
    await customerSays("1");
    expect(fakeCalendar.events).toHaveLength(0);
    expect(sentTexts()[0]).toContain(SLOT_TAKEN_PREFIX);
  });

  it.each([0, 4, 9, -1, 1.5])("never books from a slot number that was not offered (%s)", async (pick) => {
    fakeLlm.enqueue(answer());
    await customerSays("I'd like to book");
    fakeMessaging.reset();
    fakeLlm.enqueue(answer({ next_action: "confirm_booking", chosen_slot: pick }));
    await customerSays("that one");
    expect(fakeCalendar.events).toHaveLength(0);
    expect((await conversation()).state).toBe("offering_slots");
    expect(sentTexts()[0]).toContain("Here are some other times");
  });

  it("ignores a chosen slot when nothing has been offered yet", async () => {
    fakeLlm.enqueue(answer({ next_action: "confirm_booking", chosen_slot: 1 }));
    await customerSays("book the first one");
    expect(fakeCalendar.events).toHaveLength(0);
    expect((await conversation()).state).toBe("offering_slots");
  });

  it("keeps the conversation closed after booking: later messages are stored, not answered", async () => {
    await offerThenPick(1);
    fakeMessaging.reset();
    await customerSays("Thanks!");
    expect(fakeMessaging.sent).toHaveLength(0);
    expect((await conversation()).state).toBe("booked");
  });
});

describe("when the calendar cannot be used", () => {
  it("hands over to a person when the calendar is disconnected (scenario 10)", async () => {
    await connectCalendar("error");
    fakeLlm.enqueue(answer());
    await customerSays("I'd like to book");
    expect(await conversation()).toMatchObject({ state: "escalated", escalation_reason: "calendar_error" });
    expect(fakeCalendar.events).toHaveLength(0);
  });

  it("hands over to a person when Google refuses access, without retrying", async () => {
    fakeCalendar.failNext("freebusy", new AdapterError("auth", "revoked", { retryable: false }));
    fakeLlm.enqueue(answer());
    await customerSays("I'd like to book");
    expect(await conversation()).toMatchObject({ state: "escalated", escalation_reason: "calendar_error" });
  });

  it("retries a temporary calendar failure instead of escalating", async () => {
    fakeCalendar.failNext("freebusy", new AdapterError("provider_unavailable", "Google is down"));
    fakeLlm.enqueue(answer());
    const summary = await customerSays("I'd like to book");
    expect(summary.retried).toBe(1);
    expect(await conversation()).toMatchObject({ state: "in_conversation" });
    expect(fakeMessaging.sent).toHaveLength(0);
  });

  it("hands over when creating the event is refused", async () => {
    fakeLlm.enqueue(answer());
    await customerSays("I'd like to book");
    fakeMessaging.reset();
    fakeCalendar.failNext("create", new AdapterError("auth", "no longer allowed", { retryable: false }));
    fakeLlm.enqueue(answer({ next_action: "confirm_booking", chosen_slot: 1 }));
    await customerSays("1");
    expect(await conversation()).toMatchObject({ state: "escalated", escalation_reason: "calendar_error" });
    expect(fakeCalendar.events).toHaveLength(0);
  });

  it("hands over when there is no free time to offer", async () => {
    fakeCalendar.busy = [{ start: new Date("2030-01-01T00:00:00Z"), end: new Date("2031-01-01T00:00:00Z") }];
    fakeLlm.enqueue(answer());
    await customerSays("I'd like to book");
    expect(await conversation()).toMatchObject({ state: "escalated", escalation_reason: "no_availability" });
  });

  it("tells the owner by email, once, with the calendar reason", async () => {
    await connectCalendar("error");
    fakeLlm.enqueue(answer());
    await customerSays("I'd like to book");
    await runDueActions(deps);
    expect(fakeEmail.sent).toHaveLength(1);
    expect(fakeEmail.sent[0].to).toBe(OWNER_EMAIL);
    expect(fakeEmail.sent[0].text).toContain("calendar");
  });
});

describe("without a calendar", () => {
  it("keeps taking details for the team when booking is on but no calendar is connected", async () => {
    await admin.from("integrations").delete().eq("business_id", tenant.businessId);
    fakeLlm.enqueue(answer());
    await customerSays("I'd like to book");
    expect(sentTexts()).toEqual([BOOKING_PENDING_REPLY]);
    expect((await conversation()).state).toBe("enquiry_logged");
    expect(fakeCalendar.events).toHaveLength(0);
  });

  it("treats a calendar the owner disconnected on purpose like no calendar", async () => {
    await connectCalendar("disconnected");
    fakeLlm.enqueue(answer());
    await customerSays("I would like to book");
    expect(sentTexts()).toEqual([BOOKING_PENDING_REPLY]);
    expect((await conversation()).state).toBe("enquiry_logged");
  });

  it("ignores a connected calendar when booking is switched off", async () => {
    await configure({ booking_enabled: false });
    fakeLlm.enqueue(answer());
    await customerSays("I'd like to book");
    expect(sentTexts()).toEqual([BOOKING_PENDING_REPLY]);
    expect(fakeCalendar.events).toHaveLength(0);
  });
});

describe("the other safeguards still win", () => {
  it("escalates a complaint instead of offering times", async () => {
    fakeLlm.enqueue(answer({ intent: "complaint", next_action: "escalate" }));
    await customerSays("I want to complain and book another time");
    expect(await conversation()).toMatchObject({ state: "escalated", escalation_reason: "complaint" });
    expect(fakeCalendar.events).toHaveLength(0);
  });

  it("escalates urgent wording without asking the model or touching the calendar", async () => {
    await customerSays("I have severe pain, can I book now?");
    expect(fakeLlm.calls).toHaveLength(0);
    expect((await conversation()).state).toBe("escalated");
    expect(fakeCalendar.events).toHaveLength(0);
  });
});
