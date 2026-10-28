import { getAdapterMode, getResendEnv } from "@/lib/env";
import { FakeEmailAdapter } from "./fake";
import type { EmailAdapter } from "./interface";
import { ResendEmailAdapter } from "./resend";

let fake: FakeEmailAdapter | undefined;

/** One shared fake so tests can inspect the emails the code under test sent. */
export function getFakeEmail(): FakeEmailAdapter {
  fake ??= new FakeEmailAdapter();
  return fake;
}

/** The email adapter for this process: the fake in tests and `EMAIL_ADAPTER=fake`, else Resend. */
export function getEmail(): EmailAdapter {
  if (process.env.NODE_ENV === "test" || getAdapterMode("email") === "fake") return getFakeEmail();
  const env = getResendEnv();
  return new ResendEmailAdapter({ apiKey: env.RESEND_API_KEY, from: env.RESEND_FROM_EMAIL });
}

export type { EmailAdapter } from "./interface";
