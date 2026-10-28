"use server";

import { redirect } from "next/navigation";
import { safeNextPath } from "@/lib/auth/safe-next";
import { zodFieldErrors, type FormState } from "@/lib/form-state";
import { createClient } from "@/lib/supabase/server";
import { loginSchema, signupSchema } from "@/lib/validation/auth";

export async function signupAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = signupSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { ok: false, fieldErrors: zodFieldErrors(parsed.error.issues) };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp(parsed.data);

  // Deliberately generic: do not reveal whether the email is already registered.
  if (error) {
    return { ok: false, error: "Could not create the account. If you already have one, log in instead." };
  }
  if (!data.session) {
    return { ok: false, error: "Check your email to confirm your address, then log in." };
  }
  redirect("/onboarding");
}

export async function loginAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { ok: false, fieldErrors: zodFieldErrors(parsed.error.issues) };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return { ok: false, error: "Invalid email or password." };

  const next = formData.get("next");
  redirect(safeNextPath(typeof next === "string" ? next : null));
}

export async function logoutAction(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
