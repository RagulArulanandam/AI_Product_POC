-- Webhook payloads hold phone numbers and message text, so they are kept for 30 days and then
-- emptied (security-privacy.md section 6). The event row stays: it is what makes provider
-- retries idempotent, and it only needs its provider, event id and status for that.

create or replace function public.purge_webhook_payloads()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.webhook_events
     set payload = '{}'::jsonb
   where received_at < now() - interval '30 days'
     and payload <> '{}'::jsonb;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.purge_webhook_payloads() from public, anon, authenticated;

-- cron.schedule with an existing job name updates that job, so re-running is safe.
select cron.schedule('purge-webhook-payloads', '15 3 * * *', 'select public.purge_webhook_payloads()');
