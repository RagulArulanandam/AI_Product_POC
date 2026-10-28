# Security and privacy

Status: draft for review. Depends on: entities.md, database.md, auth.md, architecture.md. Feeds: integrations.md, automation-engine.md, testing.md.

This is a POC for about 5 businesses, so the aim is correct fundamentals, not a compliance programme. Anything needing legal review is marked.

## 1. What we protect
- Customer data: phone numbers, names, message content (held for businesses' customers).
- Business data: profile, config, conversations, calendar access.
- Credentials: Google OAuth tokens per business; platform keys (Twilio, OpenAI, Resend, Supabase service role, worker secret, encryption key).
- Money and reputation: runaway messaging, spam to opted-out people, cross-tenant leaks.

Main threats: tenant A reading tenant B, leaked keys, forged webhooks, replayed webhooks, prompt injection through customer messages, runaway send loops.

## 2. Secrets
- Platform secrets are environment variables only, read through `src/lib/env.ts`. `.env.local` is gitignored; `.env.example` lists names only.
- Only `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` may be `NEXT_PUBLIC_*`.
- Keys that were pasted into chat during planning (Twilio auth token, OpenAI key) are treated as exposed. Rotate them when `.env.local` is configured, and again before any hosted deployment.
- The service-role key is server-only (`import "server-only"`) and importable only from the allowlisted folders (architecture.md section 6).
- A repo scan in tests fails on strings that look like keys (`sk-`, `AC` + 32 hex, `sb_secret_`, private keys) and on a tracked `.env.local`.

## 3. Encrypting provider tokens at rest
Scope: Google OAuth token sets per business. Twilio, OpenAI and Resend keys are platform env vars and are not stored in the database.

- Algorithm: AES-256-GCM via Node `crypto`. Key: `ENCRYPTION_KEY`, 32 random bytes, base64. Optional `ENCRYPTION_KEY_PREVIOUS` for rotation.
- Plaintext is a JSON blob (`access_token`, `refresh_token`, `expiry`, scopes).
- A fresh random 12-byte IV is used for every encryption. The integration's id is bound as additional authenticated data, so a ciphertext copied to another row fails to decrypt.
- Stored in `integration_secrets.ciphertext` as `v1.<iv>.<ciphertext>.<tag>` (base64url); `key_version` records which key was used.
- API in `src/lib/crypto.ts`: `encryptSecret(plaintext, aad)` and `decryptSecret(blob, aad)`. Decryption happens only inside the calendar adapter factory on the server, using the service-role client.
- Rotation: set the new key as `ENCRYPTION_KEY`, move the old one to `ENCRYPTION_KEY_PREVIOUS`, run `scripts/reencrypt-secrets.ts`, then drop the old key. Not needed for the POC, but the format supports it.
- Tokens are never logged, never returned from a service to a page, and never placed in a URL. The integrations UI sees only status and `account_label`.
- Disconnect revokes the token at Google, then deletes the secret row and sets the integration to `disconnected`. If revocation fails, the row is still deleted and the failure is logged.
- Scopes are the narrowest needed: free/busy and event creation on one calendar (integrations.md).

## 4. Webhook security
- Twilio requests are validated with `X-Twilio-Signature` using the auth token over the full public URL and form parameters. The URL base is `PUBLIC_BASE_URL`, never the request host, because the tunnel changes the host.
- Validation lives inside the messaging adapter so routes do not touch vendor code (`validateWebhook(request)`).
- Invalid signature: respond 403, store nothing, emit one structured log line without the payload. (So `webhook_events` only contains authentic events.)
- Idempotency: `webhook_events` has a unique `(provider, provider_event_id)`. Voice uses the call SID; WhatsApp uses the message SID. A duplicate is acknowledged with 200 and ignored. This also covers replays, since Twilio signatures carry no timestamp.
- The worker requires `Authorization: Bearer <WORKER_SECRET>` (constant-time compare). Dev endpoints require the flags plus the secret (auth.md section 4).
- The app never fetches a URL supplied by a customer or tenant, so there is no SSRF surface.

## 5. Tenant isolation
- RLS on every table with default-deny grants (database.md). Tenant tests run in CI.
- The service role bypasses RLS, so every service-role query in the engine, webhooks and admin is scoped by an explicit `business_id` resolved from the event or from an admin's choice.
- A lint rule restricts imports of `lib/supabase/admin`. A test confirms no file outside the allowlist imports it.

## 6. Logging and redaction
- Structured server logs. A `redact()` helper strips `authorization`, tokens, secrets and signature headers, and masks phone numbers to the last 4 digits. It is applied to everything written to `automation_logs.details` and to console logs.
- `automation_logs` holds ids, step, status and short reasons, not message bodies. The raw model output is stored only when it failed validation, truncated to 500 characters.
- LLM prompts and replies are not logged in full.
- `webhook_events.payload` contains phone numbers and message text. It is kept for 30 days, then the payload is nulled by a retention job (Phase 8).

## 7. Frontend bundle
- A script (`npm run check:bundle`) builds the app and fails if any secret name or value appears in `.next/static` or client chunks (acceptance criterion 9). Run it in Phase 8 and whenever env handling changes.

## 8. Abuse and cost controls
- Supabase Auth rate limits are enabled and configured for signup and login (Phase 8).
- Webhooks are protected by signatures and idempotency rather than IP limits.
- Engine send caps, enforced in the single messaging choke point: at most 10 outbound messages per customer per hour, 200 per business per day, and the product turn cap (8). Hitting a cap logs a skip and escalates if a customer is waiting.
- One escalation email per conversation.

## 9. Opt-out (STOP)
- Detection: a customer message that, trimmed and case-insensitive, is exactly one of `STOP`, `STOPALL`, `UNSUBSCRIBE`, `CANCEL`, `END`, `QUIT`. The AI intent `opt_out` is a second signal, handled the same way. Opt-out detection runs before any model call.
- Effect: insert into `opt_outs` (platform-wide, by phone), set the conversation `opted_out`, send one short acknowledgement, cancel pending scheduled actions for that customer.
- Choke point: all customer messaging goes through one function (`sendToCustomer`) that checks `opt_outs` at send time, not just at conversation start. Nothing else may call the messaging adapter's send method (enforced by lint and a test).
- Re-subscribing in the POC is admin-only (delete the `opt_outs` row). No self-service START.

## 10. AI safety
- Customer text is untrusted input. The model has no tools; it returns JSON that code validates with Zod, and code picks the action (the AI proposes, code decides).
- Prompts contain only the current business's blurb, hours, available slots and that conversation. No other tenant's data, no secrets, and no phone numbers (the customer is referred to by first name if known, otherwise "the customer").
- Replies are length-capped and stripped of control characters before sending. Slots are computed by code, and a booking needs explicit confirmation of a specific slot.
- Guardrails (no medical, legal or price promises, no pretending to be human) are in product-missed-call.md.

## 11. Privacy (UK)
Assumptions, not legal advice: the business is the data controller for its customers' data and the platform acts as processor; the messages are service replies to a customer's own missed call, not marketing. Check with legal advice before real customers.

- **Data held:** customer phone, name (if given), message content, intent; owner emails.
- **Subprocessors:** Supabase, Twilio, OpenAI, Resend, Google (Calendar), later Vercel.
- **Minimisation:** no phone numbers sent to OpenAI; only the needed history window is sent.
- **Retention (policy):** conversations and messages kept 12 months, webhook payloads 30 days, logs 90 days. In the POC these are documented, and the deletion job is Phase 8 if time allows.
- **Deletion request:** a documented manual procedure: delete the `customers` row for the business; `conversations`, `messages`, `scheduled_actions` and `automation_logs` for it cascade. The `opt_outs` row is kept so STOP is still honoured.
- **Cookies:** only essential auth cookies, no analytics, so no consent banner is needed.
- **Before real use:** business-facing terms and a data processing agreement, and ICO registration check.

## 12. Dependencies and dev tooling
- Official SDKs only (twilio, openai, resend, Google auth). No unofficial WhatsApp libraries.
- Lockfile committed; `npm audit` run in the Phase 8 review.
- Seed script refuses non-local databases and uses throwaway passwords. Simulate endpoint is gated (auth.md).

## 13. Tests required by this doc
- Encryption: round trip; wrong key, wrong AAD and tampered ciphertext all fail; IV differs per call.
- Redaction: tokens, auth headers and phone numbers masked.
- Webhooks: invalid signature -> 403 and no row stored; replay -> one row; signature check uses `PUBLIC_BASE_URL`.
- Opt-out: STOP variants set `opt_outs`, cancel pending actions, and the choke point refuses to send; a later send attempt from another business to that phone is refused.
- Send caps: the 11th message in an hour for one customer is refused and logged.
- Repo scan finds no keys; bundle check finds no secrets; service-role import allowlist holds.
- Cross-tenant isolation tests from database.md.

## 14. Decisions made here
1. App-level AES-256-GCM with row-bound AAD; only Google tokens are stored per business.
2. Invalid-signature webhooks are rejected and not stored.
3. One messaging choke point enforces opt-out and send caps.
4. Logs hold ids and reasons, not message bodies; payloads are retained 30 days.
5. No phone numbers go to the LLM.
6. Re-subscribing after STOP is admin-only.

## 15. Open items
- Legal review of the controller/processor assumption and retention periods before real customers.
- Retention job and per-customer deletion script (Phase 8 if time allows).
- Env variable list and Twilio and Google specifics: integrations.md.
