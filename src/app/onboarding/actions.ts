"use server";

import { redirect } from "next/navigation";
import { requireNoBusiness } from "@/lib/auth/guards";
import { zodFieldErrors, type FormState } from "@/lib/form-state";
import { createBusinessSchema } from "@/lib/validation/business";
import { createBusiness } from "@/services/businesses";

export async function createBusinessAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { supabase } = await requireNoBusiness();

  const parsed = createBusinessSchema.safeParse({
    name: formData.get("name"),
    phone: formData.get("phone"),
    timezone: formData.get("timezone"),
  });
  if (!parsed.success) return { ok: false, fieldErrors: zodFieldErrors(parsed.error.issues) };

  const result = await createBusiness(supabase, parsed.data);
  if (!result.ok) return { ok: false, error: result.message };

  redirect("/dashboard");
}
