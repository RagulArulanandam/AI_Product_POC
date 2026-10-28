# Integrations

Status: draft for review. Depends on: architecture.md, security-privacy.md, entities.md. Feeds: automation-engine.md, frontend.md, testing.md.

Every vendor sits behind an interface in `src/adapters/<name>/` with a real implementation and a `fake.ts`. Services never import a vendor SDK.

## 1. Adapter conventions
- `ADAPTER_MODE=real|fake` (default `real`; tests force `fake`). Each folder exports a factory (`getMessaging()`, `getLlm()`, `getEmail()`, `getCalendar(integrationId)`).
- Vendor errors become `AdapterError { code, retryable, cause }`. Codes: `auth`, `rate_limited`, `invalid_request`, `not_found`, `provider_unavailable`, `invalid_output`, `unreachable_recipient`, `outside_window`, `unknown`. Retryable: `rate_limited`, `provider_unavailable`, `unknown`.
- Adapters take and return domain types (E.164 numbers, UTC instants), never vendor types or raw vendor payloads.
- Adapters never log secrets and never read `process.env`; the factory passes config from `env.ts`.

## 2. Messaging and voice (Twilio)

### Interface
```ts
interface MessagingAdapter {
  sendMessage(i: { to: string; body: string }): Promise<{ providerSid: string }>;
  validateWebhook(i: { path: string; params: Record<string,string>; signature: string | null }): boolean;
  parseInboundMessage(params): { providerSid: string; from: string; body: string; hasMedia: boolean };
  parseMessageStatus(params): { providerSid: string; status: 'sent'|'delivered'|'failed'; errorCode?: string };
  parseVoice(params): { callSid: string; from: string | null; to: string };
  voiceResponse(): string;   // TwiML
}
```
- `to`/`from` are E.164 in the interface; the adapter adds and strips the `whatsapp:` prefix.
- `sendMessage` sets the per-message status callback to `PUBLIC_BASE_URL + /api/webhooks/whatsapp/status`, so a changed tunnel URL needs no console change for status callbacks.
- Only the messaging choke point (`sendToCustomer`, security-privacy.md section 9) calls `sendMessage`.

### Webhooks
| Route | Source | Idempotency key |
|---|---|---|
| `POST /api/webhooks/voice` | incoming call on a forwarding number | `CallSid` |
| `POST /api/webhooks/whatsapp` | inbound customer message | `MessageSid` |
| `POST /api/webhooks/whatsapp/status` | delivery status | `MessageSid` + status |

All verify the signature (using `PUBLIC_BASE_URL`), store a `webhook_events` row, and return 200 quickly; work happens in the worker (architecture.md section 3).

### Voice: what "missed call" means here
- The business forwards unanswered calls to its Twilio number (conditional call forwarding). So any call that arrives on a forwarding number already was missed; the status values `no-answer`/`busy`/`failed` are not what we receive. The voice route treats every incoming call as a missed call.
- Resolve the business from `To` through `phone_numbers`. The customer is `From`. If `From` is withheld or not an E.164 number, skip and log `no_caller_id`.
- Response is TwiML `<Reject reason="busy"/>`: no answer, no call charge, caller hears a busy tone.
- `ForwardedFrom` is ignored (carrier-dependent).
- Unknown `To`: respond with the same TwiML, log `unknown_number`, create no conversation.
- UK forwarding codes (carrier-dependent, verify with the carrier): no answer `**61*<number>#`, busy `**67*<number>#`, unreachable `**62*<number>#`, cancel `##002#`. Onboarding shows these as instructions.

### WhatsApp sandbox rules (POC)
**Finding from the first live test (28 Oct 2026):** Twilio has two trial environments. The new Console's "Try out WhatsApp" (sender `+44 7460 077297`, which this POC's trial account uses) only allows messages sent as one of Twilio's pre-approved templates (`ContentSid` required, no free text, even inside the 24 hour window; the Content API is not available on trial accounts). A free-form `Body` is rejected with error 21654 "ContentSid Required". The legacy Sandbox (shared number `+14155238886`, activated in the legacy Console) allows free-form replies inside the 24 hour window, which Product 1's AI conversation needs. The rules below describe the legacy sandbox.

- Sandbox sender `+44 7460 077297`. A tester phone must send `join twilio-trial` to it first. Membership lasts about 72 hours; then rejoin.
- Only one tester recipient can be active at a time. The current tester is `+447887153223`.
- Free-form messages only work inside the 24-hour customer-service window (opened by the customer's join message or any message they send). Outside it, WhatsApp requires an approved template. The sandbox only offers sample templates.
- So the POC sends free-form messages and relies on the tester having joined or written within 24 hours. A failed send maps to `outside_window` or `unreachable_recipient`; the action fails after retries and shows in the admin failed view. The conversation's 24h expiry matches the window.
- Production path (later): one approved template with a `{{business_name}}` variable for the first message; free-form text inside the window. The editable `first_message_template` config then applies only inside the window.
- Trial account: 98 free messages remain at time of writing. Automated tests use the fake adapter; real sends are manual smoke tests only.
- Inbound media: stored as `[media not supported]`, answered with one fixed line asking for text. Does not count toward the model.
- A number that is not on WhatsApp (for example a landline) makes the send fail: conversation `failed`, logged.

### Number mapping
`phone_numbers.e164` (unique) maps a Twilio number to one business. The POC has one real number (`+447460041934`), assigned to one demo business by the seed script from `TWILIO_VOICE_NUMBER`. Other businesses use the simulate endpoint. Adding numbers later needs only new rows.

### Voice trial notes (verify in Phase 3 spike)
- Trial accounts may play a notice to callers; `<Reject>` may avoid it.
- Trial restrictions apply to outbound calls and to messaging unverified recipients.

## 3. Tunnel and Twilio console settings
Local development uses a Cloudflare quick tunnel (`cloudflared tunnel --url http://localhost:3000`). The URL changes whenever it restarts. After a restart:
1. Update `PUBLIC_BASE_URL` in `.env.local` and restart the dev server.
2. Sandbox settings "When a message comes in": `{PUBLIC_BASE_URL}/api/webhooks/whatsapp`.
3. Voice number "A call comes in": `{PUBLIC_BASE_URL}/api/webhooks/voice` (HTTP POST).

Signature validation breaks if these disagree, which shows up as 403s. Phase 8 can move to a named tunnel on an owned domain.

## 4. LLM (OpenAI)
```ts
interface LlmAdapter {
  completeJson<T>(i: {
    system: string;
    messages: { role: 'user' | 'assistant'; content: string }[];
    schema: ZodType<T>; schemaName: string;
  }): Promise<{ data: T; usage: { inputTokens: number; outputTokens: number } }>;
}
```
- Model is `OPENAI_MODEL` (currently `gpt-4o-mini`), never hard-coded.
- Uses the structured-output (`json_schema`) mode with the Zod schema converted via the SDK helper, low temperature, a 20-second timeout and an output token cap.
- The adapter validates the result with Zod. Invalid or refused output becomes `AdapterError('invalid_output')`. The product service retries once, then escalates (product-missed-call.md).
- The OpenAI API is pay-per-use with no free tier. Cost is small with this model, and dev/test use the fake. Make sure the key's account has credit.
- Prompts contain no phone numbers (security-privacy.md section 10).

## 5. Email (Resend)
```ts
interface EmailAdapter {
  send(i: { to: string; subject: string; text: string; html?: string }): Promise<{ providerId: string }>;
}
```
- Env: `RESEND_API_KEY`, `RESEND_FROM_EMAIL`.
- Free tier is about 100 emails/day. Without a verified domain, the sender `onboarding@resend.dev` can only email the Resend account owner's address. So in the POC, `escalation_email` must be that address until a domain is verified; the config form shows a hint.
- Escalation email: summary, masked customer number, link to the conversation (`APP_BASE_URL`). One per conversation.

## 6. Calendar (Google)
```ts
interface CalendarAdapter {
  getFreeBusy(i: { timeMin: Date; timeMax: Date }): Promise<{ start: Date; end: Date }[]>;
  createEvent(i: { eventId: string; start: Date; end: Date; summary: string; description: string }): Promise<{ eventId: string }>;
}
```
- `getCalendar(integrationId)` loads and decrypts the token set, refreshes the access token when expired, and writes the new tokens back (encrypted) via the service role. Only the primary calendar is used.
- Slot computation, buffers and business hours are service logic, not adapter logic. The adapter only reports busy intervals and creates events.
- Idempotent booking: `eventId` is a deterministic lowercase hex id derived from the conversation id and slot start. A 409 conflict on create means the event already exists and is treated as success.
- Google API errors map to `AdapterError`; `invalid_grant` marks the integration `error` with a "reconnect" message, and the engine escalates with a calendar reason.

### OAuth connect flow
- Routes: `GET /api/integrations/google/connect` (owner only; sets an httpOnly state cookie containing a random nonce and the business id, then redirects to Google) and `GET /api/integrations/google/callback` (verifies state, exchanges the code, encrypts and stores tokens, creates or updates the `integrations` row, sets `account_label` to the primary calendar's id/email).
- Request `access_type=offline` and `prompt=consent` so a refresh token is issued.
- Redirect URI uses `localhost`, not the tunnel: `http://localhost:3000/api/integrations/google/callback` locally; the Vercel URL is added in Phase 8.
- Scopes: the narrowest that allow free/busy and event creation. Preferred: free/busy plus owned-events-only scope if available in the current Google API; otherwise `calendar.events`. Verify against the current Google scope list at the start of Phase 6.
- Disconnect: revoke, delete secret, set `disconnected` (security-privacy.md section 3).
- Consent screen in "Testing" status: only listed test users can connect, and refresh tokens expire after 7 days, so reconnect shortly before a demo. Publishing the app unverified avoids expiry but shows a warning screen. Verification is not needed for about 5 businesses.

## 7. Environment variables
| Variable | Used by | Needed from |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | browser + server | Phase 1 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | browser + server | Phase 1 |
| `SUPABASE_SERVICE_ROLE_KEY` | server only | Phase 1 |
| `APP_BASE_URL` | links in emails and redirects | Phase 1 (`http://localhost:3000`) |
| `PUBLIC_BASE_URL` | webhook signature validation, Twilio callbacks | Phase 2 |
| `ADAPTER_MODE` | adapter factories (`real` or `fake`) | Phase 2 |
| `ENABLE_DEV_ENDPOINTS` | simulate endpoint gate | Phase 3 |
| `WORKER_SECRET` | worker auth, cron setup, dev endpoints | Phase 2 |
| `WORKER_URL` | `worker:poll` and cron setup | Phase 2 |
| `ENCRYPTION_KEY` (`ENCRYPTION_KEY_PREVIOUS` optional) | token encryption | Phase 6 |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` | messaging adapter | Phase 3 |
| `TWILIO_WHATSAPP_FROM` | messaging adapter sender | Phase 3 |
| `TWILIO_VOICE_NUMBER` | seed script maps it to a business | Phase 3 |
| `OPENAI_API_KEY`, `OPENAI_MODEL` | LLM adapter | Phase 4 |
| `RESEND_API_KEY`, `RESEND_FROM_EMAIL` | email adapter | Phase 4 |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` | calendar adapter | Phase 6 |

`env.ts` validates each group only when the relevant adapter is in `real` mode, so earlier phases run without later keys.

## 8. Tests
- Contract tests run the same suite against each fake and, where cheap, against the real adapter with mocked HTTP: sending, error mapping (`retryable` flags), parsing.
- Twilio: signature validation with fixture payloads (valid, tampered, wrong URL host); parse fixtures for inbound message, status and voice; `voiceResponse()` returns a reject.
- OpenAI: valid JSON passes; malformed or refused output gives `invalid_output`.
- Google: free/busy parsing; deterministic event id; 409 treated as success; token refresh persisted encrypted; `invalid_grant` marks the integration `error`.
- Manual smoke scripts (not in CI): `npm run smoke:twilio`, `smoke:openai`, `smoke:resend`, `smoke:calendar`, each sending one real request. They are used sparingly because of the 98-message trial cap.

## 9. Decisions made here
1. Every incoming call on a forwarding number is a missed call; the reject response avoids call charges.
2. Message status callbacks are set per message, so only two console URLs depend on the tunnel.
3. Free-form sandbox messages in the 24h window; the approved-template path is documented for production.
4. Idempotent calendar booking with a deterministic event id.
5. The `escalation_email` must be the Resend account email until a domain is verified.
6. Env validation is per adapter mode so phases do not require later keys.

## 10. Open items
- Exact Google scope names (check at Phase 6 start).
- Trial voice behaviour (notice to callers, reject billing): confirm in the Phase 3 spike.
- Named tunnel and production WhatsApp sender: Phase 8 / later.
- Worker and retry behaviour for failed sends: automation-engine.md.
