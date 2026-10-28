# AI Business Automation (POC)

A multi-tenant platform where small service businesses sign up, connect tools, enable AI "products" and configure them without technical help. Product 1 (Missed Call to WhatsApp Assistant) is built first; Products 2 and 3 are "coming soon" cards.

Scope and decisions: [docs/spec.md](docs/spec.md). Build order: [docs/plan.md](docs/plan.md). Design docs: [docs/design/](docs/design/) and [docs/testing.md](docs/testing.md).

## Status
Phase 1 (platform core) is done: sign up, onboarding, route protection, tenant isolation with RLS, product registry and seed data.
Phase 2 (automation engine) is done: queue, runner with retries, worker endpoint, pg_cron and an idempotent webhook helper. It has no customer-facing behaviour yet; it is exercised by tests.
Phases 3 to 8 (Product 1, dashboard, calendar, admin, hardening) are not built yet.

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
