# Handover: AI Business Automation POC

Live: https://ai-product-poc.vercel.app (Vercel + hosted Supabase, free tiers). Repo: https://github.com/RagulArulanandam/AI_Product_POC

A multi-tenant platform where small service businesses (clinics, salons) sign up, switch on AI "products" and configure them without technical help. Product 1 (Missed Call to WhatsApp Assistant) is built; Products 2 and 3 are "coming soon" cards.

## Run it locally
Needs Node 24, Docker Desktop (running), the Supabase CLI and Git.
1. `git clone https://github.com/RagulArulanandam/AI_Product_POC.git`, `cd AI_Product_POC`, `npm install`
2. `npm run db:start` (local Supabase)
3. Copy `.env.example` to `.env.local`. Fill the three Supabase values from `supabase status -o env`, set `WORKER_SECRET` and `ENCRYPTION_KEY` (`openssl rand -base64 32`), `ENABLE_DEV_ENDPOINTS=true`. With no paid accounts, also add `MESSAGING_ADAPTER=fake`, `LLM_ADAPTER=fake`, `EMAIL_ADAPTER=fake`, `CALENDAR_ADAPTER=fake`.
4. `npm run db:reset` then `npm run db:seed` (demo businesses and users)
5. `npm run dev`, open http://localhost:3000. Keep it running: the database job calls it every minute.
6. Log in (password `Password123!`): `owner-a@poc.local` (business) or `admin@poc.local` (platform admin).
7. `npm run verify` runs lint, types, all tests and security scans. The 10 minute walkthrough is `docs/demo-script.md`; deployment is `docs/deploy.md`.

## What we built, with what, and why
| Area | Used | Why |
|---|---|---|
| App | Next.js (App Router), TypeScript, Tailwind, shadcn | One app for dashboard, admin and webhooks; typed; quick to build |
| Data and auth | Supabase Postgres, Auth, Row Level Security | Tenant isolation enforced in the database, not just in code |
| Background work | A queue table plus pg_cron calling `/api/worker` | Delays, retries and idempotency with no extra servers |
| Engine | Retries with backoff, signed and idempotent webhooks, one send gate (opt-out, 24h window, caps) | Never double-send, never message someone who said STOP |
| Integrations | Twilio (WhatsApp, voice), OpenAI, Resend, Google Calendar, each behind an adapter with a fake | Vendors can be swapped, and tests run free and offline |
| AI | Model returns validated JSON; code picks the action ("AI proposes, code decides"); escalation to a person | Predictable, safe behaviour; complaints and health questions never get an AI answer |
| Booking | Google OAuth, tokens encrypted (AES-256-GCM), free slots computed in code, one deterministic event id | The model never invents times; retries cannot double-book |
| Products | A registry of product modules (manifest, handler, config form) | A new product does not touch the platform core |
| Admin | Business list, subscription editor, product switches, logs, failed-automation retry, audit trail | Support and diagnose without database access |
| Security | RLS tests on every table, secret scan, browser-bundle check, headers, webhook size cap, rate limits, 30-day payload cleanup | Documented in `docs/security-review.md` |
| Quality | 1114 automated tests (Vitest), including cross-tenant isolation and a demo run three times | Safe to change |
| Hosting | Vercel and hosted Supabase | Free, quick to deploy |

## Status
- **Verified live:** sign-up and login, dashboard, admin panel, Google Calendar connect, Resend escalation email, WhatsApp message delivery (template), and the Twilio webhook path.
- **Not verified live (account limits, not code):**
  - **Real AI replies and booking:** need OpenAI billing credit. The logic is covered by tests.
  - **Free-text WhatsApp:** the Twilio trial sender only delivers a fixed template.
  - **A real missed call:** the trial account has no voice number.

## How to improve
1. **Go live properly:** a paid WhatsApp sender with approved templates, a voice number, and OpenAI credit. Rotate the keys that were shared during development.
2. **Business:** Stripe billing (subscription status is manual today), staff permissions, per-business WhatsApp senders, Outlook calendar, then Products 2 and 3.
3. **Reliability:** lock simultaneous bookings of the same time, a Content-Security-Policy, edge rate limiting, error alerts (e.g. Sentry), and CI that runs `npm run verify` on every push.
4. **Scale:** admin counts come from per-business queries; move them to SQL views once there are dozens of businesses.
5. **Testing:** browser end-to-end tests (Playwright), and a repeatable live-integration smoke suite.
6. **Compliance and polish:** customer data export and delete (GDPR), a custom domain and verified email domain, a monitoring dashboard.
