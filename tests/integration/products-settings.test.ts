import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@/lib/database.types";
import { getProductSettings, listProductsForBusiness, PRODUCT_ERROR_MESSAGES, saveProductConfig, setProductEnabled } from "@/services/products";
import { serviceClient } from "../helpers/db";
import { addStaff, cleanupTenants, createTenant, type TestUser, type Tenant } from "../helpers/tenants";

const typed = (c: SupabaseClient) => c as unknown as SupabaseClient<Database>;
const admin = serviceClient();

let a: Tenant;
let b: Tenant;
let staffA: TestUser;

async function rows(businessId: string) {
  const { data } = await admin.from("business_products").select("enabled, config").eq("business_id", businessId);
  return data ?? [];
}

beforeAll(async () => {
  a = await createTenant("pset-a");
  b = await createTenant("pset-b");
  staffA = await addStaff(a);
});

beforeEach(async () => {
  for (const t of [a, b]) {
    await admin.from("business_products").delete().eq("business_id", t.businessId);
    await admin.from("subscriptions").update({ status: "trial" }).eq("business_id", t.businessId);
    await admin.from("businesses").update({ status: "active" }).eq("id", t.businessId);
  }
});

afterAll(cleanupTenants);

describe("setProductEnabled", () => {
  it("switches Product 1 on, creating the row with default settings, and off again", async () => {
    const db = typed(a.owner.client);
    expect(await setProductEnabled(db, a.businessId, "missed-call", true)).toEqual({ ok: true, enabled: true });
    let [row] = await rows(a.businessId);
    expect(row.enabled).toBe(true);
    expect(row.config).toMatchObject({ delay_minutes: 2, booking_enabled: false });

    expect(await setProductEnabled(db, a.businessId, "missed-call", false)).toEqual({ ok: true, enabled: false });
    [row] = await rows(a.businessId);
    expect(row.enabled).toBe(false);

    await setProductEnabled(db, a.businessId, "missed-call", true);
    expect(await rows(a.businessId)).toHaveLength(1); // updated, not duplicated
  });

  it("keeps saved settings when a product is switched off and on", async () => {
    const db = typed(a.owner.client);
    await setProductEnabled(db, a.businessId, "missed-call", true);
    await saveProductConfig(db, a.businessId, "missed-call", { delay_minutes: 9 });
    await setProductEnabled(db, a.businessId, "missed-call", false);
    await setProductEnabled(db, a.businessId, "missed-call", true);
    expect((await getProductSettings(db, a.businessId, "missed-call"))?.config).toMatchObject({ delay_minutes: 9 });
  });

  it("lets staff switch products too (permissions are not decided yet)", async () => {
    expect((await setProductEnabled(typed(staffA.client), a.businessId, "missed-call", true)).ok).toBe(true);
  });

  it.each([
    ["cancelled", "subscription"],
    ["past_due", "subscription"],
  ])("refuses to switch on when the subscription is %s, with a clear reason", async (status, code) => {
    await admin.from("subscriptions").update({ status }).eq("business_id", a.businessId);
    const result = await setProductEnabled(typed(a.owner.client), a.businessId, "missed-call", true);
    expect(result).toEqual({ ok: false, code, message: PRODUCT_ERROR_MESSAGES.subscription });
    expect(await rows(a.businessId)).toHaveLength(0);
  });

  it("still lets a business switch a product OFF when its subscription lapsed", async () => {
    const db = typed(a.owner.client);
    await setProductEnabled(db, a.businessId, "missed-call", true);
    await admin.from("subscriptions").update({ status: "cancelled" }).eq("business_id", a.businessId);
    expect(await setProductEnabled(db, a.businessId, "missed-call", false)).toEqual({ ok: true, enabled: false });
  });

  it("refuses when the business has been disabled", async () => {
    await admin.from("businesses").update({ status: "disabled" }).eq("id", a.businessId);
    const result = await setProductEnabled(typed(a.owner.client), a.businessId, "missed-call", true);
    expect(result).toMatchObject({ ok: false, code: "business_disabled" });
  });

  it("refuses coming-soon and unknown products", async () => {
    const db = typed(a.owner.client);
    expect(await setProductEnabled(db, a.businessId, "daily-brief", true)).toMatchObject({ ok: false, code: "coming_soon" });
    expect(await setProductEnabled(db, a.businessId, "priority-inbox", true)).toMatchObject({ ok: false, code: "coming_soon" });
    expect(await setProductEnabled(db, a.businessId, "does-not-exist", true)).toMatchObject({ ok: false, code: "not_found" });
    expect(await rows(a.businessId)).toHaveLength(0);
  });

  it("cannot touch another business: nothing is written for it", async () => {
    const result = await setProductEnabled(typed(a.owner.client), b.businessId, "missed-call", true);
    expect(result).toMatchObject({ ok: false });
    expect(await rows(b.businessId)).toHaveLength(0);

    await admin.from("business_products").insert({ business_id: b.businessId, product_id: (await admin.from("products").select("id").eq("key", "missed-call").single()).data!.id, enabled: false });
    const again = await setProductEnabled(typed(a.owner.client), b.businessId, "missed-call", true);
    // B's business is invisible to A, so it is reported as not found (and nothing leaks).
    expect(again).toMatchObject({ ok: false, code: "not_found" });
    expect((await rows(b.businessId))[0].enabled).toBe(false);
  });
});

describe("getProductSettings", () => {
  it("gives defaults and off for a business that has never set the product up", async () => {
    const settings = await getProductSettings(typed(a.owner.client), a.businessId, "missed-call");
    expect(settings?.enabled).toBe(false);
    expect(settings?.config).toMatchObject({ delay_minutes: 2, send_outside_hours: true, booking_enabled: false, escalation_email: null });
  });

  it("returns saved settings merged with defaults", async () => {
    const db = typed(a.owner.client);
    await saveProductConfig(db, a.businessId, "missed-call", { delay_minutes: 7, business_blurb: "Family dentist." });
    const settings = await getProductSettings(db, a.businessId, "missed-call");
    expect(settings?.config).toMatchObject({ delay_minutes: 7, business_blurb: "Family dentist.", appointment_duration_minutes: 30 });
  });

  it("falls back to defaults when the stored config no longer fits the schema", async () => {
    const productId = (await admin.from("products").select("id").eq("key", "missed-call").single()).data!.id;
    await admin.from("business_products").insert({ business_id: a.businessId, product_id: productId, enabled: true, config: { delay_minutes: "soon" } });
    const settings = await getProductSettings(typed(a.owner.client), a.businessId, "missed-call");
    expect(settings?.config).toMatchObject({ delay_minutes: 2 });
    expect(settings?.enabled).toBe(true);
  });

  it("never shows another business's settings", async () => {
    await saveProductConfig(typed(b.owner.client), b.businessId, "missed-call", { delay_minutes: 33 });
    const spy = await getProductSettings(typed(a.owner.client), b.businessId, "missed-call");
    expect(spy?.config).toMatchObject({ delay_minutes: 2 }); // RLS hides B's row, so defaults
  });

  it("reports unknown products as null and coming-soon products as off", async () => {
    const db = typed(a.owner.client);
    expect(await getProductSettings(db, a.businessId, "nope")).toBeNull();
    expect((await getProductSettings(db, a.businessId, "daily-brief"))?.enabled).toBe(false);
  });
});

describe("saveProductConfig", () => {
  it("saves a valid config without changing whether the product is on", async () => {
    const db = typed(a.owner.client);
    await setProductEnabled(db, a.businessId, "missed-call", true);
    expect(await saveProductConfig(db, a.businessId, "missed-call", { delay_minutes: 15, appointment_duration_minutes: 45 })).toEqual({ ok: true });
    const [row] = await rows(a.businessId);
    expect(row.enabled).toBe(true);
    expect(row.config).toMatchObject({ delay_minutes: 15, appointment_duration_minutes: 45, buffer_minutes: 0 });
  });

  it("saves for a product that is still off, leaving it off", async () => {
    await saveProductConfig(typed(a.owner.client), a.businessId, "missed-call", { delay_minutes: 4 });
    expect((await rows(a.businessId))[0].enabled).toBe(false);
  });

  it("returns a message for each invalid field and writes nothing", async () => {
    const result = await saveProductConfig(typed(a.owner.client), a.businessId, "missed-call", {
      delay_minutes: 500,
      escalation_email: "not-an-email",
      first_message_template: "   ",
      appointment_duration_minutes: 1,
      business_hours: { mon: { open: "17:00", close: "09:00" }, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("invalid");
      expect(Object.keys(result.fieldErrors ?? {})).toEqual(
        expect.arrayContaining(["delay_minutes", "escalation_email", "first_message_template", "appointment_duration_minutes", "business_hours.mon"]),
      );
      expect(result.fieldErrors!["business_hours.mon"]).toBe("Closing time must be after opening time");
    }
    expect(await rows(a.businessId)).toHaveLength(0);
  });

  it("refuses coming-soon and unknown products", async () => {
    const db = typed(a.owner.client);
    expect(await saveProductConfig(db, a.businessId, "daily-brief", {})).toMatchObject({ ok: false, code: "coming_soon" });
    expect(await saveProductConfig(db, a.businessId, "nope", {})).toMatchObject({ ok: false, code: "not_found" });
  });

  it("cannot overwrite another business's settings", async () => {
    await saveProductConfig(typed(b.owner.client), b.businessId, "missed-call", { delay_minutes: 20 });
    const result = await saveProductConfig(typed(a.owner.client), b.businessId, "missed-call", { delay_minutes: 1 });
    expect(result).toMatchObject({ ok: false });
    expect((await rows(b.businessId))[0].config).toMatchObject({ delay_minutes: 20 });
  });
});

describe("listProductsForBusiness after toggling", () => {
  it("shows the switch state on the products list", async () => {
    const db = typed(a.owner.client);
    expect((await listProductsForBusiness(db, a.businessId)).find((p) => p.key === "missed-call")?.enabled).toBe(false);
    await setProductEnabled(db, a.businessId, "missed-call", true);
    expect((await listProductsForBusiness(db, a.businessId)).find((p) => p.key === "missed-call")?.enabled).toBe(true);
  });
});
