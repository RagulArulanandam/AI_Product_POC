import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { CreateBusinessInput } from "@/lib/validation/business";

export type CreateBusinessResult =
  | { ok: true; businessId: string }
  | { ok: false; code: "already_owner" | "invalid" | "unknown"; message: string };

/** Calls the atomic create_business RPC as the signed-in user (database.md section 10). */
export async function createBusiness(
  supabase: SupabaseClient<Database>,
  input: CreateBusinessInput,
): Promise<CreateBusinessResult> {
  const { data, error } = await supabase.rpc("create_business", {
    p_name: input.name,
    p_phone: input.phone,
    p_timezone: input.timezone,
  });

  if (error || !data) {
    const message = error?.message ?? "";
    if (message.includes("already_owner")) {
      return { ok: false, code: "already_owner", message: "You already have a business." };
    }
    if (/invalid_(name|phone|timezone)/.test(message)) {
      return { ok: false, code: "invalid", message: "Please check the business details." };
    }
    return { ok: false, code: "unknown", message: "Could not create the business. Please try again." };
  }
  return { ok: true, businessId: data };
}
