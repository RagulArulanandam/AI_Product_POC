import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/lib/database.types";
import { getPublicEnv } from "@/lib/env";

/** Per-request client that runs as the signed-in user, so RLS applies. */
export async function createClient() {
  const cookieStore = await cookies();
  const env = getPublicEnv();
  return createServerClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll(list) {
        try {
          for (const { name, value, options } of list) cookieStore.set(name, value, options);
        } catch {
          // Called from a Server Component, which cannot set cookies. proxy.ts refreshes sessions.
        }
      },
    },
  });
}
