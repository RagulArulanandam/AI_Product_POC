-- Calls the worker endpoint every minute (database.md section 9, automation-engine.md section 9).
-- The URL and secret are NOT in this file. They live in Supabase Vault under the names
-- `worker_url` and `worker_secret`, set by scripts/configure-cron.ts locally (and by hand when
-- hosted), so no secret ever lives in a migration.

create or replace function public.call_worker()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'worker_url' limit 1;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'worker_secret' limit 1;

  -- Not configured yet (for example right after a reset): do nothing rather than fail.
  if coalesce(v_url, '') = '' or coalesce(v_secret, '') = '' then
    return;
  end if;

  perform net.http_post(
    url := v_url,
    body := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_secret
    ),
    timeout_milliseconds := 55000
  );
end;
$$;

revoke all on function public.call_worker() from public, anon, authenticated;

-- cron.schedule with an existing job name updates that job, so re-running is safe.
select cron.schedule('worker-tick', '* * * * *', 'select public.call_worker()');
