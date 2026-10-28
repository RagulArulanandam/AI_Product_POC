import { config } from "dotenv";
import { Client } from "pg";
import { assertLocalDatabase } from "./seed";

/**
 * Tells the database where the worker lives and the secret to call it with, so the
 * `worker-tick` cron job can reach the Next.js app (database.md section 9).
 * Stored in Supabase Vault. Local only. Re-run after `supabase db reset`, which wipes the vault.
 */

/** The Postgres container reaches the host machine as host.docker.internal, not localhost. */
export function toDockerHostUrl(workerUrl: string): string {
  const url = new URL(workerUrl);
  if (["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) url.hostname = "host.docker.internal";
  return url.toString();
}

/** Creates or updates a Supabase Vault secret by name. */
async function upsertVaultSecret(client: Client, name: string, value: string, description: string): Promise<void> {
  const existing = await client.query<{ id: string }>("select id from vault.secrets where name = $1", [name]);
  if (existing.rows.length > 0) {
    await client.query("select vault.update_secret($1::uuid, $2)", [existing.rows[0].id, value]);
  } else {
    await client.query("select vault.create_secret($1, $2, $3)", [value, name, description]);
  }
}

async function main(): Promise<void> {
  config({ path: ".env.local", quiet: true });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.WORKER_SECRET;
  const workerUrl = process.env.WORKER_URL ?? "http://localhost:3000/api/worker";
  if (!supabaseUrl || !secret) throw new Error("NEXT_PUBLIC_SUPABASE_URL and WORKER_SECRET must be set in .env.local");
  assertLocalDatabase(supabaseUrl);

  const client = new Client({
    connectionString: process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
  });
  await client.connect();
  try {
    const target = toDockerHostUrl(workerUrl);
    await upsertVaultSecret(client, "worker_url", target, "URL of the Next.js worker endpoint");
    await upsertVaultSecret(client, "worker_secret", secret, "Bearer token for the worker endpoint");
    // DB tests pause the job; make sure it is running again.
    await client.query("select cron.alter_job(jobid, active := true) from cron.job where jobname = 'worker-tick'");
    console.log(`Cron configured: worker-tick calls ${target} every minute (secret not shown).`);
  } finally {
    await client.end();
  }
}

if (process.argv[1] && /configure-cron\.ts$/.test(process.argv[1].replace(/\\/g, "/"))) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
