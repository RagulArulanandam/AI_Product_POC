-- create_business: atomic onboarding (auth.md section 2, database.md section 10).
-- Creates the business, an owner membership for the caller and a trial subscription.

create or replace function public.create_business(p_name text, p_phone text, p_timezone text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if char_length(v_name) < 1 or char_length(v_name) > 120 then
    raise exception 'invalid_name' using errcode = '22023';
  end if;
  if p_phone is null or p_phone !~ '^\+[1-9][0-9]{6,14}$' then
    raise exception 'invalid_phone' using errcode = '22023';
  end if;
  if p_timezone is null or not exists (select 1 from pg_catalog.pg_timezone_names where name = p_timezone) then
    raise exception 'invalid_timezone' using errcode = '22023';
  end if;
  -- POC: one business per user.
  if exists (select 1 from public.memberships where user_id = v_uid and role = 'owner') then
    raise exception 'already_owner' using errcode = '23505';
  end if;

  insert into public.businesses (name, phone_e164, timezone)
  values (v_name, p_phone, p_timezone)
  returning id into v_id;

  insert into public.memberships (business_id, user_id, role) values (v_id, v_uid, 'owner');
  insert into public.subscriptions (business_id) values (v_id);

  return v_id;
end;
$$;

revoke all on function public.create_business(text, text, text) from public, anon;
grant execute on function public.create_business(text, text, text) to authenticated;
