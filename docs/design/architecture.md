# Architecture

Status: draft for review. Depends on: spec.md, plan.md, CLAUDE.md. Feeds: entities, database, auth, security-privacy, integrations, automation-engine, frontend, testing.

## 1. Shape of the system
One platform, one Next.js app, one Supabase database. Products (Missed Call now; Priority Inbox and Daily Brief later) are modules inside the app, not separate services. The platform core provides tenancy, auth, billing status, integrations, the automation engine and the dashboards. A product plugs in through a manifest and adds handlers and screens without changing the core.

No microservices, Redis, Kafka or Kubernetes. Background work is rows in Postgres processed by a worker endpoint.

```
 Customer / Admin browser
        |
        v
 Next.js app (App Router, TypeScript)
   pages + server actions  ---------------------+
   /api/webhooks/* (Twilio)                     |
   /api/worker (secret-protected)               |
   /api/dev/* (local only)                      |
        |                                       |
        v                                       v
   services  ->  adapters  -> Twilio | OpenAI | Resend | Google Calendar
        |
        v
 Supabase Postgres (RLS) + Auth + pg_cron/pg_net  --HTTP-->  /api/worker
```

## 2. Local topology (Phases 1-8)
- Next.js dev server on `localhost:3000`.
- Supabase CLI stack in Docker (Postgres, Auth, Studio). Requires Docker Desktop with WSL2 on Windows.
- Cloudflare quick tunnel exposes the app to Twilio. The URL changes on restart, so `PUBLIC_BASE_URL` and the Twilio webhook URLs are updated by hand after a restart (README checklist). Webhook signature checks use `PUBLIC_BASE_URL`, never the request host.
- pg_cron (every minute) calls the worker through `pg_net` at `http://host.docker.internal:3000/api/worker` with the worker secret. Fallback: `npm run worker:poll`, a local loop that calls the same endpoint.
- Hosted deployment (Vercel + hosted Supabase) happens in Phase 8 only, after the Phase 6 flow works locally.

## 3. Layering rules
Route or server action -> service -> adapter.

| Layer | Allowed to | Not allowed to |
|---|---|---|
| Route / server action | Parse input, check auth, call one service, shape the response | Contain business logic, import vendor SDKs, touch tables directly |
| Service (`src/services`) | Business logic, DB access through the Supabase clients, call adapters | Import vendor SDKs, read `process.env` |
| Adapter (`src/adapters`) | Wrap one vendor behind an interface; map vendor errors to `AdapterError` | Contain business rules or read tenant data |
| Product (`src/products/<key>`) | Define manifest, handlers, config form; call services and adapters via the registry | Be imported by the platform core except through `registry.ts` |

Webhook routes follow one pattern: verify signature -> store the event idempotently -> enqueue work -> return 200 quickly. Real work happens in the worker.

## 4. Folder structure
```
src/
  app/
    (auth)/login, signup
    (app)/dashboard, onboarding, products, integrations, conversations, billing
    admin/                       # platform admin area (Phase 7)
    api/
      webhooks/voice, whatsapp
      worker/
      dev/simulate-missed-call
  adapters/
    messaging/   (interface.ts, twilio.ts, fake.ts)
    llm/         (interface.ts, openai.ts, fake.ts)
    email/       (interface.ts, resend.ts, fake.ts)
    calendar/    (interface.ts, google.ts, fake.ts)
  services/      # businesses, products, conversations, scheduling, integrations, admin
  engine/        # event runner, scheduled actions, logging helper, webhook helper
  products/
    types.ts     # ProductManifest
    registry.ts  # the single registration point
    missed-call/ (manifest.ts, config.ts, handlers/, form.tsx)
    priority-inbox/, daily-brief/    # manifest stubs, "coming soon"
  lib/
    env.ts       # the only reader of process.env
    errors.ts    # AppError, AdapterError
    crypto.ts    # token encryption (Phase 6)
    supabase/    (server.ts, browser.ts, admin.ts)
  components/ui/ # shadcn
  middleware.ts
supabase/
  config.toml, migrations/
scripts/         # seed.ts, worker-poll.ts
tests/           # unit/, db/, helpers/, e2e/
docs/
```
Folders are created when first used, not up front.

## 5. Adapters
- Each adapter has an `interface.ts`, one real implementation and a `fake.ts` used by tests and by dev mode when keys are absent.
- Services receive adapters from one factory per adapter folder (`getMessaging()`, etc.). The factory returns the fake when `NODE_ENV=test`.
- Adapter methods are narrow and domain-shaped (`sendMessage`, `classify`, `sendEmail`, `getFreeBusy`, `createEvent`), not thin copies of vendor APIs.
- Vendor errors are mapped to `AdapterError { code, retryable, cause }`. The engine uses `retryable` to decide on backoff.
- Interface details live in integrations.md.

## 6. Supabase clients
Three clients in `src/lib/supabase`:
- `server.ts`: per-request, cookie-based, runs as the signed-in user so RLS applies. Default for all pages and actions.
- `browser.ts`: anon key, used only for auth UI.
- `admin.ts`: service role. Server-only (`import "server-only"`). Allowed callers: `src/engine`, `src/app/api/webhooks`, `src/app/api/worker`, `src/app/api/dev`, `src/app/admin`, `src/lib/auth/guards.ts` (the admin check), `scripts/`. A lint rule (restricted imports) and a test enforce the allowlist.

## 7. Configuration
- `src/lib/env.ts` validates all env vars with Zod at startup and exports a typed object. Nothing else reads `process.env`.
- Only `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are public. A test greps the production build for secret names and values.
- The full variable list is in integrations.md. `.env.example` has names only; `.env.local` is gitignored.
- `ENABLE_DEV_ENDPOINTS` defaults to off; dev routes also check `NODE_ENV !== production`.

## 8. Products and the registry
- `ProductManifest`: `key`, `name`, `description`, `status` (`available` | `coming_soon`), `configSchema` (Zod), `defaultConfig`, `handledEvents`, `handlers`.
- `registry.ts` is the only place products are listed. The engine routes events by `handledEvents`. The platform never imports a product directly.
- The `products` table is seeded from the registry; a test fails if the keys differ.
- Config for a product is validated by one Zod schema shared by the form and the server action.

## 9. Automation pattern
EVENT -> CONDITION -> AI PROCESSING -> ACTION -> LOG RESULT.
- An event is a row (webhook receipt, due scheduled action).
- The runner loads the product for the business, evaluates conditions, calls the LLM adapter if needed, then executes an action through an adapter.
- Every step writes `automation_logs` (status, reason, error). Skipped events log the reason.
- The model proposes; code validates the JSON and chooses the action. Code owns conversation state.
- Queue, retries and the worker contract are in automation-engine.md.

## 10. Errors and results
- Services throw `AppError { code, message, status }` for expected failures (validation, forbidden, not found). Routes map these to responses.
- Webhook routes never throw to the provider: after signature success they return 200 even if processing is deferred; a bad signature returns 403.
- Unexpected errors in the worker mark the scheduled action `failed` (or retry), log the error without secrets, and appear in the admin failed-automations view.
- Server actions return `{ ok: true, data } | { ok: false, error }` so forms can show field errors.

## 11. Conventions
- Timestamps in UTC; business timezone applied only at display and slot computation.
- Phone numbers in E.164, normalised at the boundary.
- All tables have `id` (uuid), `created_at`, `updated_at`.
- Schema changes only via `supabase/migrations/`.
- TypeScript strict. Path alias `@/` -> `src/`.
- Tests: Vitest for unit and DB tests; Playwright added later. See testing.md.

## 12. Decisions made here
1. Webhooks acknowledge fast and defer work to the worker, so provider timeouts and retries stay harmless.
2. Admin screens use the service role behind one server-side admin guard, not admin RLS policies (see auth.md).
3. Fakes ship with every adapter, so the whole flow is testable without paid calls (the Twilio sandbox has a 98-message cap).
4. `src/engine` is platform code; product-specific logic stays in `src/products`.
5. Folders are created only when needed.

## 13. Open items for later docs
- Table list, state machine and enums: entities.md.
- RLS helpers and queue SQL: database.md.
- Roles and the `can()` permission function (staff permissions on hold, all allowed for now): auth.md.
- Encryption scheme and log redaction: security-privacy.md.
- Adapter signatures, Twilio sandbox rules and env list: integrations.md.
