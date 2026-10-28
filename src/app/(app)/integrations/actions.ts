"use server";

import { revalidatePath } from "next/cache";
import { requireBusiness } from "@/lib/auth/guards";
import { can } from "@/lib/auth/permissions";
import { setForwardingConfirmed, type ForwardingResult } from "@/services/integrations";

/** Records that the owner has set up (or cleared) call forwarding. */
export async function confirmForwardingAction(confirmed: boolean): Promise<ForwardingResult> {
  const { supabase, business, role } = await requireBusiness();
  if (!can(role, "integration.manage")) return { ok: false, message: "You don't have permission to do that." };

  const result = await setForwardingConfirmed(supabase, business.id, confirmed);
  if (result.ok) {
    revalidatePath("/integrations");
    revalidatePath("/dashboard");
  }
  return result;
}
