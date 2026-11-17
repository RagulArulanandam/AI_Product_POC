-- Tells n8n about key events and sends it a daily summary (docs/n8n-hostinger-plan.md).
-- The n8n webhook address and secret are NOT in this file. They live in Supabase Vault under
-- `n8n_webhook_url` and `n8n_webhook_secret`, like the worker settings, so no secret is committed.
-- Until they exist nothing is sent. Messages carry names and counts only: no phone numbers,
-- message text or tokens.

create or replace function public.notify_n8n(payload jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'n8n_webhook_url' limit 1;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'n8n_webhook_secret' limit 1;

  -- Not configured: do nothing rather than fail.
  if coalesce(v_url, '') = '' then
    return;
  end if;

  perform net.http_post(
    url := v_url,
    body := payload,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Webhook-Secret', coalesce(v_secret, '')
    ),
    timeout_milliseconds := 10000
  );
exception when others then
  -- A notification problem must never block the write that triggered it.
  raise warning 'notify_n8n failed: %', sqlerrm;
end;
$$;

revoke all on function public.notify_n8n(jsonb) from public, anon, authenticated;

-- One automation log row in, at most one message out.
create or replace function public.automation_logs_notify_n8n()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_kind text;
begin
  v_kind := case new.reason
    when 'first_message_scheduled' then 'missed_call'
    when 'escalated' then 'escalated'
    when 'booking_created' then 'booked'
    when 'opted_out' then 'opted_out'
    else 'error'
  end;

  select name into v_name from public.businesses where id = new.business_id;

  perform public.notify_n8n(jsonb_build_object(
    'type', v_kind,
    'business_id', new.business_id,
    'business_name', v_name,
    'conversation_id', new.conversation_id,
    'reason', new.reason,
    'status', new.status,
    'detail', case new.reason
      when 'escalated' then new.details ->> 'reason'
      when 'booking_created' then new.details ->> 'start'
      else null
    end,
    'at', new.created_at
  ));
  return new;
end;
$$;

revoke all on function public.automation_logs_notify_n8n() from public, anon, authenticated;

drop trigger if exists automation_logs_notify_n8n on public.automation_logs;
create trigger automation_logs_notify_n8n
  after insert on public.automation_logs
  for each row
  when (new.status = 'error' or new.reason in ('first_message_scheduled', 'escalated', 'booking_created', 'opted_out'))
  execute function public.automation_logs_notify_n8n();

-- Last 24 hours across every business, sent once a day.
create or replace function public.send_daily_summary()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_since timestamptz := now() - interval '24 hours';
  v_businesses jsonb;
begin
  select coalesce(jsonb_agg(to_jsonb(t) order by t.name), '[]'::jsonb) into v_businesses
  from (
    select b.name,
           count(c.id) as calls,
           count(c.id) filter (where c.state = 'booked') as bookings,
           count(c.id) filter (where c.escalation_reason is not null) as handed_over
    from public.businesses b
    left join public.conversations c on c.business_id = b.id and c.started_at >= v_since
    group by b.id, b.name
  ) t;

  perform public.notify_n8n(jsonb_build_object(
    'type', 'daily_summary',
    'since', v_since,
    'failed_actions', (select count(*) from public.scheduled_actions where status = 'failed'),
    'businesses', v_businesses
  ));
end;
$$;

revoke all on function public.send_daily_summary() from public, anon, authenticated;

-- 08:00 UTC every day. cron.schedule with an existing job name updates it, so re-running is safe.
select cron.schedule('daily-summary', '0 8 * * *', 'select public.send_daily_summary()');
