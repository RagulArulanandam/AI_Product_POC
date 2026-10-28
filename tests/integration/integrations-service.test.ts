import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@/lib/database.types";
import { forwardingCodes, getIntegrationsOverview, setForwardingConfirmed } from "@/services/integrations";
import { anonClient, serviceClient } from "../helpers/db";
import { addStaff, cleanupTenants, createTenant, type TestUser, type Tenant } from "../helpers/tenants";

const typed = (c: SupabaseClient) => c as unknown as SupabaseClient<Database>;
const admin = serviceClient();

let a: Tenant;
let b: Tenant;
let staffA: TestUser;
let numberA: string;

beforeAll(async () => {
  a = await createTenant("int-a");
  b = await createTenant("int-b");
  staffA = await addStaff(a);
  numberA = `+447700900${Math.floor(Math.random() * 800) + 100}`;
});

beforeEach(async () => {
  for (const t of [a, b]) {
    await admin.from("integrations").delete().eq("business_id", t.businessId);
    await admin.from("phone_numbers").delete().eq("business_id", t.businessId);
  }
});

afterAll(cleanupTenants);

const assign = (tenant: Tenant, e164 = numberA) => admin.from("phone_numbers").insert({ business_id: tenant.businessId, e164 });

describe("getIntegrationsOverview", () => {
  it("shows a business with nothing connected", async () => {
    expect(await getIntegrationsOverview(typed(a.owner.client), a.businessId)).toEqual({
      assistantNumber: null,
      telephony: { status: "disconnected", forwardingConfirmed: false },
      calendar: { status: "disconnected", accountLabel: null, lastError: null },
    });
  });

  it("shows the assigned number and each integration's state", async () => {
    await assign(a);
    const first = await admin.from("integrations").insert({ business_id: a.businessId, provider: "telephony", status: "connected", metadata: { forwarding_confirmed: true } });
    const second = await admin.from("integrations").insert({ business_id: a.businessId, provider: "google_calendar", status: "error", account_label: "clinic@example.com", last_error: "Reconnect needed" });
    expect(first.error).toBeNull();
    expect(second.error).toBeNull();
    expect(await getIntegrationsOverview(typed(a.owner.client), a.businessId)).toEqual({
      assistantNumber: numberA,
      telephony: { status: "connected", forwardingConfirmed: true },
      calendar: { status: "error", accountLabel: "clinic@example.com", lastError: "Reconnect needed" },
    });
  });

  it("never shows another business's number or connections", async () => {
    await assign(b);
    await admin.from("integrations").insert({ business_id: b.businessId, provider: "google_calendar", status: "connected", account_label: "other@example.com" });
    const overview = await getIntegrationsOverview(typed(a.owner.client), b.businessId);
    expect(overview.assistantNumber).toBeNull();
    expect(overview.calendar).toEqual({ status: "disconnected", accountLabel: null, lastError: null });
  });
});

describe("setForwardingConfirmed", () => {
  it("refuses to confirm when no number has been assigned", async () => {
    const result = await setForwardingConfirmed(typed(a.owner.client), a.businessId, true);
    expect(result).toEqual({ ok: false, message: "No assistant number has been assigned to your business yet. Please contact support." });
    expect((await getIntegrationsOverview(typed(a.owner.client), a.businessId)).telephony.forwardingConfirmed).toBe(false);
  });

  it("confirms forwarding once a number is assigned, and can take it back", async () => {
    await assign(a);
    const db = typed(a.owner.client);
    expect(await setForwardingConfirmed(db, a.businessId, true)).toEqual({ ok: true });
    expect((await getIntegrationsOverview(db, a.businessId)).telephony).toEqual({ status: "connected", forwardingConfirmed: true });

    expect(await setForwardingConfirmed(db, a.businessId, false)).toEqual({ ok: true });
    expect((await getIntegrationsOverview(db, a.businessId)).telephony).toEqual({ status: "disconnected", forwardingConfirmed: false });
  });

  it("is safe to repeat and keeps one integration row", async () => {
    await assign(a);
    const db = typed(a.owner.client);
    await setForwardingConfirmed(db, a.businessId, true);
    await setForwardingConfirmed(db, a.businessId, true);
    const { count } = await admin.from("integrations").select("*", { count: "exact", head: true }).eq("business_id", a.businessId).eq("provider", "telephony");
    expect(count).toBe(1);
  });

  it("keeps other facts stored on the telephony row", async () => {
    await assign(a);
    await admin.from("integrations").insert({ business_id: a.businessId, provider: "telephony", metadata: { note: "keep me" } });
    await setForwardingConfirmed(typed(a.owner.client), a.businessId, true);
    const { data } = await admin.from("integrations").select("metadata").eq("business_id", a.businessId).eq("provider", "telephony").single();
    expect(data?.metadata).toEqual({ note: "keep me", forwarding_confirmed: true });
  });

  it("lets staff do it too (permissions are not decided yet)", async () => {
    await assign(a);
    expect(await setForwardingConfirmed(typed(staffA.client), a.businessId, true)).toEqual({ ok: true });
  });

  it("cannot be used on another business", async () => {
    await assign(b, "+447700900199");
    const result = await setForwardingConfirmed(typed(a.owner.client), b.businessId, true);
    expect(result).toEqual({ ok: false, message: "You don't have permission to do that." });
    const { count } = await admin.from("integrations").select("*", { count: "exact", head: true }).eq("business_id", b.businessId);
    expect(count).toBe(0);
  });

  it("cannot be called without signing in", async () => {
    await assign(a);
    const { error } = await anonClient().rpc("set_forwarding_confirmed", { p_business: a.businessId, p_confirmed: true });
    expect(error).not.toBeNull();
  });

  it("lets tenants change nothing else on integrations: direct writes are still refused", async () => {
    await assign(a);
    await setForwardingConfirmed(typed(a.owner.client), a.businessId, true);
    const direct = await a.owner.client.from("integrations").update({ status: "error" }).eq("business_id", a.businessId).select();
    expect(direct.error).not.toBeNull();
    const secrets = await a.owner.client.from("integration_secrets").select("*");
    expect(secrets.data ?? []).toHaveLength(0);
  });
});

describe("forwardingCodes", () => {
  it("builds the carrier codes with the assistant number", () => {
    const codes = forwardingCodes("+447460041934");
    expect(codes.map((c) => c.code)).toEqual(["**61*+447460041934#", "**67*+447460041934#", "**62*+447460041934#", "##002#"]);
    expect(codes.every((c) => c.label && c.description)).toBe(true);
  });
});
