-- Let the affected student settle an expired manual response immediately. The
-- scheduled worker may win the race, so recognize its audited withdrawal as a
-- successful, idempotent result.

create or replace function public.force_withdraw_expired_bid_response(
  p_application_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_application public.applications;
  v_company public.companies;
begin
  select a.* into v_application
  from public.applications a
  where a.id = p_application_id
    and a.student_id = (select auth.uid())
  for update;

  if v_application.id is null then
    raise exception 'Application not found.' using errcode = 'P0001';
  end if;

  select * into v_company
  from public.companies
  where id = v_application.company_id;

  if v_company.bidding_mode <> 'committee' then
    raise exception 'Only manual bid responses use this timeout.' using errcode = 'P0001';
  end if;

  if v_application.status = 'confirmation_required' then
    if v_application.confirmation_deadline is null
      or clock_timestamp() < v_application.confirmation_deadline then
      raise exception 'The response deadline has not expired.' using errcode = 'P0001';
    end if;

    perform private.withdraw_after_bid_increase(
      v_application.id,
      null,
      'Company bid response timeout expired'
    );
    return true;
  end if;

  -- The cron worker may have completed the same forced withdrawal milliseconds
  -- earlier. Only accept that specific audited outcome as idempotent success.
  return v_application.status = 'withdrawn' and exists (
    select 1
    from public.audit_logs l
    where l.entity_type = 'application'
      and l.entity_id = v_application.id
      and l.action = 'bid_increase.withdrawn'
      and l.actor_id is null
      and l.reason = 'Company bid response timeout expired'
  );
end;
$$;

revoke all on function public.force_withdraw_expired_bid_response(uuid)
from public, anon;
grant execute on function public.force_withdraw_expired_bid_response(uuid)
to authenticated;
