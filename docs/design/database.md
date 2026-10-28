# Database

Status: draft for review. Depends on: entities.md, architecture.md. Feeds: auth.md, security-privacy.md, automation-engine.md, testing.md.

This doc turns entities.md into schema rules. It describes decisions, not full SQL; the SQL lives in `supabase/migrations/`.

## 1. Principles
- Schema changes only through files in `supabase/migrations/`, created with `supabase migration new`. Never edit a migration that has been committed; add a new one.
- RLS is enabled on every table in the same migration that creates it.
- Default-deny: the `anon` role gets no table access; `authenticated` gets only the grants listed in section 6.
- Enums are `text` with `CHECK` constraints (cheaper to change than Postgres enum types).
- Timestamps are `timestamptz` (UTC). Primary keys are `uuid default gen_random_uuid()`.
- Phone columns have `CHECK (col ~ '^\+[1-9][0-9]{6,14}$')`. Timezone validity is checked in the app (IANA list) and in the `create_business` RPC.
- Foreign keys: `business_id` and `customer_id` use `ON DELETE CASCADE`; `conversation_id` on `scheduled_actions` and `automation_logs` also cascades, so deleting a customer leaves nothing behind (security-privacy.md); `product_id` uses `RESTRICT`; `user_id` references `auth.users` with `CASCADE`.

## 2. Migration order
| # | Name | Phase | Contents |
|---|---|---|---|
| 1 | `extensions_and_helpers` | 1 | `pg_cron`, `pg_net`; `set_updated_at()` trigger function |
| 2 | `tenancy_core` | 1 | `businesses`, `memberships`, `platform_admins`; helpers `is_member`, `can_write`; RLS + grants |
| 3 | `products_billing_integrations` | 1 | `products` (+ idempotent seed rows), `business_products`, `subscriptions`, `integrations`, `integration_secrets`; helper `can_enable_product`; RLS + grants |
| 4 | `create_business_rpc` | 1 | `create_business()` |
| 5 | `engine_tables` | 2 | `customers`, `conversations`, `messages`, `scheduled_actions`, `automation_logs`, `webhook_events`, `opt_outs`; `claim_due_actions()`; RLS |
| 6 | `worker_cron` | 2 | pg_cron job that calls the worker |
| 7 | `phone_numbers` | 3 | `phone_numbers`; RLS |

Each migration also adds `updated_at` triggers for its tables.

## 3. Helper functions
All are `SECURITY DEFINER`, `STABLE`, with `SET search_path = public`, and `EXECUTE` granted to `authenticated` only. They are `SECURITY DEFINER` so policy checks on `memberships` do not recurse into RLS.

- `is_member(b uuid) -> boolean`: `auth.uid()` has a membership in business `b`.
- `can_write(b uuid) -> boolean`: for now returns `is_member(b)`. This is the single DB-side place to restrict writes by role once staff permissions are decided (mirrors `can()` in app code; see auth.md).
- `can_enable_product(b uuid, p uuid) -> boolean`: business is `active`, subscription status is `trial` or `active`, and product status is `available`.

There is no `is_platform_admin()` policy helper: admin screens use the service role behind a server-side guard (architecture.md section 12).

## 4. Tables: constraints and indexes
Only what is not obvious from entities.md.

| Table | Constraints | Indexes |
|---|---|---|
| businesses | `status in ('active','disabled')`; phone check | `(status)` |
| memberships | `role in ('owner','staff')`; unique `(business_id, user_id)` | `(user_id)` |
| platform_admins | unique `(user_id)` | none |
| products | unique `(key)`; `status in ('available','coming_soon')` | none |
| business_products | unique `(business_id, product_id)`; `config jsonb not null` | none |
| subscriptions | unique `(business_id)`; status check | none |
| integrations | unique `(business_id, provider)`; provider and status checks | none |
| integration_secrets | unique `(integration_id)` | none |
| phone_numbers | unique `(e164)`; phone check | `(business_id)` |
| customers | unique `(business_id, phone_e164)` | `(phone_e164)` for inbound routing |
| conversations | state check; unique `(business_id, trigger_call_sid)` where not null | `(business_id, started_at desc)`; `(customer_id, started_at desc)` for the dedupe window; partial `(customer_id)` where state in open states for inbound routing; `(business_id, state)` |
| messages | direction, sender, status checks; unique `(provider_sid)` where not null | `(conversation_id, created_at)`; `(business_id, created_at desc)` |
| scheduled_actions | status check; unique `(dedupe_key)`; `attempts <= max_attempts` | partial `(run_at)` where status = 'pending'; `(business_id, status)` |
| automation_logs | status check | `(business_id, created_at desc)`; `(scheduled_action_id)`; partial `(created_at desc)` where status = 'error' (failed-automations view) |
| webhook_events | unique `(provider, provider_event_id)`; status check | partial `(received_at)` where status = 'failed' |
| opt_outs | unique `(phone_e164)` | none |

Every table with `business_id` has an index leading with `business_id` (enforced by a test).

`business_hours` JSON shape: `{"mon": {"open": "09:00", "close": "17:00"}, "tue": ..., "sun": null}` with `null` meaning closed. Validated by Zod; `create_business` writes Mon-Fri 09:00-17:00 by default.

## 5. RLS policies
`authenticated` role. "none" means no policy exists, so access is denied.

| Table | select | insert | update | delete |
|---|---|---|---|---|
| businesses | `is_member(id)` | none (RPC) | `can_write(id)` | none |
| memberships | `is_member(business_id)` | none | none | none |
| platform_admins | none | none | none | none |
| products | `true` | none | none | none |
| business_products | `is_member(business_id)` | `can_write(business_id)` and (`not enabled` or `can_enable_product(...)`) | same as insert, both `using` and `with check` | none |
| subscriptions | `is_member(business_id)` | none | none | none |
| integrations | `is_member(business_id)` | none | none | none |
| integration_secrets | none | none | none | none |
| phone_numbers | `is_member(business_id)` | none | none | none |
| customers, conversations, messages | `is_member(business_id)` | none | none | none |
| automation_logs | `is_member(business_id)` | none | none | none |
| scheduled_actions, webhook_events, opt_outs | none | none | none | none |

Notes:
- Integration connect/disconnect, escalation, bookings and all engine writes use the service role in server code after an app-level check. Tenants cannot write those tables even through the API.
- `businesses` update is limited by column grants (section 6): tenants can change profile fields but never `status`.
- Admin overrides (enabling a product past the subscription check) go through the service role, which bypasses RLS.
- The service role is the only writer for engine tables; it never runs in client code.
- Tenants cannot `upsert` into `business_products`: PostgREST upserts need UPDATE rights on the key columns (`business_id`, `product_id`), which are deliberately withheld. Services select first, then insert or update.

## 6. Grants
- `revoke all on all tables in schema public from anon, authenticated;` then `alter default privileges ... revoke all` for future tables, so new tables are private until granted explicitly.
- `authenticated` receives: `select` on the tables marked in section 5; `insert, update` on `business_products`; `update (name, phone_e164, timezone, business_hours)` on `businesses`.
- `anon` receives nothing.
- `service_role` is unrestricted (Supabase default).
- `claim_due_actions`, and engine functions, are `EXECUTE` for `service_role` only.

## 7. `updated_at`
A single `set_updated_at()` trigger function sets `new.updated_at = now()` before update. Each table gets its own trigger in its creating migration. `automation_logs` and `webhook_events` have the column for convention but are effectively append-only.

## 8. Queue: claiming due work
`claim_due_actions(batch int) -> setof scheduled_actions`, `SECURITY INVOKER`, service role only:

```sql
update scheduled_actions
   set status = 'processing', locked_at = now(), attempts = attempts + 1
 where id in (
   select a.id from scheduled_actions a
    where a.run_at <= now()
      and (a.status = 'pending'
           or (a.status = 'processing' and a.locked_at < now() - interval '5 minutes'))
      and not exists (
        select 1 from scheduled_actions p
         where p.conversation_id = a.conversation_id
           and p.status = 'processing'
           and p.locked_at >= now() - interval '5 minutes'
           and p.id <> a.id)
    order by run_at
    limit batch
    for update skip locked)
returning *;
```
- `FOR UPDATE SKIP LOCKED` means two overlapping ticks never take the same row.
- The `not exists` clause stops a conversation having two actions processing at once. The worker calls with `batch = 1` in a loop, so the clause holds across concurrent workers.
- The stale-lock clause recovers rows left `processing` by a crashed worker (it consumes an attempt).
- Success, retry with backoff (1, 5, 15 minutes) and final failure are written by the engine (automation-engine.md): success sets `done`; a retryable failure sets `pending` with a later `run_at`; reaching `max_attempts` sets `failed`.
- `dedupe_key` is unique, so enqueuing the same logical action twice is a no-op (`ON CONFLICT DO NOTHING`).

## 9. Cron (migration 6 and local setup)
- `cron.schedule('worker-tick', '* * * * *', ...)` calls `net.http_post` to the worker URL with an `Authorization: Bearer <worker secret>` header.
- The URL and secret are not in the migration. `call_worker()` reads them from Supabase Vault (`worker_url`, `worker_secret`) and does nothing if they are missing. (Custom database settings were tried first, but the local `postgres` role is not allowed to set them.)
- Local: `scripts/configure-cron.ts` (run by `npm run db:setup`, and chained after `npm run db:reset`) writes both Vault secrets from `.env.local`; the URL is `http://host.docker.internal:3000/api/worker`. Re-run after a plain `supabase db reset`, which wipes the vault.
- Hosted (Phase 8): create the same two Vault secrets by hand with the deployed URL.
- One-minute cron granularity is acceptable for a 2-minute default delay.
- Fallback: `npm run worker:poll` calls the same endpoint in a loop.

## 10. `create_business` RPC
`create_business(p_name text, p_phone text, p_timezone text) returns uuid`, `SECURITY DEFINER`, `EXECUTE` to `authenticated`.
In one transaction it inserts the business (`active`, default hours), an `owner` membership for `auth.uid()`, and a `trial` subscription. It rejects unauthenticated calls, invalid phone or timezone, and users who already own a business (POC: one per user). Auth-side behaviour is in auth.md.

## 11. Seed and type generation
- `supabase/migrations` inserts the `products` rows idempotently (`on conflict (key) do update`), so they exist in every environment.
- `scripts/seed.ts` (run after `supabase db reset` via `npm run db:seed`) creates three businesses with an owner each through the auth admin API, plus one platform admin. It refuses to run unless `NEXT_PUBLIC_SUPABASE_URL` is a local address. Test passwords are fixed constants in the script, valid only for local data.
- `supabase gen types typescript --local` writes `src/lib/database.types.ts`, which is committed. CI fails if it is stale.

## 12. Tests required by this doc
In `tests/db/`, against local Supabase with two tenants (A, B):
1. For every tenant table, a user of A cannot select, insert, update or delete a row of B (acceptance criterion 1).
2. `anon` reads nothing anywhere.
3. `authenticated` cannot read `integration_secrets`, `scheduled_actions`, `webhook_events`, `opt_outs` or `platform_admins`.
4. A tenant cannot update `businesses.status`.
5. Every table in `public` has RLS enabled (queries `pg_class.relrowsecurity`), and every table with `business_id` has an index leading with it.
6. `can_enable_product` blocks enabling when the subscription is `cancelled` or the product is `coming_soon`.
7. `create_business` creates all three rows atomically and rejects a second business for the same user.
8. `claim_due_actions` run twice in parallel returns disjoint rows; stale `processing` rows are reclaimed.
9. Unique constraints hold: duplicate `provider_sid`, `trigger_call_sid`, `dedupe_key`, `(provider, provider_event_id)`.

## 13. Decisions made here
1. `text` + `CHECK` instead of Postgres enums.
2. Default-deny grants; tenants cannot write engine tables at all.
3. Column-level grant keeps `businesses.status` admin-only.
4. Subscription and product gating for enabling a product is enforced in RLS, not just in the service.
5. `can_write` is the one DB place to change when staff permissions are decided.
6. Cron secrets live in Supabase Vault (local and hosted), never in migrations.

## 14. Open items
- Redaction and retention for `webhook_events.payload` and `automation_logs.details`: security-privacy.md.
- Worker request/response contract and backoff handling in code: automation-engine.md.
- Session handling and admin guard: auth.md.
