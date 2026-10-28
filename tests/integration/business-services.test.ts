import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@/lib/database.types";
import { DEFAULT_BUSINESS_HOURS } from "@/lib/validation/hours";
import { getSubscription, updateBusinessProfile } from "@/services/business";
import { getMetrics, getSetupChecklist, listRecentConversations } from "@/services/dashboard";
import { saveProductConfig, setProductEnabled } from "@/services/products";
import { serviceClient } from "../helpers/db";
import { missedCallProductId } from "../helpers/tenant-tables";
import { addStaff, cleanupTenants, createTenant, type TestUser, type Tenant } from "../helpers/tenants";

const typed = (c: SupabaseClient) => c as unknown as SupabaseClient<Database>;
const admin = serviceClient();

let a: Tenant;
let b: Tenant;
let staffA: TestUser;
let productId: string;

const valid = { name: "Renamed Clinic", phone: "07911 123456", timezone: "Europe/Paris", business_hours: DEFAULT_BUSINESS_HOURS };

async function addConversation(tenant: Tenant, fields: Record<string, unknown> = {}, phone = "+447700900801") {
  const { data: customer } = await admin
    .from("customers")
    .upsert({ business_id: tenant.businessId, phone_e164: phone }, { onConflict: "business_id,phone_e164" })
    .select("id")
    .single();
  const { data } = await admin
    .from("conversations")
    .insert({ business_id: tenant.businessId, customer_id: customer!.id, product_id: productId, ...fields })
    .select("id")
    .single();
  return data!.id as string;
}

beforeAll(async () => {
  a = await createTenant("bsvc-a");
  b = await createTenant("bsvc-b");
  staffA = await addStaff(a);
  productId = await missedCallProductId(admin);
});

beforeEach(async () => {
  for (const t of [a, b]) {
    for (const table of ["conversations", "customers", "business_products", "integrations"] as const) {
      await admin.from(table).delete().eq("business_id", t.businessId);
    }
  }
  await admin.from("businesses").update({ name: "Reset Name", timezone: "Europe/London", status: "active" }).eq("id", a.businessId);
});

afterAll(cleanupTenants);

describe("updateBusinessProfile", () => {
  it("saves name, phone, timezone and hours, normalising the phone number", async () => {
    expect(await updateBusinessProfile(typed(a.owner.client), a.businessId, valid)).toEqual({ ok: true });
    const { data } = await admin.from("businesses").select("name, phone_e164, timezone, business_hours, status").eq("id", a.businessId).single();
    expect(data).toMatchObject({ name: "Renamed Clinic", phone_e164: "+447911123456", timezone: "Europe/Paris", status: "active" });
    expect(data?.business_hours).toEqual(DEFAULT_BUSINESS_HOURS);
  });

  it("saves changed opening hours", async () => {
    const hours = { ...DEFAULT_BUSINESS_HOURS, sat: { open: "10:00", close: "14:00" }, mon: null };
    await updateBusinessProfile(typed(a.owner.client), a.businessId, { ...valid, business_hours: hours });
    const { data } = await admin.from("businesses").select("business_hours").eq("id", a.businessId).single();
    expect(data?.business_hours).toEqual(hours);
  });

  it("lets staff do it too (permissions are not decided yet)", async () => {
    expect((await updateBusinessProfile(typed(staffA.client), a.businessId, valid)).ok).toBe(true);
  });

  it("explains every invalid field and saves nothing", async () => {
    const result = await updateBusinessProfile(typed(a.owner.client), a.businessId, {
      name: "  ",
      phone: "123",
      timezone: "Mars/Base",
      business_hours: { ...DEFAULT_BUSINESS_HOURS, mon: { open: "18:00", close: "09:00" } },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(Object.keys(result.fieldErrors ?? {})).toEqual(expect.arrayContaining(["name", "phone", "timezone", "business_hours.mon"]));
    }
    const { data } = await admin.from("businesses").select("name").eq("id", a.businessId).single();
    expect(data?.name).toBe("Reset Name");
  });

  it("cannot change another business, or its status", async () => {
    const before = await admin.from("businesses").select("name").eq("id", b.businessId).single();
    const result = await updateBusinessProfile(typed(a.owner.client), b.businessId, valid);
    expect(result).toMatchObject({ ok: false });
    const after = await admin.from("businesses").select("name").eq("id", b.businessId).single();
    expect(after.data?.name).toBe(before.data?.name);
  });
});

describe("getSubscription", () => {
  it("returns the manual subscription record", async () => {
    await admin.from("subscriptions").update({ plan: "Pro", status: "active", current_period_end: "2027-01-31T00:00:00Z", notes: "Paid by invoice" }).eq("business_id", a.businessId);
    expect(await getSubscription(typed(a.owner.client), a.businessId)).toEqual({
      plan: "Pro", status: "active", currentPeriodEnd: "2027-01-31T00:00:00+00:00", notes: "Paid by invoice",
    });
  });

  it("shows nothing for another business", async () => {
    expect(await getSubscription(typed(a.owner.client), b.businessId)).toBeNull();
  });
});

describe("getMetrics", () => {
  const since = new Date("2026-10-01T00:00:00Z");

  it("counts calls handled, conversations, bookings and escalations for the period", async () => {
    await addConversation(a, { started_at: "2026-10-10T10:00:00Z" }, "+447700900811"); // call, no reply
    await addConversation(a, { started_at: "2026-10-11T10:00:00Z", last_inbound_at: "2026-10-11T10:05:00Z", state: "in_conversation" }, "+447700900812");
    await addConversation(a, { started_at: "2026-10-12T10:00:00Z", last_inbound_at: "2026-10-12T10:05:00Z", state: "booked" }, "+447700900813");
    await addConversation(a, { started_at: "2026-10-13T10:00:00Z", last_inbound_at: "2026-10-13T10:05:00Z", state: "escalated", escalation_reason: "complaint" }, "+447700900814");
    await addConversation(a, { started_at: "2026-09-01T10:00:00Z", state: "booked" }, "+447700900815"); // before the period

    expect(await getMetrics(typed(a.owner.client), a.businessId, since)).toEqual({
      missedCalls: 4,
      conversations: 3,
      bookings: 1,
      escalations: 1,
    });
  });

  it("is all zeros for a business with no activity, and never counts another business's", async () => {
    await addConversation(b, { started_at: "2026-10-10T10:00:00Z", state: "booked", last_inbound_at: "2026-10-10T10:01:00Z" });
    expect(await getMetrics(typed(a.owner.client), a.businessId, since)).toEqual({ missedCalls: 0, conversations: 0, bookings: 0, escalations: 0 });
    expect(await getMetrics(typed(a.owner.client), b.businessId, since)).toEqual({ missedCalls: 0, conversations: 0, bookings: 0, escalations: 0 });
  });
});

describe("getSetupChecklist", () => {
  const find = (items: { key: string; done: boolean }[], key: string) => items.find((i) => i.key === key)!;

  it("starts with only the profile done", async () => {
    const list = await getSetupChecklist(typed(a.owner.client), a.businessId);
    expect(list.items.map((i) => [i.key, i.done])).toEqual([
      ["profile", true], ["product", false], ["messages", false], ["forwarding", false], ["calendar", false],
    ]);
    expect(list).toMatchObject({ done: 1, total: 4 });
  });

  it("ticks items as the business sets things up", async () => {
    const db = typed(a.owner.client);
    await setProductEnabled(db, a.businessId, "missed-call", true);
    expect(find((await getSetupChecklist(db, a.businessId)).items, "product").done).toBe(true);

    await saveProductConfig(db, a.businessId, "missed-call", { business_blurb: "Family dentist." });
    expect(find((await getSetupChecklist(db, a.businessId)).items, "messages").done).toBe(true);

    await admin.from("integrations").insert({ business_id: a.businessId, provider: "telephony", status: "connected", metadata: { forwarding_confirmed: true } });
    const list = await getSetupChecklist(db, a.businessId);
    expect(find(list.items, "forwarding").done).toBe(true);
    expect(list).toMatchObject({ done: 4, total: 4 });
  });

  it("treats the calendar as optional: connecting it does not change the progress count", async () => {
    await admin.from("integrations").insert({ business_id: a.businessId, provider: "google_calendar", status: "connected" });
    const list = await getSetupChecklist(typed(a.owner.client), a.businessId);
    expect(find(list.items, "calendar")).toMatchObject({ done: true, optional: true });
    expect(list).toMatchObject({ done: 1, total: 4 });
  });

  it("does not count forwarding that is only 'connected' without being confirmed", async () => {
    await admin.from("integrations").insert({ business_id: a.businessId, provider: "telephony", status: "connected", metadata: {} });
    expect(find((await getSetupChecklist(typed(a.owner.client), a.businessId)).items, "forwarding").done).toBe(false);
  });

  it("gives every item a destination", async () => {
    const list = await getSetupChecklist(typed(a.owner.client), a.businessId);
    for (const item of list.items) {
      expect(item.href).toMatch(/^\//);
      expect(item.cta.length).toBeGreaterThan(0);
    }
  });
});

describe("listRecentConversations", () => {
  it("lists the newest first, with the customer, and respects the limit", async () => {
    await addConversation(a, { started_at: "2026-10-10T10:00:00Z" }, "+447700900821");
    await addConversation(a, { started_at: "2026-10-12T10:00:00Z", state: "escalated", escalation_reason: "urgent", last_intent: "needs_human" }, "+447700900822");
    await addConversation(a, { started_at: "2026-10-11T10:00:00Z" }, "+447700900823");

    const all = await listRecentConversations(typed(a.owner.client), a.businessId, 10);
    expect(all.map((c) => c.customer.phone)).toEqual(["+447700900822", "+447700900823", "+447700900821"]);
    expect(all[0]).toMatchObject({ state: "escalated", escalationReason: "urgent", lastIntent: "needs_human" });

    expect(await listRecentConversations(typed(a.owner.client), a.businessId, 2)).toHaveLength(2);
  });

  it("never lists another business's conversations", async () => {
    await addConversation(b, {}, "+447700900831");
    expect(await listRecentConversations(typed(a.owner.client), a.businessId, 10)).toEqual([]);
    expect(await listRecentConversations(typed(a.owner.client), b.businessId, 10)).toEqual([]);
  });
});
