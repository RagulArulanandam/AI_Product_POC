import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import { flattenIssues } from "@/lib/forms/field-errors";
import { updateBusinessSchema } from "@/lib/validation/business";

type Db = SupabaseClient<Database>;

export type UpdateBusinessResult =
  | { ok: true }
  | { ok: false; message: string; fieldErrors?: Record<string, string> };

/**
 * Saves the business profile: name, phone, timezone and opening hours. Tenants may change these
 * columns only (never `status`); the database enforces that with column grants and RLS.
 */
export async function updateBusinessProfile(supabase: Db, businessId: string, raw: unknown): Promise<UpdateBusinessResult> {
  const parsed = updateBusinessSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, message: "Please fix the highlighted fields.", fieldErrors: flattenIssues(parsed.error.issues) };
  }
  const { name, phone, timezone, business_hours } = parsed.data;

  const { data, error } = await supabase
    .from("businesses")
    .update({ name, phone_e164: phone, timezone, business_hours: business_hours as Record<string, Json | undefined> })
    .eq("id", businessId)
    .select("id");

  if (error || !data || data.length === 0) return { ok: false, message: "Could not save your changes. Please try again." };
  return { ok: true };
}

export interface SubscriptionView {
  plan: string;
  status: string;
  currentPeriodEnd: string | null;
  notes: string;
}

/** The business's subscription record (read-only for tenants; maintained by the platform team). */
export async function getSubscription(supabase: Db, businessId: string): Promise<SubscriptionView | null> {
  const { data } = await supabase
    .from("subscriptions")
    .select("plan, status, current_period_end, notes")
    .eq("business_id", businessId)
    .maybeSingle();
  if (!data) return null;
  return { plan: data.plan, status: data.status, currentPeriodEnd: data.current_period_end, notes: data.notes };
}
