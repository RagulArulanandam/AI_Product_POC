import { config } from "dotenv";

/**
 * Fallback for pg_cron: calls the worker endpoint in a loop (automation-engine.md section 9).
 *   npm run worker:poll            every 10 seconds
 *   npm run worker:poll -- --once  one call, print the summary, exit
 */
async function callWorker(url: string, secret: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${secret}` } });
  const body: unknown = await res.json().catch(() => null);
  return { status: res.status, body };
}

async function main(): Promise<void> {
  config({ path: ".env.local", quiet: true });
  const url = process.env.WORKER_URL ?? "http://localhost:3000/api/worker";
  const secret = process.env.WORKER_SECRET;
  if (!secret) throw new Error("WORKER_SECRET must be set in .env.local");

  const once = process.argv.includes("--once");
  const intervalMs = 10_000;

  do {
    try {
      const { status, body } = await callWorker(url, secret);
      const summary = body as { claimed?: number } | null;
      if (once || status !== 200 || (summary?.claimed ?? 0) > 0) {
        console.log(`${new Date().toISOString()} ${status} ${JSON.stringify(body)}`);
      }
      if (once && status !== 200) process.exit(1);
    } catch (error) {
      console.error(`${new Date().toISOString()} worker call failed:`, error instanceof Error ? error.message : error);
      if (once) process.exit(1);
    }
    if (!once) await new Promise((r) => setTimeout(r, intervalMs));
  } while (!once);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
