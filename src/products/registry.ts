import { dailyBriefManifest } from "./daily-brief/manifest";
import { missedCallManifest } from "./missed-call/manifest";
import { priorityInboxManifest } from "./priority-inbox/manifest";
import type { ProductManifest } from "./types";

/**
 * The single place products are registered (architecture.md section 8). Adding a product
 * means adding its folder and one line here; the platform core does not change.
 * The `products` table is seeded from this list; tests/db/registry-sync.test.ts keeps them equal.
 */
export const PRODUCTS: readonly ProductManifest[] = [
  missedCallManifest,
  priorityInboxManifest,
  dailyBriefManifest,
];

export function listProducts(): readonly ProductManifest[] {
  return PRODUCTS;
}

export function getProduct(key: string): ProductManifest | undefined {
  return PRODUCTS.find((p) => p.key === key);
}
