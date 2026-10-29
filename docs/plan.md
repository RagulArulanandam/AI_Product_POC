# Plan

Status key: [ ] todo, [x] done. Update at the end of each slice. Current phase: 7 (Phase 0 still has open items: accounts/keys for later phases and the WhatsApp template approval).

## Phase 0: Docs and accounts
- [x] CLAUDE.md, spec.md, plan.md, product-missed-call.md in repo
- [x] Draft design docs with Claude Code in plan mode: architecture, entities, database, auth, automation-engine, frontend, integrations, security-privacy, testing (approved)
- [ ] Accounts and keys in .env.local: Supabase (local first), OpenAI, Resend, Google Cloud OAuth, Twilio (number + WhatsApp sandbox), tunnel
- [ ] Submit WhatsApp sender / template approvals (runs in the background)
Done when: docs reviewed, keys in place, nothing blocked.

## Phase 1: Platform core
- [x] Scaffold Next.js + TS + Tailwind + shadcn, lint/typecheck/test wired
- [x] Local Supabase, migrations: businesses, memberships, platform_admins, products, business_products, subscriptions, integrations, integration_secrets
- [x] RLS policies + cross-tenant isolation test
- [x] Auth: signup/login, business creation, membership, route protection
- [x] Product registry (manifest) with Product 1 + two "coming soon" stubs
- [x] Seed script (3 businesses, 1 admin, 1 staff)
Done when: two test businesses cannot see each other's data; products listed from the registry. (Done: see tests/db/isolation.test.ts and tests/db/seed.test.ts.)

## Phase 2: Automation engine
- [x] Tables: customers, opt_outs, conversations, messages, scheduled_actions, automation_logs, webhook_events
- [x] Logging helper (redacting); event -> handler runner
- [x] Worker endpoint + pg_cron every minute (FOR UPDATE SKIP LOCKED), retries with backoff
- [x] Webhook helper: signature verify + idempotency
Done when: a test event passes through the queue and is logged; duplicates are ignored. (Done: see tests/integration/webhooks.test.ts "end to end". Cron to app was also checked by hand through Docker.)
Still to do in Phase 3: wire the helper into real routes with `after()` (it is injected in the helper, so not yet exercised in a running route) and add the Twilio signature verifier.

## Phase 3: Product 1, outbound
- [x] Messaging adapter + Twilio implementation (free-text mode, plus trial template mode)
- [x] Voice webhook, business lookup by dialled number, conditions (enabled, hours, dedupe, opt-out)
- [x] Customer upsert, conversation create, scheduled send after delay
- [x] Simulate-missed-call dev endpoint
Done when: a missed call produces a WhatsApp message on a real phone after the delay. (Done on 28 Oct 2026: a simulated call reached the tester phone about 2 minutes later and Twilio reported it delivered; the delivery callback came back through the tunnel. Caveat: the trial account can only send Twilio's fixed "Appointment Reminders" template, not our wording. A real forwarded call is untested because the account has no voice number.)
Open decision before Phase 4: the AI conversation needs free-text replies, which the trial's template-only environment does not allow. Options: the legacy sandbox, or a paid upgrade with a registered sender.

## Phase 4: Product 1, AI conversation
- [x] LLM adapter (OpenAI), structured output, schema validation, bad-JSON fallback
- [x] Inbound WhatsApp webhook, idempotent message storage
- [x] Intent handling, guardrails, turn cap, STOP handling
- [x] Escalation: flag + Resend email to owner
Done when: natural chat works; complaints and "speak to someone" escalate. (Done against the scripted model and fake WhatsApp: all Product 1 scenarios 1 to 10 except 4 and 10, which need the calendar, are covered by tests. Live on 28 Oct 2026: the real Resend email reached the owner's inbox via an escalation. NOT yet verified live: a real OpenAI answer, because the OpenAI account reported "no credits remaining"; and real WhatsApp replies, which the Twilio trial cannot send as free text.)
Before relying on the AI live: add billing credit at platform.openai.com/settings/organization/billing, then run the README "Try the AI conversation" steps.

## Phase 5: Customer dashboard
- [x] Onboarding, product cards + toggles, Product 1 config form
- [x] Integrations page, conversation list/detail, activity metrics, billing status page
Done when: owner can configure and watch Product 1 without touching the DB.

## Phase 6: Calendar booking
- [x] Google OAuth connect/disconnect, encrypted token storage, narrow scopes
- [x] Calendar adapter: free/busy, slot computation, re-check, create event
- [x] Booking states and confirmation message
- [x] Live check against a real Google account (28-29 Oct 2026: connect, free/busy, event create and delete all worked with the narrow scopes; the full chat-to-booking flow still needs OpenAI credit)
Done when: call -> chat -> event on the calendar, end to end.

## Phase 7: Admin panel
- [ ] Business list, subscription status, product toggle, integration status
- [ ] Automation logs, failed-automation view with retry, basic metrics
Done when: admin can diagnose and retry a failed automation.

## Phase 8: Hardening
- [ ] Rate limiting on webhooks and signup
- [ ] Error states, README (setup, env vars, deploy), demo script
- [ ] Security review: RLS, secrets, token handling
Done when: the demo runs three times in a row without DB edits.

## Later
Products 2 and 3, Stripe, per-business WhatsApp senders, Outlook.

## Decisions pending
None. See spec.md section 6 for resolved decisions (Twilio, local-first then Vercel, Google Calendar).

## Deployment note
Phases 1-8 run locally with a tunnel for webhooks. Deploy to Vercel (and switch Supabase to hosted) only after the Phase 6 end-to-end flow works locally, as part of Phase 8.
