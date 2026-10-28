"use server";

import { revalidatePath } from "next/cache";
import { can } from "@/lib/auth/permissions";
import { requireBusiness } from "@/lib/auth/guards";
import { saveProductConfig, setProductEnabled, type SaveConfigResult, type ToggleResult } from "@/services/products";

const FORBIDDEN = { ok: false as const, code: "forbidden" as const, message: "You don't have permission to do that." };

/** Switches a product on or off for the signed-in user's business. */
export async function toggleProductAction(key: string, enabled: boolean): Promise<ToggleResult | typeof FORBIDDEN> {
  const { supabase, business, role } = await requireBusiness();
  if (!can(role, "product.toggle")) return FORBIDDEN;

  const result = await setProductEnabled(supabase, business.id, key, enabled);
  if (result.ok) {
    revalidatePath("/products");
    revalidatePath(`/products/${key}`);
  }
  return result;
}

/** Saves a product's settings. The form sends them as JSON, validated by the product's own schema. */
export async function saveProductConfigAction(key: string, json: string): Promise<SaveConfigResult | typeof FORBIDDEN> {
  const { supabase, business, role } = await requireBusiness();
  if (!can(role, "product.configure")) return FORBIDDEN;

  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { ok: false, code: "invalid", message: "The settings could not be read. Please try again." };
  }

  const result = await saveProductConfig(supabase, business.id, key, raw);
  if (result.ok) {
    revalidatePath("/products");
    revalidatePath(`/products/${key}`);
  }
  return result;
}
