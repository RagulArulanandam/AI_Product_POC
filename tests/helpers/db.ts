import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Client } from "pg";

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set. Start local Supabase and fill .env.local (see .env.example).`);
  return v;
}

const clientOptions = { auth: { persistSession: false, autoRefreshToken: false } } as const;

/** Service-role client: bypasses RLS. Test setup and assertions only. */
export function serviceClient(): SupabaseClient {
  return createClient(need("NEXT_PUBLIC_SUPABASE_URL"), need("SUPABASE_SERVICE_ROLE_KEY"), clientOptions);
}

/** Client with the public key and no session (role: anon). */
export function anonClient(): SupabaseClient {
  return createClient(need("NEXT_PUBLIC_SUPABASE_URL"), need("NEXT_PUBLIC_SUPABASE_ANON_KEY"), clientOptions);
}

/** Direct Postgres connection for catalog queries (RLS flags, indexes, grants). */
export async function pgClient(): Promise<Client> {
  const client = new Client({
    connectionString: process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
  });
  await client.connect();
  return client;
}
