-- Products, per-business enablement and config, manual subscriptions, integrations and their
-- secrets (entities.md, database.md sections 4-6).

create table public.products (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null,
  description text not null default '',
  status text not null default 'available' check (status in ('available', 'coming_soon')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Seeded from the code registry (src/products/registry.ts); a test keeps the two in sync.
insert into public.products (key, name, description, status) values
  ('missed-call', 'Missed Call to WhatsApp Assistant',
   'Texts customers on WhatsApp after a missed call, answers questions and books appointments.', 'available'),
  ('priority-inbox', 'Priority Inbox',
   'Sorts incoming email by importance and drafts replies.', 'coming_soon'),
  ('daily-brief', 'Daily Brief',
   'A short daily summary of what needs your attention.', 'coming_soon')
on conflict (key) do update
  set name = excluded.name, description = excluded.description, status = excluded.status;

create table public.business_products (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete restrict,
  enabled boolean not null default false,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, product_id)
);

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null unique references public.businesses (id) on delete cascade,
  plan text not null default 'trial',
  status text not null default 'trial' check (status in ('trial', 'active', 'past_due', 'cancelled')),
  current_period_end timestamptz,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.integrations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  provider text not null check (provider in ('google_calendar', 'telephony')),
  status text not null default 'disconnected' check (status in ('connected', 'disconnected', 'error')),
  account_label text,
  metadata jsonb not null default '{}'::jsonb,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, provider)
);

-- Encrypted provider tokens (security-privacy.md section 3). Tenants have no access at all.
create table public.integration_secrets (
  id uuid primary key default gen_random_uuid(),
  integration_id uuid not null unique references public.integrations (id) on delete cascade,
  business_id uuid not null references public.businesses (id) on delete cascade,
  ciphertext text not null,
  key_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index integration_secrets_business_id_idx on public.integration_secrets (business_id);

create trigger products_set_updated_at before update on public.products
  for each row execute function public.set_updated_at();
create trigger business_products_set_updated_at before update on public.business_products
  for each row execute function public.set_updated_at();
create trigger subscriptions_set_updated_at before update on public.subscriptions
  for each row execute function public.set_updated_at();
create trigger integrations_set_updated_at before update on public.integrations
  for each row execute function public.set_updated_at();
create trigger integration_secrets_set_updated_at before update on public.integration_secrets
  for each row execute function public.set_updated_at();

-- Enabling a product needs an active business, a trial or active subscription and an
-- available product. The service role (admin override) bypasses RLS and this check.
create or replace function public.can_enable_product(b uuid, p uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.businesses bu
      join public.subscriptions s on s.business_id = bu.id
      join public.products pr on pr.id = p
     where bu.id = b
       and bu.status = 'active'
       and s.status in ('trial', 'active')
       and pr.status = 'available'
  );
$$;

revoke all on function public.can_enable_product(uuid, uuid) from public, anon;
grant execute on function public.can_enable_product(uuid, uuid) to authenticated;

-- RLS
alter table public.products enable row level security;
alter table public.business_products enable row level security;
alter table public.subscriptions enable row level security;
alter table public.integrations enable row level security;
alter table public.integration_secrets enable row level security;

create policy products_select on public.products
  for select to authenticated using (true);

create policy business_products_select on public.business_products
  for select to authenticated using (public.is_member(business_id));
create policy business_products_insert on public.business_products
  for insert to authenticated
  with check (
    public.can_write(business_id)
    and (not enabled or public.can_enable_product(business_id, product_id))
  );
create policy business_products_update on public.business_products
  for update to authenticated
  using (public.can_write(business_id))
  with check (
    public.can_write(business_id)
    and (not enabled or public.can_enable_product(business_id, product_id))
  );

create policy subscriptions_select on public.subscriptions
  for select to authenticated using (public.is_member(business_id));

create policy integrations_select on public.integrations
  for select to authenticated using (public.is_member(business_id));

-- integration_secrets: RLS on, no policies, no grants.

-- Grants (default-deny)
revoke all on public.products, public.business_products, public.subscriptions,
  public.integrations, public.integration_secrets from anon, authenticated;
grant select on public.products to authenticated;
grant select on public.business_products to authenticated;
grant insert (business_id, product_id, enabled, config) on public.business_products to authenticated;
grant update (enabled, config) on public.business_products to authenticated;
grant select on public.subscriptions to authenticated;
grant select on public.integrations to authenticated;
