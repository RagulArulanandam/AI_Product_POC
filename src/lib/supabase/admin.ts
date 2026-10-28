import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { getPublicEnv, getServerEnv } from "@/lib/env";

/**
 * Service-role client: bypasses RLS. Server-only, and importable only from the allowlisted
 * folders (architecture.md section 6; enforced by tests/unit/service-role-imports.test.ts).
 */
export function createAdminClient() {
  return createClient<Database>(getPublicEnv().NEXT_PUBLIC_SUPABASE_URL, getServerEnv().SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
