"use server";

import { revalidatePath } from "next/cache";
import { requireBusiness } from "@/lib/auth/guards";
import { can } from "@/lib/auth/permissions";
import { updateBusinessProfile, type UpdateBusinessResult } from "@/services/business";

/** Saves the business profile. The form sends JSON, validated by the same schema as onboarding. */
export async function updateBusinessAction(json: string): Promise<UpdateBusinessResult> {
  const { supabase, business, role } = await requireBusiness();
  if (!can(role, "business.update")) return { ok: false, message: "You don't have permission to do that." };

  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { ok: false, message: "The details could not be read. Please try again." };
  }

  const result = await updateBusinessProfile(supabase, business.id, raw);
  // The business name appears in the layout on every page.
  if (result.ok) revalidatePath("/", "layout");
  return result;
}
