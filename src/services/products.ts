import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import { flattenIssues } from "@/lib/forms/field-errors";
import { getProduct, listProducts } from "@/products/registry";
import type { ProductStatus } from "@/products/types";

export interface ProductView {
  key: string;
  name: string;
  description: string;
  status: ProductStatus;
  /** Whether this business has switched the product on. Always false for coming_soon. */
  enabled: boolean;
}

/**
 * Every registered product, merged with this business's enablement. The registry is the source
 * of truth for what exists; business_products only says what the business has switched on.
 */
export async function listProductsForBusiness(
  supabase: SupabaseClient<Database>,
  businessId: string,
): Promise<ProductView[]> {
  const { data, error } = await supabase
    .from("business_products")
    .select("enabled, product:products(key)")
    .eq("business_id", businessId);
  if (error) throw new Error(`listProductsForBusiness failed: ${error.message}`);

  const enabledKeys = new Set(
    (data ?? []).filter((row) => row.enabled && row.product).map((row) => row.product!.key),
  );

  return listProducts().map((p) => ({
    key: p.key,
    name: p.name,
    description: p.description,
    status: p.status,
    enabled: p.status === "available" && enabledKeys.has(p.key),
  }));
}

export type ProductActionError = "not_found" | "coming_soon" | "subscription" | "business_disabled" | "invalid" | "failed";

/** Plain-English explanations shown to people when a product action is refused. */
export const PRODUCT_ERROR_MESSAGES: Record<ProductActionError, string> = {
  not_found: "That product could not be found.",
  coming_soon: "This product is not available yet.",
  subscription: "Your subscription is not active, so products cannot be switched on. Contact us to renew.",
  business_disabled: "Your business has been paused by the platform team.",
  invalid: "Please fix the highlighted fields.",
  failed: "Something went wrong. Please try again.",
};

export type ToggleResult = { ok: true; enabled: boolean } | { ok: false; code: ProductActionError; message: string };
export type SaveConfigResult =
  | { ok: true }
  | { ok: false; code: ProductActionError; message: string; fieldErrors?: Record<string, string> };

const refuse = (code: ProductActionError) => ({ ok: false as const, code, message: PRODUCT_ERROR_MESSAGES[code] });

type Db = SupabaseClient<Database>;
type JsonObject = Record<string, Json | undefined>;

async function productRowId(supabase: Db, key: string): Promise<string | null> {
  const { data } = await supabase.from("products").select("id").eq("key", key).maybeSingle();
  return data?.id ?? null;
}

/** Why a business cannot switch products on right now, or null when it can. */
async function enableBlocker(supabase: Db, businessId: string): Promise<ProductActionError | null> {
  const { data: business } = await supabase.from("businesses").select("status").eq("id", businessId).maybeSingle();
  if (!business) return "not_found";
  if (business.status !== "active") return "business_disabled";

  const { data: subscription } = await supabase.from("subscriptions").select("status").eq("business_id", businessId).maybeSingle();
  if (!subscription || !["trial", "active"].includes(subscription.status)) return "subscription";
  return null;
}

/**
 * Switches a product on or off for a business. The database also enforces this (RLS), but the
 * checks here give people a reason instead of a permission error. Tenants cannot upsert, so this
 * selects first and then updates or inserts.
 */
export async function setProductEnabled(supabase: Db, businessId: string, key: string, enabled: boolean): Promise<ToggleResult> {
  const product = getProduct(key);
  if (!product) return refuse("not_found");
  if (enabled && product.status !== "available") return refuse("coming_soon");

  if (enabled) {
    const blocker = await enableBlocker(supabase, businessId);
    if (blocker) return refuse(blocker);
  }

  const productId = await productRowId(supabase, key);
  if (!productId) return refuse("not_found");

  const { data: existing } = await supabase
    .from("business_products")
    .select("id")
    .eq("business_id", businessId)
    .eq("product_id", productId)
    .maybeSingle();

  const write = existing
    ? await supabase.from("business_products").update({ enabled }).eq("id", existing.id).select("id")
    : await supabase
        .from("business_products")
        .insert({ business_id: businessId, product_id: productId, enabled, config: product.defaultConfig as JsonObject })
        .select("id");

  // RLS hides other businesses' rows, so an empty result means "not yours" rather than an error.
  if (write.error || !write.data || write.data.length === 0) return refuse("failed");
  return { ok: true, enabled };
}

export interface ProductSettings<TConfig = unknown> {
  key: string;
  enabled: boolean;
  /** The saved config with defaults filled in. */
  config: TConfig;
}

/** The saved settings for one product, with defaults applied. Null for an unknown product. */
export async function getProductSettings(supabase: Db, businessId: string, key: string): Promise<ProductSettings | null> {
  const product = getProduct(key);
  if (!product) return null;
  const productId = await productRowId(supabase, key);
  if (!productId) return null;

  const { data } = await supabase
    .from("business_products")
    .select("enabled, config")
    .eq("business_id", businessId)
    .eq("product_id", productId)
    .maybeSingle();

  const parsed = product.configSchema.safeParse(data?.config ?? {});
  return {
    key,
    enabled: product.status === "available" && (data?.enabled ?? false),
    // A stored value that no longer fits the schema falls back to the defaults.
    config: parsed.success ? parsed.data : product.defaultConfig,
  };
}

/** Validates and saves a product's config with the same schema the form uses. */
export async function saveProductConfig(supabase: Db, businessId: string, key: string, raw: unknown): Promise<SaveConfigResult> {
  const product = getProduct(key);
  if (!product) return refuse("not_found");
  if (product.status !== "available") return refuse("coming_soon");

  const parsed = product.configSchema.safeParse(raw);
  if (!parsed.success) {
    return { ...refuse("invalid"), fieldErrors: flattenIssues(parsed.error.issues) };
  }

  const productId = await productRowId(supabase, key);
  if (!productId) return refuse("not_found");

  const { data: existing } = await supabase
    .from("business_products")
    .select("id")
    .eq("business_id", businessId)
    .eq("product_id", productId)
    .maybeSingle();

  const write = existing
    ? await supabase.from("business_products").update({ config: parsed.data as JsonObject }).eq("id", existing.id).select("id")
    : await supabase
        .from("business_products")
        .insert({ business_id: businessId, product_id: productId, enabled: false, config: parsed.data as JsonObject })
        .select("id");

  if (write.error || !write.data || write.data.length === 0) return refuse("failed");
  return { ok: true };
}
