import "server-only";
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isPlatformAdmin, resolveBusinessContext } from "./context";

/** Every protected page, layout and server action calls a guard itself (auth.md section 4). */
export const requireUser = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return { supabase, user };
});

/** For business pages: sends users without a business to onboarding, disabled ones to the notice. */
export async function requireBusiness() {
  const { supabase, user } = await requireUser();
  const ctx = await resolveBusinessContext(supabase, user.id);
  if (ctx.kind === "no_business") redirect("/onboarding");
  if (ctx.kind === "disabled") redirect("/disabled");
  return { supabase, user, business: ctx.business, role: ctx.role };
}

/** For onboarding: users who already have a business go to the dashboard. */
export async function requireNoBusiness() {
  const { supabase, user } = await requireUser();
  const ctx = await resolveBusinessContext(supabase, user.id);
  if (ctx.kind !== "no_business") redirect("/dashboard");
  return { supabase, user };
}

/** For admin pages. Non-admins get a 404 so the area's existence is not revealed. */
export async function requireAdmin() {
  const { user } = await requireUser();
  const admin = createAdminClient();
  if (!(await isPlatformAdmin(admin, user.id))) notFound();
  return { user, admin };
}
