# POC Spec

## 1. Goal
Prove that a new business can sign up, configure its details, connect integrations, enable an AI product and run the automation without developer intervention. The key demo is the complete flow: missed call -> WhatsApp conversation -> appointment on Google Calendar.

## 2. Non-goals (POC)
- Real Stripe payments or invoicing (subscription status is a manual record)
- Products 2 and 3 working (cards shown as "Coming soon"; to be built after Product 1)
- Outlook, Instagram, SMS, website enquiries
- Custom CRM, calendar or messaging infrastructure
- Per-business WhatsApp senders, multi-language, multiple calendars or appointment types
- Scale beyond ~5 businesses

## 3. Users
- **Business owner/staff:** uses the customer dashboard for their own business only.
- **Platform admin:** internal user who sees all businesses and troubleshoots.

## 4. Platform features

### 4.1 Customer dashboard
- Sign up / log in; create business (onboarding: name, phone number, timezone, business hours)
- Business profile
- List of available AI products with enable/disable toggle
- Product configuration screens
- Integration status (Google Calendar, telephony/WhatsApp) with connect/disconnect
- Basic activity metrics (missed calls handled, conversations, bookings, escalations)
- Subscription and billing status (read-only)
- Conversation and message history with intent and escalation flag

### 4.2 Admin panel
- List all businesses
- Subscription status per business
- Enable/disable products per business
- Automation status and basic logs
- Integration status per business
- Basic usage metrics
- Failed automations view with retry

### 4.3 Product 1: Missed Call -> WhatsApp Assistant
See docs/design/product-missed-call.md. Configurable: delay before first message, message template, business hours, appointment booking on/off, connected Google Calendar, escalation behaviour.

## 5. Decisions so far
- Businesses self-register; admin can disable a business.
- Missed calls reach the system by conditional call forwarding to a provider number (webhook on no-answer/busy/failed). A "simulate missed call" dev endpoint exists for testing.
- One shared WhatsApp sender for the POC, with the business name in the template.
- English only.
- One Google Calendar and one appointment duration per business.
- Escalation = email to the owner via Resend, flag in dashboard.
- AI: OpenAI API. Email: Resend.

## 6. Resolved decisions (previously open)
- WhatsApp and voice: Twilio (WhatsApp sandbox for the demo), behind an adapter. No unofficial WhatsApp libraries.
- Hosting: build and verify everything locally first (with a tunnel for webhooks). Deploy to Vercel only after the local flow works end to end.
- Calendar: Google Calendar (free API; not open source). One calendar and one appointment duration per business.
- Missed calls: both the simulate endpoint and real forwarded calls are in scope; real calls are tested in Phase 3.

## 6b. Open decisions
None at the moment.

## 7. Acceptance criteria
1. Two businesses exist; a user of business A cannot read any row of business B (automated test).
2. Owner can sign up, complete onboarding, enable Product 1 and save config.
3. A simulated or real missed call creates a conversation and sends the WhatsApp message after the configured delay.
4. A customer reply is stored once (no duplicates on provider retry) and answered by the AI.
5. Complaints, "speak to a person", or low confidence escalate: conversation flagged and owner emailed.
6. Booking: customer is offered 2-3 real free slots and confirms; event is created on the connected Google Calendar; confirmation sent.
7. STOP from a customer prevents further messages.
8. Admin can see all businesses, toggle a product, see failed automations and retry one.
9. No secrets in the repo or frontend bundle; webhooks reject invalid signatures.
