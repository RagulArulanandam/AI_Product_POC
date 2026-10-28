import { getMessaging } from "@/adapters/messaging";
import { twilioVoiceProvider } from "@/engine/providers/twilio";
import { createWebhookDeps } from "@/engine/webhook-deps";
import { handleWebhook } from "@/engine/webhooks";

/** Twilio "a call comes in" webhook for a business's forwarding number. */
export async function POST(request: Request): Promise<Response> {
  return handleWebhook(request, twilioVoiceProvider(getMessaging()), createWebhookDeps());
}
