import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { listProducts } from "@/products/registry";
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
