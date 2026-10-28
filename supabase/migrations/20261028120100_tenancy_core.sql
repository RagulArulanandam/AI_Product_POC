-- Tenancy core: businesses, memberships, platform_admins (entities.md, database.md section 5).

create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  phone_e164 text not null check (phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  timezone text not null default 'Europe/London',
  business_hours jsonb not null default '{
    "mon": {"open": "09:00", "close": "17:00"},
    "tue": {"open": "09:00", "close": "17:00"},
    "wed": {"open": "09:00", "close": "17:00"},
    "thu": {"open": "09:00", "close": "17:00"},
    "fri": {"open": "09:00", "close": "17:00"},
    "sat": null,
    "sun": null
  }'::jsonb,
  status text not null default 'active' check (status in ('active', 'disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index businesses_status_idx on public.businesses (status);

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'staff')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, user_id)
);
create index memberships_user_id_idx on public.memberships (user_id);

create table public.platform_admins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger businesses_set_updated_at before update on public.businesses
  for each row execute function public.set_updated_at();
create trigger memberships_set_updated_at before update on public.memberships
  for each row execute function public.set_updated_at();
create trigger platform_admins_set_updated_at before update on public.platform_admins
  for each row execute function public.set_updated_at();

-- Helpers. SECURITY DEFINER so policy checks on memberships do not recurse into RLS.
create or replace function public.is_member(b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.memberships m
    where m.business_id = b and m.user_id = auth.uid()
  );
$$;

-- Single DB-side place to restrict writes by role once staff permissions are decided.
create or replace function public.can_write(b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_member(b);
$$;

revoke all on function public.is_member(uuid) from public, anon;
revoke all on function public.can_write(uuid) from public, anon;
grant execute on function public.is_member(uuid) to authenticated;
grant execute on function public.can_write(uuid) to authenticated;

-- RLS
alter table public.businesses enable row level security;
alter table public.memberships enable row level security;
alter table public.platform_admins enable row level security;

create policy businesses_select on public.businesses
  for select to authenticated using (public.is_member(id));
create policy businesses_update on public.businesses
  for update to authenticated
  using (public.can_write(id)) with check (public.can_write(id));

create policy memberships_select on public.memberships
  for select to authenticated using (public.is_member(business_id));

-- platform_admins: RLS on, no policies, so only the service role can touch it.

-- Grants (default-deny). Tenants may edit profile fields but never `status`.
revoke all on public.businesses, public.memberships, public.platform_admins from anon, authenticated;
grant select on public.businesses to authenticated;
grant update (name, phone_e164, timezone, business_hours) on public.businesses to authenticated;
grant select on public.memberships to authenticated;
