# Automation engine

Status: draft for review. Depends on: architecture.md, entities.md, database.md, integrations.md, security-privacy.md, product-missed-call.md. Feeds: frontend.md (failed-automations view), testing.md.

Pattern: EVENT -> CONDITION -> AI PROCESSING -> ACTION -> LOG RESULT. The engine is platform code in `src/engine`; product logic stays in `src/products/<key>`.

## 1. Moving parts
| Part | Where | Job |
|---|---|---|
| Webhook helper | `src/engine/webhooks.ts` | Verify signature, store `webhook_events` idempotently, enqueue a `handle_event` action, return 200 |
| Queue | `scheduled_actions` + `claim_due_actions` | Durable, delayed, retryable work |
| Worker | `POST /api/worker` | Claims due actions and runs them |
| Runner | `src/engine/runner.ts` | Routes an action or event to the right product handler |
| Product handler | `src/products/<key>/handlers/` | Conditions, AI call, action decisions for that product |
| Messaging choke point | `src/engine/send.ts` (`sendToCustomer`) | Opt-out, caps, window check, then adapter send |
| Logger | `src/engine/log.ts` | Writes redacted `automation_logs` rows |

## 2. Event flow
1. A webhook arrives (voice, WhatsApp inbound, status). The helper verifies the signature (403 if invalid, nothing stored), inserts `webhook_events` (unique provider event id; duplicate -> 200 and stop), resolves `business_id` where possible, enqueues one `handle_event` action with `dedupe_key = 'evt:' + webhook_event_id`, and returns 200.
2. The route then triggers the worker routine in the background with Next's `after()`, so inbound replies are not delayed by cron. The one-minute cron tick is the safety net and the clock for delayed actions.
3. The worker claims an action and the runner dispatches it:
   - `handle_event`: loads the event, maps the event type (`call.missed`, `message.inbound`, `message.status`) to the product that declares it in `handledEvents`, then calls the handler.
   - Product action types (`send_first_message`, `send_reply`, `expire_conversation`): call the product's handler directly.
4. The handler runs conditions, may call the LLM adapter, performs actions through services and adapters, and logs each step.
5. The runner marks the action `done`, or applies the retry rules (section 5).

## 3. Handler contract
```ts
interface ProductHandler {
  handle(ctx: {
    business: Business;
    config: unknown;            // already validated by the product's Zod schema
    action: ScheduledAction;
    event?: WebhookEvent;
    services: Services;         // injected, so tests can pass fakes
    log: StepLogger;
    now: Date;                  // injected clock
  }): Promise<'done' | { retryAt: Date } | { fail: string }>;
}
```
- The product manifest maps event types and action types to handlers. The platform never imports a product directly (architecture.md section 8).
- Handlers get `now` injected; they never call `Date.now()` directly, so delays, hours and expiry are testable.

## 4. Conditions and skips
Conditions run in order; the first failure ends the event with a skip logged (`status = 'skipped'`, reason below).

| Reason | Meaning |
|---|---|
| `business_inactive` | business is disabled |
| `product_disabled` | product not enabled for the business |
| `subscription_blocked` | subscription status does not allow the product |
| `unknown_number` | `To` not in `phone_numbers` |
| `no_caller_id` | `From` withheld or invalid |
| `duplicate_in_window` | conversation for this customer started within the dedupe window (default 30 min) |
| `opted_out` | phone is in `opt_outs` |
| `cap_reached` | send caps hit (security-privacy.md section 8) |
| `no_open_conversation` | inbound message with nothing to attach to |

Outside business hours is not a skip: it selects the outside-hours template, or skips with `outside_hours_disabled` when `send_outside_hours` is false.

## 5. Queue, retries and failure
- Claiming uses `claim_due_actions` (database.md section 8). The worker claims one action at a time and loops until none are due or its time budget (50 seconds) is spent. A conversation never has two actions processing at once.
- Delivery is at-least-once, so every action is idempotent:
  - Creating work uses `dedupe_key` (for example `first:<conversationId>`, `expire:<conversationId>`, `evt:<eventId>`).
  - Outbound messages are written as a `messages` row (`queued`) first. The send action reads that row: if `provider_sid` is already set, it skips the send. After the provider call, the row gets `provider_sid` and `sent`.
  - Calendar events use a deterministic event id (integrations.md section 6).
- Failure handling:
  - `AdapterError` with `retryable = false` -> fail immediately.
  - Retryable error or thrown unexpected error -> `pending` again with `run_at = now + backoff`: 1, 5 and 15 minutes for attempts 1 to 3 (`nextRunAt(attempt, now)` is a pure function).
  - After `max_attempts` (3) -> `failed`, `last_error` set (redacted), logged with `status = 'error'`.
  - A failed `send_first_message` sets the conversation to `failed`. A failed reply leaves the conversation open and logs the failure.
- Crashed worker: rows stuck in `processing` for more than 5 minutes are reclaimed by the claim query.
- Admin retry (Phase 7): sets a `failed` action back to `pending` with `attempts = 0`, `run_at = now`, and logs an `admin_action`.

## 6. Messaging choke point
`sendToCustomer({ businessId, conversationId, to, body })` is the only code path that sends customer messages. It checks, in order: business active, `opt_outs`, send caps, the 24-hour window for non-first messages (using `last_inbound_at`), then writes the `messages` row and calls `MessagingAdapter.sendMessage`. It returns a typed result (`sent`, or `blocked` with a reason that the handler logs). Lint blocks other imports of the send method.

## 7. Product 1 specifics (engine view)
- **`call.missed`**: conditions -> upsert customer -> create conversation `pending_send` (unique on `trigger_call_sid`) -> schedule `send_first_message` at `now + delay_minutes` with `dedupe_key = 'first:' + conversationId`.
- **`send_first_message`**: re-check opt-out, business status and hours (they may have changed during the delay), pick template, send via the choke point, move to `awaiting_reply`, schedule `expire_conversation` for `+24h`.
- **`message.inbound`**: attach to the customer's open conversation (entities.md section 5). STOP detection runs first (no model call). Otherwise the handler builds the model input, calls the LLM, validates, applies guardrails and the turn cap, picks the action, sends the reply, and updates state and `last_intent`.
- **`message.status`**: updates `messages.status` for the matching `provider_sid`. A `failed` status on a first message sets the conversation to `failed` and logs the provider error code.
- **`expire_conversation`**: if `now - max(last_inbound_at, started_at) >= 24h` and the conversation is still open, set `expired`; otherwise reschedule for that moment plus 24h.
- AI contract, guardrails and booking steps stay in product-missed-call.md; the engine only provides the loop, retries and logging.

## 8. Logging
- `log.step({ businessId, conversationId?, actionId?, eventType, step, status, reason?, details? })` writes `automation_logs`. `step` is `event`, `condition`, `ai`, `action` or `system`; `status` is `ok`, `skipped` or `error`.
- Every handler writes at least one row per action, so any event can be traced.
- `details` goes through `redact()`; no message bodies or tokens (security-privacy.md section 6).
- The logger never throws: a failed log write goes to the console and does not fail the action.
- Admin views read this table: logs per business, and failed automations (`status = 'error'` joined to failed actions).

## 9. Worker endpoint
- `POST /api/worker`, `Authorization: Bearer <WORKER_SECRET>`, constant-time compare, 401 otherwise.
- Response: JSON counts (`claimed`, `done`, `retried`, `failed`, `skipped`). Route `maxDuration` is 60 seconds.
- Callers: pg_cron through `pg_net` every minute, the `after()` trigger from webhook routes, `npm run worker:poll` locally, and later Vercel.
- Concurrent workers are safe because of `SKIP LOCKED` and the per-conversation exclusion.

## 10. Simulate missed call
`POST /api/dev/simulate-missed-call` takes `{ businessId, from }`, builds the same normalised event a voice webhook would, and passes it through the same helper and queue. It bypasses only the signature check. It is available only when `ENABLE_DEV_ENDPOINTS=true`, `NODE_ENV !== production`, and the worker-secret header is present.

## 11. Tests
- Queue: concurrent claims never overlap; stale `processing` rows are reclaimed; a conversation never has two actions processing; `dedupe_key` blocks duplicates.
- Retry: `nextRunAt` gives 1, 5, 15 minutes; non-retryable error fails at once; the third failure ends in `failed` with a log row.
- Idempotent send: a retry after a successful provider call does not send twice.
- Webhook helper: invalid signature stores nothing; duplicate event creates one row and one action; unresolved business is logged.
- Conditions: each skip reason produces the right log row and no conversation.
- Expiry: reschedules after a recent reply, expires after 24 hours of silence.
- Disabled business: pending actions are skipped and logged, not deleted.
- Admin retry: a failed action runs again after retry and an `admin_action` row is written.
- Worker endpoint: wrong or missing secret is rejected.
- Product 1 scenarios 1, 2, 3, 8, 9 and 10 (product-missed-call.md) run end to end against the fake adapters and the local database.

## 12. Decisions made here
1. All work flows through `scheduled_actions`; webhooks only store and enqueue.
2. Inbound replies are processed immediately with `after()`; cron covers delays and retries.
3. At-least-once delivery with idempotent actions instead of exactly-once.
4. One action is claimed at a time and a conversation is never processed concurrently.
5. A single messaging choke point enforces opt-out, caps and the window.
6. Handlers receive injected services and clock for testability.

## 13. Open items
- Whether `after()` behaves identically on Vercel at deploy time (check in Phase 8; cron still covers it).
- Admin retry UI: frontend.md.
