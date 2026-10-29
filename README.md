# AI Business Automation (POC)

A multi-tenant platform where small service businesses sign up, connect tools, enable AI "products" and configure them without technical help. Product 1 (Missed Call to WhatsApp Assistant) is built first; Products 2 and 3 are "coming soon" cards.

Scope and decisions: [docs/spec.md](docs/spec.md). Build order: [docs/plan.md](docs/plan.md). Design docs: [docs/design/](docs/design/) and [docs/testing.md](docs/testing.md).

## Status
Phase 1 (platform core) is done: sign up, onboarding, route protection, tenant isolation with RLS, product registry and seed data.
Phase 2 (automation engine) is done: queue, runner with retries, worker endpoint, pg_cron and an idempotent webhook helper. It has no customer-facing behaviour yet; it is exercised by tests.
Phase 3 (Product 1 outbound) is done: a missed call (real webhook or simulated) opens a conversation and sends the first WhatsApp message after the configured delay. On a Twilio trial account the message is Twilio's fixed template, not our text (see docs/design/integrations.md).
Phase 4 (AI conversation) is done: customer replies are answered by the model within strict rules, and complaints, requests for a person, urgent or health questions and unusable answers hand the conversation to a person and email the owner. STOP opts the customer out. Verified with scripted models and fake WhatsApp; live OpenAI needs billing credit, and live WhatsApp replies need a Twilio account that can send free text.
Phase 5 (customer dashboard) is done: onboarding, dashboard with metrics and set-up checklist, product cards and the Product 1 form, settings, billing status, integrations with call-forwarding steps, and conversation list and detail. `npm run db:seed` adds demo conversations for Bright Smile Dental (owner-a@poc.local) so the pages have something to show. To check a production build without disturbing `npm run dev`, build into its own folder: `NEXT_DIST_DIR=.next-build npx next build`, then `NEXT_DIST_DIR=.next-build npx next start -p 3102`.
Phase 6 (calendar booking) is done and tested with a fake calendar and a stubbed Google: connect and disconnect Google Calendar (tokens encrypted), the assistant offers real free times, books the one the customer picks, and hands over to a person when the calendar cannot be used. It has not been tried against a real Google account yet: that needs `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `GOOGLE_REDIRECT_URI` in `.env.local` (see docs/design/integrations.md). Set `CALENDAR_ADAPTER=fake` to try Connect and booking locally without Google.
Phase 7 (admin panel) is done: sign in as `admin@poc.local` to land on `/admin`, which lists every business with subscription, products, integration health and 30-day usage. A business page lets an admin pause or resume the business, edit the subscription by hand, switch products on or off and read the automation log. `/admin/failures` lists failed automations with a Retry button. Every admin change is logged as an `admin_action`; non-admins get a 404 on `/admin`.
Phase 8 (hardening) is not built yet.

## Prerequisites
- Node.js 24 and npm
- Docker Desktop (running)
- [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started)

## Setup
```bash
npm install
supabase start                 # local Postgres, Auth and Studio (first run pulls images)
cp .env.example .env.local     # then fill in the local values from `supabase status -o env`
npm run db:reset               # apply migrations and configure the worker cron
npm run db:seed                # demo businesses and users
npm run dev                    # http://localhost:3000
```

`.env.local` for Phases 1 and 2 needs `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (the publishable key), `SUPABASE_SERVICE_ROLE_KEY` (the secret key), `APP_BASE_URL`, `WORKER_SECRET` (any random string of 16+ characters) and `WORKER_URL`. The other variables in `.env.example` are for later phases.

The background worker runs every minute through pg_cron, which calls `/api/worker` on your dev server (so `npm run dev` must be running, and `npm run db:setup` must have been run after any plain `supabase db reset`).

Seed accounts (password `Password123!`, local data only): `admin@poc.local`, `owner-a@poc.local`, `owner-b@poc.local`, `owner-c@poc.local`, `staff-a@poc.local`.

## Commands
| Command | What it does |
|---|---|
| `npm run dev` | start the app |
| `npm run verify` | lint, typecheck, all tests, secret scan, DB type check |
| `npm run test:unit` | tests that need no database |
| `npm run test:db` | RLS, schema and integration tests (needs local Supabase) |
| `npm run db:reset` / `db:seed` / `db:types` | rebuild the database, seed it, regenerate types |
| `npm run db:setup` | give pg_cron the worker URL and secret (stored in Supabase Vault) |
| `npm run worker:poll` | call the worker every 10 seconds (fallback for cron) |

## Try the missed-call flow
With the app running, `ENABLE_DEV_ENDPOINTS=true` and `WORKER_SECRET` in `.env.local`, simulate a missed call for a business (use a phone that has joined your Twilio WhatsApp test environment):

```bash
curl -X POST http://localhost:3000/api/dev/simulate-missed-call \
  -H "Authorization: Bearer $WORKER_SECRET" -H "Content-Type: application/json" \
  -d '{"businessId":"<business uuid>","from":"+44..."}'
```

The message is sent after the delay in the product config (default 2 minutes) by the cron job. Watch `automation_logs`, `conversations` and `messages` in Supabase Studio (http://127.0.0.1:54323).

## Try the AI conversation
Needs a funded OpenAI key (`OPENAI_API_KEY`, `OPENAI_MODEL`) and a Resend key (`RESEND_API_KEY`, `RESEND_FROM_EMAIL`). Until you have a Twilio account that can send free text, set `MESSAGING_ADAPTER=fake` in `.env.local` so replies are stored in the database instead of sent; `LLM_ADAPTER`, `EMAIL_ADAPTER` and `CALENDAR_ADAPTER` work the same way. Set the product's `escalation_email` to your Resend account email (the free sender can only email its owner).

```bash
# 1. start a conversation, then 2. speak as the customer
curl -X POST http://localhost:3000/api/dev/simulate-missed-call \
  -H "Authorization: Bearer $WORKER_SECRET" -H "Content-Type: application/json" \
  -d '{"businessId":"<business uuid>","from":"+44..."}'
curl -X POST http://localhost:3000/api/dev/simulate-inbound-message \
  -H "Authorization: Bearer $WORKER_SECRET" -H "Content-Type: application/json" \
  -d '{"from":"+44...","body":"What time do you open on Saturday?"}'
```

Read the conversation in the `messages` table (Supabase Studio, http://127.0.0.1:54323). Try "I want to make a complaint" or "Is this safe for my condition?" to see an escalation and the owner's email.

## Layout
```
src/app/         pages, server actions, proxy.ts (route protection)
src/lib/         env, Supabase clients, auth guards, validation
src/engine/      queue, runner, worker, webhook helper, logger
src/services/    business logic called from routes
src/products/    product registry and manifests
supabase/        migrations and local config
tests/           unit, db, integration, helpers
scripts/         seed, secret scan, type check
```

## Security basics
- RLS is on for every table and tenants only get the grants they need. Run `npm run test:db` to see the isolation tests.
- The service-role key is server-only. Never put secrets in `NEXT_PUBLIC_*` variables or commit `.env.local`.
