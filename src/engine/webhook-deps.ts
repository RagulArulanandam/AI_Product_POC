import { after } from "next/server";
import { getPublicBaseUrl } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { createEngineDeps } from "./deps";
import type { WebhookDeps } from "./webhooks";
import { runDueActions } from "./worker";

/** What webhook routes pass to handleWebhook: real database, public tunnel URL, and `after()`. */
export function createWebhookDeps(): WebhookDeps {
  return {
    admin: createAdminClient(),
    publicBaseUrl: getPublicBaseUrl(),
    // Run the worker after the response is sent, so replies are not delayed until the next
    // cron tick. The cron job remains the safety net and the clock for delayed actions.
    schedule: (task) => after(task),
    runWorker: () => runDueActions(createEngineDeps()),
  };
}
