# Demo script

A 10 minute walk through the whole POC on one machine. Everything is local; nothing needs a database edit. Run it three times in a row to check it is repeatable: each run only adds new rows.

## Before you start (once)
1. Docker Desktop running, then `npm run db:start`.
2. `npm run db:reset`, then `npm run db:seed`. Start `npm run dev` in its own terminal and leave it running (the background worker calls it every minute).
3. In `.env.local` choose what is real and what is faked:
   - Safe default with no paid accounts: `MESSAGING_ADAPTER=fake`, `LLM_ADAPTER=fake`, `EMAIL_ADAPTER=fake`, `CALENDAR_ADAPTER=fake`, `ENABLE_DEV_ENDPOINTS=true`. Replies are stored in the database instead of sent.
   - Real services: set the matching variables from `.env.example` and remove the `*_ADAPTER=fake` lines. The assistant's natural replies need funded OpenAI credit; WhatsApp free text needs a Twilio account that can send it (a trial can only send its fixed template).
4. Seed accounts (password `Password123!`): `owner-a@poc.local` (Bright Smile Dental), `admin@poc.local`.

## Part 1: the owner (3 minutes)
1. Log in as `owner-a@poc.local`. The dashboard shows the set-up checklist and last 30 days of activity.
2. **Products**: Missed Call to WhatsApp Assistant is on; Priority Inbox and Daily Brief show "Coming soon". Open **Configure** and change the delay or the message, then **Save changes**.
3. **Integrations**: shows call-forwarding steps for the business's phone company. With Google credentials set, **Connect Google Calendar**, tick the permissions on Google's screen and see it show as connected. With `CALENDAR_ADAPTER=fake`, Connect gives a demo calendar straight away.
4. **Conversations**: open the seeded ones (booked, needs you, opted out) and read the thread.

## Part 2: a missed call (3 minutes)
Replace `<business id>` with the id in the address bar of the business page in the admin panel (or from `select id, name from businesses` in Supabase Studio, http://127.0.0.1:54323), and `<secret>` with `WORKER_SECRET` from `.env.local`.

```powershell
$h = @{ Authorization = "Bearer <secret>" }
Invoke-RestMethod -Method Post -Uri http://localhost:3000/api/dev/simulate-missed-call -Headers $h -ContentType "application/json" -Body '{"businessId":"<business id>","from":"+447700900321"}'
```

1. A new conversation appears under **Conversations** as "Sending soon". After the configured delay (default 2 minutes) the worker sends the first message and it becomes "Waiting for reply". To skip the wait, change the product delay to 0 first.
2. Play the customer:

```powershell
Invoke-RestMethod -Method Post -Uri http://localhost:3000/api/dev/simulate-inbound-message -Headers $h -ContentType "application/json" -Body '{"from":"+447700900321","body":"I want to make a complaint"}'
```

3. The conversation turns to **Needs you** and the owner gets an escalation email (the address in the product's escalation setting). Send `STOP` from another number and see it become **Opted out**; nothing is ever sent to that number again.
4. With funded OpenAI credit, try "What time do you open on Saturday?" and "Can I book tomorrow morning?". The assistant offers three real free times from the calendar, books the one the customer picks and the event appears in Google Calendar.

## Part 3: the admin (3 minutes)
1. Log in as `admin@poc.local`. You land on **/admin**, with the amber "Admin panel" banner so it is never mistaken for a customer view.
2. The list shows every business, subscription, products on, integration health and 30 day counts. Open **Bright Smile Dental**.
3. Change the subscription to "Payment overdue" and save. Switch a product off and on. Read the automation log and filter it to **Error**.
4. **Failures** shows one seeded failed action. Click **Retry** then **Yes, retry**. It leaves the list and the business log shows an `admin_action` row with your account.
5. Log in as an owner and visit `/admin`: you get a 404, not a "forbidden" page.

## Reset between runs
Nothing needs resetting. For a completely clean start: `npm run db:reset`, `npm run db:seed`.

## If something looks wrong
- Pages keep reloading or show build errors: stop `npm run dev`, delete the `.next` folder, start it again.
- Messages stay "Sending soon": the worker is not being called. Check `npm run dev` is running, or run `npm run worker:poll`.
- Login works but you see "Invalid Refresh Token" in the log: clear the site's cookies for `localhost` and sign in again (it happens after `db:reset`).
