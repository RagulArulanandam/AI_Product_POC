# Security review (Phase 8)

Reviewed on 29 Oct 2026 against the rules in CLAUDE.md and docs/design/security-privacy.md. Each line says what was checked and what proves it, so the review can be repeated. `npm run verify` runs the automated parts.

## Tenant isolation
| Check | Result | Evidence |
|---|---|---|
| RLS enabled on every table in `public` | Pass | tests/db/schema.test.ts "has RLS enabled on every table" |
| Every tenant table has a cross-tenant read/write/insert test | Pass | tests/db/isolation.test.ts driven by `TENANT_TABLES`; a meta-test fails if a table is missing from the list |
| Index leading with `business_id` on every tenant table | Pass | schema.test.ts |
| Anonymous role has no grants and reads nothing | Pass | schema.test.ts "grants nothing to anon" and "lets anon read nothing" |
| Tenants cannot change `businesses.status` (pause is admin only) | Pass | schema.test.ts column grants |
| Admin area returns 404 to non-admins, and admins with no business go to `/admin` | Pass | tests/integration/admin-guard.test.ts |
| Service-role client only imported from allowlisted folders, never in client code | Pass | tests/unit/service-role-imports.test.ts |

## Secrets and tokens
| Check | Result | Evidence |
|---|---|---|
| No secrets in the repo; `.env.example` holds names only | Pass | `npm run check:secrets` (314 files) |
| No secret name or value in the browser bundle | Pass | `npm run check:bundle` against a production build: 36 client files clean |
| Only the Supabase URL and anon key are `NEXT_PUBLIC_*` | Pass | grep of `src/` |
| Google tokens encrypted at rest (AES-256-GCM, key rotation supported), unreadable by tenants | Pass | tests/unit/crypto.test.ts, tests/integration/calendar-connection.test.ts |
| OAuth state is a one-time nonce in an httpOnly, `secure` (in production), SameSite=Lax cookie tied to the business | Pass | tests/unit/oauth-state.test.ts; src/app/api/integrations/google/connect/route.ts |
| Logs redact tokens, secrets, signatures and phone numbers | Pass | tests/unit/redact.test.ts; no `console.log` in `src/` |
| Dev endpoints refuse to run in production and need the worker secret | Pass | `getDevEndpointsEnabled()` requires `NODE_ENV !== "production"`; tests/integration/simulate-endpoint.test.ts |
| Worker endpoint needs `Authorization: Bearer <WORKER_SECRET>` (constant-time compare) | Pass | tests/unit/worker-auth.test.ts |

## Webhooks and abuse controls
| Check | Result | Evidence |
|---|---|---|
| Signature verified before anything is stored; forged request stores nothing | Pass | tests/integration/webhooks.test.ts |
| Idempotent on the provider's event id (retries are harmless) | Pass | webhooks.test.ts, webhook-routes.test.ts |
| Oversized bodies refused with 413 before they are read | Added in Phase 8 | webhooks.test.ts "refuses an oversized body" (64 KB cap) |
| Webhook payloads (phone numbers, message text) emptied after 30 days | Added in Phase 8 | tests/db/cron.test.ts "webhook payload retention" (daily pg_cron job) |
| Sign-up and login rate limited per IP | Added in Phase 8 | `[auth.rate_limit] sign_in_sign_ups = 10` per 5 minutes in supabase/config.toml. When hosted, set the same value in the Supabase dashboard (Authentication, Rate limits) |
| Outbound send caps (10 per customer per hour, 200 per business per day, turn cap 8) and opt-out checked at send time | Pass | tests/integration/send-gate.test.ts |
| Security headers on every response (nosniff, no framing, referrer policy, permissions policy, HSTS) | Added in Phase 8 | tests/unit/security-headers.test.ts |
| Error pages never show error text | Added in Phase 8 | src/app/error.tsx shows only a reference digest |

## AI safety
| Check | Result | Evidence |
|---|---|---|
| The model only proposes; code validates the JSON and chooses the action | Pass | tests/unit/decide.test.ts |
| STOP is handled before any model call; opted-out customers are never messaged | Pass | optout.test.ts, send-gate.test.ts |
| Prompts hold no other tenant's data or secrets; safety net and escalation for complaints, health and urgent messages | Pass | prompt.test.ts, safety.test.ts, conversation.test.ts |

## Known gaps (accepted for the POC)
- **Simultaneous same-slot bookings** by two customers at the same instant are not locked (documented in docs/design/product-missed-call.md).
- **No Content-Security-Policy.** The other headers are set; a CSP needs every script source mapped first.
- **Rate limiting is per IP through Supabase Auth only.** Webhooks rely on signatures and the engine's send caps, not IP limits, as designed. If a forged-request flood becomes a cost problem on Vercel, add Vercel's firewall rate limit in front of `/api/webhooks/*`.
- **`staff` permissions are not tightened yet**: `can()` returns true for every member (decision pending, docs/design/auth.md section 5).
- **Admin tables fetch counts per business** (a few queries each). Fine for about five businesses; it needs a SQL view before dozens.
- **Real keys pasted into chat earlier** (Twilio auth token, OpenAI key, Resend key) must be rotated before anyone else uses the system.

## Before deploying
1. Rotate the Twilio auth token, OpenAI key and Resend key, and use new values in Vercel's environment settings only.
2. Generate a fresh `ENCRYPTION_KEY` and `WORKER_SECRET` for the hosted project (`openssl rand -base64 32`). Existing local tokens do not carry over: businesses reconnect Google.
3. Set `ENABLE_DEV_ENDPOINTS=false` (it is also forced off in production builds).
4. Hosted Supabase: apply migrations, set the sign-in rate limit, set the worker URL and secret in Vault (`worker_url`, `worker_secret`) and confirm the `worker-tick` and `purge-webhook-payloads` cron jobs exist.
5. Add the production redirect URI to the Google OAuth client and `PUBLIC_BASE_URL` to the Twilio webhook settings.
