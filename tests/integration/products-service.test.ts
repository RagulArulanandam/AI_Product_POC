import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/database.types";
import { listProductsForBusiness } from "@/services/products";
import { serviceClient } from "../helpers/db";
import { cleanupTenants, createTenant, type Tenant } from "../helpers/tenants";
import { missedCallProductId } from "../helpers/tenant-tables";

const typed = (c: SupabaseClient) => c as unknown as SupabaseClient<Database>;
const admin = serviceClient();

let a: Tenant;
let b: Tenant;

beforeAll(async () => {
  a = await createTenant("psvc-a");
  b = await createTenant("psvc-b");
});

afterAll(cleanupTenants);

describe("listProductsForBusiness", () => {
  it("lists every registered product, all off for a new business", async () => {
    const products = await listProductsForBusiness(typed(a.owner.client), a.businessId);
    expect(products.map((p) => p.key)).toEqual(["missed-call", "priority-inbox", "daily-brief"]);
    expect(products.every((p) => !p.enabled)).toBe(true);
    expect(products.find((p) => p.key === "missed-call")?.status).toBe("available");
    expect(products.filter((p) => p.status === "coming_soon")).toHaveLength(2);
  });

  it("shows a product as enabled only for the business that enabled it", async () => {
    await admin
      .from("business_products")
      .insert({ business_id: a.businessId, product_id: await missedCallProductId(admin), enabled: true });

    const forA = await listProductsForBusiness(typed(a.owner.client), a.businessId);
    expect(forA.find((p) => p.key === "missed-call")?.enabled).toBe(true);

    const forB = await listProductsForBusiness(typed(b.owner.client), b.businessId);
    expect(forB.find((p) => p.key === "missed-call")?.enabled).toBe(false);
  });

  it("does not leak another business's enablement through RLS", async () => {
    // A asking about B's id sees B's rows as empty, so everything reads as off.
    const spy = await listProductsForBusiness(typed(a.owner.client), b.businessId);
    expect(spy.every((p) => !p.enabled)).toBe(true);
  });

  it("never reports a coming_soon product as enabled, even if a row says so", async () => {
    const { data: soon } = await admin.from("products").select("id").eq("key", "daily-brief").single();
    await admin
      .from("business_products")
      .insert({ business_id: b.businessId, product_id: soon!.id, enabled: true });
    const forB = await listProductsForBusiness(typed(b.owner.client), b.businessId);
    expect(forB.find((p) => p.key === "daily-brief")?.enabled).toBe(false);
  });
});
