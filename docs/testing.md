# Testing

Status: draft for review. Depends on all docs in docs/design/. Rule from CLAUDE.md: tests are written with the code, every new tenant table gets an isolation test, and lint, typecheck and tests run after every change.

## 1. Approach
Most confidence comes from fast tests against a real local Postgres with fake adapters. Real vendors are used only in a few manual smoke tests, because the Twilio trial has a message cap and vendor calls are slow and flaky.

| Layer | Tool | What it covers | Needs DB? |
|---|---|---|---|
| Unit | Vitest | pure logic: Zod schemas, slot computation, `nextRunAt`, redaction, crypto, `can()`, template rendering | no |
| Component | Vitest + Testing Library | forms, hours editor, cards | no |
| DB | Vitest | RLS, grants, constraints, RPCs, `claim_due_actions` | yes (local Supabase) |
| Integration | Vitest | services and engine against the real DB with fake adapters; route handlers called directly | yes |
| End to end | Playwright | a few browser flows (from Phase 5) | yes |
| Manual smoke | scripts | one real request per vendor; demo script | n/a |

## 2. Layout and commands
```
tests/
  unit/            # no DB
  db/              # RLS and schema tests
  integration/     # services + engine + routes, fake adapters
  e2e/             # Playwright (Phase 5+)
  fixtures/twilio/ # webhook payload fixtures
  helpers/         # tenant harness, db client, clock, fixtures
scripts/smoke-*.ts # manual, not in CI
```
| Command | Runs |
|---|---|
| `npm run test:unit` | unit + component, no DB |
| `npm run test:db` | DB + integration (needs `supabase start`) |
| `npm test` | both |
| `npm run test:e2e` | Playwright |
| `npm run check:secrets` | repo scan for key patterns and tracked `.env.local` |
| `npm run check:bundle` | build, then scan client output for secrets (Phase 8) |
| `npm run verify` | lint + typecheck + `npm test` + `check:secrets`: run before every commit |

DB and integration tests run serially (`fileParallelism: false` for that project) because they share one local database. Each file creates uniquely named tenants and cleans up after itself.

## 3. Tenant harness
`tests/helpers/tenants.ts` creates tenants A and B, each with an owner user, plus a staff user in A, and returns Supabase clients signed in as each (plus the service-role client for setup).
- `TENANT_TABLES` lists every table with a `business_id`. A meta-test compares it to `information_schema`, so a new tenant table without an isolation test fails the build.
- The generic isolation test loops over `TENANT_TABLES`: A cannot select, insert, update or delete B's rows. It also asserts `anon` sees nothing.
- Platform-only tables (`platform_admins`, `opt_outs`, `webhook_events`, `scheduled_actions`, `integration_secrets`) get a "no tenant access" test.

## 4. Fakes and fixtures
- `src/adapters/*/fake.ts` is used by integration tests: `FakeMessaging` records sends and can be told to fail (retryable or not); `FakeLlm` returns scripted responses in order (including malformed JSON); `FakeEmail` records emails; `FakeCalendar` holds an in-memory busy list and records created events.
- Twilio payload fixtures live in `tests/fixtures/twilio/` (voice, inbound message, status), along with signed variants for validation tests.
- Test phone numbers use the Ofcom drama range (`+447700900001` to `+447700900999`), never real numbers.

## 5. Time
Logic that depends on time takes `now` as a parameter (handlers get an injected clock). Tests set `run_at` in the past rather than sleeping. No `sleep` or real timers in tests.
Slot computation and business hours are tested across a DST change in `Europe/London` (clocks go back on 25 October 2026) and across weekends and closed days.

## 6. Acceptance criteria coverage (spec.md section 7)
| # | Criterion | Test | Phase |
|---|---|---|---|
| 1 | Cross-tenant isolation | `tests/db` generic isolation over all tenant tables | 1 |
| 2 | Signup, onboarding, enable Product 1, save config | integration tests for `create_business`, product enable and config save; Playwright flow | 1 / 5 |
| 3 | Missed call creates conversation, message sent after delay | integration: simulate call -> conversation -> action due -> fake send | 3 |
| 4 | Reply stored once, AI answers | integration: duplicate webhook yields one message; scripted LLM reply | 4 |
| 5 | Escalation flags and emails | integration: complaint, "speak to a person", low confidence, turn cap | 4 |
| 6 | Booking on calendar | integration with `FakeCalendar` (slots, re-check, event, confirmation); manual real run | 6 |
| 7 | STOP | integration: opted out, no further sends, cross-business block | 4 |
| 8 | Admin view, toggle, failed + retry | integration + Playwright | 7 |
| 9 | No secrets, webhooks reject bad signatures | `check:secrets`, `check:bundle`, signature tests | 2 / 8 |

## 7. Product 1 scenarios (product-missed-call.md)
| # | Scenario | Level | Phase |
|---|---|---|---|
| 1 | Missed call during hours -> message after delay | integration | 3 |
| 2 | Duplicate call in window -> no second conversation | integration | 3 |
| 3 | Provider retries the same webhook -> one message | integration | 2 / 4 |
| 4 | "Check-up Thursday" -> slots -> confirm -> event | integration, FakeCalendar | 6 |
| 5 | Complaint -> escalated, owner emailed | integration | 4 |
| 6 | "Is this safe for my condition?" -> no advice, escalated | integration with a scripted model reply plus guardrail checks | 4 |
| 7 | STOP -> opted out | integration | 4 |
| 8 | Invalid signature -> rejected | route test | 2 / 3 |
| 9 | Invalid model JSON -> retry, then escalate | integration | 4 |
| 10 | Calendar disconnected -> escalate with reason | integration | 6 |

## 8. Other required tests (by doc)
- **Database** (database.md section 12): nine DB tests, including parallel queue claims.
- **Auth** (auth.md section 9): guards, middleware redirects, `create_business`, admin 404, `next` validation, worker and dev endpoint gating.
- **Security** (security-privacy.md section 13): encryption, redaction, opt-out choke point, send caps, repo scan, service-role import allowlist.
- **Integrations** (integrations.md section 8): adapter contract tests, signature fixtures, OpenAI invalid output, Google token refresh and `invalid_grant`.
- **Engine** (automation-engine.md section 11): queue, retries, idempotent send, expiry, admin retry.
- **Frontend** (frontend.md section 7): component tests and Playwright flows.

## 9. Rules
- No network in automated tests. Vendor calls are fakes or mocked HTTP.
- Deterministic: fixed ids and dates where output is compared; no snapshot tests of whole pages.
- A bug fix starts with a failing test.
- Do not weaken or delete a failing test to get green; fix the code or raise it.
- Each slice ends with `npm run verify` passing, then a commit and the plan.md checkbox update.
- Tests never use the real Twilio sandbox, OpenAI, Resend or Google; the smoke scripts do, one request each, run by hand.

## 10. Manual smoke and demo checks
- `npm run smoke:twilio | smoke:openai | smoke:resend | smoke:calendar` each send one real request. Use sparingly (98 trial messages).
- Demo checklist (README, Phase 8): tunnel running and URLs updated, tester phone joined (`join twilio-trial`, rejoin every 72 hours), Google calendar reconnected within 7 days, worker running. Run the full flow (call -> WhatsApp -> reply -> booking) three times in a row without database edits.

## 11. Tests by phase
| Phase | Added |
|---|---|
| 1 | tenant harness, isolation tests, RLS/grant checks, `create_business`, guards, registry tests, seed check |
| 2 | queue and retry tests, webhook helper tests, redaction, worker auth, `check:secrets` |
| 3 | adapter contract tests (Twilio), voice route, conditions, simulate endpoint, scenarios 1, 2, 8 |
| 4 | LLM adapter, inbound route, guardrails, STOP, escalation, scenarios 3, 5, 6, 7, 9 |
| 5 | component tests, Playwright flows |
| 6 | encryption in use, OAuth state, slot computation, booking, scenarios 4, 10 |
| 7 | admin services, retry, Playwright admin flow |
| 8 | bundle check, rate limit and send cap checks, three-run demo |

## 12. Decisions made here
1. Real local Postgres with fake adapters instead of mocking the database.
2. A meta-test forces an isolation test for every new tenant table.
3. DB and integration tests run serially against one local database.
4. Ofcom drama-range numbers for all test phones.
5. Manual smoke scripts are the only tests that touch real vendors.

## 13. Open items
- GitHub Actions with Supabase in CI: optional, decide in Phase 8.
- Coverage targets: none set; coverage is judged by the mappings above.
