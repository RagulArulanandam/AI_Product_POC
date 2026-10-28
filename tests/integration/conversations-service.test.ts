import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@/lib/database.types";
import { FILTERS, getConversation, listConversations, PAGE_SIZE, parseFilter } from "@/services/conversations";
import { serviceClient } from "../helpers/db";
import { missedCallProductId } from "../helpers/tenant-tables";
import { cleanupTenants, createTenant, type Tenant } from "../helpers/tenants";

const typed = (c: SupabaseClient) => c as unknown as SupabaseClient<Database>;
const admin = serviceClient();

let a: Tenant;
let b: Tenant;
let productId: string;
let counter = 0;

async function add(tenant: Tenant, fields: Record<string, unknown> = {}, customer: { phone?: string; name?: string | null } = {}) {
  counter += 1;
  const phone = customer.phone ?? `+4477009${String(10000 + counter).slice(1)}`;
  const { data: c } = await admin
    .from("customers")
    .upsert({ business_id: tenant.businessId, phone_e164: phone, name: customer.name ?? null }, { onConflict: "business_id,phone_e164" })
    .select("id")
    .single();
  const { data } = await admin
    .from("conversations")
    .insert({ business_id: tenant.businessId, customer_id: c!.id, product_id: productId, ...fields })
    .select("id")
    .single();
  return data!.id as string;
}

beforeAll(async () => {
  a = await createTenant("cvs-a");
  b = await createTenant("cvs-b");
  productId = await missedCallProductId(admin);
});

beforeEach(async () => {
  for (const t of [a, b]) {
    await admin.from("conversations").delete().eq("business_id", t.businessId);
    await admin.from("customers").delete().eq("business_id", t.businessId);
  }
});

afterAll(cleanupTenants);

describe("parseFilter", () => {
  it("accepts the known filters and falls back to all", () => {
    for (const f of FILTERS) expect(parseFilter(f)).toBe(f);
    expect(parseFilter(undefined)).toBe("all");
    expect(parseFilter("nonsense")).toBe("all");
    expect(parseFilter(["booked", "active"])).toBe("booked");
    expect(parseFilter("")).toBe("all");
  });
});

describe("listConversations", () => {
  it("lists newest first, with customer details", async () => {
    await add(a, { started_at: "2026-10-10T10:00:00Z" }, { name: "Older" });
    await add(a, { started_at: "2026-10-12T10:00:00Z", state: "escalated", escalation_reason: "complaint" }, { name: "Newest" });
    const page = await listConversations(typed(a.owner.client), a.businessId);
    expect(page.items.map((c) => c.customer.name)).toEqual(["Newest", "Older"]);
    expect(page.items[0]).toMatchObject({ state: "escalated", escalationReason: "complaint" });
    expect(page.nextBefore).toBeNull();
  });

  it.each([
    ["needs-you", ["escalated"]],
    ["active", ["pending_send", "awaiting_reply", "in_conversation", "offering_slots"]],
    ["booked", ["booked"]],
    ["closed", ["enquiry_logged", "opted_out", "expired", "failed"]],
  ] as const)("filters by %s", async (filter, states) => {
    const all = ["pending_send", "awaiting_reply", "in_conversation", "offering_slots", "booked", "escalated", "enquiry_logged", "opted_out", "expired", "failed"];
    for (const state of all) await add(a, { state, started_at: `2026-10-${10 + (counter % 15)}T10:00:00Z` });
    const page = await listConversations(typed(a.owner.client), a.businessId, { filter });
    expect(page.items.map((c) => c.state).sort()).toEqual([...states].sort());
  });

  it("pages back in time without repeating or skipping rows", async () => {
    for (let i = 0; i < 7; i += 1) await add(a, { started_at: new Date(Date.UTC(2026, 9, 1 + i, 10)).toISOString() });
    const first = await listConversations(typed(a.owner.client), a.businessId, { limit: 3 });
    expect(first.items).toHaveLength(3);
    expect(first.nextBefore).not.toBeNull();
    const second = await listConversations(typed(a.owner.client), a.businessId, { limit: 3, before: first.nextBefore! });
    const third = await listConversations(typed(a.owner.client), a.businessId, { limit: 3, before: second.nextBefore! });
    expect(third.items).toHaveLength(1);
    expect(third.nextBefore).toBeNull();

    const ids = [...first.items, ...second.items, ...third.items].map((c) => c.id);
    expect(new Set(ids).size).toBe(7);
    const times = [...first.items, ...second.items, ...third.items].map((c) => c.startedAt);
    expect(times).toEqual([...times].sort().reverse());
  });

  it("uses a sensible default page size", () => {
    expect(PAGE_SIZE).toBe(25);
  });

  it("searches by name and by phone number in national or international form", async () => {
    await add(a, {}, { name: "Priya Patel", phone: "+447911123456" });
    await add(a, {}, { name: "Sam Jones", phone: "+447911999888" });
    const db = typed(a.owner.client);
    expect((await listConversations(db, a.businessId, { q: "priya" })).items.map((c) => c.customer.name)).toEqual(["Priya Patel"]);
    expect((await listConversations(db, a.businessId, { q: "07911 123456" })).items.map((c) => c.customer.name)).toEqual(["Priya Patel"]);
    expect((await listConversations(db, a.businessId, { q: "+44 7911 999888" })).items.map((c) => c.customer.name)).toEqual(["Sam Jones"]);
    expect((await listConversations(db, a.businessId, { q: "911" })).items).toHaveLength(2);
    expect((await listConversations(db, a.businessId, { q: "nobody" })).items).toEqual([]);
  });

  it("combines search with a filter", async () => {
    await add(a, { state: "booked" }, { name: "Priya Patel" });
    await add(a, { state: "escalated" }, { name: "Priya Shah" });
    const page = await listConversations(typed(a.owner.client), a.businessId, { q: "priya", filter: "needs-you" });
    expect(page.items.map((c) => c.customer.name)).toEqual(["Priya Shah"]);
  });

  it("cannot be tricked by search text that looks like query syntax", async () => {
    await add(a, {}, { name: "Normal Person" });
    const db = typed(a.owner.client);
    for (const q of ["a),business_id.neq.0,(b", "%", "x%,name.ilike.%", "'; drop table customers; --"]) {
      const page = await listConversations(db, a.businessId, { q });
      expect(page.items.every((c) => c.customer.name === "Normal Person" || page.items.length === 0)).toBe(true);
    }
    expect((await listConversations(db, a.businessId)).items).toHaveLength(1);
  });

  it("never lists another business's conversations, even when searching for them", async () => {
    await add(b, {}, { name: "Secret Customer", phone: "+447911555000" });
    const db = typed(a.owner.client);
    expect((await listConversations(db, a.businessId)).items).toEqual([]);
    expect((await listConversations(db, a.businessId, { q: "secret" })).items).toEqual([]);
    expect((await listConversations(db, b.businessId)).items).toEqual([]);
  });
});

describe("getConversation", () => {
  it("returns the conversation with its messages in order", async () => {
    const id = await add(a, { state: "escalated", escalation_reason: "complaint", turn_count: 2, last_intent: "complaint" }, { name: "Sam", phone: "+447911123456" });
    const base = new Date("2026-10-28T10:00:00Z").getTime();
    await admin.from("messages").insert([
      { business_id: a.businessId, conversation_id: id, direction: "outbound", sender: "system", body: "Hi", status: "delivered", created_at: new Date(base).toISOString() },
      { business_id: a.businessId, conversation_id: id, direction: "inbound", sender: "customer", body: "Unhappy", status: "received", intent: "complaint", created_at: new Date(base + 60_000).toISOString() },
      { business_id: a.businessId, conversation_id: id, direction: "outbound", sender: "ai", body: "Passed on", status: "sent", created_at: new Date(base + 120_000).toISOString() },
    ]);

    const detail = await getConversation(typed(a.owner.client), a.businessId, id);
    expect(detail).toMatchObject({
      id, state: "escalated", escalationReason: "complaint", turnCount: 2, lastIntent: "complaint",
      customer: { phone: "+447911123456", name: "Sam" },
    });
    expect(detail?.messages.map((m) => [m.sender, m.body])).toEqual([["system", "Hi"], ["customer", "Unhappy"], ["ai", "Passed on"]]);
    expect(detail?.messages[1]).toMatchObject({ direction: "inbound", intent: "complaint", status: "received" });
  });

  it("returns an empty thread for a conversation with no messages", async () => {
    const id = await add(a);
    expect((await getConversation(typed(a.owner.client), a.businessId, id))?.messages).toEqual([]);
  });

  it("returns null for another business's conversation, an unknown id, or the wrong business id", async () => {
    const mine = await add(a);
    const theirs = await add(b);
    const db = typed(a.owner.client);
    expect(await getConversation(db, a.businessId, theirs)).toBeNull();
    expect(await getConversation(db, b.businessId, theirs)).toBeNull();
    expect(await getConversation(db, b.businessId, mine)).toBeNull();
    expect(await getConversation(db, a.businessId, "00000000-0000-4000-8000-000000000000")).toBeNull();
  });
});
