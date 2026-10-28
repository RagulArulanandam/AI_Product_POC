import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { Role } from "./permissions";

export type BusinessSummary = {
  id: string;
  name: string;
  phone_e164: string;
  timezone: string;
  status: "active" | "disabled";
};

export type BusinessContext =
  | { kind: "no_business" }
  | { kind: "disabled"; business: BusinessSummary; role: Role }
  | { kind: "ok"; business: BusinessSummary; role: Role };

/**
 * Finds the user's business through RLS (POC: one business per user, so the oldest
 * membership). Pure of Next.js so it can be tested with a signed-in client.
 */
export async function resolveBusinessContext(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<BusinessContext> {
  const { data, error } = await supabase
    .from("memberships")
    .select("role, business:businesses(id, name, phone_e164, timezone, status)")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`resolveBusinessContext failed: ${error.message}`);
  if (!data || !data.business) return { kind: "no_business" };

  const business = data.business as BusinessSummary;
  const role = data.role as Role;
  return business.status === "disabled" ? { kind: "disabled", business, role } : { kind: "ok", business, role };
}

/** Admin check. Pass the service-role client: tenants have no access to platform_admins. */
export async function isPlatformAdmin(admin: SupabaseClient<Database>, userId: string): Promise<boolean> {
  const { data, error } = await admin.from("platform_admins").select("id").eq("user_id", userId).maybeSingle();
  if (error) throw new Error(`isPlatformAdmin failed: ${error.message}`);
  return data !== null;
}
