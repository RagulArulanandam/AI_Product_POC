-- Automation engine tables (entities.md, database.md sections 4-8).
-- Tenants may read customers, conversations, messages and automation_logs of their own business.
-- Everything else is written and read by the service role only.

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  phone_e164 text not null check (phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  name text,
  last_contacted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, phone_e164)
);
create index customers_phone_idx on public.customers (phone_e164);

-- Platform-wide STOP list, keyed by phone because the WhatsApp sender is shared.
create table public.opt_outs (
  id uuid primary key default gen_random_uuid(),
  phone_e164 text not null unique check (phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  source_business_id uuid references public.businesses (id) on delete set null,
  opted_out_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  customer_id uuid not null references public.customers (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete restrict,
  state text not null default 'pending_send' check (state in (
    'pending_send', 'awaiting_reply', 'in_conversation', 'offering_slots', 'booked',
    'enquiry_logged', 'escalated', 'opted_out', 'expired', 'failed'
  )),
  trigger_call_sid text,
  started_at timestamptz not null default now(),
  last_inbound_at timestamptz,
  last_outbound_at timestamptz,
  expires_at timestamptz,
  turn_count integer not null default 0 check (turn_count >= 0),
  last_intent text,
  escalation_reason text,
  escalated_at timestamptz,
  offered_slots jsonb not null default '[]'::jsonb,
  booking_event_id text,
  booking_start timestamptz,
  booking_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, trigger_call_sid)
);
create index conversations_business_started_idx on public.conversations (business_id, started_at desc);
create index conversations_customer_started_idx on public.conversations (customer_id, started_at desc);
create index conversations_business_state_idx on public.conversations (business_id, state);
create index conversations_open_by_customer_idx on public.conversations (customer_id)
  where state in ('pending_send', 'awaiting_reply', 'in_conversation', 'offering_slots');

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  direction text not null check (direction in ('inbound', 'outbound')),
  sender text not null check (sender in ('customer', 'ai', 'system')),
  body text not null default '',
  provider_sid text,
  status text not null check (status in ('received', 'queued', 'sent', 'delivered', 'failed')),
  intent text,
  confidence numeric check (confidence is null or (confidence >= 0 and confidence <= 1)),
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Inbound idempotency (acceptance criterion 4): one stored message per provider SID.
create unique index messages_provider_sid_key on public.messages (provider_sid) where provider_sid is not null;
create index messages_conversation_created_idx on public.messages (conversation_id, created_at);
create index messages_business_created_idx on public.messages (business_id, created_at desc);

create table public.scheduled_actions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  conversation_id uuid references public.conversations (id) on delete cascade,
  type text not null check (char_length(type) > 0),
  payload jsonb not null default '{}'::jsonb,
  run_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending', 'processing', 'done', 'failed', 'cancelled')),
  attempts integer not null default 0,
  max_attempts integer not null default 3 check (max_attempts > 0),
  last_error text,
  locked_at timestamptz,
  dedupe_key text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (attempts <= max_attempts)
);
create index scheduled_actions_due_idx on public.scheduled_actions (run_at) where status = 'pending';
create index scheduled_actions_stale_idx on public.scheduled_actions (locked_at) where status = 'processing';
create index scheduled_actions_business_status_idx on public.scheduled_actions (business_id, status);
create index scheduled_actions_conversation_idx on public.scheduled_actions (conversation_id);

create table public.automation_logs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  conversation_id uuid references public.conversations (id) on delete cascade,
  scheduled_action_id uuid references public.scheduled_actions (id) on delete set null,
  event_type text not null,
  step text not null check (step in ('event', 'condition', 'ai', 'action', 'system')),
  status text not null check (status in ('ok', 'skipped', 'error')),
  reason text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index automation_logs_business_created_idx on public.automation_logs (business_id, created_at desc);
create index automation_logs_action_idx on public.automation_logs (scheduled_action_id);
create index automation_logs_errors_idx on public.automation_logs (created_at desc) where status = 'error';

-- Only events with a valid signature are stored (security-privacy.md section 4).
create table public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_event_id text not null,
  business_id uuid references public.businesses (id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'received' check (status in ('received', 'processed', 'skipped', 'failed')),
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_event_id)
);
create index webhook_events_business_idx on public.webhook_events (business_id);
create index webhook_events_failed_idx on public.webhook_events (received_at) where status = 'failed';

create trigger customers_set_updated_at before update on public.customers
  for each row execute function public.set_updated_at();
create trigger opt_outs_set_updated_at before update on public.opt_outs
  for each row execute function public.set_updated_at();
create trigger conversations_set_updated_at before update on public.conversations
  for each row execute function public.set_updated_at();
create trigger messages_set_updated_at before update on public.messages
  for each row execute function public.set_updated_at();
create trigger scheduled_actions_set_updated_at before update on public.scheduled_actions
  for each row execute function public.set_updated_at();
create trigger automation_logs_set_updated_at before update on public.automation_logs
  for each row execute function public.set_updated_at();
create trigger webhook_events_set_updated_at before update on public.webhook_events
  for each row execute function public.set_updated_at();

-- RLS: on everywhere; policies only where tenants may read.
alter table public.customers enable row level security;
alter table public.opt_outs enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.scheduled_actions enable row level security;
alter table public.automation_logs enable row level security;
alter table public.webhook_events enable row level security;

create policy customers_select on public.customers
  for select to authenticated using (public.is_member(business_id));
create policy conversations_select on public.conversations
  for select to authenticated using (public.is_member(business_id));
create policy messages_select on public.messages
  for select to authenticated using (public.is_member(business_id));
create policy automation_logs_select on public.automation_logs
  for select to authenticated using (public.is_member(business_id));
-- opt_outs, scheduled_actions, webhook_events: no policies, service role only.

revoke all on public.customers, public.opt_outs, public.conversations, public.messages,
  public.scheduled_actions, public.automation_logs, public.webhook_events from anon, authenticated;
grant select on public.customers, public.conversations, public.messages, public.automation_logs to authenticated;

-- Queue claim (database.md section 8). Service role only.
-- 1. Rows left `processing` by a crashed worker that have no attempts left are failed.
-- 2. Then up to `batch` due rows are locked and returned. A conversation never has two
--    actions processing at once, and stale rows are reclaimed (consuming an attempt).
create or replace function public.claim_due_actions(batch integer default 1)
returns setof public.scheduled_actions
language plpgsql
security invoker
set search_path = public
as $$
begin
  update public.scheduled_actions
     set status = 'failed',
         last_error = coalesce(last_error, 'worker stopped before finishing (no attempts left)')
   where status = 'processing'
     and locked_at < now() - interval '5 minutes'
     and attempts >= max_attempts;

  return query
  update public.scheduled_actions s
     set status = 'processing', locked_at = now(), attempts = s.attempts + 1
   where s.id in (
     select a.id from public.scheduled_actions a
      where a.run_at <= now()
        and a.attempts < a.max_attempts
        and (a.status = 'pending'
             or (a.status = 'processing' and a.locked_at < now() - interval '5 minutes'))
        and not exists (
          select 1 from public.scheduled_actions p
           where p.conversation_id = a.conversation_id
             and p.status = 'processing'
             and p.locked_at >= now() - interval '5 minutes'
             and p.id <> a.id)
      order by a.run_at
      limit batch
      for update skip locked)
  returning s.*;
end;
$$;

revoke all on function public.claim_due_actions(integer) from public, anon, authenticated;
grant execute on function public.claim_due_actions(integer) to service_role;
