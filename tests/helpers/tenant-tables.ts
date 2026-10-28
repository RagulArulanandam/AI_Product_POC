import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Every table with tenant data. The meta-test in tests/db/schema.test.ts compares this list
 * with the database, so a new tenant table without an entry here fails the build
 * (testing.md section 3).
 */
export interface TenantTableSpec {
  table: string;
  /** Column that scopes a row to a business (`id` for businesses itself). */
  scopeColumn: "id" | "business_id";
  /** Whether members may read their own rows. False for tables tenants never see. */
  tenantReadable: boolean;
  /** A change tests try to make to another tenant's row. Never a real change. */
  tamper: Record<string, unknown>;
  /** An insert as tenant A that points at tenant B, which must be refused. */
  crossTenantInsert: (ctx: {
    victimBusinessId: string;
    attackerUserId: string;
    productId: string;
  }) => Record<string, unknown> | null;
  /** Make sure the business has at least one row in this table. */
  ensureRow: (admin: SupabaseClient, businessId: string) => Promise<void>;
}

const noop = async () => {};

async function ensureIntegration(admin: SupabaseClient, businessId: string): Promise<string> {
  const { data, error } = await admin
    .from("integrations")
    .upsert({ business_id: businessId, provider: "google_calendar" }, { onConflict: "business_id,provider" })
    .select("id")
    .single();
  if (error || !data) throw new Error(`ensureIntegration failed: ${error?.message}`);
  return data.id;
}

export async function missedCallProductId(admin: SupabaseClient): Promise<string> {
  const { data, error } = await admin.from("products").select("id").eq("key", "missed-call").single();
  if (error || !data) throw new Error(`missed-call product not seeded: ${error?.message}`);
  return data.id;
}

export const TENANT_TABLES: TenantTableSpec[] = [
  {
    table: "businesses",
    scopeColumn: "id",
    tenantReadable: true,
    tamper: { name: "hacked" },
    crossTenantInsert: () => ({ name: "Injected", phone_e164: "+447700900999" }),
    ensureRow: noop, // created with the tenant
  },
  {
    table: "memberships",
    scopeColumn: "business_id",
    tenantReadable: true,
    tamper: { role: "staff" },
    crossTenantInsert: ({ victimBusinessId, attackerUserId }) => ({
      business_id: victimBusinessId,
      user_id: attackerUserId,
      role: "owner",
    }),
    ensureRow: noop, // owner membership is created with the tenant
  },
  {
    table: "subscriptions",
    scopeColumn: "business_id",
    tenantReadable: true,
    tamper: { status: "active" },
    crossTenantInsert: ({ victimBusinessId }) => ({ business_id: victimBusinessId, plan: "free-forever" }),
    ensureRow: noop, // trial subscription is created with the tenant
  },
  {
    table: "business_products",
    scopeColumn: "business_id",
    tenantReadable: true,
    tamper: { enabled: true },
    crossTenantInsert: ({ victimBusinessId, productId }) => ({
      business_id: victimBusinessId,
      product_id: productId,
      enabled: false,
    }),
    ensureRow: async (admin, businessId) => {
      const { error } = await admin
        .from("business_products")
        .upsert(
          { business_id: businessId, product_id: await missedCallProductId(admin), enabled: false },
          { onConflict: "business_id,product_id" },
        );
      if (error) throw new Error(`ensureRow business_products failed: ${error.message}`);
    },
  },
  {
    table: "integrations",
    scopeColumn: "business_id",
    tenantReadable: true,
    tamper: { status: "connected" },
    crossTenantInsert: ({ victimBusinessId }) => ({ business_id: victimBusinessId, provider: "telephony" }),
    ensureRow: async (admin, businessId) => {
      await ensureIntegration(admin, businessId);
    },
  },
  {
    table: "integration_secrets",
    scopeColumn: "business_id",
    tenantReadable: false,
    tamper: { ciphertext: "stolen" },
    crossTenantInsert: ({ victimBusinessId }) => ({
      business_id: victimBusinessId,
      integration_id: "00000000-0000-0000-0000-000000000000",
      ciphertext: "x",
    }),
    ensureRow: async (admin, businessId) => {
      const integrationId = await ensureIntegration(admin, businessId);
      const { error } = await admin
        .from("integration_secrets")
        .upsert(
          { integration_id: integrationId, business_id: businessId, ciphertext: "v1.test.ciphertext.tag" },
          { onConflict: "integration_id" },
        );
      if (error) throw new Error(`ensureRow integration_secrets failed: ${error.message}`);
    },
  },
];

/** Tables that no tenant may read or write at all. */
export const NO_TENANT_ACCESS_TABLES = ["platform_admins"];
