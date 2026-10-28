# Frontend

Status: draft for review. Depends on: architecture.md, auth.md, entities.md, integrations.md, automation-engine.md. Feeds: testing.md.

One web app with a customer dashboard and an admin panel. Products appear inside the customer dashboard as cards and config screens.

## 1. Principles
- Server components by default; client components only for interactivity (toggles, forms, dialogs).
- Reads go through services called from server components. Mutations are server actions returning `{ ok, data | error }` (architecture.md section 10).
- No data fetching to Supabase from the browser, other than the auth UI. No secrets or service-role access in client code.
- Tailwind + shadcn/ui. Desktop-first, usable on tablet; no phone-specific polish in the POC.
- Forms validate with the same Zod schema on the client (for messages) and in the server action (for truth). Product config forms are hand-written per product and import the product's schema; there is no generic schema-to-form generator.
- Every protected page and action calls its guard (auth.md section 4).

## 2. Route map
### Public
| Route | Purpose |
|---|---|
| `/` | redirects: signed in -> `/dashboard`, else `/login` |
| `/login`, `/signup` | email + password forms |

### Customer app (`(app)` group, `requireBusiness()`)
| Route | Purpose | Phase |
|---|---|---|
| `/onboarding` | name, phone, timezone; creates the business | 1 |
| `/dashboard` | setup checklist, metrics, integration status summary | 1 (stub), 5 |
| `/products` | product cards with enable toggles | 1 (read-only list), 5 (toggles) |
| `/products/[key]` | product config form | 5 |
| `/integrations` | Google Calendar, telephony, WhatsApp status and connect/disconnect | 5, 6 |
| `/conversations` | list with filters | 5 |
| `/conversations/[id]` | message thread, intent, escalation, booking | 5 |
| `/billing` | read-only subscription status | 5 |
| `/settings` | business profile and hours editor | 5 |
| `/disabled` (rendered by the guard) | notice when the business is disabled | 1 |

### Admin (`/admin`, `requireAdmin()`, 404 for non-admins)
| Route | Purpose | Phase |
|---|---|---|
| `/admin` | all businesses with status, subscription, products, integration health, basic usage | 7 |
| `/admin/businesses/[id]` | profile, subscription editor, product toggles, integrations, logs | 7 |
| `/admin/failures` | failed automations across businesses with retry | 7 |

API routes (webhooks, worker, dev, Google OAuth) have no UI.

## 3. Layouts
- **Customer shell:** sidebar (Dashboard, Products, Conversations, Integrations, Billing, Settings), top bar with business name and a user menu (logout).
- **Admin shell:** same components, but a visible "Admin" banner and a different accent so it is never confused with a customer view.
- **Auth layout:** centred card, no sidebar.
- Common files: `loading.tsx` (skeletons), `error.tsx` (retry button), `not-found.tsx`.

## 4. Screens
### Onboarding
Business name, phone (UK default, shown as typed, stored E.164), timezone (default Europe/London). Inline Zod errors. On success -> dashboard.

### Dashboard
- **Setup checklist** driven by data: profile complete, a product enabled, Google Calendar connected (when booking is on), forwarding confirmed. Each item links to the page that fixes it.
- **Metrics (last 7 / 30 days):** missed calls handled, conversations, bookings, escalations. Computed in services by counting `conversations`; no metrics table.
- **Status strip:** integrations and shared WhatsApp status.

### Products
Cards from the registry joined to `business_products`. Product 1: enable toggle and "Configure". Products 2 and 3: "Coming soon", no toggle. Enabling can be blocked with a reason (subscription status, business inactive); the message comes from the service, not the database error.

### Product 1 config form
Fields from product-missed-call.md: delay, first-message template, outside-hours template (with a `{{business_name}}` preview), business hours editor (shared component), booking on/off (shows a link to Integrations if no calendar is connected), appointment duration, buffer, escalation email (hint: until a Resend domain is verified it must be the account owner's email), escalation triggers, business blurb. "Reset to defaults" and unsaved-change warning. Save is an owner-gated action (`can()` allows all for now).

### Integrations
- **Google Calendar:** status badge, connected account label, Connect / Reconnect / Disconnect (confirmation dialog). An `error` status shows "Reconnect needed".
- **Telephony:** assigned forwarding number, UK forwarding instructions (integrations.md section 2), "I've set up forwarding" confirmation. If no number is assigned, a "contact support" message.
- **WhatsApp:** shared sender, managed by the platform; read-only.

### Conversations
- **List:** customer number, started, state badge, last intent, escalation flag; filters by state and "escalated only"; cursor pagination (25 per page, by `started_at`).
- **Detail:** thread (customer / AI / system bubbles with times), per-message intent and confidence for AI turns, an escalation banner with the reason, booking details (slot, event link status), and current state.

### Billing
Read-only plan, status, period end, and a "contact us to change your plan" note.

### Settings
Business name, phone, timezone, hours. Status is not editable.

### Admin
- **Businesses list:** name, status, subscription status, enabled products, integration health, counts for the last 30 days; row action to disable/enable the business.
- **Business detail:** subscription status editor, product toggles (override allowed), integration status, automation logs (filter by status), recent conversations.
- **Failures:** table of failed actions (business, type, error, attempts, time) with a Retry button that confirms, calls the retry service and shows the result. Every admin change is logged (auth.md section 6).

## 5. Components (shadcn)
`button`, `input`, `label`, `select`, `switch`, `checkbox`, `textarea`, `card`, `badge`, `table`, `tabs`, `dialog`, `alert-dialog`, `dropdown-menu`, `skeleton`, `sonner` (toasts), `separator`, `alert`. Project components: `BusinessHoursEditor`, `ProductCard`, `StateBadge`, `MetricTile`, `SetupChecklist`, `MessageThread`, `EmptyState`, `ConfirmButton`.

## 6. States and behaviour
- **Loading:** skeletons via `loading.tsx`.
- **Empty:** every list has an `EmptyState` with the next step (for example "No conversations yet. Enable Missed Call and forward your calls.").
- **Errors:** action errors show inline field errors plus a toast; unexpected errors hit `error.tsx`. Messages never expose stack traces or vendor errors.
- **Time:** stored in UTC, shown in the business timezone via `Intl.DateTimeFormat` with the explicit zone. Admin views show the business's zone label.
- **Phone numbers:** shown in national UK format for owners; masked in admin tables where full numbers are not needed.
- **Accessibility:** labelled inputs, visible focus, shadcn default contrast, keyboard-operable dialogs.

## 7. Tests
- Component tests (Vitest + Testing Library): config form validation errors and defaults, hours editor, template preview substitution, product card states.
- Server-action tests with fakes: validation failure shape, permission check, product enable blocked by subscription.
- Playwright (added in Phase 5): signup -> onboarding -> dashboard; enable Product 1 and save config; guard behaviour (unauthenticated redirect, non-admin 404 on `/admin`). Phase 7 adds admin retry flow.
- Phase 1 UI is covered by guard and render tests only (testing.md).

## 8. Decisions made here
1. Hand-written product config forms sharing the product's Zod schema, instead of a generic generator.
2. Metrics are counted live from `conversations`, with no metrics table.
3. The admin shell is visibly distinct from the customer shell.
4. Blocked actions explain why, using service-level messages.
5. Desktop-first; no mobile polish in the POC.

## 9. Open items
- Staff-specific hiding of controls once permissions are decided (uses `can()`).
- Visual design beyond shadcn defaults (not needed for the POC).
