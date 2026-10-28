-- Maps a Twilio number to exactly one business (entities.md, integrations.md "Number mapping").
-- Written by admins and the seed script (service role). Members can read their own numbers.

create table public.phone_numbers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  e164 text not null unique check (e164 ~ '^\+[1-9][0-9]{6,14}$'),
  kind text not null default 'voice' check (kind in ('voice')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index phone_numbers_business_idx on public.phone_numbers (business_id);

create trigger phone_numbers_set_updated_at before update on public.phone_numbers
  for each row execute function public.set_updated_at();

alter table public.phone_numbers enable row level security;

create policy phone_numbers_select on public.phone_numbers
  for select to authenticated using (public.is_member(business_id));

revoke all on public.phone_numbers from anon, authenticated;
grant select on public.phone_numbers to authenticated;
