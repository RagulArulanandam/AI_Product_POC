import type { ZodType } from "zod";

export type ProductStatus = "available" | "coming_soon";

/**
 * What a product declares to the platform (architecture.md section 8). Products register in
 * src/products/registry.ts; the platform core never imports a product directly.
 * Handlers and the config form are added by Phases 3 to 5.
 */
export interface ProductManifest {
  /** Stable key, also stored in the `products` table. */
  key: string;
  name: string;
  description: string;
  status: ProductStatus;
  /** One schema shared by the config form and the server action. */
  configSchema: ZodType;
  defaultConfig: unknown;
  /** Event types the engine routes to this product. */
  handledEvents: readonly string[];
}
