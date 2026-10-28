import { getMessaging } from "@/adapters/messaging";
import { twilioInboundProvider } from "@/engine/providers/twilio";
import { createWebhookDeps } from "@/engine/webhook-deps";
import { handleWebhook } from "@/engine/webhooks";

/** A customer's WhatsApp message. Set as the sandbox "when a message comes in" URL. */
export async function POST(request: Request): Promise<Response> {
  return handleWebhook(request, twilioInboundProvider(getMessaging()), createWebhookDeps());
}
