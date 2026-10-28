import { createClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import { assertLocalDatabase, runSeed, SEED, SEED_PASSWORD, type SeedResult } from "../../scripts/seed";
import { serviceClient } from "../helpers/db";

// Phase 1 "done when": two seeded businesses cannot see each other's data, and the seed is
// repeatable.

const admin = serviceClient();
let first: SeedResult;

async function signedIn(email: string) {
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password: SEED_PASSWORD });
  if (error) throw new Error(`sign in ${email}: ${error.message}`);
  return client;
}

beforeAll(async () => {
  first = await runSeed();
});

describe("seed script", () => {
  it("is repeatable and does not duplicate anything", async () => {
    const second = await runSeed();
    expect(second.businesses.map((b) => b.id)).toEqual(first.businesses.map((b) => b.id));

    const ownerIds = first.businesses.map((b) => b.ownerId);
    const { data } = await admin.from("memberships").select("business_id").in("user_id", ownerIds).eq("role", "owner");
    expect(data).toHaveLength(3);

    const { count } = await admin
      .from("subscriptions")
      .select("*", { count: "exact", head: true })
      .in("business_id", first.businesses.map((b) => b.id));
    expect(count).toBe(3);
  });

  it("creates the platform admin without any business membership", async () => {
    const { data: adminRow } = await admin.from("platform_admins").select("user_id").eq("user_id", first.adminUserId);
    expect(adminRow).toHaveLength(1);
    const { data: memberships } = await admin.from("memberships").select("id").eq("user_id", first.adminUserId);
    expect(memberships).toEqual([]);
  });

  it("enables Product 1 for business A only", async () => {
    const [a, b, c] = first.businesses;
    const { data } = await admin
      .from("business_products")
      .select("business_id, enabled")
      .in("business_id", [a.id, b.id, c.id]);
    expect(data).toEqual([{ business_id: a.id, enabled: true }]);
  });

  it("puts a staff member in business A", async () => {
    const { data } = await admin
      .from("memberships")
      .select("role")
      .eq("user_id", first.staffUserId)
      .eq("business_id", first.businesses[0].id);
    expect(data).toEqual([{ role: "staff" }]);
  });

  it("keeps the three seeded businesses invisible to each other's owners", async () => {
    for (const mine of first.businesses) {
      const client = await signedIn(SEED.businesses.find((b) => b.key === mine.key)!.owner);
      const { data: visible } = await client.from("businesses").select("id");
      expect((visible ?? []).map((r) => r.id)).toEqual([mine.id]);

      for (const other of first.businesses.filter((b) => b.id !== mine.id)) {
        const { data: rows } = await client.from("memberships").select("id").eq("business_id", other.id);
        expect(rows ?? []).toHaveLength(0);
        const { data: subs } = await client.from("subscriptions").select("id").eq("business_id", other.id);
        expect(subs ?? []).toHaveLength(0);
        const { data: prods } = await client.from("business_products").select("id").eq("business_id", other.id);
        expect(prods ?? []).toHaveLength(0);
      }
    }
  });

  it("gives every seeded business a trial subscription", async () => {
    const { data } = await admin
      .from("subscriptions")
      .select("status")
      .in("business_id", first.businesses.map((b) => b.id));
    expect(data).toEqual([{ status: "trial" }, { status: "trial" }, { status: "trial" }]);
  });
});

describe("assertLocalDatabase", () => {
  it("allows local addresses", () => {
    expect(() => assertLocalDatabase("http://127.0.0.1:54321")).not.toThrow();
    expect(() => assertLocalDatabase("http://localhost:54321")).not.toThrow();
  });

  it("refuses hosted databases", () => {
    expect(() => assertLocalDatabase("https://abcdefgh.supabase.co")).toThrow(/Refusing/);
    expect(() => assertLocalDatabase("https://evil.example")).toThrow(/Refusing/);
  });
});
