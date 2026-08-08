-- Automatic companies collect each student's initial bid while registration is
-- open. These pre-bids reserve cohort membership without starting the live
-- inactivity timer. Live bidding remains locked to that registered cohort.

alter function public.apply_to_company(uuid)
rename to register_committee_application;
alter function public.register_committee_application(uuid)
set schema private;

create function public.apply_to_company(p_company_id uuid)
returns public.applications
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.companies
    where id = p_company_id and bidding_mode = 'committee'
  ) then
    raise exception 'This company uses automatic bidding. Place an initial bid to join.'
      using errcode = 'P0001';
  end if;

  return private.register_committee_application(p_company_id);
end;
$$;

create or replace function public.submit_automatic_bid(
  p_company_id uuid,
  p_bid integer
)
returns public.applications
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company public.companies;
  v_profile public.profiles;
  v_application public.applications;
  v_available integer;
  v_now timestamptz := clock_timestamp();
begin
  if p_bid is null or p_bid < 0 then
    raise exception 'Enter a valid whole-number bid.' using errcode = 'P0001';
  end if;

  select * into v_company
  from public.companies
  where id = p_company_id
  for update;

  if v_company.id is null then
    raise exception 'Company not found.' using errcode = 'P0001';
  end if;
  if v_company.bidding_mode <> 'automatic' then
    raise exception 'This company is committee controlled.' using errcode = 'P0001';
  end if;

  if v_company.status = 'registration_open' then
    if p_bid < v_company.minimum_bid then
      raise exception 'Your bid must be at least % points.', v_company.minimum_bid
        using errcode = 'P0001';
    end if;
    if v_company.maximum_bid is not null and p_bid > v_company.maximum_bid then
      raise exception 'Your bid cannot exceed % points.', v_company.maximum_bid
        using errcode = 'P0001';
    end if;

    select * into v_application
    from public.applications
    where student_id = (select auth.uid()) and company_id = p_company_id
    for update;

    if v_application.id is not null
      and v_application.status not in ('withdrawn', 'cancelled', 'not_selected') then
      raise exception 'You have already placed your registration bid for this company.'
        using errcode = 'P0001';
    end if;

    select * into v_profile
    from public.profiles
    where id = (select auth.uid())
    for update;

    if v_profile.id is null or v_profile.role <> 'student'
      or v_profile.account_status <> 'active' then
      raise exception 'Only active students can bid.' using errcode = 'P0001';
    end if;

    v_available := v_profile.initial_points + v_profile.point_adjustments
      - v_profile.reserved_points - v_profile.spent_points;

    if v_available < p_bid then
      raise exception 'You need % points to place this bid, but only % points are available.',
        p_bid, v_available using errcode = 'P0001';
    end if;

    update public.profiles
    set reserved_points = reserved_points + p_bid
    where id = v_profile.id;

    if v_application.id is null then
      insert into public.applications (
        student_id, company_id, initial_bid, accepted_bid, reserved_points,
        withdrawal_charge, bid_response_penalty_percent, status,
        confirmed_at, bid_updated_at
      ) values (
        v_profile.id, v_company.id, p_bid, p_bid, p_bid,
        0, v_company.withdrawal_penalty_percent, 'active_bid', v_now, v_now
      ) returning * into v_application;
    else
      update public.applications
      set initial_bid = p_bid,
          accepted_bid = p_bid,
          reserved_points = p_bid,
          final_points_deducted = 0,
          withdrawal_charge = 0,
          bid_response_penalty_percent = v_company.withdrawal_penalty_percent,
          status = 'active_bid',
          applied_at = v_now,
          bid_updated_at = v_now,
          confirmation_deadline = null,
          confirmed_at = v_now,
          withdrawn_at = null,
          finalized_at = null
      where id = v_application.id
      returning * into v_application;
    end if;

    insert into public.point_transactions (
      student_id, company_id, application_id, type, amount,
      balance_before, balance_after, description, created_by
    ) values (
      v_profile.id, v_company.id, v_application.id, 'reservation',
      p_bid, v_available, v_available - p_bid,
      'Automatic registration bid reserved for ' || v_company.name,
      v_profile.id
    );

    insert into public.notifications (user_id, title, message, kind, action_url)
    values (
      v_profile.id,
      'Registration bid placed for ' || v_company.name,
      'Your ' || p_bid || '-point bid registered your place. You can withdraw without a charge until live bidding starts.',
      'success',
      '/student/companies/' || v_company.slug
    );

    insert into public.audit_logs (
      actor_id, actor_role, action, entity_type, entity_id, new_value
    ) values (
      v_profile.id, v_profile.role, 'automatic_bid.pre_registered',
      'application', v_application.id,
      jsonb_build_object(
        'company_id', v_company.id,
        'bid', p_bid,
        'live_timer_started', false
      )
    );

    return v_application;
  end if;

  if v_company.status <> 'open' then
    raise exception 'This automatic auction is not active.' using errcode = 'P0001';
  end if;

  select * into v_application
  from public.applications
  where student_id = (select auth.uid()) and company_id = p_company_id
  for update;

  if v_application.id is null
    or v_application.status not in ('active_bid', 'confirmed') then
    raise exception 'This bidding session is locked. Only students who placed a bid before bidding started can participate.'
      using errcode = 'P0001';
  end if;

  return private.submit_automatic_bid_registered_cohort(p_company_id, p_bid);
end;
$$;

-- Keep the displayed highest pre-bid synchronized when a student registers,
-- withdraws for free, or registers again before live bidding starts.
create or replace function private.recompute_automatic_registration_bid()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.companies c
  set current_bid = greatest(
    c.minimum_bid,
    coalesce((
      select max(a.accepted_bid)
      from public.applications a
      where a.company_id = new.company_id
        and a.status in ('active_bid', 'confirmed')
    ), c.minimum_bid)
  )
  where c.id = new.company_id
    and c.bidding_mode = 'automatic'
    and c.status = 'registration_open';

  return null;
end;
$$;

drop trigger if exists applications_recompute_automatic_registration_bid
on public.applications;
create trigger applications_recompute_automatic_registration_bid
after insert or update of status, accepted_bid on public.applications
for each row
execute function private.recompute_automatic_registration_bid();

update public.companies c
set current_bid = greatest(
  c.minimum_bid,
  coalesce((
    select max(a.accepted_bid)
    from public.applications a
    where a.company_id = c.id
      and a.status in ('active_bid', 'confirmed')
  ), c.minimum_bid)
)
where c.bidding_mode = 'automatic'
  and c.status = 'registration_open';

revoke all on function private.register_committee_application(uuid)
from public, anon, authenticated;
revoke all on function private.recompute_automatic_registration_bid()
from public, anon, authenticated;
revoke all on function public.apply_to_company(uuid) from public, anon;
revoke all on function public.submit_automatic_bid(uuid, integer) from public, anon;

grant execute on function public.apply_to_company(uuid) to authenticated;
grant execute on function public.submit_automatic_bid(uuid, integer)
to authenticated;

update public.system_settings
set value = 'true',
    description = 'Students join committee companies at the opening bid or place an automatic initial bid during registration; the cohort locks when live bidding starts.',
    updated_at = now()
where key = 'pre_bidding_registration';
