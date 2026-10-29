# Deploying to Vercel and hosted Supabase

Both have free tiers. Vercel's Hobby plan is for non-commercial use, which fits a POC; move to Pro before real customers. A free Supabase project pauses after about a week without use (restore it from the dashboard).

Do the steps in order. Each step says what proves it worked. Steps 1, 2, 3 and 6 need your own accounts and secrets, so you do them; nothing here needs the secrets pasted into chat.

## 1. Hosted Supabase (about 10 minutes)
1. At supabase.com create a project (any region near the UK, such as London). Save the database password somewhere safe.
2. **Project Settings → API**: copy the project URL, the publishable (anon) key and the secret (service role) key. These become `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` in step 3.
3. **Authentication → Providers → Email**: turn **Confirm email** off (the POC has no email confirmation step; with it on, new sign-ups are told to check their inbox).
4. **Authentication → Rate Limits**: set sign-ups and sign-ins to 10 per 5 minutes per IP.
5. Apply the migrations from this repo. In a terminal in the project folder:
   ```bash
   supabase login
   supabase link --project-ref <your project ref>
   supabase db push
   ```
   Proof: **Database → Tables** lists `businesses`, `conversations`, `scheduled_actions` and the others, and **Database → Extensions** shows `pg_cron`, `pg_net` and `supabase_vault` enabled (enable them there if `db push` complained).

## 2. Vercel (about 10 minutes)
1. At vercel.com sign in with GitHub, **Add New → Project**, and import `AI_Product_POC`. Leave the framework as Next.js. Do not deploy yet.
2. Add the environment variables from step 3 under **Settings → Environment Variables** (Production), then deploy.
3. Note the address Vercel gives you, for example `https://ai-product-poc.vercel.app`. Use it as `APP_BASE_URL` and `PUBLIC_BASE_URL`, then redeploy once so the app knows its own address.

## 3. Environment variables for Vercel
Use **new** keys, not the ones from your local file (rotate the Twilio, OpenAI and Resend keys first; they were shared in chat earlier).

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | from step 1.2 |
| `APP_BASE_URL`, `PUBLIC_BASE_URL` | the Vercel address, no trailing slash |
| `WORKER_SECRET` | a new random string: `openssl rand -base64 32` |
| `ENCRYPTION_KEY` | a new key: `openssl rand -base64 32`. Calendars connected locally must be connected again |
| `ENABLE_DEV_ENDPOINTS` | `false` (also forced off in production) |
| `TWILIO_*`, `OPENAI_API_KEY`, `OPENAI_MODEL`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL` | as in `.env.example` |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | your OAuth client |
| `GOOGLE_REDIRECT_URI` | `https://<your vercel address>/api/integrations/google/callback` |

Do not set any `*_ADAPTER` variable: production uses the real services. Without OpenAI credit the assistant cannot reply, and conversations are handed to the owner with the reason "Assistant unavailable".

## 4. Point the database worker at Vercel
The background worker is a database job that calls `/api/worker` on your app every minute. Its address and secret live in Supabase Vault, not in the repo. In the Supabase **SQL Editor** run (using your own values):
```sql
select vault.create_secret('https://<your vercel address>/api/worker', 'worker_url', 'Worker endpoint');
select vault.create_secret('<the WORKER_SECRET you set in Vercel>', 'worker_secret', 'Worker bearer token');
```
Proof: `select jobname, active from cron.job;` lists `worker-tick` and `purge-webhook-payloads`, both active, and within two minutes `select count(*) from net._http_response;` grows. (To change a value later, use `vault.update_secret`.)

## 5. Create the first admin
1. Open the Vercel address and **Create an account** with your own email, then finish onboarding (this also gives you a business to look at).
2. In the SQL Editor:
   ```sql
   insert into public.platform_admins (user_id)
   select id from auth.users where email = '<your email>';
   ```
3. Sign out and in again. A platform admin without a business lands on `/admin`; one who also owns a business uses the address `/admin` directly.

## 6. Connect Google, Twilio and the rest
- **Google Cloud Console → your OAuth client**: add `https://<your vercel address>/api/integrations/google/callback` to Authorized redirect URIs. In the app, **Integrations → Connect Google Calendar**.
- **Twilio Console**: set the WhatsApp "when a message comes in" URL to `https://<your vercel address>/api/webhooks/whatsapp`, the status callback to `https://<your vercel address>/api/webhooks/whatsapp/status`, and the voice number's webhook to `https://<your vercel address>/api/webhooks/voice`. These must match `PUBLIC_BASE_URL` exactly, because Twilio signs the full address.
- The Twilio trial still only delivers its fixed template, so WhatsApp replies are limited until you upgrade or use a registered sender.

## 7. Check it
1. `/login` loads; sign-up works and lands on onboarding.
2. `/admin` loads for your admin account and shows your business.
3. After a minute, **Admin → Businesses** shows no failed automations, and the Vercel function log for `/api/worker` shows 200 responses every minute.
4. Optional bundle check from your machine, after a local build: `NEXT_DIST_DIR=.next-check npx next build` then `npm run check:bundle -- .next-check`.

## Rolling back
Vercel keeps every deployment: **Deployments → … → Promote to Production** on the last good one. Database migrations are not reversed automatically; write a new migration instead of editing an applied one.
