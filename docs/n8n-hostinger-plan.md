# Plan: n8n automation and one-place hosting on Hostinger

Status: proposal for the team, not built. Written 17 Nov 2026. Prices below were read from Hostinger's public pages on that date and change often: confirm at checkout.

## 1. The reference video, and what it shows
"I Built an AI Voice Receptionist with Vapi and n8n MCP" (Nate Herk, 34 min, https://www.youtube.com/watch?v=y-cq_Qo4zVo).
- **Front end:** Vapi runs the phone conversation (GPT-4.1, a long system prompt, a first message, handoff to other assistants, a PDF knowledge base, and a phone number).
- **Back end:** n8n exposes seven small workflows through one **MCP server trigger**. Vapi calls them as tools: client lookup, new client, check availability, book event, lookup appointment, update appointment, delete appointment.
- **Data:** Google Calendar for events and a Google Sheet as the CRM (clients, appointment log, call log).
- **Call log:** Vapi's end-of-call report is sent to an n8n webhook, which writes a summary and outcome to the sheet.
- **Design rule worth copying:** no AI inside the n8n workflows. The voice agent decides; the workflows do one fixed job each, so calls stay fast, cheap and predictable.

## 2. Where our project stands against it
| Capability in the video | Our project today |
|---|---|
| Answer the call by voice | Not built. We react to a missed call and send a WhatsApp text |
| Look up a returning client | Partly: customers are matched by phone number, not email |
| Create a new client | Done (customer created on first contact) |
| Check availability, book an event | Done (free times computed by code, one event per booking) |
| Update or cancel an appointment | **Missing** |
| Look up a customer's appointment | **Missing** (the booking lives on the conversation only) |
| Knowledge base answers | Partly: a short business description, no uploaded FAQ document |
| Hand off to a human or another agent | Done (escalation plus an email to the owner) |
| Log each call with summary and outcome | Partly: automation log and conversation status; no AI call summary |
| Phone number assigned to the assistant | Done in the app (`phone_numbers`); a real number needs a paid Twilio account |
| CRM | Our Supabase tables (multi-tenant, with isolation tests) |

## 3. Recommended design: keep the app, add n8n beside it
Do **not** move the logic into n8n. The app gives us tenant isolation, tests and security rules that n8n workflows do not. Use n8n for three jobs:
1. **Scheduler:** an n8n "Schedule Trigger" calls `/api/worker` every minute. This can replace the Supabase cron job, so the database stops needing to reach the app (useful when the app moves to a VPS).
2. **Event hub:** the app posts events (missed call, conversation started, booked, escalated, opted out) to an n8n webhook. n8n fans them out to a Google Sheet or Notion log, Slack or email alerts, and a daily summary. This is the video's "call logger".
3. **Tool server (only for the voice option):** an n8n MCP server whose workflows call our app's API and calendar to look up a customer, check availability, book, update and cancel.

```
Caller / WhatsApp -> Twilio (or Vapi for voice)
                         |
          Hostinger VPS (Docker Compose, one HTTPS domain each)
   +--------------------------------------------------------+
   |  Caddy (HTTPS)                                          |
   |    app.<domain>  -> Next.js app (this repo)             |
   |    n8n.<domain>  -> n8n (+ its own small database)      |
   +--------------------------------------------------------+
        |                         |
   Supabase (hosted free tier,    Google Calendar, OpenAI, Resend
   or self-hosted later)
```

## 4. Step by step
### Phase A: learn n8n locally, free (about 1 day)
1. Run n8n in Docker on your machine (`docker run -p 5678:5678 n8nio/n8n`), create the owner account.
2. Build workflow 1, the scheduler: Schedule Trigger every minute, then HTTP Request `POST http://host.docker.internal:3000/api/worker` with header `Authorization: Bearer <WORKER_SECRET>`. Confirm queued messages still send.
3. Build workflow 2, the event hub: a Webhook node that receives app events and appends a row to a Google Sheet. (Section 5 lists the small app change.)
4. Build workflow 3, a daily summary (Schedule Trigger at 08:00, read yesterday's rows, send an email through Resend).

### Phase B: Hostinger VPS (about half a day)
1. Buy a **KVM 2** VPS (about $8.79/month on the 24-month promotion, about $14.99/month at renewal; KVM 1 is $6.49 promotional). Hostinger has a one-click "n8n" Docker template. Pick Ubuntu with Docker if you want everything in one compose file.
2. Buy or attach a domain; point `app.<domain>` and `n8n.<domain>` at the VPS (A records).
3. Secure the server: SSH key login, disable password login, firewall allowing only ports 22, 80 and 443, automatic security updates, a Hostinger snapshot schedule.

### Phase C: deploy the app and n8n together (about 1 day)
1. Write a `docker-compose.yml`: Caddy (automatic HTTPS), the Next.js app (a Dockerfile in the repo), and n8n with a persistent volume and its own Postgres (not SQLite) and `N8N_ENCRYPTION_KEY` set and backed up.
2. Put the same environment variables as Vercel in a `.env` on the server (never in the repo).
3. Point Twilio's webhooks and the Google redirect URI at `https://app.<domain>/...`. Keep Vercel running until this works, then switch over.
4. Replace the Supabase cron job with the n8n scheduler (Phase A step 2), or update the Vault `worker_url` to the new address.
5. Run the demo script and the hosted missed-call test from `docs/team-setup-and-testing.md`.

### Phase D: close the gaps the video covers (about 2 to 3 days)
1. Add **update and cancel appointment** to the calendar adapter and the booking flow, and store the booking on a small `appointments` table so it can be looked up.
2. Add a **knowledge base**: a per-business FAQ text (or uploaded PDF text) that the assistant may quote, with the existing "only use this information" rule.
3. Add an **AI call summary and outcome** on conversation close, sent to the n8n event hub.
4. Add n8n tool workflows (lookup customer, check availability, book, update, cancel), each with one job and a clear description, exposed through the MCP server trigger.

### Phase E: optional voice receptionist (about 2 days, extra cost)
1. Vapi assistant with a first line that says it is an AI, the system prompt, and the n8n MCP server added as a tool (server URL from the MCP trigger, header `Authorization: Bearer <n8n API key>`, server-sent events).
2. Attach a phone number (Vapi gives free US numbers; a UK number means importing a Twilio one) and set the end-of-call report URL to the n8n webhook.
3. Add a handoff to a human number for complaints, matching our escalation rules.
This is a different product from the missed-call text flow, so decide whether it replaces or sits beside it.

### Phase F: run it safely (ongoing)
Daily backups of the n8n volume and database, uptime monitoring on both domains, n8n owner login with a strong password, no public n8n editor if you can restrict it by IP, and a written restore test.

## 5. Small changes needed in this repo
- An **automation adapter** (`src/adapters/automation/`) that posts signed events to `N8N_WEBHOOK_URL` (with a fake for tests), called after key steps. It follows the project rule that services never call outside systems directly.
- Calendar adapter methods `updateEvent` and `deleteEvent`, with tests.
- An `appointments` table (with `business_id`, RLS and an isolation test) and a few service endpoints for n8n to call, protected by a shared secret.
- A `Dockerfile` and `docker-compose.yml` for the VPS.

## 6. Cost and trade-offs (be honest with the team)
- Hostinger's low price needs a **24-month prepayment** (about $155.76 for KVM 1, $210.96 for KVM 2) and renews higher. Shorter terms cost more per month. n8n itself is free to self-host; you pay for the server.
- You become the system administrator: updates, backups, security and uptime are yours. Vercel and hosted Supabase handle that today.
- A single VPS is a single point of failure. Keep the Vercel deployment as a fallback until the VPS has run cleanly for a few weeks.
- AI still costs money: OpenAI credit for replies, plus Vapi and voice provider charges per minute for the voice option. A UK Twilio number needs a paid account and address verification.
- n8n's Sustainable Use License allows running it for your own business automations. Selling n8n itself as a service to customers is restricted, so keep n8n as our back office and not something customers log in to.
- Self-hosting Supabase on the same VPS is possible but heavy. For the POC, keep Supabase's hosted free tier.

## 7. Decisions needed
1. Is the voice receptionist (Phase E) in scope, or do we stay with missed call to WhatsApp?
2. Which domain name, and who owns the Hostinger account?
3. Do we pay for the 24-month plan now, or build and test n8n locally first (Phase A is free)?
4. Who funds OpenAI, Twilio and Vapi usage?

Suggested order: A, then D1 to D3 (they help with or without n8n), then B and C, then E if wanted.
