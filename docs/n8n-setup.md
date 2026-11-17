# n8n setup: alerts and a daily summary

The database sends n8n a small JSON message when something important happens, and a summary every morning. n8n turns them into Telegram messages. Nothing polls, and n8n never gets a database login, so a month of use is only a few hundred n8n executions (important on n8n Cloud, which counts executions per month).

## What gets sent
| `type` | When | Fields |
|---|---|---|
| `missed_call` | a missed call was picked up and the first message scheduled | `business_name`, `conversation_id` |
| `escalated` | a conversation was handed to a person | `business_name`, `detail` (the reason) |
| `booked` | an appointment was booked | `business_name`, `detail` (the start time, UTC) |
| `opted_out` | a customer replied STOP | `business_name` |
| `error` | any step failed | `business_name`, `reason` (a short code) |
| `daily_summary` | 08:00 UTC every day | `businesses` (name, calls, bookings, handed_over), `failed_actions` |

No phone numbers, message text or tokens are ever included. Each request carries the header `X-Webhook-Secret`.

## 1. Telegram bot (2 minutes, free)
1. In Telegram open **@BotFather**, send `/newbot`, choose a name, and copy the **bot token**.
2. Send any message to your new bot.
3. Open `https://api.telegram.org/bot<your token>/getUpdates` in a browser and note the number after `"chat":{"id":`. That is your **chat id**.

## 2. Create the workflow in n8n
n8n Cloud: sign up at https://n8n.io (it has a free trial; check the current plan limits). Then **Create workflow** and name it `POC alerts`.

1. **Webhook node**
   - HTTP Method `POST`, Path `poc-events`.
   - Authentication: **Header Auth**. Create a credential with **Name** `X-Webhook-Secret` and **Value** a new random string (PowerShell: `$b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); [Convert]::ToBase64String($b)`). Keep this value for step 3.
   - Respond: **Immediately**.
   - Copy the **Production URL** (not the Test URL). It only works once the workflow is Active.
2. **Switch node** after it: Mode **Rules**, Value `{{ $json.body.type }}`. Add six outputs where the value equals `missed_call`, `escalated`, `booked`, `opted_out`, `error` and `daily_summary`.
3. One **Telegram → Send Message** node per output. Create a Telegram credential with your bot token, and set Chat ID to your chat id. Text for each:
   - missed_call: `📞 Missed call picked up for {{ $json.body.business_name }}. First message scheduled.`
   - escalated: `⚠️ {{ $json.body.business_name }}: a customer needs a person ({{ $json.body.detail }}).`
   - booked: `✅ Booking made for {{ $json.body.business_name }} at {{ $json.body.detail }} (UTC).`
   - opted_out: `🚫 A customer opted out of messages ({{ $json.body.business_name }}).`
   - error: `❌ Problem at {{ $json.body.business_name }}: {{ $json.body.reason }}`
   - daily_summary: put a **Code** node (JavaScript, Run Once for All Items) first, then Telegram with text `{{ $json.text }}`:
     ```js
     const b = $input.first().json.body;
     const lines = b.businesses.map(x => `${x.name}: ${x.calls} calls, ${x.bookings} booked, ${x.handed_over} handed over`);
     return [{ json: { text: `📊 Last 24 hours\n${lines.join('\n')}\nFailed automations: ${b.failed_actions}` } }];
     ```
4. Switch the workflow to **Active** (top right).

## 3. Connect the database to n8n
Apply the migration to the hosted database (once): `supabase db push`. Then in the Supabase **SQL Editor** store the address and secret (use your own values; no `<` `>` characters):
```sql
select vault.create_secret('PASTE-THE-PRODUCTION-URL', 'n8n_webhook_url', 'n8n webhook');
select vault.create_secret('PASTE-THE-SECRET', 'n8n_webhook_secret', 'n8n webhook secret');
```
To change a value later: `delete from vault.secrets where name = 'n8n_webhook_url';` then create it again.

## 4. Test it
1. In the SQL Editor run `select public.send_daily_summary();`. Within seconds Telegram shows the summary and n8n lists an execution.
2. Trigger a missed call (`npm run simulate:call ...`). You get "Missed call picked up".
3. Reply STOP from the test phone: "A customer opted out".
4. Check the delivery from the database side:
   ```sql
   select status_code, created from net._http_response order by created desc limit 5;
   ```
   `200` is delivered. `403` means the secret in the Vault differs from n8n's. `404` means the workflow is not Active or you used the Test URL.

## 5. Good to know
- Turning it off: `delete from vault.secrets where name = 'n8n_webhook_url';`. Nothing is sent until it is set again, and the app is never affected.
- If n8n is down, the database simply fails to deliver that message. The app and its logs are unaffected.
- The daily job runs at 08:00 UTC (09:00 in UK summer time). To change it: `select cron.schedule('daily-summary', '0 7 * * *', 'select public.send_daily_summary()');`.
- To add an alert for another step, add its reason code to the trigger in `supabase/migrations/20261117100000_n8n_notifications.sql` (in a new migration, never by editing an applied one) and a branch in the Switch node.
