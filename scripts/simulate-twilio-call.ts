import { randomBytes } from "node:crypto";
import { config } from "dotenv";
import twilio from "twilio";

/**
 * Sends our voice webhook the same signed request Twilio sends when a call comes in, so the real
 * path (signature check, number-to-business lookup, missed-call flow, WhatsApp message) can be
 * tried without owning a phone number. Not for production use: it needs your Twilio auth token.
 *
 *   npm run simulate:call -- --from +44... [--to +44...] [--base https://your-app]
 *
 * --from  the caller: a phone that has joined the Twilio WhatsApp sandbox (it gets the message)
 * --to    the "dialled" number; it must exist in phone_numbers for the business (default TWILIO_VOICE_NUMBER)
 * --base  the address the app signs against (default PUBLIC_BASE_URL); must equal the app's PUBLIC_BASE_URL
 * --post-to  send the request to this address instead (for example http://localhost:3000), while still signing for --base
 * The token comes from TWILIO_AUTH_TOKEN (.env.local or the environment), never from an argument.
 */
export interface SignedCall {
  url: string;
  body: string;
  signature: string;
  callSid: string;
}

export function buildSignedCall(input: { base: string; from: string; to: string; authToken: string; callSid?: string }): SignedCall {
  const callSid = input.callSid ?? `CA${randomBytes(16).toString("hex")}`;
  const params: Record<string, string> = {
    CallSid: callSid,
    From: input.from,
    To: input.to,
    CallStatus: "ringing",
    Direction: "inbound",
    ApiVersion: "2010-04-01",
  };
  const url = `${input.base.replace(/\/+$/, "")}/api/webhooks/voice`;
  return {
    url,
    body: new URLSearchParams(params).toString(),
    signature: twilio.getExpectedTwilioSignature(input.authToken, url, params),
    callSid,
  };
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  config({ path: ".env.local", quiet: true });
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const from = arg("from");
  const to = arg("to") ?? process.env.TWILIO_VOICE_NUMBER;
  const base = arg("base") ?? process.env.PUBLIC_BASE_URL;

  if (!authToken) throw new Error("TWILIO_AUTH_TOKEN is not set (.env.local or the environment).");
  if (!from || !/^\+[1-9]\d{6,14}$/.test(from)) throw new Error("Pass --from with the caller's number in +44... format.");
  if (!to || !/^\+[1-9]\d{6,14}$/.test(to)) throw new Error("Pass --to, or set TWILIO_VOICE_NUMBER, in +44... format.");
  if (!base) throw new Error("Pass --base, or set PUBLIC_BASE_URL.");

  const call = buildSignedCall({ base, from, to, authToken });
  const target = arg("post-to") ? `${arg("post-to")!.replace(/\/+$/, "")}/api/webhooks/voice` : call.url;
  const res = await fetch(target, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": call.signature },
    body: call.body,
  });
  console.log(`POST ${target} -> ${res.status}`);
  console.log((await res.text()).slice(0, 300));
  if (res.status === 403) console.error("403: the token or PUBLIC_BASE_URL differs from the one the app uses.");
  if (!res.ok) process.exit(1);
  console.log(`Sent a signed call ${call.callSid} from ${from} to ${to}. The WhatsApp message follows after the product's delay.`);
}

if (process.argv[1]?.includes("simulate-twilio-call")) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
