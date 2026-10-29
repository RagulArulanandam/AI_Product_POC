# Team guide: set up, run and test

For a teammate who wants to run the project and try every feature. For what was built and why, read [project-overview.md](project-overview.md). For putting it online, read [deploy.md](deploy.md).

## 1. Pick how much you want to do
| Goal | What you need | Time |
|---|---|---|
| Just look at it | A browser and a login (see 2) | 2 minutes |
| Run it on your machine, no paid accounts | Node, Git, Docker Desktop, Supabase CLI (see 3) | about 30 minutes, mostly first-time downloads |
| Also try the real WhatsApp, AI, email and calendar | The free accounts in section 6 | another hour |

## 2. Look at the live app (no installs)
Open https://ai-product-poc.vercel.app and use **Create an account** (any email and a password you choose, no confirmation email is sent). Finish onboarding with a business name and a UK number such as `020 7946 0958`.

To see the admin panel, ask the project owner to run this in Supabase for your email, then sign in again and open `/admin`:
```sql
insert into public.platform_admins (user_id)
select id from auth.users where email = '<your email>';
```
The live app cannot simulate a missed call (those test endpoints are switched off in production). Use a local copy for that.

## 3. Install these
| Tool | Why | Check it |
|---|---|---|
| Git | get the code | `git --version` |
| Node.js 24 (with npm) | run the app and scripts | `node --version` |
| Docker Desktop | runs the local database; it must be **running** | `docker --version` |
| Supabase CLI | starts and manages the local database | `supabase --version` (install: https://supabase.com/docs/guides/local-development/cli/getting-started) |
| A code editor | optional (VS Code works) | |

The first `supabase start` downloads several Docker images (a few GB), so allow time and disk space. On Windows, Git Bash is handy; the commands below also work in PowerShell unless noted.

## 4. Get it running locally
```bash
git clone https://github.com/RagulArulanandam/AI_Product_POC.git
cd AI_Product_POC
npm install
npm run db:start            # local Supabase (Docker must be running)
```
Create `.env.local` by copying `.env.example`, then fill in:
- the three Supabase values from `supabase status -o env`: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (the publishable key) and `SUPABASE_SERVICE_ROLE_KEY` (the secret key);
- `WORKER_SECRET` and `ENCRYPTION_KEY`: any random strings; generate with `openssl rand -base64 32` (or in PowerShell: `$b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); [Convert]::ToBase64String($b)`);
- `APP_BASE_URL=http://localhost:3000`, `WORKER_URL=http://localhost:3000/api/worker`, `ENABLE_DEV_ENDPOINTS=true`;
- **for a no-cost run:** `ADAPTER_MODE=fake`. Messages, AI, email and calendar are then simulated (replies are stored in the database instead of sent).

Then:
```bash
npm run db:reset            # create all tables and the background-job settings
npm run db:seed             # demo businesses, users and conversations
npm run dev                 # http://localhost:3000 (keep this running)
```
Keep `npm run dev` running: a database job calls it every minute to send delayed messages.

**Seed logins** (password `Password123!`, local data only):
| Email | Role |
|---|---|
| `owner-a@poc.local` | owner of Bright Smile Dental (has demo conversations) |
| `owner-b@poc.local`, `owner-c@poc.local` | owners of two other businesses |
| `staff-a@poc.local` | staff at Bright Smile Dental |
| `admin@poc.local` | platform admin (lands on `/admin`) |

Check everything is healthy with `npm run verify` (lint, types, about 1100 tests, secret scan). Tests that need no database: `npm run test:unit`.

## 5. Test each feature
Features marked "no accounts" work with `ADAPTER_MODE=fake`.

| Feature | Needs | How to try it |
|---|---|---|
| Customer dashboard, settings, billing page | no accounts | Log in as `owner-a@poc.local`. Look at the checklist, 30 day numbers, **Settings** (name, phone, hours) and **Billing** |
| Product cards and Product 1 settings | no accounts | **Products**: switch Missed Call on or off, open **Configure**, change the delay (set it to `0` to skip waiting), the message wording, hours, booking and the escalation email, then save. Priority Inbox and Daily Brief show "Coming soon" |
| Conversations | no accounts | **Conversations**: filter and search the seeded ones; open one to read the thread, intent and status |
| Missed call, then a first message | no accounts (fake) | See the command below. The conversation appears as "Sending soon", then "Waiting for reply" once the worker sends (within a minute after the delay). Open it to read the stored message |
| Customer says STOP | no accounts | Send `STOP` as the customer (command below). The conversation becomes "Opted out" and nothing is ever sent to that number again |
| Escalation to a person | no accounts to see the status; Resend key for the real email | Send "I want to make a complaint". With a working model it escalates straight away. With no working model the step is retried and then handed over as "Assistant unavailable": at once when the OpenAI key has no credit, otherwise after the retries (about 20 minutes). The owner is emailed once |
| Natural AI conversation and booking | OpenAI key **with credit**, plus Google (or `CALENDAR_ADAPTER=fake`) | Ask "What time do you open on Saturday?" or "Can I book tomorrow morning?". The assistant offers three real free times and books the one chosen. Without credit this cannot run live; the automated tests (`tests/integration/conversation.test.ts`, `booking.test.ts`) cover it |
| Google Calendar connect and disconnect | Google Cloud OAuth client (section 6), or `CALENDAR_ADAPTER=fake` | **Integrations**, **Connect Google Calendar**. With the fake it connects a demo calendar instantly |
| Admin panel | no accounts | Log in as `admin@poc.local`. Businesses list, open one: subscription, product switches, integrations, automation log. **Failures** has one seeded failed action: **Retry** it |
| Tenant isolation | no accounts | Log in as `owner-b@poc.local` and confirm none of Bright Smile's data is visible; visit `/admin` and get a 404 |
| Real WhatsApp delivery | Twilio trial and a tunnel | See "Real WhatsApp" below |

**Simulate a missed call and a customer reply** (needs `ENABLE_DEV_ENDPOINTS=true`). Use the business id from the address bar of a business page in the admin panel, and `WORKER_SECRET` from `.env.local`.

PowerShell:
```powershell
$h = @{ Authorization = "Bearer <WORKER_SECRET>" }
Invoke-RestMethod -Method Post -Uri http://localhost:3000/api/dev/simulate-missed-call -Headers $h -ContentType "application/json" -Body '{"businessId":"<business id>","from":"+447700900321"}'
Invoke-RestMethod -Method Post -Uri http://localhost:3000/api/dev/simulate-inbound-message -Headers $h -ContentType "application/json" -Body '{"from":"+447700900321","body":"STOP"}'
```
bash:
```bash
curl -X POST http://localhost:3000/api/dev/simulate-missed-call -H "Authorization: Bearer $WORKER_SECRET" -H "Content-Type: application/json" -d '{"businessId":"<business id>","from":"+447700900321"}'
curl -X POST http://localhost:3000/api/dev/simulate-inbound-message -H "Authorization: Bearer $WORKER_SECRET" -H "Content-Type: application/json" -d '{"from":"+447700900321","body":"STOP"}'
```
(`curl` in PowerShell is a different command: use the first block there.) The step-by-step demo is in [demo-script.md](demo-script.md).

**Trigger a real missed call without owning a phone number.** A trial Twilio account cannot receive calls on a number you control, so `npm run simulate:call` sends our voice webhook the same signed request Twilio would send. It exercises the real path: signature check, number-to-business lookup, missed-call flow, then the WhatsApp message.
1. Link a number to the business (any number you pick, it only has to match `--to`). In Supabase SQL Editor (local Studio or hosted):
   ```sql
   insert into public.phone_numbers (business_id, e164)
   select id, '+447460041934' from public.businesses where name = '<business name>';
   ```
2. Make sure Missed Call is switched on for that business (delay 0 for a quick test) and the worker is running.
3. Send the call. `--from` is the phone that joined the Twilio WhatsApp sandbox (it receives the message); `--base` and `TWILIO_AUTH_TOKEN` must match what the target app uses:
   ```bash
   # against the hosted app (put its TWILIO_AUTH_TOKEN and PUBLIC_BASE_URL in .env.local or the environment first)
   npm run simulate:call -- --from +44<your phone> --to +447460041934 --base https://ai-product-poc.vercel.app
   # against your local app (signs for PUBLIC_BASE_URL but posts to localhost)
   npm run simulate:call -- --from +44<your phone> --to +447460041934 --post-to http://localhost:3000
   ```
4. Within about a minute the trial template arrives on that phone and the conversation appears under **Conversations**. A `403` means the token or `PUBLIC_BASE_URL` differs from the app's. The token is read from `.env.local`, never from an argument.

**Repeat the hosted missed-call test (checklist).** Once only: the `phone_numbers` link above, the worker secret in Vercel and the two Vault secrets (`worker_url`, `worker_secret`, same secret as Vercel; check `select status_code from net._http_response order by created desc limit 3;` shows 200), and Missed Call switched on.
1. The phone has joined the Twilio WhatsApp sandbox in the last 72 hours (otherwise send the join code again).
2. Run `npm run simulate:call -- --from +44<your phone> --to <linked number> --base <hosted address>`. Expect `-> 200` and the "busy" text.
3. **Conversations** shows a new one as "Sending soon"; the business's automation log shows `conditions_passed` and `first_message_scheduled`.
4. After the delay plus up to a minute for the worker, the template arrives and the conversation becomes "Waiting for reply".
5. Reply `STOP` from the phone to check the opt-out, or run the next test.
A second call from the same number within 30 minutes is skipped as `duplicate_in_window`. To repeat sooner, delete the test conversation: `delete from public.conversations where customer_id in (select id from public.customers where phone_e164 = '+44<your phone>');`

**Real WhatsApp (free but limited).** Remove `ADAPTER_MODE=fake`, set the Twilio values, start a tunnel (`cloudflared tunnel --url http://localhost:3000`), set `PUBLIC_BASE_URL` to the tunnel address and restart `npm run dev`. In the Twilio Console set the sandbox "when a message comes in" URL to `<tunnel>/api/webhooks/whatsapp` and the status callback to `<tunnel>/api/webhooks/whatsapp/status`. Join the sandbox from the test phone by sending the join code. A trial sender can only deliver Twilio's fixed template, not our wording, so you can verify delivery and inbound handling (STOP, escalation) but not free-text AI replies.

## 6. Accounts for the real services
All have a free tier. Put the values in `.env.local` (never commit it, never paste keys in chat or tickets).

| Service | Used for | Get it | Limits to know |
|---|---|---|---|
| Twilio | WhatsApp and voice | twilio.com trial; Console, "Try out WhatsApp" | Trial delivers a fixed template only; no free-text replies; no voice number |
| OpenAI | the assistant's replies | platform.openai.com | **Needs paid credit**; without it the assistant escalates as "Assistant unavailable". Set `OPENAI_MODEL` too |
| Resend | escalation emails | resend.com, API key | The free sender only emails the account owner's address |
| Google Cloud | Calendar | console.cloud.google.com: create a project, enable Google Calendar API, set up the consent screen (External, add yourself as a test user), create a **Web application** OAuth client with redirect `http://localhost:3000/api/integrations/google/callback` | While in Testing, Google shows "not verified": click Advanced, then Go to the app |
| Cloudflare tunnel | lets Twilio reach your laptop | `cloudflared` | Address changes each restart |

## 7. Useful commands
| Command | What it does |
|---|---|
| `npm run dev` | start the app |
| `npm run db:start` / `supabase stop` | start / stop the local database |
| `npm run db:reset` then `npm run db:seed` | fresh database and demo data |
| `npm run worker:poll` | call the worker every 10 seconds if the database job is not running |
| `npm run verify` | everything: lint, types, tests, secret scan, type check |
| `npm run check:bundle -- <build folder>` | confirm no secret reached the browser bundle |

Supabase Studio (database viewer): http://127.0.0.1:54323.

## 8. Troubleshooting
- **`supabase start` fails, "docker not found":** start Docker Desktop and wait until it says running.
- **Messages stay "Sending soon":** `npm run dev` is not running, or run `npm run db:setup` once to re-point the database job.
- **Pages keep reloading or show build errors:** stop `npm run dev`, delete the `.next` folder, start again.
- **"Invalid Refresh Token" after a reset:** clear the site's cookies for `localhost` and sign in again.
- **Google "redirect_uri_mismatch":** the redirect in Google Cloud must match `.env.local` exactly.
- **"Access blocked" from Google:** add your Gmail under Audience, Test users.
- **Tests flaky right after starting:** another run or the dev server worker may be using the queue; rerun `npm run verify`.
