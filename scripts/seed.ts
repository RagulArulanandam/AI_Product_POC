import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import type { Database } from "@/lib/database.types";
import { getPublicEnv, getServerEnv } from "@/lib/env";

/**
 * Local seed data (database.md section 11): one platform admin, three businesses with an owner
 * each, and one staff member. Safe to run repeatedly. Refuses any non-local database.
 * The password is a throwaway constant that only exists in local data.
 */
export const SEED_PASSWORD = "Password123!";

export const SEED = {
  admin: { email: "admin@poc.local" },
  businesses: [
    { key: "a", name: "Bright Smile Dental", phone: "+447700900101", owner: "owner-a@poc.local" },
    { key: "b", name: "Glow Beauty Clinic", phone: "+447700900102", owner: "owner-b@poc.local" },
    { key: "c", name: "Fresh Cuts Studio", phone: "+447700900103", owner: "owner-c@poc.local" },
  ],
  staff: { email: "staff-a@poc.local", businessKey: "a" },
} as const;

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

export function assertLocalDatabase(url: string): void {
  const host = new URL(url).hostname;
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(`Refusing to seed ${host}: seeding is only allowed against a local Supabase.`);
  }
}

type Admin = SupabaseClient<Database>;

async function findUserId(admin: Admin, email: string): Promise<string | null> {
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw new Error(`listUsers failed: ${error.message}`);
    const match = data.users.find((u) => u.email === email);
    if (match) return match.id;
    if (data.users.length < 100) return null;
  }
  return null;
}

async function ensureUser(admin: Admin, email: string): Promise<string> {
  const existing = await findUserId(admin, email);
  if (existing) return existing;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: SEED_PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`createUser ${email} failed: ${error?.message}`);
  return data.user.id;
}

export interface SeedResult {
  adminUserId: string;
  businesses: { key: string; id: string; name: string; ownerId: string }[];
  staffUserId: string;
}

export async function runSeed(): Promise<SeedResult> {
  const publicEnv = getPublicEnv();
  assertLocalDatabase(publicEnv.NEXT_PUBLIC_SUPABASE_URL);
  const options = { auth: { persistSession: false, autoRefreshToken: false } } as const;

  const admin = createClient<Database>(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    getServerEnv().SUPABASE_SERVICE_ROLE_KEY,
    options,
  );

  // Platform admin (not a member of any business).
  const adminUserId = await ensureUser(admin, SEED.admin.email);
  const { error: adminError } = await admin
    .from("platform_admins")
    .upsert({ user_id: adminUserId }, { onConflict: "user_id" });
  if (adminError) throw new Error(`platform_admins upsert failed: ${adminError.message}`);

  const { data: product, error: productError } = await admin
    .from("products")
    .select("id")
    .eq("key", "missed-call")
    .single();
  if (productError || !product) throw new Error("missed-call product is not seeded; run the migrations first.");

  const businesses: SeedResult["businesses"] = [];
  for (const b of SEED.businesses) {
    const ownerId = await ensureUser(admin, b.owner);

    // Create through the real onboarding RPC, as the owner, unless they already have a business.
    const { data: existing } = await admin
      .from("memberships")
      .select("business_id")
      .eq("user_id", ownerId)
      .eq("role", "owner")
      .maybeSingle();

    let businessId = existing?.business_id;
    if (!businessId) {
      const asOwner = createClient<Database>(publicEnv.NEXT_PUBLIC_SUPABASE_URL, publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY, options);
      const { error: signInError } = await asOwner.auth.signInWithPassword({ email: b.owner, password: SEED_PASSWORD });
      if (signInError) throw new Error(`sign in ${b.owner} failed: ${signInError.message}`);
      const { data, error } = await asOwner.rpc("create_business", {
        p_name: b.name,
        p_phone: b.phone,
        p_timezone: "Europe/London",
      });
      if (error || !data) throw new Error(`create_business for ${b.name} failed: ${error?.message}`);
      businessId = data;
    }
    businesses.push({ key: b.key, id: businessId, name: b.name, ownerId });
  }

  // Business A has Product 1 switched on, so the dashboard has something to show.
  const a = businesses.find((b) => b.key === "a")!;
  const { error: enableError } = await admin
    .from("business_products")
    .upsert({ business_id: a.id, product_id: product.id, enabled: true }, { onConflict: "business_id,product_id" });
  if (enableError) throw new Error(`enable product failed: ${enableError.message}`);

  // One staff member in business A.
  const staffUserId = await ensureUser(admin, SEED.staff.email);
  const { error: staffError } = await admin
    .from("memberships")
    .upsert({ business_id: a.id, user_id: staffUserId, role: "staff" }, { onConflict: "business_id,user_id" });
  if (staffError) throw new Error(`staff membership failed: ${staffError.message}`);

  return { adminUserId, businesses, staffUserId };
}

async function main(): Promise<void> {
  config({ path: ".env.local", quiet: true });
  const result = await runSeed();
  console.log("Seeded local data (password for every account: " + SEED_PASSWORD + ")");
  console.log(`  admin   ${SEED.admin.email}`);
  for (const b of SEED.businesses) console.log(`  owner   ${b.owner}  ->  ${b.name}`);
  console.log(`  staff   ${SEED.staff.email}  ->  ${result.businesses[0].name}`);
}

if (process.argv[1] && /seed\.ts$/.test(process.argv[1].replace(/\\/g, "/"))) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
