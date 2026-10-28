import { getAdapterMode, getPublicBaseUrl, getTwilioEnv } from "@/lib/env";
import { FakeMessagingAdapter } from "./fake";
import type { MessagingAdapter } from "./interface";
import { TwilioMessagingAdapter } from "./twilio";

let fake: FakeMessagingAdapter | undefined;

/** One shared fake so tests can inspect what the code under test sent. */
export function getFakeMessaging(): FakeMessagingAdapter {
  fake ??= new FakeMessagingAdapter();
  return fake;
}

/** The messaging adapter for this process: the fake in tests and `ADAPTER_MODE=fake`, else Twilio. */
export function getMessaging(): MessagingAdapter {
  if (process.env.NODE_ENV === "test" || getAdapterMode() === "fake") return getFakeMessaging();

  const env = getTwilioEnv();
  return new TwilioMessagingAdapter({
    accountSid: env.TWILIO_ACCOUNT_SID,
    authToken: env.TWILIO_AUTH_TOKEN,
    whatsappFrom: env.TWILIO_WHATSAPP_FROM,
    publicBaseUrl: getPublicBaseUrl(),
    trialContentSid: env.TWILIO_TRIAL_CONTENT_SID,
  });
}

export type { MessagingAdapter } from "./interface";
