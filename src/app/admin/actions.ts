"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/guards";
import { zodFieldErrors } from "@/lib/form-state";
import { subscriptionSchema, uuidSchema } from "@/lib/validation/admin";
import {
  retryFailedAction,
  setBusinessStatus,
  setProductForBusiness,
  setSubscription,
  type AdminResult,
} from "@/services/admin";

const BAD_REQUEST: AdminResult = { ok: false, message: "That request was not valid." };

function refresh(businessId?: string) {
  revalidatePath("/admin");
  revalidatePath("/admin/failures");
  if (businessId) revalidatePath(`/admin/businesses/${businessId}`);
}

export async function setBusinessStatusAction(businessId: string, status: "active" | "disabled"): Promise<AdminResult> {
  const { user, admin } = await requireAdmin();
  if (!uuidSchema.safeParse(businessId).success || (status !== "active" && status !== "disabled")) return BAD_REQUEST;
  const result = await setBusinessStatus(admin, user.id, businessId, status);
  if (result.ok) refresh(businessId);
  return result;
}

export async function setProductAction(businessId: string, productKey: string, enabled: boolean): Promise<AdminResult> {
  const { user, admin } = await requireAdmin();
  if (!uuidSchema.safeParse(businessId).success || typeof productKey !== "string" || typeof enabled !== "boolean") return BAD_REQUEST;
  const result = await setProductForBusiness(admin, user.id, businessId, productKey, enabled);
  if (result.ok) refresh(businessId);
  return result;
}

export async function retryActionAction(actionId: string): Promise<AdminResult> {
  const { user, admin } = await requireAdmin();
  if (!uuidSchema.safeParse(actionId).success) return BAD_REQUEST;
  const result = await retryFailedAction(admin, user.id, actionId, new Date());
  // The business is not known here, so refresh every admin page that shows failures.
  refresh();
  revalidatePath("/admin/businesses/[id]", "page");
  return result;
}

export type SubscriptionFormState = undefined | { ok: true; message: string } | { ok: false; error?: string; fieldErrors?: Record<string, string[] | undefined> };

export async function saveSubscriptionAction(businessId: string, _prev: SubscriptionFormState, formData: FormData): Promise<SubscriptionFormState> {
  const { user, admin } = await requireAdmin();
  if (!uuidSchema.safeParse(businessId).success) return { ok: false, error: BAD_REQUEST.message };

  const parsed = subscriptionSchema.safeParse({
    status: formData.get("status"),
    plan: formData.get("plan"),
    currentPeriodEnd: formData.get("currentPeriodEnd") ?? "",
    notes: formData.get("notes") ?? "",
  });
  if (!parsed.success) return { ok: false, fieldErrors: zodFieldErrors(parsed.error.issues) };

  const result = await setSubscription(admin, user.id, businessId, parsed.data);
  if (!result.ok) return { ok: false, error: result.message };
  refresh(businessId);
  return { ok: true, message: result.message };
}
