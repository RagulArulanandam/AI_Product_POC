import { createEngineDeps } from "@/engine/deps";
import { isAuthorized } from "@/engine/worker-auth";
import { runDueActions } from "@/engine/worker";
import { getWorkerSecret } from "@/lib/env";

export const maxDuration = 60;

/**
 * Processes due scheduled actions. Called by pg_cron every minute, by webhook routes right
 * after they enqueue work, and by `npm run worker:poll`. Protected by WORKER_SECRET.
 */
export async function POST(request: Request): Promise<Response> {
  let secret: string;
  try {
    secret = getWorkerSecret();
  } catch {
    // Misconfigured server: refuse everyone rather than run unauthenticated.
    return Response.json({ error: "worker_not_configured" }, { status: 500 });
  }

  if (!isAuthorized(request.headers.get("authorization"), secret)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const summary = await runDueActions(createEngineDeps());
  return Response.json(summary, { headers: { "Cache-Control": "no-store" } });
}
