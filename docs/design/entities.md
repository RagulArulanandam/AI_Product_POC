# Entities

Status: draft for review. Depends on: architecture.md, spec.md, product-missed-call.md. Feeds: database.md (SQL, RLS, indexes), auth.md, automation-engine.md, frontend.md, testing.md.

This doc decides what exists and what it means. Column types, constraints, indexes and policies are in database.md.

## 1. Conventions
- Every table has `id` (uuid), `created_at`, `updated_at` (UTC).
- Every business-owned row has `business_id`. `businesses` itself is scoped by its own `id`.
- Phone numbers are E.164. Enums are Postgres enums or checked text; values listed below.
- JSON columns (`config`, `business_hours`, `payload`, `details`, `metadata`) are validated by Zod in code.

## 2. Classification
| Table | Scope | Tenant users can | Written by |
|---|---|---|---|
| businesses | tenant (by `id`) | read own; owner updates profile | RPC `create_business`, owner, admin |
| memberships | tenant | read own business's | RPC, admin |
| business_products | tenant | read; owner updates | owner, admin |
| subscriptions | tenant | read only | admin / seed |
| integrations | tenant | read (no secrets) | owner, server |
| integration_secrets | tenant, **no tenant access** | nothing | service role only |
| phone_numbers | tenant | read only | admin / seed |
| customers | tenant | read | engine (service role) |
| conversations | tenant | read | engine |
| messages | tenant | read | engine |
| scheduled_actions | tenant | none in UI | engine |
| automation_logs | tenant | read (own business) | engine |
| webhook_events | tenant (nullable `business_id`) | none | webhook routes |
| products | platform | read | migration/seed from registry |
| platform_admins | platform | nothing | seed / SQL |
| opt_outs | platform | nothing | engine |

Tenant users never write engine-owned tables directly. Which role may do what (owner vs staff) is on hold: the schema stores `role`, and `can(role, action)` allows everything for now (auth.md).

## 3. Entities

### businesses
`name`, `phone_e164` (the business's own number, informational), `timezone` (IANA), `business_hours` (per weekday open/close or closed, in business timezone), `status` (`active` | `disabled`).
- Created by the `create_business` RPC together with an owner membership, a trial subscription and no products enabled.
- `disabled` stops all automation for the business and blocks its users from the dashboard except a "disabled" notice.

### memberships
`business_id`, `user_id` (auth.users), `role` (`owner` | `staff`). Unique `(business_id, user_id)`. Schema allows many businesses per user; the POC UI assumes one.

### platform_admins
`user_id` unique. Separate from memberships. An admin is not automatically a member of any business.

### products
`key` unique (e.g. `missed-call`), `name`, `description`, `status` (`available` | `coming_soon`). Seeded from the registry; a test compares keys.

### business_products
`business_id`, `product_id`, `enabled`, `config` (jsonb, validated by the product's Zod schema). Unique `(business_id, product_id)`.
- Enabling requires subscription status `trial` or `active` and product status `available`. An admin can override.
- A row is created on first enable or first config save, with the product's default config.

### subscriptions
One per business: `plan` (text label), `status` (`trial` | `active` | `past_due` | `cancelled`), `current_period_end` nullable, `notes`. Manual record; no Stripe.

### integrations
`business_id`, `provider` (`google_calendar` | `telephony`), `status` (`connected` | `disconnected` | `error`), `account_label` (e.g. Google account email, shown in UI), `metadata` (non-secret), `last_error`. Unique `(business_id, provider)`.
- WhatsApp is the shared platform sender, so it has no per-business integration row; the UI shows platform status.
- `telephony` is connected when the business has a `phone_numbers` row and the owner has confirmed call forwarding is set up (`metadata.forwarding_confirmed`).

### integration_secrets
`integration_id` unique, `business_id`, `ciphertext`, `key_version`. Holds Google OAuth tokens only (provider credentials for Twilio, OpenAI and Resend are platform env vars). RLS on with no policy for `authenticated`; service role only. Scheme in security-privacy.md.

### phone_numbers
`business_id`, `e164` unique across the platform, `kind` (`voice`). Maps a Twilio number to exactly one business. Assigned by an admin or seed. For the POC there is one real number, so one business gets real forwarded calls and others use the simulate endpoint.

### customers
`business_id`, `phone_e164`, `name` nullable (extracted by the AI), `last_contacted_at`. Unique `(business_id, phone_e164)`. Opt-out is not stored here (see opt_outs).

### opt_outs
Platform-level: `phone_e164` unique, `source_business_id`, `opted_out_at`. STOP is on the shared sender, so an opt-out blocks messaging from every business. Checked by phone before every outbound message.

### conversations
`business_id`, `customer_id`, `product_id`, `state` (section 4), `trigger_call_sid` (unique per business; idempotency for the voice webhook), `started_at`, `last_inbound_at`, `last_outbound_at`, `expires_at`, `turn_count`, `last_intent`, `escalation_reason` nullable, `escalated_at` nullable, `offered_slots` (jsonb, UTC instants), `booking_event_id` nullable, `booking_start`/`booking_end` nullable.
- "Escalated" in the dashboard means `escalation_reason is not null`. The `escalated` state and the reason are set together; there is no separate boolean.
- `turn_count` counts customer turns toward the turn cap.

### messages
`business_id`, `conversation_id`, `direction` (`inbound` | `outbound`), `sender` (`customer` | `ai` | `system`), `body`, `provider_sid` nullable, `status` (`received` | `queued` | `sent` | `delivered` | `failed`), `intent` nullable, `confidence` nullable, `error` nullable. Unique on `provider_sid` where not null (inbound idempotency, acceptance criterion 4).

### scheduled_actions
`business_id`, `conversation_id` nullable, `type` (`handle_event`, `send_first_message`, `send_reply`, `expire_conversation`; extensible per product), `payload`, `run_at`, `status` (`pending` | `processing` | `done` | `failed` | `cancelled`), `attempts`, `max_attempts` (3), `last_error`, `locked_at`, `dedupe_key` unique. Queue rules are in automation-engine.md.

### automation_logs
`business_id`, `conversation_id` nullable, `scheduled_action_id` nullable, `event_type`, `step` (event, condition, ai, action), `status` (`ok` | `skipped` | `error`), `reason`, `details` (redacted jsonb). Append-only. Powers the admin logs and failed-automations view.

### webhook_events
`provider`, `provider_event_id`, `business_id` nullable (set once resolved), `payload`, `status` (`received` | `processed` | `skipped` | `failed`), `received_at`, `processed_at`. Unique `(provider, provider_event_id)`. Only events with a valid signature are stored (security-privacy.md). Rows with null `business_id` are service-role only.

## 4. Conversation state machine
Code owns the state. The model only proposes `next_action`.

```
pending_send -> awaiting_reply -> in_conversation -> offering_slots -> booked
```
Side and terminal states: `enquiry_logged`, `escalated`, `opted_out`, `expired`, `failed`.

| From | To | Trigger |
|---|---|---|
| (new) | pending_send | Missed call passes conditions; `send_first_message` scheduled |
| pending_send | awaiting_reply | First message sent |
| pending_send | failed | Send failed after max attempts |
| awaiting_reply | in_conversation | Customer replied |
| in_conversation | offering_slots | Booking enabled, intent `book_appointment`, slots computed |
| offering_slots | booked | Customer confirmed a specific slot; event created |
| offering_slots | in_conversation | Slot taken or customer wants other times |
| in_conversation | enquiry_logged | `close` after an enquiry was captured |
| any open state | escalated | Complaint, wants human, low confidence, urgent wording, turn cap, calendar error, invalid model output after retry |
| any open state | opted_out | STOP wording |
| awaiting_reply, in_conversation, offering_slots | expired | 24h with no customer reply |

- Open states: `pending_send`, `awaiting_reply`, `in_conversation`, `offering_slots`. Terminal: the rest.
- After `escalated`, only one short "the team will contact you" message is sent; further inbound messages are stored but not auto-answered.
- After `opted_out`, nothing is sent.
- The 24h expiry also matches the WhatsApp customer-service window.

## 5. Rules that span entities
- **Inbound routing:** a customer reply is attached to that phone's most recent open conversation across businesses (shared sender). If none, the message is stored in `webhook_events` only and logged as skipped (`no_open_conversation`), except STOP, which always creates an `opt_outs` row. If the phone has open conversations with more than one business, route to the most recent and log a warning.
- **Dedupe window:** a new missed call is skipped if the same business and customer have a conversation started within the dedupe window (default 30 min), logged with the reason.
- **Product gating:** the engine only handles an event if the business is `active`, the product is `enabled` and subscription status allows it.
- **Business disabled:** pending scheduled actions for that business are skipped and logged, not deleted.
- **Deletion:** deleting a business cascades to its tenant rows. Per-customer deletion and retention are decided in security-privacy.md.
- **Metrics** (missed calls handled, conversations, bookings, escalations) are derived by query from `conversations` and `messages`; there is no metrics table.

## 6. Decisions made here
1. `opt_outs` is platform-level and keyed by phone, because the sender is shared.
2. Escalation is state plus reason, no boolean flag.
3. A `webhook_events` table gives idempotency before any business work happens.
4. WhatsApp has no per-business integration row in the POC.
5. `phone_numbers` is its own table so extra numbers can be added later without a schema change.

## 7. Open items
- Exact column types, enums, indexes and policies: database.md.
- `create_business` RPC and the admin guard: auth.md.
- Retention periods and per-customer deletion: security-privacy.md.
- Per-state outbound message behaviour for `send_reply`: automation-engine.md.
