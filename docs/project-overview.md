# Project overview: what we built and what is left to go live

Idea: the team's (see docs/spec.md). Built as a proof of concept by Ragul. This is the single read-through of what exists, how it works, where it stands, and what it takes to make it real. Setup and test steps are in [team-setup-and-testing.md](team-setup-and-testing.md).

Live: https://ai-product-poc.vercel.app (Vercel with hosted Supabase). Code: https://github.com/RagulArulanandam/AI_Product_POC

## 1. The idea in one paragraph
Small service businesses (dental, dermatology, beauty clinics) sign up, connect their tools, switch on AI "products" and configure them without technical knowledge. The first product answers **missed calls**: when a customer calls and nobody picks up, the system sends them a WhatsApp message, an AI assistant continues the chat within strict rules, and it can book an appointment into the business's Google Calendar. Anything sensitive (a complaint, a request for a person, a health question) is handed to a human and the owner is emailed. Two more products (Priority Inbox, Daily Brief) appear as "coming soon" cards. The POC principle was the smallest reliable version that proves the business model, built for about five businesses.

## 2. What exists today
**For a business owner**
- **Sign up and onboarding:** create an account, then a business (name, phone, time zone). Opening hours are set in Settings.
- **Dashboard:** a set-up checklist and last 30 days of activity (missed calls picked up, replies, bookings, hand-overs).
- **Products page:** one card per product with an on/off switch. Missed Call to WhatsApp Assistant is live; the other two say "Coming soon".
- **Product 1 settings:** delay before the first message, message wording (normal and outside hours), opening hours, booking on or off, appointment length and gap, which calendar, the escalation email, and a short description of the business for the assistant. All validated by one shared rule set, so the form and the server cannot disagree.
- **Conversations:** a list with filters and search, and a detail page showing the full thread, detected intent and status (sending soon, waiting for reply, in conversation, offering times, booked, needs you, opted out, no reply, failed).
- **Integrations:** call-forwarding instructions per phone company, and **Connect / Disconnect Google Calendar**.
- **Billing:** the subscription status (managed by hand in the POC; there is no payment provider yet).

**For the platform admin** (`/admin`, visibly different from the customer screens)
- All businesses with subscription, products on, integration health and 30 day usage; pause or resume a business.
- Per business: edit the subscription, switch products on or off (even if the subscription would block it), see integrations and the automation log (filter by OK / skipped / error).
- **Failures:** a list of automations that ran out of retries, with a confirmed **Retry** button.
- Every admin change is written to an audit log with the admin's user id. Non-admins get a 404 on `/admin`.

**The missed-call flow, end to end**
1. A call to the business's forwarded number is not answered. The telephony provider calls our webhook (signature checked).
2. We check conditions: product on, subscription allows it, not already contacted recently, customer has not opted out, hours.
3. A conversation is opened and a first message is scheduled after the configured delay.
4. The worker sends it through one "send gate" that re-checks opt-out, the 24 hour WhatsApp window and send caps.
5. Customer replies come in by webhook. `STOP` is detected before any AI call and opts the customer out for good.
6. Otherwise the AI proposes a structured answer; our code validates it and decides: reply, ask a question, offer times, book, or escalate.
7. Booking: free times are computed by code from business hours and the calendar's busy time, three are offered, the customer picks one, the time is re-checked and the event is created once.
8. Every step writes an automation log row, which feeds the admin screens.

## 3. How it is built, and why
| Choice | Why |
|---|---|
| One Next.js app (App Router, TypeScript, Tailwind, shadcn) | Dashboard, admin, webhooks and workers in one place; no microservices to run for five tenants |
| Supabase: Postgres, Auth and **Row Level Security** | Tenant isolation is enforced by the database itself, so a coding slip cannot leak another business's data |
| A queue table plus a database cron job that calls `/api/worker` every minute | Delayed messages, retries (1, 5, 15 minutes) and "never process twice" with no Redis or extra servers |
| Idempotent, signature-verified webhooks | Providers retry; duplicates are ignored and forged requests store nothing |
| An adapter for every outside service (messaging, AI, email, calendar), each with a fake | Vendors can be swapped later, and all tests run offline for free |
| "The AI proposes, code decides" | The model returns JSON that code validates; times offered and bookings come from code, never from the model's own text |
| Guardrails | No medical, legal or price promises; complaints, health, urgent or "speak to a person" go to a human; turn cap of 8; confidence threshold 0.6; send caps of 10 per customer per hour and 200 per business per day |
| Google tokens encrypted (AES-256-GCM, key rotation supported), server-side only | Tokens never reach the browser, logs or other tenants |
| Products as plug-in modules (manifest, handler, settings form, registered in one place) | Product 2 and 3 can be added without touching the platform core |
| Vercel and hosted Supabase free tiers | Cheap, quick to put online |

**Quality and security work:** about 1100 automated tests (unit, database, integration), including a cross-tenant isolation test for every tenant table and a demo flow run three times in a row. Checks for committed secrets and for secrets leaking into the browser bundle, security headers, a size cap on webhooks, sign-in rate limits, a 30 day cleanup of webhook payloads (which hold phone numbers and message text), and friendly error pages. The written review is in [security-review.md](security-review.md).

## 4. Where it stands
| Area | Status |
|---|---|
| Dashboard, products, settings, conversations, billing, admin | Built and tested; running on the hosted site |
| Sign-up, login, logout, tenant isolation | Verified on the hosted site |
| Google Calendar connect and disconnect | Verified live with a real Google account (free/busy read, event create and delete) |
| Escalation email | Verified live through Resend |
| Missed call to WhatsApp, hosted | Verified on the hosted site on 29 Oct 2026 with a signed Twilio voice webhook (`npm run simulate:call`): call linked to the business, conversation opened, worker sent Twilio's template, message received on a phone |
| WhatsApp delivery | Verified live with Twilio's template message and the webhook callbacks |
| AI replies and booking by chat | Logic fully tested with a scripted model; **not run live** (no OpenAI credit) |
| Free-text WhatsApp replies | **Blocked** by the Twilio trial sender (template only) |
| A real phone call to a Twilio number | **Not tried** (the trial account cannot receive calls on a number we control); the signed webhook above stands in for it |
| Subscriptions and payments | Manual status only |

The three blocked items are account limits, not missing code.

## 5. What it takes to go live
**Must do (in this order)**
1. **Fund and rotate:** add OpenAI billing credit; rotate the Twilio auth token, OpenAI key and Resend key (they were shared in chat while building).
2. **Upgrade WhatsApp:** a paid Twilio account with a registered WhatsApp sender and approved message templates, so the assistant can send free text and open conversations outside the 24 hour window.
3. **Voice number:** a Twilio voice number (UK) so call-forwarding can reach us; set the voice webhook to the hosted address.
4. **Verified email domain:** a domain verified in Resend, so escalation emails can go to any owner, not just the account owner. Optionally a custom domain for the app.
5. **Google verification:** while the Google app is in "Testing" only listed users can connect and tokens expire after 7 days. Publish and verify the OAuth app (calendar scopes are sensitive) for real customers.
6. **Run it against real accounts:** with 1 to 5 done, run the full chain below on the hosted site and fix what real providers reveal.

**Then, before real customers**
- Billing with Stripe (status is manual today) and subscription enforcement.
- Staff permissions (today every member can do everything; the rules were deliberately put on hold).
- Error alerting (e.g. Sentry), uptime checks, and automatic checks on every push (CI running `npm run verify`).
- Customer data export and delete (GDPR), plus a privacy notice and terms.
- Lock simultaneous bookings of the same time (today two customers choosing the same slot at the same instant could both pass).
- A Content-Security-Policy, and edge rate limiting in front of the webhooks.
- Move the admin counts to SQL views when there are dozens of businesses; per-business WhatsApp senders; Outlook calendar.

## 6. Testing in the hosted environment
Steps to set it up are in [deploy.md](deploy.md). The checks, once the accounts above exist:
1. Sign up on the live site, finish onboarding, make yourself admin (one SQL line) and open `/admin`.
2. **Integrations:** connect Google Calendar, confirm the stored token is unreadable in the database, disconnect, and confirm access is gone at Google.
3. Turn on Product 1, set the escalation email, set the delay short.
4. Point the Twilio webhooks (inbound, status, voice) at the live address, then **call the business number and do not answer**. A WhatsApp message should arrive after the delay.
5. Reply with questions, "I'd like to book", and a time: confirm three real free times, the booking, and the event in Google Calendar.
6. Reply `STOP` from a second phone: opted out, nothing further sent. Send a complaint: handed over and an email received.
7. In `/admin`, confirm the automation log shows each step, force a failure (for example disconnect the calendar mid-conversation) and **Retry** it from Failures.
8. Check the Vercel function log for `/api/worker` (200 every minute) and the Supabase auth log for sign-in problems.

## 7. Known limits of the POC
- The dev "simulate" endpoints are off in production, so a hosted test needs a real call and real WhatsApp.
- English only; one shared WhatsApp sender with the business name in the template.
- Trial limits: Twilio's cap on trial messages, Resend's free sender restriction, Supabase free projects pause after about a week idle.
- Sign-in rate limits are per IP at Supabase; on Vercel the callers share addresses, so keep the limit generous (100 per 5 minutes) rather than the 10 used locally.

## 8. Suggested next steps for the team
1. Decide who owns the Twilio, OpenAI, Resend and Google accounts for the next stage (company accounts, not personal ones).
2. Run the section 6 checks with real accounts and agree the fix list.
3. Decide the staff permission rules and the first pricing, so billing can be built.
4. Pick two or three real clinics for a supervised pilot before any wider launch.
