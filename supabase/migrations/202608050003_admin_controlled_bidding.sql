-- Restore administrator-controlled bidding with explicit student responses.

alter table public.applications
add column if not exists bid_updated_at timestamptz;

update public.applications
set bid_updated_at = coalesce(updated_at, applied_at, now())
where bid_updated_at is null;

alter table public.applications
alter column bid_updated_at set default now(),
alter column bid_updated_at set not null;

alter table public.companies
add column if not exists withdrawal_penalty_percent integer not null default 10
  check (withdrawal_penalty_percent between 0 and 100);

alter table public.companies
alter column maximum_bid drop not null;

alter table public.applications
add column if not exists withdrawal_charge integer not null default 0
  check (withdrawal_charge >= 0);

alter table public.applications
add column if not exists bid_response_penalty_percent integer
  check (bid_response_penalty_percent between 0 and 100);

create or replace function private.recompute_company_counts(target_company uuid)
returns void
language plpgsql
security definer set search_path = ''
as $$
begin
  update public.companies c
  set
    applicant_count = (
      select count(*) from public.applications a
      where a.company_id = target_company
        and a.status in ('active_bid', 'confirmation_required', 'confirmed', 'selected', 'finalized')
    ),
    confirmed_count = (
      select count(*) from public.applications a
      where a.company_id = target_company
        and a.status in ('active_bid', 'confirmed', 'selected', 'finalized')
    ),
    pending_count = (
      select count(*) from public.applications a
      where a.company_id = target_company and a.status = 'confirmation_required'
    ),
    withdrawal_count = (
      select count(*) from public.applications a
      where a.company_id = target_company and a.status = 'withdrawn'
    )
  where c.id = target_company;
end;
$$;

-- If student-controlled bidding was briefly enabled, require everyone below
-- the current company bid to make an explicit stay/withdraw decision.
update public.applications a
set status = 'confirmation_required',
    confirmation_deadline = now() + make_interval(mins => c.response_duration_minutes)
from public.companies c
where c.id = a.company_id
  and c.status in ('open', 'paused')
  and a.status in ('active_bid', 'confirmed')
  and a.accepted_bid < c.current_bid;

update public.companies c
set status = 'bid_increase_pending'
where c.status in ('open', 'paused')
  and exists (
    select 1 from public.applications a
    where a.company_id = c.id and a.status = 'confirmation_required'
  );

create or replace function public.apply_to_company(p_company_id uuid)
returns public.applications
language plpgsql
security definer set search_path = ''
as $$
declare
  v_profile public.profiles;
  v_company public.companies;
  v_application public.applications;
  v_available integer;
begin
  select * into v_company
  from public.companies
  where id = p_company_id
  for update;

  if v_company.id is null then
    raise exception 'Company not found.' using errcode = 'P0001';
  end if;
  if v_company.status <> 'open' then
    raise exception 'This company is not open for applications.' using errcode = 'P0001';
  end if;
  if v_company.opens_at is not null and now() < v_company.opens_at then
    raise exception 'This bidding session has not opened yet.' using errcode = 'P0001';
  end if;
  if v_company.closes_at is not null and now() >= v_company.closes_at then
    raise exception 'This bidding session has closed.' using errcode = 'P0001';
  end if;

  select * into v_application
  from public.applications
  where student_id = (select auth.uid()) and company_id = p_company_id
  for update;

  if v_application.id is not null
    and v_application.status not in ('withdrawn', 'cancelled', 'not_selected') then
    raise exception 'You already have an application for this company.' using errcode = 'P0001';
  end if;

  select * into v_profile
  from public.profiles
  where id = (select auth.uid())
  for update;

  if v_profile.id is null or v_profile.role <> 'student' or v_profile.account_status <> 'active' then
    raise exception 'Only active students can apply.' using errcode = 'P0001';
  end if;

  v_available := v_profile.initial_points + v_profile.point_adjustments
    - v_profile.reserved_points - v_profile.spent_points;

  if v_available < v_company.current_bid then
    raise exception 'You need % points to apply, but only % points are available.',
      v_company.current_bid, v_available using errcode = 'P0001';
  end if;

  update public.profiles
  set reserved_points = reserved_points + v_company.current_bid
  where id = v_profile.id;

  if v_application.id is null then
    insert into public.applications (
      student_id, company_id, initial_bid, accepted_bid, reserved_points,
      withdrawal_charge, bid_response_penalty_percent, status, confirmed_at, bid_updated_at
    ) values (
      v_profile.id, v_company.id, v_company.current_bid, v_company.current_bid,
      v_company.current_bid, 0, null, 'active_bid', now(), clock_timestamp()
    ) returning * into v_application;
  else
    update public.applications
    set initial_bid = v_company.current_bid,
        accepted_bid = v_company.current_bid,
        reserved_points = v_company.current_bid,
        final_points_deducted = 0,
        withdrawal_charge = 0,
        bid_response_penalty_percent = null,
        status = 'active_bid',
        applied_at = now(),
        bid_updated_at = clock_timestamp(),
        confirmation_deadline = null,
        confirmed_at = now(),
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
    v_company.current_bid, v_available, v_available - v_company.current_bid,
    'Points reserved for ' || v_company.name, v_profile.id
  );

  insert into public.audit_logs (
    actor_id, actor_role, action, entity_type, entity_id, new_value
  ) values (
    v_profile.id, v_profile.role, 'application.created', 'application',
    v_application.id,
    jsonb_build_object('company_id', v_company.id, 'bid', v_company.current_bid)
  );

  return v_application;
end;
$$;

create or replace function private.withdraw_after_bid_increase(
  p_application_id uuid,
  p_actor uuid,
  p_reason text
)
returns public.applications
language plpgsql
security definer set search_path = ''
as $$
declare
  v_company_id uuid;
  v_company public.companies;
  v_application public.applications;
  v_profile public.profiles;
  v_available integer;
  v_calculated_charge integer;
  v_charge integer;
  v_after_release integer;
  v_release integer;
begin
  select company_id into v_company_id
  from public.applications
  where id = p_application_id;

  if v_company_id is null then
    raise exception 'Application not found.' using errcode = 'P0001';
  end if;

  select * into v_company
  from public.companies
  where id = v_company_id
  for update;

  select * into v_application
  from public.applications
  where id = p_application_id
  for update;

  if v_application.status <> 'confirmation_required' then
    raise exception 'No bid response is pending for this application.' using errcode = 'P0001';
  end if;

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
  v_after_release := v_available + v_release;

  update public.profiles
  set reserved_points = reserved_points - v_release,
      spent_points = spent_points + v_charge
  where id = v_profile.id;

  update public.applications
  set status = 'withdrawn',
      reserved_points = 0,
      withdrawal_charge = v_charge,
      withdrawn_at = now(),
      confirmation_deadline = null
  where id = v_application.id
  returning * into v_application;

  if v_release > 0 then
    insert into public.point_transactions (
      student_id, company_id, application_id, type, amount,
      balance_before, balance_after, description, created_by
    ) values (
      v_profile.id, v_company.id, v_application.id, 'release',
      -v_release, v_available, v_after_release,
      'Previous bid reservation released for ' || v_company.name, p_actor
    );
  end if;

  if v_charge > 0 then
    insert into public.point_transactions (
      student_id, company_id, application_id, type, amount,
      balance_before, balance_after, description, created_by
    ) values (
      v_profile.id, v_company.id, v_application.id, 'spend',
      v_charge, v_after_release, v_after_release - v_charge,
      'Withdrawal charge for ' || v_company.name || ': base bid plus ' ||
        coalesce(
          v_application.bid_response_penalty_percent,
          v_company.withdrawal_penalty_percent
        ) || '% of the bid increase',
      p_actor
    );
  end if;

  insert into public.notifications (user_id, title, message, kind, action_url)
  values (
    v_profile.id,
    case when p_actor is null then 'Bid response expired' else 'Withdrawn after bid increase' end,
    'You left ' || v_company.name || '. A ' || v_charge || '-point withdrawal charge was applied.',
    'warning',
    '/student/activity'
  );

  insert into public.audit_logs (
    actor_id, actor_role, action, entity_type, entity_id, new_value, reason
  ) values (
    p_actor,
    case when p_actor is null then null else v_profile.role end,
    'bid_increase.withdrawn',
    'application',
    v_application.id,
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
      'charge_capped', v_charge < v_calculated_charge
    ),
    nullif(trim(p_reason), '')
  );

  if not exists (
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
security definer set search_path = ''
as $$
declare
  v_company_id uuid;
  v_status public.application_status;
  v_application public.applications;
  v_profile public.profiles;
  v_company public.companies;
  v_available integer;
  v_release integer;
begin
  select company_id, status into v_company_id, v_status
  from public.applications
  where id = p_application_id and student_id = (select auth.uid());

  if v_company_id is null then
    raise exception 'Application not found.' using errcode = 'P0001';
  end if;

  if v_status = 'confirmation_required' then
    return private.withdraw_after_bid_increase(
      p_application_id,
      (select auth.uid()),
      'Student withdrew after the bid increase'
    );
  end if;

  select * into v_company
  from public.companies
  where id = v_company_id
  for update;

  select * into v_application
  from public.applications
  where id = p_application_id and student_id = (select auth.uid())
  for update;

  if v_application.status = 'confirmation_required' then
    return private.withdraw_after_bid_increase(
      p_application_id,
      (select auth.uid()),
      'Student withdrew after the bid increase'
    );
  end if;
  if v_application.status not in ('active_bid', 'confirmed') then
    raise exception 'This application can no longer be withdrawn.' using errcode = 'P0001';
  end if;
  if v_company.status in ('finalized', 'cancelled') then
    raise exception 'This bidding session no longer permits withdrawal.' using errcode = 'P0001';
  end if;

  select * into v_profile
  from public.profiles
  where id = v_application.student_id
  for update;

  v_release := v_application.reserved_points;
  v_available := v_profile.initial_points + v_profile.point_adjustments
    - v_profile.reserved_points - v_profile.spent_points;

  update public.profiles
  set reserved_points = reserved_points - v_release
  where id = v_profile.id;

  update public.applications
  set status = 'withdrawn', reserved_points = 0, withdrawal_charge = 0,
      withdrawn_at = now(), confirmation_deadline = null
  where id = v_application.id
  returning * into v_application;

  if v_release > 0 then
    insert into public.point_transactions (
      student_id, company_id, application_id, type, amount,
      balance_before, balance_after, description, created_by
    ) values (
      v_profile.id, v_company.id, v_application.id, 'release',
      -v_release, v_available, v_available + v_release,
      'Application withdrawn; reserved points released for ' || v_company.name,
      v_profile.id
    );
  end if;

  insert into public.audit_logs (
    actor_id, actor_role, action, entity_type, entity_id, new_value
  ) values (
    v_profile.id, v_profile.role, 'application.withdrawn', 'application',
    v_application.id,
    jsonb_build_object('company_id', v_company.id, 'released_points', v_release)
  );

  return v_application;
end;
$$;

create or replace function public.respond_to_bid_increase(
  p_application_id uuid,
  p_accept boolean
)
returns public.applications
language plpgsql
security definer set search_path = ''
as $$
declare
  v_company_id uuid;
  v_application public.applications;
  v_profile public.profiles;
  v_company public.companies;
  v_available integer;
  v_additional integer;
begin
  select company_id into v_company_id
  from public.applications
  where id = p_application_id and student_id = (select auth.uid());

  if v_company_id is null then
    raise exception 'Application not found.' using errcode = 'P0001';
  end if;

  if not p_accept then
    return private.withdraw_after_bid_increase(
      p_application_id,
      (select auth.uid()),
      'Student chose to withdraw after the bid increase'
    );
  end if;

  select * into v_company
  from public.companies
  where id = v_company_id
  for update;

  select * into v_application
  from public.applications
  where id = p_application_id and student_id = (select auth.uid())
  for update;

  if v_application.status <> 'confirmation_required' then
    raise exception 'No bid confirmation is pending for this application.' using errcode = 'P0001';
  end if;
  if v_application.confirmation_deadline is not null
    and now() >= v_application.confirmation_deadline then
    raise exception 'The response deadline has passed.' using errcode = 'P0001';
  end if;

  select * into v_profile
  from public.profiles
  where id = v_application.student_id
  for update;

  v_available := v_profile.initial_points + v_profile.point_adjustments
    - v_profile.reserved_points - v_profile.spent_points;
  v_additional := v_company.current_bid - v_application.reserved_points;

  if v_additional < 0 then
    raise exception 'The new bid cannot be lower than the reserved bid.' using errcode = 'P0001';
  end if;
  if v_available < v_additional then
    raise exception 'You need % additional points, but only % points are available.',
      v_additional, v_available using errcode = 'P0001';
  end if;

  update public.profiles
  set reserved_points = reserved_points + v_additional
  where id = v_profile.id;

  update public.applications
  set accepted_bid = v_company.current_bid,
      reserved_points = v_company.current_bid,
      status = 'confirmed',
      confirmed_at = now(),
      bid_updated_at = clock_timestamp(),
      bid_response_penalty_percent = null,
      confirmation_deadline = null
  where id = v_application.id
  returning * into v_application;

  if v_additional > 0 then
    insert into public.point_transactions (
      student_id, company_id, application_id, type, amount,
      balance_before, balance_after, description, created_by
    ) values (
      v_profile.id, v_company.id, v_application.id, 'reservation',
      v_additional, v_available, v_available - v_additional,
      'Additional points reserved to stay with ' || v_company.name,
      v_profile.id
    );
  end if;

  insert into public.notifications (user_id, title, message, kind, action_url)
  values (
    v_profile.id,
    'You stayed in ' || v_company.name,
    'Your reservation is now ' || v_company.current_bid || ' points.',
    'success',
    '/student/activity'
  );

  insert into public.audit_logs (
    actor_id, actor_role, action, entity_type, entity_id, new_value
  ) values (
    v_profile.id, v_profile.role, 'bid_increase.accepted', 'application',
    v_application.id,
    jsonb_build_object('company_id', v_company.id, 'bid', v_company.current_bid)
  );

  if not exists (
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

create or replace function public.increase_company_bid(
  p_company_id uuid,
  p_custom_bid integer default null,
  p_reason text default null
)
returns public.companies
language plpgsql
security definer set search_path = ''
as $$
declare
  v_company public.companies;
  v_old_bid integer;
  v_new_bid integer;
  v_deadline timestamptz;
begin
  if not private.has_role(array['admin']::public.user_role[]) then
    raise exception 'Administrator access is required.' using errcode = 'P0001';
  end if;

  select * into v_company
  from public.companies
  where id = p_company_id
  for update;

  if v_company.id is null or v_company.status not in ('open', 'paused') then
    raise exception 'This company is not in an active bidding state.' using errcode = 'P0001';
  end if;
  if v_company.applicant_count <= v_company.cv_requirement then
    raise exception 'The company is not oversubscribed.' using errcode = 'P0001';
  end if;

  v_old_bid := v_company.current_bid;
  v_new_bid := coalesce(p_custom_bid, v_company.current_bid + v_company.bid_increment);

  if v_new_bid <= v_company.current_bid then
    raise exception 'The new bid must be higher than the current bid.' using errcode = 'P0001';
  end if;
  if v_company.maximum_bid is not null and v_new_bid > v_company.maximum_bid then
    raise exception 'The new bid exceeds the configured maximum of %.',
      v_company.maximum_bid using errcode = 'P0001';
  end if;

  v_deadline := now() + make_interval(mins => v_company.response_duration_minutes);

  insert into public.bid_history (
    company_id, previous_bid, new_bid, bid_increment,
    applicant_count_before, reason, changed_by
  ) values (
    v_company.id, v_old_bid, v_new_bid, v_new_bid - v_old_bid,
    v_company.applicant_count, nullif(trim(p_reason), ''), (select auth.uid())
  );

  update public.companies
  set current_bid = v_new_bid, status = 'bid_increase_pending'
  where id = v_company.id
  returning * into v_company;

  update public.applications
  set status = 'confirmation_required',
      confirmation_deadline = v_deadline,
      bid_response_penalty_percent = v_company.withdrawal_penalty_percent
  where company_id = v_company.id and status in ('active_bid', 'confirmed');

  insert into public.notifications (user_id, title, message, kind, action_url)
  select
    student_id,
    'Bid increased for ' || v_company.name,
    'The bid is now ' || v_new_bid || ' points. Choose Stay or Withdraw before ' ||
      to_char(v_deadline, 'DD Mon HH24:MI') || '.',
    'action_required',
    '/student'
  from public.applications
  where company_id = v_company.id and status = 'confirmation_required';

  insert into public.audit_logs (
    actor_id, actor_role, action, entity_type, entity_id,
    previous_value, new_value, reason
  ) values (
    (select auth.uid()), private.current_role(), 'company.bid_increased',
    'company', v_company.id,
    jsonb_build_object('bid', v_old_bid),
    jsonb_build_object(
      'bid', v_new_bid,
      'deadline', v_deadline,
      'withdrawal_penalty_percent', v_company.withdrawal_penalty_percent
    ),
    nullif(trim(p_reason), '')
  );

  return v_company;
end;
$$;

create or replace function public.change_company_status(
  p_company_id uuid,
  p_status public.company_status,
  p_reason text default null
)
returns public.companies
language plpgsql
security definer set search_path = ''
as $$
declare
  v_company public.companies;
  v_previous public.company_status;
  released record;
begin
  if not private.has_role(array['admin']::public.user_role[]) then
    raise exception 'Administrator access is required.' using errcode = 'P0001';
  end if;

  select * into v_company
  from public.companies
  where id = p_company_id
  for update;

  if v_company.id is null then
    raise exception 'Company not found.' using errcode = 'P0001';
  end if;
  if v_company.status = 'finalized' then
    raise exception 'A finalized company must use the reversal workflow.' using errcode = 'P0001';
  end if;
  if p_status = 'closed' and v_company.pending_count > 0 then
    raise exception 'Resolve all pending Stay or Withdraw responses before closing.' using errcode = 'P0001';
  end if;
  if p_status = 'closed' and v_company.applicant_count > v_company.cv_requirement then
    raise exception 'The session is still oversubscribed. Increase the bid before closing.' using errcode = 'P0001';
  end if;

  v_previous := v_company.status;

  if p_status = 'open' and exists (
    select 1 from public.companies
    where id <> p_company_id and status in ('open', 'bid_increase_pending')
  ) then
    raise exception 'Another company is already live. Pause or close it first.' using errcode = 'P0001';
  end if;

  if p_status = 'cancelled' then
    for released in
      select a.*, p.initial_points, p.point_adjustments,
        p.reserved_points as profile_reserved, p.spent_points,
        c.name as company_name
      from public.applications a
      join public.profiles p on p.id = a.student_id
      join public.companies c on c.id = a.company_id
      where a.company_id = p_company_id
        and a.status in ('active_bid', 'confirmation_required', 'confirmed', 'selected')
      order by a.id
      for update of a, p
    loop
      update public.profiles
      set reserved_points = reserved_points - released.reserved_points
      where id = released.student_id;

      update public.applications
      set status = 'cancelled', reserved_points = 0, confirmation_deadline = null
      where id = released.id;

      if released.reserved_points > 0 then
        insert into public.point_transactions (
          student_id, company_id, application_id, type, amount,
          balance_before, balance_after, description, created_by
        ) values (
          released.student_id, p_company_id, released.id, 'release',
          -released.reserved_points,
          released.initial_points + released.point_adjustments
            - released.profile_reserved - released.spent_points,
          released.initial_points + released.point_adjustments
            - released.profile_reserved - released.spent_points + released.reserved_points,
          'Bidding session cancelled; points released for ' || released.company_name,
          (select auth.uid())
        );
      end if;

      insert into public.notifications (user_id, title, message, kind, action_url)
      values (
        released.student_id,
        released.company_name || ' bidding cancelled',
        'Your reserved points have been released.',
        'warning',
        '/student'
      );
    end loop;
  end if;

  update public.companies
  set status = p_status
  where id = p_company_id
  returning * into v_company;

  insert into public.audit_logs (
    actor_id, actor_role, action, entity_type, entity_id,
    previous_value, new_value, reason
  ) values (
    (select auth.uid()), private.current_role(), 'company.status_changed',
    'company', p_company_id,
    jsonb_build_object('status', v_previous),
    jsonb_build_object('status', p_status),
    nullif(trim(p_reason), '')
  );

  return v_company;
end;
$$;

create or replace function public.finalize_company(p_company_id uuid)
returns public.companies
language plpgsql
security definer set search_path = ''
as $$
declare
  v_company public.companies;
  app_row record;
  v_eligible_count integer;
begin
  if not private.has_role(array['admin']::public.user_role[]) then
    raise exception 'Administrator access is required.' using errcode = 'P0001';
  end if;

  select * into v_company
  from public.companies
  where id = p_company_id
  for update;

  if v_company.id is null or v_company.status = 'finalized' then
    raise exception 'This company cannot be finalized.' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.applications
    where company_id = p_company_id and status = 'confirmation_required'
  ) then
    raise exception 'Resolve all pending Stay or Withdraw responses before finalizing.' using errcode = 'P0001';
  end if;

  select count(*) into v_eligible_count
  from public.applications
  where company_id = p_company_id and status in ('active_bid', 'confirmed', 'selected');

  if v_eligible_count > v_company.cv_requirement then
    raise exception 'There are % students staying for only % CV slots.',
      v_eligible_count, v_company.cv_requirement using errcode = 'P0001';
  end if;

  for app_row in
    select a.*, p.initial_points, p.point_adjustments,
      p.reserved_points as profile_reserved, p.spent_points
    from public.applications a
    join public.profiles p on p.id = a.student_id
    where a.company_id = p_company_id
      and a.status in ('active_bid', 'confirmed', 'selected')
      and a.final_points_deducted = 0
    order by a.id
    for update of a, p
  loop
    update public.profiles
    set reserved_points = reserved_points - app_row.reserved_points,
        spent_points = spent_points + app_row.accepted_bid
    where id = app_row.student_id;

    update public.applications
    set status = 'finalized',
        final_points_deducted = app_row.accepted_bid,
        reserved_points = 0,
        finalized_at = now(),
        confirmation_deadline = null
    where id = app_row.id;

    insert into public.point_transactions (
      student_id, company_id, application_id, type, amount,
      balance_before, balance_after, description, created_by
    ) values (
      app_row.student_id, p_company_id, app_row.id, 'spend', app_row.accepted_bid,
      app_row.initial_points + app_row.point_adjustments - app_row.spent_points,
      app_row.initial_points + app_row.point_adjustments
        - app_row.spent_points - app_row.accepted_bid,
      'Finalized bid for ' || v_company.name,
      (select auth.uid())
    );

    insert into public.notifications (user_id, title, message, kind, action_url)
    values (
      app_row.student_id,
      'Application finalized',
      'Your ' || v_company.name || ' application was finalized for ' ||
        app_row.accepted_bid || ' points.',
      'success',
      '/student/activity'
    );
  end loop;

  update public.companies
  set status = 'finalized', finalized_at = now()
  where id = p_company_id
  returning * into v_company;

  insert into public.audit_logs (
    actor_id, actor_role, action, entity_type, entity_id, new_value
  ) values (
    (select auth.uid()), private.current_role(), 'company.finalized',
    'company', p_company_id,
    jsonb_build_object(
      'final_bid', v_company.current_bid,
      'applicants', v_eligible_count,
      'total_points', v_eligible_count * v_company.current_bid
    )
  );

  return v_company;
end;
$$;

create or replace function public.expire_bid_responses()
returns integer
language plpgsql
security definer set search_path = ''
as $$
declare
  expired record;
  processed integer := 0;
begin
  for expired in
    select id
    from public.applications
    where status = 'confirmation_required'
      and confirmation_deadline <= now()
    order by company_id, id
  loop
    begin
      perform private.withdraw_after_bid_increase(
        expired.id,
        null,
        'Automatic withdrawal after the Stay or Withdraw deadline'
      );
      processed := processed + 1;
    exception when sqlstate 'P0001' then
      null;
    end;
  end loop;

  return processed;
end;
$$;

create or replace function public.get_bid_participants(p_company_id uuid)
returns table (
  full_name text,
  response_state text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    p.full_name,
    case
      when a.status = 'confirmation_required' then 'pending'
      else 'staying'
    end as response_state
  from public.applications a
  join public.profiles p on p.id = a.student_id
  join public.companies c on c.id = a.company_id
  where a.company_id = p_company_id
    and a.status in ('active_bid', 'confirmation_required', 'confirmed', 'selected', 'finalized')
    and c.status in ('open', 'paused', 'bid_increase_pending', 'closed', 'finalized')
    and exists (
      select 1 from public.profiles viewer
      where viewer.id = (select auth.uid())
        and viewer.account_status = 'active'
    )
  order by p.full_name, p.id;
$$;

-- Public analytics remains aggregate-only while including the configured
-- maximum bid used by the administrator interface.
drop function if exists public.get_public_bid_analytics();

create function public.get_public_bid_analytics()
returns table (
  id uuid,
  name text,
  industry text,
  location text,
  cv_requirement integer,
  current_bid integer,
  maximum_bid integer,
  opens_at timestamptz,
  closes_at timestamptz,
  status public.company_status,
  applicant_count integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    c.id,
    c.name,
    c.industry,
    c.location,
    c.cv_requirement,
    c.current_bid,
    c.maximum_bid,
    c.opens_at,
    c.closes_at,
    c.status,
    c.applicant_count
  from public.companies c
  where c.status <> 'cancelled'
  order by
    case c.status
      when 'open' then 0
      when 'bid_increase_pending' then 1
      when 'paused' then 2
      when 'upcoming' then 3
      when 'closed' then 4
      when 'finalized' then 5
      else 6
    end,
    c.opens_at nulls last,
    c.name;
$$;

revoke all on function private.withdraw_after_bid_increase(uuid, uuid, text)
from public, anon, authenticated;

revoke all on function public.apply_to_company(uuid) from public, anon;
revoke all on function public.withdraw_application(uuid) from public, anon;
revoke all on function public.respond_to_bid_increase(uuid, boolean) from public, anon;
revoke all on function public.increase_company_bid(uuid, integer, text) from public, anon;
revoke all on function public.get_bid_participants(uuid) from public, anon;
revoke all on function public.get_public_bid_analytics() from public;
revoke all on function public.expire_bid_responses() from public, anon, authenticated;

grant execute on function public.apply_to_company(uuid) to authenticated;
grant execute on function public.withdraw_application(uuid) to authenticated;
grant execute on function public.respond_to_bid_increase(uuid, boolean) to authenticated;
grant execute on function public.increase_company_bid(uuid, integer, text) to authenticated;
grant execute on function public.get_bid_participants(uuid) to authenticated;
grant execute on function public.get_public_bid_analytics() to anon, authenticated;

insert into public.system_settings (key, value, description)
values
  ('student_controlled_bids', 'false', 'Administrators control company bid increases.'),
  ('ranked_bid_selection', 'false', 'Students explicitly stay or withdraw after each increase.'),
  ('target_bid_auto_close', 'false', 'Bidding closes or finalizes through administrator actions.'),
  ('withdrawal_penalty_default_percent', '10', 'Default percentage charged on the increase portion when withdrawing after a bid increase.'),
  ('student_applicant_visibility', '"names_and_response_state"', 'Students see participant names and whether a Stay or Withdraw response is pending.'),
  ('student_participant_names_visible', 'true', 'Authenticated students can see names and response states for current participants.')
on conflict (key) do update
set value = excluded.value,
    description = excluded.description,
    updated_at = now();
