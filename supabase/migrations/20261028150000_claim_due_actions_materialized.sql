-- Fix for claim_due_actions (migration 20261028130000).
--
-- The first version used `UPDATE ... WHERE id IN (SELECT ... LIMIT n FOR UPDATE SKIP LOCKED)`.
-- Postgres may execute that subselect more than once, so one call could lock and return more
-- than `batch` rows (seen as 2 rows for batch = 1). The extra row was never run and sat in
-- `processing` until the stale-lock timeout.
--
-- Picking the rows in a MATERIALIZED CTE runs the SKIP LOCKED selection exactly once.

create or replace function public.claim_due_actions(batch integer default 1)
returns setof public.scheduled_actions
language plpgsql
security invoker
set search_path = public
as $$
begin
  -- Rows left `processing` by a crashed worker with no attempts left are failed.
  update public.scheduled_actions
     set status = 'failed',
         last_error = coalesce(last_error, 'worker stopped before finishing (no attempts left)')
   where status = 'processing'
     and locked_at < now() - interval '5 minutes'
     and attempts >= max_attempts;

  return query
  with picked as materialized (
    select a.id
      from public.scheduled_actions a
     where a.run_at <= now()
       and a.attempts < a.max_attempts
       and (a.status = 'pending'
            or (a.status = 'processing' and a.locked_at < now() - interval '5 minutes'))
       -- a conversation never has two actions processing at once
       and not exists (
         select 1 from public.scheduled_actions p
          where p.conversation_id = a.conversation_id
            and p.status = 'processing'
            and p.locked_at >= now() - interval '5 minutes'
            and p.id <> a.id)
     order by a.run_at
     limit batch
     for update skip locked
  )
  update public.scheduled_actions s
     set status = 'processing', locked_at = now(), attempts = s.attempts + 1
    from picked
   where s.id = picked.id
  returning s.*;
end;
$$;

revoke all on function public.claim_due_actions(integer) from public, anon, authenticated;
grant execute on function public.claim_due_actions(integer) to service_role;
