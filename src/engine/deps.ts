import { getMessaging } from "@/adapters/messaging";
import { createAdminClient } from "@/lib/supabase/admin";
import { listProducts } from "@/products/registry";
import type { EngineDeps } from "./runner";

/** The real dependencies the worker route uses. Tests pass their own EngineDeps instead. */
export function createEngineDeps(): EngineDeps {
  return {
    admin: createAdminClient(),
    products: listProducts(),
    now: () => new Date(),
    services: { messaging: getMessaging },
  };
}
