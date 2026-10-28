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
  /** A column and value tests try to write as another tenant. Never a real change. */
  tamper: Record<string, unknown>;
  /** Builds an insert as tenant A that points at tenant B, which must be refused. */
  crossTenantInsert: (ctx: { victimBusinessId: string; attackerUserId: string }) => Record<string, unknown> | null;
  /** Make sure the victim business has at least one row in this table. */
  ensureRow: (admin: SupabaseClient, businessId: string) => Promise<void>;
}

const noop = async () => {};

export const TENANT_TABLES: TenantTableSpec[] = [
  {
    table: "businesses",
    scopeColumn: "id",
    tamper: { name: "hacked" },
    crossTenantInsert: () => ({ name: "Injected", phone_e164: "+447700900999" }),
    ensureRow: noop, // created with the tenant
  },
  {
    table: "memberships",
    scopeColumn: "business_id",
    tamper: { role: "staff" },
    crossTenantInsert: ({ victimBusinessId, attackerUserId }) => ({
      business_id: victimBusinessId,
      user_id: attackerUserId,
      role: "owner",
    }),
    ensureRow: noop, // owner membership is created with the tenant
  },
];

/** Tables that no tenant may read or write at all. */
export const NO_TENANT_ACCESS_TABLES = ["platform_admins"];
