import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { anonClient, serviceClient } from "../helpers/db";
import { cleanupTenants, createTenant, type Tenant } from "../helpers/tenants";

let a: Tenant;
let missedCall: string;
let priorityInbox: string;
const admin = serviceClient();

async function productId(key: string): Promise<string> {
  const { data, error } = await admin.from("products").select("id").eq("key", key).single();
  if (error || !data) throw new Error(`product ${key} missing`);
  return data.id;
}

async function setSubscription(status: string) {
  await admin.from("subscriptions").update({ status }).eq("business_id", a.businessId);
}

beforeAll(async () => {
  a = await createTenant("prod-a");
  missedCall = await productId("missed-call");
  priorityInbox = await productId("priority-inbox");
});

afterAll(cleanupTenants);

describe("products", () => {
  it("seeds the three products with the right availability", async () => {
    const { data } = await admin.from("products").select("key, status").order("key");
    expect(data).toEqual([
      { key: "daily-brief", status: "coming_soon" },
      { key: "missed-call", status: "available" },
      { key: "priority-inbox", status: "coming_soon" },
    ]);
  });

  it("lets signed-in users read products but not anon", async () => {
    const signedIn = await a.owner.client.from("products").select("key");
    expect(signedIn.data).toHaveLength(3);
    const anon = await anonClient().from("products").select("key");
    expect(anon.data ?? []).toHaveLength(0);
  });

  it("does not let tenants write products", async () => {
    const res = await a.owner.client.from("products").update({ status: "available" }).eq("key", "daily-brief").select();
    expect(res.data ?? []).toHaveLength(0);
    const insert = await a.owner.client.from("products").insert({ key: "evil", name: "Evil" });
    expect(insert.error).not.toBeNull();
  });
});

describe("enabling a product (can_enable_product)", () => {
  async function reset(subscription = "trial") {
    await admin.from("business_products").delete().eq("business_id", a.businessId);
    await admin.from("businesses").update({ status: "active" }).eq("id", a.businessId);
    await setSubscription(subscription);
  }
  async function seedRow(enabled: boolean) {
    const { error } = await admin
      .from("business_products")
      .insert({ business_id: a.businessId, product_id: missedCall, enabled });
    if (error) throw new Error(error.message);
  }
  async function enabledNow(): Promise<boolean | undefined> {
    const { data } = await admin
      .from("business_products")
      .select("enabled")
      .eq("business_id", a.businessId)
      .eq("product_id", missedCall)
      .maybeSingle();
    return data?.enabled;
  }
  function setEnabled(enabled: boolean) {
    return a.owner.client
      .from("business_products")
      .update({ enabled })
      .eq("business_id", a.businessId)
      .eq("product_id", missedCall)
      .select();
  }

  it("works on a trial subscription", async () => {
    await reset("trial");
    const { error } = await a.owner.client
      .from("business_products")
      .insert({ business_id: a.businessId, product_id: missedCall, enabled: true });
    expect(error).toBeNull();
    expect(await enabledNow()).toBe(true);
  });

  it("is blocked on insert when the subscription is cancelled", async () => {
    await reset("cancelled");
    const { error } = await a.owner.client
      .from("business_products")
      .insert({ business_id: a.businessId, product_id: missedCall, enabled: true });
    expect(error).not.toBeNull();
    expect(await enabledNow()).toBeUndefined();
  });

  it("is blocked on update when the subscription is cancelled", async () => {
    await reset("cancelled");
    await seedRow(false);
    const { error } = await setEnabled(true);
    expect(error).not.toBeNull();
    expect(await enabledNow()).toBe(false);
  });

  it("always allows disabling, even when cancelled", async () => {
    await reset("cancelled");
    await seedRow(true);
    const { data, error } = await setEnabled(false);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(await enabledNow()).toBe(false);
  });

  it("is blocked for a coming_soon product", async () => {
    await reset("active");
    const { error } = await a.owner.client
      .from("business_products")
      .insert({ business_id: a.businessId, product_id: priorityInbox, enabled: true });
    expect(error).not.toBeNull();
  });

  it("is blocked when the business is disabled", async () => {
    await reset("trial");
    await seedRow(false);
    await admin.from("businesses").update({ status: "disabled" }).eq("id", a.businessId);
    const { error } = await setEnabled(true);
    expect(error).not.toBeNull();
    expect(await enabledNow()).toBe(false);
  });

  it("lets the service role override the subscription check (admin)", async () => {
    await reset("cancelled");
    await seedRow(false);
    const { error } = await admin
      .from("business_products")
      .update({ enabled: true })
      .eq("business_id", a.businessId)
      .eq("product_id", missedCall);
    expect(error).toBeNull();
    expect(await enabledNow()).toBe(true);
  });
});

describe("business_products config", () => {
  beforeAll(async () => {
    await admin.from("business_products").delete().eq("business_id", a.businessId);
    await admin.from("subscriptions").update({ status: "trial" }).eq("business_id", a.businessId);
    await admin.from("businesses").update({ status: "active" }).eq("id", a.businessId);
    await admin.from("business_products").insert({ business_id: a.businessId, product_id: missedCall });
  });

  it("lets a member save config on their own row", async () => {
    const { data, error } = await a.owner.client
      .from("business_products")
      .update({ config: { delay_minutes: 5 } })
      .eq("business_id", a.businessId)
      .eq("product_id", missedCall)
      .select("config")
      .single();
    expect(error).toBeNull();
    expect(data?.config).toEqual({ delay_minutes: 5 });
  });

  it("does not let a member re-point a row to another business or product", async () => {
    const res = await a.owner.client
      .from("business_products")
      .update({ product_id: priorityInbox })
      .eq("business_id", a.businessId);
    expect(res.error).not.toBeNull();
  });

  it("does not let tenants upsert (it would need update rights on the key columns)", async () => {
    const { error } = await a.owner.client
      .from("business_products")
      .upsert({ business_id: a.businessId, product_id: missedCall, enabled: false }, { onConflict: "business_id,product_id" });
    expect(error).not.toBeNull();
  });

  it("enforces one row per business and product", async () => {
    const { error } = await admin
      .from("business_products")
      .insert({ business_id: a.businessId, product_id: missedCall });
    expect(error).not.toBeNull();
  });
});

describe("subscriptions and integrations", () => {
  it("is read-only for tenants", async () => {
    const res = await a.owner.client
      .from("subscriptions")
      .update({ status: "active" })
      .eq("business_id", a.businessId)
      .select();
    expect(res.error).not.toBeNull();
  });

  it("allows only one subscription per business and validates status", async () => {
    const dup = await admin.from("subscriptions").insert({ business_id: a.businessId });
    expect(dup.error).not.toBeNull();
    const bad = await admin.from("subscriptions").update({ status: "free" }).eq("business_id", a.businessId);
    expect(bad.error).not.toBeNull();
  });

  it("is read-only for tenants on integrations and enforces uniqueness", async () => {
    const insert = await a.owner.client.from("integrations").insert({ business_id: a.businessId, provider: "telephony" });
    expect(insert.error).not.toBeNull();

    await admin.from("integrations").insert({ business_id: a.businessId, provider: "telephony" });
    const dup = await admin.from("integrations").insert({ business_id: a.businessId, provider: "telephony" });
    expect(dup.error).not.toBeNull();
    const badProvider = await admin.from("integrations").insert({ business_id: a.businessId, provider: "stripe" });
    expect(badProvider.error).not.toBeNull();
  });

  it("keeps integration_secrets invisible to tenants", async () => {
    const { data: integration } = await admin
      .from("integrations")
      .select("id")
      .eq("business_id", a.businessId)
      .eq("provider", "telephony")
      .single();
    await admin
      .from("integration_secrets")
      .insert({ integration_id: integration!.id, business_id: a.businessId, ciphertext: "v1.x.y.z" });

    const read = await a.owner.client.from("integration_secrets").select("*");
    expect(read.data ?? []).toHaveLength(0);
    expect(read.error).not.toBeNull();
  });

  it("deletes dependent rows with the business", async () => {
    const t = await createTenant("prod-cascade");
    await admin.from("business_products").insert({ business_id: t.businessId, product_id: missedCall });
    await admin.from("businesses").delete().eq("id", t.businessId);
    const { count } = await admin
      .from("business_products")
      .select("*", { count: "exact", head: true })
      .eq("business_id", t.businessId);
    expect(count).toBe(0);
  });
});
