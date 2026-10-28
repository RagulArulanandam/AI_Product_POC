# CLAUDE.md

## Project
Multi-tenant AI business automation platform (POC). Small service businesses (dental, derm, beauty clinics) sign up, connect tools, enable AI "products" and configure them without technical knowledge. POC targets ~5 businesses. Product 1 (Missed Call -> WhatsApp Assistant) is built first. Products 2 (Priority Inbox) and 3 (Daily Brief) are "coming soon" cards only.

POC principle: build the smallest reliable version that proves the business model. No over-engineering.

## Stack
- Next.js (App Router) + TypeScript, Tailwind CSS + shadcn/ui
- Supabase: Postgres, Auth, RLS, pg_cron (run locally with the Supabase CLI; hosted later)
- OpenAI API (model name from env `OPENAI_MODEL`, never hard-coded)
- Resend for outgoing email
- Twilio for WhatsApp and voice, behind an adapter (see docs/design/integrations.md)
- Google Calendar API for availability and booking
- Hosting: build and verify locally first (tunnel such as cloudflared/ngrok for webhooks); deploy to Vercel only after the local end-to-end flow works
- Stripe is NOT in the POC. Subscription status is a manual table.

## Commands
Docker Desktop must be running for anything that touches the database.
- `npm run dev` start the app on http://localhost:3000
- `npm run db:start` start local Supabase (`supabase stop` to stop it)
- `npm run db:reset` re-apply all migrations from scratch, then `npm run db:seed` for demo data
- `npm run db:types` regenerate `src/lib/database.types.ts` after any migration (commit it)
- `npm run lint`, `npm run typecheck`
- `npm test` runs everything; `npm run test:unit` needs no database, `npm run test:db` needs local Supabase
- `npm run check:secrets` repo scan for keys, `npm run check:types` fails if the DB types are stale
- `npm run verify` lint + typecheck + tests + both checks: run before every commit
- Local secrets live in `.env.local` (gitignored). Names are listed in `.env.example`.
- Next.js 16 renamed `middleware.ts` to `proxy.ts`. Docs for this version are in `node_modules/next/dist/docs/`.
- Local seed accounts (password `Password123!`): admin@poc.local, owner-a/b/c@poc.local, staff-a@poc.local

## Architecture rules
- One Next.js app, one Supabase database. No microservices, Redis, Kafka, Kubernetes.
- Layering: route/server action -> service -> adapter. Routes stay thin.
- Every external service (messaging, LLM, email, calendar) sits behind an interface in `src/adapters/`. Services never import a vendor SDK directly.
- Products live in `src/products/<key>/` with a manifest (key, name, description, config Zod schema, handled events), a handler and a config form. Registered in one place. Adding a product must not require changing the platform core.
- Automation pattern: EVENT -> CONDITION -> AI PROCESSING -> ACTION -> LOG RESULT.
- The AI proposes, code decides. The model returns structured JSON; our code validates it and chooses the action.
- Config for each product is validated by one Zod schema shared by the form and the server.

## Security rules (non-negotiable)
- RLS enabled on every tenant table from the first migration. Every business-owned row has `business_id`.
- Service-role key is server-side only (webhooks, cron worker, admin). Never in client code or `NEXT_PUBLIC_*`.
- Every webhook verifies the provider signature/secret and is idempotent (unique provider SID).
- OAuth tokens and provider credentials are encrypted at rest, never logged, never sent to the frontend.
- Never delete or modify customer emails or irreversible external data.
- Respect opt-out (STOP): never message an opted-out customer.
- No secrets in the repo. `.env.example` lists variable names only.

## Data conventions
- Store timestamps in UTC; display in the business timezone.
- Phone numbers in E.164.
- All tables: `id` (uuid), `created_at`, `updated_at`.
- Schema changes only via files in `supabase/migrations/`.

## Working rules
- Use plan mode for each slice. Work one slice at a time.
- Do not build anything outside the current phase in docs/plan.md.
- After every change run lint, typecheck and tests; fix failures.
- Add tests with the code. Every new tenant table needs a cross-tenant isolation test.
- Commit after each working slice. Update docs/plan.md checkboxes at the end of a slice.
- If a requirement is unclear, ask instead of guessing.

## Read before working on...
- Scope and acceptance criteria: docs/spec.md
- What to do next: docs/plan.md
- Folder structure and adapters: docs/design/architecture.md
- Tables and RLS: docs/design/entities.md, docs/design/database.md
- Login, roles, permissions: docs/design/auth.md
- Screens and routes: docs/design/frontend.md
- Queue, retries, logging: docs/design/automation-engine.md
- Product 1 behaviour and AI contract: docs/design/product-missed-call.md
- Providers and env vars: docs/design/integrations.md
- Secrets, GDPR, opt-out: docs/design/security-privacy.md
