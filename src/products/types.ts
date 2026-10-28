import type { ZodType } from "zod";
import type { ProductHandlers } from "@/engine/types";

export type ProductStatus = "available" | "coming_soon";

/**
 * What a product declares to the platform (architecture.md section 8). Products register in
 * src/products/registry.ts; the platform core never imports a product directly.
 * The config form is added in Phase 5.
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
  /** Handlers keyed by event type or action type (automation-engine.md section 3). */
  handlers: ProductHandlers;
}
