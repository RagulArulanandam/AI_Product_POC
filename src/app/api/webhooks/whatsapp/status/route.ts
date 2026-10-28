import { getMessaging } from "@/adapters/messaging";
import { twilioStatusProvider } from "@/engine/providers/twilio";
import { createWebhookDeps } from "@/engine/webhook-deps";
import { handleWebhook } from "@/engine/webhooks";

/** Delivery status callbacks. The URL is set per message by the messaging adapter. */
export async function POST(request: Request): Promise<Response> {
  return handleWebhook(request, twilioStatusProvider(getMessaging()), createWebhookDeps());
}
