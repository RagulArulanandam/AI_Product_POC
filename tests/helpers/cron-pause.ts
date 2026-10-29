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

/**
 * The job fires at the start of every minute and the dev server's worker may still be running
 * (a first request after a recompile can take several seconds). Starting tests in that window lets
 * it claim their actions, so wait until it has had time to finish.
 */
const TICK_SETTLE_SECONDS = 12;

export async function setup(): Promise<void> {
  await setCronActive(false);
  const secondsIntoMinute = new Date().getSeconds();
  if (secondsIntoMinute < TICK_SETTLE_SECONDS) {
    await new Promise((resolve) => setTimeout(resolve, (TICK_SETTLE_SECONDS - secondsIntoMinute) * 1000));
  }
}

export async function teardown(): Promise<void> {
  await setCronActive(true);
}
