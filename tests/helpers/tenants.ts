import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { anonClient, serviceClient } from "./db";

export const TEST_PASSWORD = "Test-password-123";

export interface TestUser {
  id: string;
  email: string;
  /** Signed in as this user: RLS applies. */
  client: SupabaseClient;
}

export interface Tenant {
  label: string;
  businessId: string;
  owner: TestUser;
}

const created: { users: string[]; businesses: string[] } = { users: [], businesses: [] };

function unique(label: string): string {
  return `${label}-${randomUUID().slice(0, 8)}`;
}

/** Create an auth user and return a client signed in as them. */
export async function createUser(label: string): Promise<TestUser> {
  const admin = serviceClient();
  const email = `${unique(label)}@test.local`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);
  created.users.push(data.user.id);

  const client = anonClient();
  const { error: signInError } = await client.auth.signInWithPassword({ email, password: TEST_PASSWORD });
  if (signInError) throw new Error(`signIn failed: ${signInError.message}`);
  return { id: data.user.id, email, client };
}

/** Ofcom drama-range number (07700 900000-900999), never a real one (testing.md section 4). */
function testPhone(): string {
  return `+447700900${String(Math.floor(Math.random() * 900) + 100)}`;
}

/** A business with an owner, set up through the service role. */
export async function createTenant(label: string): Promise<Tenant> {
  const admin = serviceClient();
  const owner = await createUser(`${label}-owner`);

  const { data: business, error } = await admin
    .from("businesses")
    .insert({ name: `Test ${unique(label)}`, phone_e164: testPhone() })
    .select("id")
    .single();
  if (error || !business) throw new Error(`createTenant business failed: ${error?.message}`);
  created.businesses.push(business.id);

  const { error: memberError } = await admin
    .from("memberships")
    .insert({ business_id: business.id, user_id: owner.id, role: "owner" });
  if (memberError) throw new Error(`createTenant membership failed: ${memberError.message}`);

  // Mirrors what the create_business RPC does (migration 4).
  const { error: subscriptionError } = await admin.from("subscriptions").insert({ business_id: business.id });
  if (subscriptionError) throw new Error(`createTenant subscription failed: ${subscriptionError.message}`);

  return { label, businessId: business.id, owner };
}

/** Register a business created outside createTenant (for example through the RPC) for cleanup. */
export function trackBusiness(id: string): void {
  created.businesses.push(id);
}

/** Add a staff member to an existing business. */
export async function addStaff(tenant: Tenant, label = "staff"): Promise<TestUser> {
  const staff = await createUser(`${tenant.label}-${label}`);
  const { error } = await serviceClient()
    .from("memberships")
    .insert({ business_id: tenant.businessId, user_id: staff.id, role: "staff" });
  if (error) throw new Error(`addStaff failed: ${error.message}`);
  return staff;
}

/** Delete everything this test run created (businesses cascade to their rows). */
export async function cleanupTenants(): Promise<void> {
  const admin = serviceClient();
  if (created.businesses.length > 0) {
    await admin.from("businesses").delete().in("id", created.businesses);
    created.businesses.length = 0;
  }
  for (const id of created.users.splice(0)) {
    await admin.auth.admin.deleteUser(id);
  }
}
