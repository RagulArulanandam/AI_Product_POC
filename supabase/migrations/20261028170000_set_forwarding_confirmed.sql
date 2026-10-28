-- Lets a business member record that they have set up call forwarding to their assistant number.
--
-- Tenants have no write access to `integrations` (it also holds connection state the platform
-- controls), so this narrow SECURITY DEFINER function is their only way to touch the telephony
-- row, and it can only set one flag. The caller must be able to write for the business, and
-- confirming needs a phone number to have been assigned (by an admin or the seed).

create or replace function public.set_forwarding_confirmed(p_business uuid, p_confirmed boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_write(p_business) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_confirmed and not exists (select 1 from public.phone_numbers where business_id = p_business) then
    raise exception 'no_number' using errcode = '22023';
  end if;

  insert into public.integrations (business_id, provider, status, metadata)
  values (
    p_business,
    'telephony',
    case when p_confirmed then 'connected' else 'disconnected' end,
    jsonb_build_object('forwarding_confirmed', p_confirmed)
  )
  on conflict (business_id, provider) do update
    set status = excluded.status,
        metadata = public.integrations.metadata || excluded.metadata;
end;
$$;

revoke all on function public.set_forwarding_confirmed(uuid, boolean) from public, anon;
grant execute on function public.set_forwarding_confirmed(uuid, boolean) to authenticated;
