-- Keep direct self-withdrawal and the explicit Withdraw decision equivalent
-- during a committee-controlled bid increase. Both paths must use the same
-- base-bid-plus-increase penalty routine.

create or replace function public.withdraw_application(p_application_id uuid)
returns public.applications
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mode text;
  v_status public.application_status;
begin
  select c.bidding_mode, a.status
  into v_mode, v_status
  from public.applications a
  join public.companies c on c.id = a.company_id
  where a.id = p_application_id
    and a.student_id = (select auth.uid());

  if v_mode is null then
    raise exception 'Application not found.' using errcode = 'P0001';
  end if;

  if v_mode = 'automatic' then
    return private.withdraw_automatic_bid(
      p_application_id,
      (select auth.uid())
    );
  end if;

  if v_status = 'confirmation_required' then
    return private.withdraw_after_bid_increase(
      p_application_id,
      (select auth.uid()),
      'Student self-withdrew during the pending bid decision'
    );
  end if;

  return private.withdraw_application_committee(p_application_id);
end;
$$;

revoke all on function public.withdraw_application(uuid) from public, anon;
grant execute on function public.withdraw_application(uuid) to authenticated;
