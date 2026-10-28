import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { anonClient, pgClient } from "../helpers/db";
import { TENANT_TABLES } from "../helpers/tenant-tables";

// Schema-level guarantees from database.md section 12 and security-privacy.md.

let pg: Client;

beforeAll(async () => {
  pg = await pgClient();
});

afterAll(async () => {
  await pg.end();
});

async function publicTables(): Promise<string[]> {
  const { rows } = await pg.query<{ relname: string }>(
    `select c.relname from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p')
      order by c.relname`,
  );
  return rows.map((r) => r.relname);
}

describe("schema guarantees", () => {
  it("has RLS enabled on every table in public", async () => {
    const { rows } = await pg.query<{ relname: string; relrowsecurity: boolean }>(
      `select c.relname, c.relrowsecurity from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind in ('r', 'p')`,
    );
    expect(rows.length).toBeGreaterThan(0);
    const without = rows.filter((r) => !r.relrowsecurity).map((r) => r.relname);
    expect(without).toEqual([]);
  });

  it("lists every tenant table in TENANT_TABLES (so each gets an isolation test)", async () => {
    const { rows } = await pg.query<{ table_name: string }>(
      `select distinct table_name from information_schema.columns
        where table_schema = 'public' and column_name = 'business_id'`,
    );
    const withBusinessId = rows.map((r) => r.table_name);
    const registered = TENANT_TABLES.map((t) => t.table).filter((t) => t !== "businesses");
    expect(withBusinessId.sort()).toEqual(registered.sort());
  });

  it("has an index leading with business_id on every table that has the column", async () => {
    const { rows: tables } = await pg.query<{ table_name: string }>(
      `select distinct table_name from information_schema.columns
        where table_schema = 'public' and column_name = 'business_id'`,
    );
    const { rows: indexed } = await pg.query<{ relname: string }>(
      `select distinct c.relname from pg_index i
         join pg_class c on c.oid = i.indrelid
         join pg_attribute a on a.attrelid = c.oid and a.attnum = i.indkey[0]
        where c.relnamespace = 'public'::regnamespace and a.attname = 'business_id'`,
    );
    const have = new Set(indexed.map((r) => r.relname));
    const missing = tables.map((t) => t.table_name).filter((t) => !have.has(t));
    expect(missing).toEqual([]);
  });

  it("grants nothing to anon in public", async () => {
    const { rows } = await pg.query(
      `select table_name, privilege_type from information_schema.role_table_grants
        where grantee = 'anon' and table_schema = 'public'`,
    );
    expect(rows).toEqual([]);
  });

  it("lets anon read nothing from any table", async () => {
    const anon = anonClient();
    for (const table of await publicTables()) {
      const { data } = await anon.from(table).select("*").limit(1);
      expect(data ?? [], table).toHaveLength(0);
    }
  });

  it("keeps businesses.status out of tenants' column grants", async () => {
    const { rows } = await pg.query<{ column_name: string }>(
      `select column_name from information_schema.column_privileges
        where grantee = 'authenticated' and table_schema = 'public'
          and table_name = 'businesses' and privilege_type = 'UPDATE'`,
    );
    const cols = rows.map((r) => r.column_name).sort();
    expect(cols).toEqual(["business_hours", "name", "phone_e164", "timezone"]);
  });
});
