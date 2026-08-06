-- Keep the committee round deadline on accepted applications until the round
-- ends. This lets students who responded early follow the same countdown and
-- move to the result screen alongside students settled at expiry.

create or replace function public.respond_to_bid_increase(
  p_application_id uuid,
  p_accept boolean
)
returns public.applications
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mode text;
  v_deadline timestamptz;
  v_application public.applications;
begin
  select c.bidding_mode, a.confirmation_deadline
  into v_mode, v_deadline
  from public.applications a
  join public.companies c on c.id = a.company_id
  where a.id = p_application_id
    and a.student_id = (select auth.uid());

  if v_mode is null then
    raise exception 'Application not found.' using errcode = 'P0001';
  end if;
  if v_mode <> 'committee' then
    raise exception 'Stay or Withdraw rounds apply only to committee-controlled bidding.'
      using errcode = 'P0001';
  end if;

  v_application := private.respond_to_bid_increase_committee(
    p_application_id,
    p_accept
  );

  if p_accept and v_deadline is not null then
    update public.applications
    set confirmation_deadline = v_deadline
    where id = v_application.id
      and status = 'confirmed'
    returning * into v_application;
  end if;

  return v_application;
end;
$$;

revoke all on function public.respond_to_bid_increase(uuid, boolean)
from public, anon;
grant execute on function public.respond_to_bid_increase(uuid, boolean)
to authenticated;
