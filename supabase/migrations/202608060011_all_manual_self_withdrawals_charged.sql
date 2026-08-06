-- Charge every manual self-withdrawal using the same rule as a pending
-- Withdraw decision: initial bid plus the configured percentage of increases.

create or replace function private.withdraw_committee_application_charged(
  p_application_id uuid,
  p_actor uuid
)
returns public.applications
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company public.companies;
  v_application public.applications;
  v_profile public.profiles;
  v_available integer;
  v_release integer;
  v_calculated_charge integer;
  v_charge integer;
  v_was_pending boolean;
begin
  select c.* into v_company
  from public.applications a
  join public.companies c on c.id = a.company_id
  where a.id = p_application_id
  for update of c;

  select * into v_application
  from public.applications
  where id = p_application_id and student_id = p_actor
  for update;

  if v_application.id is null or v_company.id is null then
    raise exception 'Application not found.' using errcode = 'P0001';
  end if;
  if v_company.bidding_mode <> 'committee'
    or v_company.status in ('finalized', 'cancelled')
    or v_application.status not in (
      'active_bid', 'confirmed', 'confirmation_required'
    ) then
    raise exception 'This manual application can no longer be withdrawn.'
      using errcode = 'P0001';
  end if;

  v_was_pending := v_application.status = 'confirmation_required';

  select * into v_profile
  from public.profiles
  where id = v_application.student_id
  for update;

  v_available := v_profile.initial_points + v_profile.point_adjustments
    - v_profile.reserved_points - v_profile.spent_points;
  v_release := v_application.reserved_points;
  v_calculated_charge := v_application.initial_bid + ceil(
    greatest(v_company.current_bid - v_application.initial_bid, 0)
      * coalesce(
          v_application.bid_response_penalty_percent,
          v_company.withdrawal_penalty_percent
        ) / 100.0
  )::integer;
  v_charge := least(v_calculated_charge, v_available + v_release);

  update public.profiles
  set reserved_points = reserved_points - v_release,
      spent_points = spent_points + v_charge
  where id = v_profile.id;

  update public.applications
  set status = 'withdrawn', reserved_points = 0,
      withdrawal_charge = v_charge, withdrawn_at = now(),
      confirmation_deadline = null
  where id = v_application.id
  returning * into v_application;

  if v_release > 0 then
    insert into public.point_transactions (
      student_id, company_id, application_id, type, amount,
      balance_before, balance_after, description, created_by
    ) values (
      v_profile.id, v_company.id, v_application.id, 'release', -v_release,
      v_available, v_available + v_release,
      'Manual bid reservation released for ' || v_company.name, p_actor
    );
  end if;

  if v_charge > 0 then
    insert into public.point_transactions (
      student_id, company_id, application_id, type, amount,
      balance_before, balance_after, description, created_by
    ) values (
      v_profile.id, v_company.id, v_application.id, 'spend', v_charge,
      v_available + v_release, v_available + v_release - v_charge,
      'Manual bidding withdrawal charge for ' || v_company.name,
      p_actor
    );
  end if;

  insert into public.notifications (user_id, title, message, kind, action_url)
  values (
    v_profile.id,
    'Manual application withdrawn',
    'You left ' || v_company.name || '. A ' || v_charge ||
      '-point withdrawal charge was applied.',
    'warning',
    '/student/activity'
  );

  insert into public.audit_logs (
    actor_id, actor_role, action, entity_type, entity_id, new_value, reason
  ) values (
    p_actor, v_profile.role, 'application.withdrawn_with_charge',
    'application', v_application.id,
    jsonb_build_object(
      'company_id', v_company.id,
      'initial_bid', v_application.initial_bid,
      'current_bid', v_company.current_bid,
      'penalty_percent', coalesce(
        v_application.bid_response_penalty_percent,
        v_company.withdrawal_penalty_percent
      ),
      'calculated_charge', v_calculated_charge,
      'applied_charge', v_charge,
      'charge_capped', v_charge < v_calculated_charge,
      'decision_was_pending', v_was_pending
    ),
    'Student self-withdrew from manual bidding'
  );

  if v_was_pending and not exists (
    select 1 from public.applications
    where company_id = v_company.id and status = 'confirmation_required'
  ) then
    update public.companies
    set status = 'open'
    where id = v_company.id and status = 'bid_increase_pending';

    update public.bid_history
    set applicant_count_after = (
      select count(*) from public.applications
      where company_id = v_company.id and status in ('active_bid', 'confirmed')
    )
    where id = (
      select id from public.bid_history
      where company_id = v_company.id order by created_at desc limit 1
    );
  end if;

  return v_application;
end;
$$;

create or replace function public.withdraw_application(p_application_id uuid)
returns public.applications
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mode text;
begin
  select c.bidding_mode into v_mode
  from public.applications a
  join public.companies c on c.id = a.company_id
  where a.id = p_application_id
    and a.student_id = (select auth.uid());

  if v_mode is null then
    raise exception 'Application not found.' using errcode = 'P0001';
  end if;
  if v_mode = 'automatic' then
    return private.withdraw_automatic_bid(p_application_id, (select auth.uid()));
  end if;
  return private.withdraw_committee_application_charged(
    p_application_id,
    (select auth.uid())
  );
end;
$$;

revoke all on function private.withdraw_committee_application_charged(uuid, uuid)
from public, anon, authenticated;
revoke all on function public.withdraw_application(uuid) from public, anon;
grant execute on function public.withdraw_application(uuid) to authenticated;
