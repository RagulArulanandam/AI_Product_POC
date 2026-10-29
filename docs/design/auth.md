# Auth

Status: draft for review. Depends on: entities.md, database.md, architecture.md. Feeds: security-privacy.md, frontend.md, testing.md.

## 1. Identity model
- Authentication is Supabase Auth with email + password. A person is an `auth.users` row.
- Business users: a membership links a user to a business with a role (`owner` | `staff`). Signing up and creating a business makes the user its `owner`.
- Platform admin: a row in `platform_admins`, separate from memberships. An admin is not a member of any business and sees tenant data only through admin screens.
- The same person can be both (for example in local testing); the two checks are independent.
- POC assumes one business per user. The schema allows many; the UI resolves the user's oldest membership.

## 2. Flows

### Sign up
1. `/signup`: email + password (minimum 8 characters, no complexity rules).
2. Email confirmation is off in the POC (local Supabase default; avoids hosted email rate limits). Revisit at deploy in Phase 8.
3. The user is signed in immediately and redirected to `/onboarding`.

### Onboarding (create business)
1. `/onboarding` collects business name, phone and timezone (default `Europe/London`, chosen from `Intl.supportedValuesOf('timeZone')`). Hours default to Mon-Fri 09:00-17:00 and are edited later (Phase 5).
2. The server action normalises the phone to E.164 (libphonenumber-js, default region GB), then calls `create_business` as the signed-in user (database.md section 10). The RPC atomically creates the business, owner membership and trial subscription.
3. On success redirect to `/dashboard`. A user who already owns a business gets a clear error.

### Log in / out
- `/login`: email + password; supports `?next=` (same-origin paths only).
- Logout is a server action that calls `signOut()` and redirects to `/login`.
- Password reset and account deletion are not in the POC.

### Admin
- No admin sign-up. Admins are created by the seed script or a documented SQL insert into `platform_admins`.
- An admin logs in on the same `/login` page. An admin has no business, so `requireBusiness()` sends them to `/admin` instead of onboarding.

## 3. Sessions
- `@supabase/ssr` with cookie sessions (httpOnly, SameSite=Lax, Secure in production). Tokens are never put in localStorage or read by client code.
- Access token lifetime is the Supabase default (1 hour) with automatic refresh in middleware.
- Server code always uses `supabase.auth.getUser()` (validates with Supabase), never `getSession()`, to decide who the caller is.

## 4. Route protection
Two layers: middleware checks authentication; server guards check authorisation.

| Path | Public? | Check |
|---|---|---|
| `/`, `/login`, `/signup` | yes | signed-in users are redirected to `/dashboard` |
| `/onboarding` | no | authenticated and **no** membership (else redirect to `/dashboard`) |
| `/dashboard`, `/products`, `/integrations`, `/conversations`, `/billing` | no | authenticated, `requireBusiness()` |
| `/admin/**` | no | authenticated and `requireAdmin()`; non-admins get a 404, not a 403 |
| `/api/webhooks/*` | yes | provider signature, not cookies (integrations.md) |
| `/api/worker` | yes | `Authorization: Bearer <WORKER_SECRET>`, compared with `timingSafeEqual` |
| `/api/dev/*` | yes | only when `ENABLE_DEV_ENDPOINTS=true` and `NODE_ENV !== production`; also requires the worker secret header |

- `middleware.ts` refreshes the session and redirects unauthenticated requests for protected paths to `/login?next=...`. It does no database role checks.
- Guards live in `src/lib/auth/guards.ts`:
  - `requireUser()`: returns the user or redirects to `/login`.
  - `requireBusiness()`: returns `{ user, business, role }` for the user's membership, redirects to `/onboarding` if none, and renders the "business disabled" page if `business.status = 'disabled'`.
  - `requireAdmin()`: checks `platform_admins` with the service-role client; calls `notFound()` if absent.
- Every page, layout and server action under a protected area calls a guard itself; it never relies on middleware alone.

## 5. Roles and permissions (staff rules on hold)
- `src/lib/auth/permissions.ts` exports `type Action` and `can(role, action): boolean`.
- Actions: `business.update`, `product.toggle`, `product.configure`, `integration.manage`, `conversation.view`, `metrics.view`, `billing.view`.
- Decision pending: what `staff` may do. Until decided, `can()` returns `true` for every member role and every action. The test suite includes a case per action so that tightening it later is a one-file change.
- Server actions follow one pattern: `requireBusiness()` -> `can(role, action)` -> Zod parse -> service call -> `{ ok, data | error }`.
- Defence in depth: the database applies `can_write(business_id)` in RLS (database.md). When staff rules are decided, `can()` and `can_write()` change together.

## 6. Admin model
- Admin queries use the service-role client inside `src/services/admin.ts`, imported only from `src/app/admin`. Every function takes an explicit `businessId` (or lists all businesses); there is no "current business" for admins.
- Admin actions that change state (disable a business, toggle a product, change subscription status, retry an automation) write an `automation_logs` row with `event_type = 'admin_action'` and the admin's user id in `details`.
- Disabling a business: sets `businesses.status = 'disabled'`. Its users see the disabled notice; the engine skips its events (entities.md section 5).
- Admins can enable a product regardless of subscription status (service role bypasses `can_enable_product`).

## 7. Engine and webhook identity
- Webhooks and the worker act as the system, not as a user. They use the service-role client, and every query is scoped by the `business_id` resolved from the event.
- User identity is never inferred from webhook payloads.
- The service-role key is only imported from the allowlisted folders (architecture.md section 6).

## 8. Hardening notes
- Server actions rely on Next.js same-origin checks; no state-changing GET routes.
- `?next=` redirects are validated against a same-origin path allowlist to prevent open redirects.
- Login and signup rate limiting is Phase 8 (security-privacy.md).
- Error messages on login do not reveal whether an email exists.

## 9. Tests
- Unit: `can()` returns true for all roles and actions (placeholder), `next` validation rejects external URLs, worker secret check rejects missing and wrong tokens, dev endpoints return 404 when the flag is off or `NODE_ENV=production`.
- Middleware: unauthenticated request to a protected path redirects to `/login?next=`; authenticated users hitting `/login` go to `/dashboard`.
- Guards (with the local Supabase): user with no membership -> `/onboarding`; owner of a business reaches its pages; disabled business renders the notice; non-admin gets `notFound()` on admin; admin passes.
- DB integration: signup -> `create_business` creates business, owner membership and trial subscription; second business for the same user is rejected; invalid phone or timezone is rejected.
- Isolation: a `staff` member of A cannot read B (reuses the tenant test harness).
- Audit: an admin product toggle writes an `admin_action` log row.

## 10. Decisions made here
1. Email + password only; confirmation off for the POC.
2. Middleware authenticates; server guards authorise on every protected page and action.
3. Non-admins get a 404 on `/admin` so its existence is not revealed.
4. `can()` and `can_write()` allow all members until staff rules are decided, and change together.
5. Admin state changes are logged to `automation_logs`.
6. The worker and dev endpoints are protected by a shared secret and, for dev, by environment flags.

## 11. Open items
- Staff permission rules (user decision, on hold).
- Email confirmation, password reset and account deletion before any real users: revisit in Phase 8.
- Secret handling, rate limits and redaction: security-privacy.md.
- Layouts and the disabled-business page: frontend.md.
