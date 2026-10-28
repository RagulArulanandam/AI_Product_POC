import { Client } from "pg";

/**
 * The `worker-tick` cron job calls the live dev server every minute, and that worker would
 * claim actions the queue tests create. Pause the job while DB tests run and resume it after.
 * (If a run is killed before teardown, `npm run db:setup` re-activates the job.)
 */
async function setCronActive(active: boolean): Promise<void> {
  const client = new Client({
    connectionString: process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
  });
  await client.connect();
  try {
    await client.query("select cron.alter_job(jobid, active := $1) from cron.job where jobname = 'worker-tick'", [active]);
  } finally {
    await client.end();
  }
}

export async function setup(): Promise<void> {
  await setCronActive(false);
}

export async function teardown(): Promise<void> {
  await setCronActive(true);
}
