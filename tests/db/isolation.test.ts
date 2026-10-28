import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { serviceClient } from "../helpers/db";
import { missedCallProductId, NO_TENANT_ACCESS_TABLES, TENANT_TABLES } from "../helpers/tenant-tables";
import { addStaff, cleanupTenants, createTenant, type TestUser, type Tenant } from "../helpers/tenants";

// Acceptance criterion 1: a user of business A cannot read any row of business B.

let a: Tenant;
let b: Tenant;
let staffA: TestUser;
let productId: string;
const admin = serviceClient();

beforeAll(async () => {
  a = await createTenant("iso-a");
  b = await createTenant("iso-b");
  staffA = await addStaff(a);
  productId = await missedCallProductId(admin);
  for (const spec of TENANT_TABLES) {
    await spec.ensureRow(admin, a.businessId);
    await spec.ensureRow(admin, b.businessId);
  }
});

afterAll(cleanupTenants);

async function countRows(table: string, scopeColumn: string, businessId: string): Promise<number> {
  const { count, error } = await admin
    .from(table)
    .select("*", { count: "exact", head: true })
    .eq(scopeColumn, businessId);
  if (error) throw new Error(`${table}: ${error.message}`);
  return count ?? 0;
}

describe.each(TENANT_TABLES)("tenant isolation: $table", (spec) => {
  for (const [who, getUser] of [
    ["owner of A", () => a.owner],
    ["staff of A", () => staffA],
  ] as const) {
    describe(who, () => {
      it("cannot read rows of B", async () => {
        const { data } = await getUser().client.from(spec.table).select("*").eq(spec.scopeColumn, b.businessId);
        expect(data ?? []).toHaveLength(0);
      });

      it("cannot update rows of B", async () => {
        const before = await countRows(spec.table, spec.scopeColumn, b.businessId);
        const res = await getUser()
          .client.from(spec.table)
          .update(spec.tamper)
          .eq(spec.scopeColumn, b.businessId)
          .select();
        expect(res.data ?? []).toHaveLength(0);

        const { data: after } = await admin.from(spec.table).select("*").eq(spec.scopeColumn, b.businessId);
        expect(after).toHaveLength(before);
        for (const row of after ?? []) {
          for (const [col, value] of Object.entries(spec.tamper)) expect(row[col]).not.toBe(value);
        }
      });

      it("cannot delete rows of B", async () => {
        const before = await countRows(spec.table, spec.scopeColumn, b.businessId);
        const res = await getUser().client.from(spec.table).delete().eq(spec.scopeColumn, b.businessId).select();
        expect(res.data ?? []).toHaveLength(0);
        expect(await countRows(spec.table, spec.scopeColumn, b.businessId)).toBe(before);
      });

      it("cannot insert rows for B", async () => {
        const payload = spec.crossTenantInsert({
          victimBusinessId: b.businessId,
          attackerUserId: getUser().id,
          productId,
        });
        if (!payload) return;
        const before = await countRows(spec.table, spec.scopeColumn, b.businessId);
        const res = await getUser().client.from(spec.table).insert(payload).select();
        expect(res.error).not.toBeNull();
        expect(await countRows(spec.table, spec.scopeColumn, b.businessId)).toBe(before);
      });
    });
  }

  if (spec.tenantReadable) {
    it("lets the owner of A read A's own rows", async () => {
      const { data, error } = await a.owner.client.from(spec.table).select("*").eq(spec.scopeColumn, a.businessId);
      expect(error).toBeNull();
      expect((data ?? []).length).toBeGreaterThan(0);
    });
  } else {
    it("does not let the owner of A read A's own rows either", async () => {
      const { data } = await a.owner.client.from(spec.table).select("*").eq(spec.scopeColumn, a.businessId);
      expect(data ?? []).toHaveLength(0);
    });
  }
});

describe.each(NO_TENANT_ACCESS_TABLES)("platform-only table: %s", (table) => {
  it("gives tenants no access", async () => {
    const { data } = await a.owner.client.from(table).select("*");
    expect(data ?? []).toHaveLength(0);
    const insert = await a.owner.client.from(table).insert({ user_id: a.owner.id }).select();
    expect(insert.error).not.toBeNull();
  });
});
