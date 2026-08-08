-- Introduce a registration window before live bidding. Students join and
-- reserve the opening bid during this phase. The cohort is frozen when an
-- administrator starts bidding, and pre-start withdrawals are always free.

create or replace function public.apply_to_company(p_company_id uuid)
returns public.applications
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles;
  v_company public.companies;
  v_application public.applications;
  v_available integer;
  v_now timestamptz := clock_timestamp();
begin
  select * into v_company
  from public.companies
  where id = p_company_id
  for update;

  if v_company.id is null then
    raise exception 'Company not found.' using errcode = 'P0001';
  end if;
  if v_company.status <> 'registration_open' then
    raise exception 'Registration is closed. Only students who joined before bidding started can participate.'
      using errcode = 'P0001';
  end if;

  select * into v_application
  from public.applications
  where student_id = (select auth.uid()) and company_id = p_company_id
  for update;

  if v_application.id is not null
    and v_application.status not in ('withdrawn', 'cancelled', 'not_selected') then
    raise exception 'You have already joined this company.' using errcode = 'P0001';
  end if;

  select * into v_profile
  from public.profiles
  where id = (select auth.uid())
  for update;

  if v_profile.id is null or v_profile.role <> 'student'
    or v_profile.account_status <> 'active' then
    raise exception 'Only active students can join.' using errcode = 'P0001';
  end if;

  v_available := v_profile.initial_points + v_profile.point_adjustments
    - v_profile.reserved_points - v_profile.spent_points;

  if v_available < v_company.current_bid then
    raise exception 'You need % points to join, but only % points are available.',
      v_company.current_bid, v_available using errcode = 'P0001';
  end if;

  update public.profiles
  set reserved_points = reserved_points + v_company.current_bid
  where id = v_profile.id;

  if v_application.id is null then
    insert into public.applications (
      student_id, company_id, initial_bid, accepted_bid, reserved_points,
      withdrawal_charge, bid_response_penalty_percent, status,
      confirmed_at, bid_updated_at
    ) values (
      v_profile.id, v_company.id, v_company.current_bid, v_company.current_bid,
      v_company.current_bid, 0, v_company.withdrawal_penalty_percent,
      'active_bid', v_now, v_now
    ) returning * into v_application;
  else
    update public.applications
    set initial_bid = v_company.current_bid,
        accepted_bid = v_company.current_bid,
        reserved_points = v_company.current_bid,
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
    v_company.current_bid, v_available, v_available - v_company.current_bid,
    'Pre-bidding place reserved for ' || v_company.name, v_profile.id
  );

  insert into public.notifications (user_id, title, message, kind, action_url)
  values (
    v_profile.id,
    'Joined ' || v_company.name,
    'Your place is reserved for bidding. You can withdraw without a point charge until bidding starts.',
    'success',
    '/student/companies/' || v_company.slug
  );

  insert into public.audit_logs (
    actor_id, actor_role, action, entity_type, entity_id, new_value
  ) values (
    v_profile.id, v_profile.role, 'application.pre_registered', 'application',
    v_application.id,
    jsonb_build_object(
      'company_id', v_company.id,
      'opening_bid', v_company.current_bid,
      'bidding_mode', v_company.bidding_mode
    )
  );

  return v_application;
end;
$$;

create or replace function private.withdraw_pre_bidding_registration(
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
  if v_company.status <> 'registration_open'
    or v_application.status not in ('active_bid', 'confirmed') then
    raise exception 'Free withdrawal is available only before bidding starts.'
      using errcode = 'P0001';
  end if;

  select * into v_profile
  from public.profiles
  where id = v_application.student_id
  for update;

  v_available := v_profile.initial_points + v_profile.point_adjustments
    - v_profile.reserved_points - v_profile.spent_points;
  v_release := v_application.reserved_points;

  update public.profiles
  set reserved_points = reserved_points - v_release
  where id = v_profile.id;

  update public.applications
  set status = 'withdrawn',
      reserved_points = 0,
      withdrawal_charge = 0,
      bid_response_penalty_percent = null,
      withdrawn_at = clock_timestamp(),
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
      'Pre-bidding registration released for ' || v_company.name, p_actor
    );
  end if;

  insert into public.notifications (user_id, title, message, kind, action_url)
  values (
    v_profile.id,
    'Left ' || v_company.name || ' before bidding',
    'Your reserved points were released in full. No withdrawal charge was deducted.',
    'info',
    '/student/activity'
  );

  insert into public.audit_logs (
    actor_id, actor_role, action, entity_type, entity_id, new_value, reason
  ) values (
    p_actor, v_profile.role, 'application.pre_bidding_withdrawn',
    'application', v_application.id,
    jsonb_build_object(
      'company_id', v_company.id,
      'released_points', v_release,
      'withdrawal_charge', 0
    ),
    'Student withdrew before bidding started'
  );

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
  v_company_status public.company_status;
begin
  select c.bidding_mode, c.status into v_mode, v_company_status
  from public.applications a
  join public.companies c on c.id = a.company_id
  where a.id = p_application_id
    and a.student_id = (select auth.uid());

  if v_mode is null then
    raise exception 'Application not found.' using errcode = 'P0001';
  end if;
  if v_company_status = 'registration_open' then
    return private.withdraw_pre_bidding_registration(
      p_application_id,
      (select auth.uid())
    );
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

-- Keep the existing automatic bid transaction, but place an atomic membership
-- gate in front of it. The locked application must belong to the frozen cohort.
alter function public.submit_automatic_bid(uuid, integer)
rename to submit_automatic_bid_registered_cohort;
alter function public.submit_automatic_bid_registered_cohort(uuid, integer)
set schema private;

create function public.submit_automatic_bid(
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
  v_application public.applications;
begin
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
  if v_company.status <> 'open' then
    raise exception 'This automatic auction is not active.' using errcode = 'P0001';
  end if;

  select * into v_application
  from public.applications
  where student_id = (select auth.uid()) and company_id = p_company_id
  for update;

  if v_application.id is null
    or v_application.status not in ('active_bid', 'confirmed') then
    raise exception 'This bidding session is locked. Only students who joined before bidding started can bid.'
      using errcode = 'P0001';
  end if;

  return private.submit_automatic_bid_registered_cohort(p_company_id, p_bid);
end;
$$;

-- Limit the public administrator state machine to the registration-first flow.
-- Internal bidding functions still perform their own open/pending/final states.
alter function public.change_company_status(uuid, public.company_status, text)
rename to change_company_status_legacy;
alter function public.change_company_status_legacy(uuid, public.company_status, text)
set schema private;

create function public.change_company_status(
  p_company_id uuid,
  p_status public.company_status,
  p_reason text default null
)
returns public.companies
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company public.companies;
  v_transition_allowed boolean;
begin
  select * into v_company
  from public.companies
  where id = p_company_id
  for update;

  if v_company.id is null then
    raise exception 'Company not found.' using errcode = 'P0001';
  end if;

  v_transition_allowed := v_company.status = p_status
    or p_status = 'cancelled'
    or (v_company.status = 'upcoming' and p_status = 'registration_open')
    or (v_company.status = 'registration_open' and p_status = 'open')
    or (v_company.status = 'open' and p_status in ('paused', 'closed'))
    or (v_company.status = 'paused' and p_status in ('open', 'closed'));

  if not v_transition_allowed then
    raise exception 'Invalid company transition from % to %. Open registration before starting bidding, and use the appropriate finalization workflow to finish.',
      v_company.status, p_status using errcode = 'P0001';
  end if;

  return private.change_company_status_legacy(
    p_company_id,
    p_status,
    p_reason
  );
end;
$$;

-- A free automatic withdrawal may be reversed only while registration remains
-- open. Once bidding starts, the public bid RPC also requires active membership.
create or replace function private.prevent_automatic_withdrawal_reentry()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'withdrawn'
    and new.status in ('active_bid', 'confirmation_required', 'confirmed')
    and exists (
      select 1
      from public.companies c
      where c.id = old.company_id
        and c.bidding_mode = 'automatic'
        and c.status <> 'registration_open'
    ) then
    raise exception 'Your withdrawal from this automatic auction is final. You cannot apply again.'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

-- Show the registered cohort on the company detail page before bidding starts.
drop function if exists public.get_bid_participants(uuid);
create function public.get_bid_participants(p_company_id uuid)
returns table (
  full_name text,
  response_state text,
  bid_amount integer,
  rank_position integer,
  is_currently_selected boolean,
  is_self boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with ranked as (
    select
      a.student_id,
      a.accepted_bid,
      a.status,
      case
        when a.status = 'withdrawn' then null
        else row_number() over (
          order by
            case when a.status = 'withdrawn' then 1 else 0 end,
            a.accepted_bid desc,
            a.bid_updated_at asc,
            a.id asc
        )::integer
      end as bid_rank,
      row_number() over (
        order by
          case when a.status = 'withdrawn' then 1 else 0 end,
          a.accepted_bid desc,
          a.bid_updated_at asc,
          a.id asc
      )::integer as display_order
    from public.applications a
    where a.company_id = p_company_id
      and a.status in (
        'active_bid',
        'confirmation_required',
        'confirmed',
        'selected',
        'finalized',
        'not_selected',
        'withdrawn'
      )
  )
  select
    p.full_name,
    case r.status
      when 'confirmation_required' then 'pending'
      when 'selected' then 'selected'
      when 'finalized' then 'finalized'
      when 'not_selected' then 'not_selected'
      when 'withdrawn' then 'withdrawn'
      else 'staying'
    end,
    r.accepted_bid,
    r.bid_rank,
    case
      when r.status in ('withdrawn', 'not_selected') then false
      when r.status in ('selected', 'finalized') then true
      else coalesce(r.bid_rank <= c.cv_requirement, false)
    end,
    r.student_id = (select auth.uid())
  from ranked r
  join public.profiles p on p.id = r.student_id
  join public.companies c on c.id = p_company_id
  where c.status in (
      'registration_open', 'open', 'paused', 'bid_increase_pending',
      'closed', 'finalized'
    )
    and exists (
      select 1
      from public.profiles viewer
      where viewer.id = (select auth.uid())
        and viewer.account_status = 'active'
    )
  order by r.display_order;
$$;

-- Preserve the current privacy-safe public shape while ordering registration
-- immediately before the live company states.
drop function if exists public.get_public_bid_analytics();
create function public.get_public_bid_analytics()
returns table (
  id uuid,
  name text,
  industry text,
  location text,
  available_roles text[],
  cv_requirement integer,
  current_bid integer,
  maximum_bid integer,
  opens_at timestamptz,
  closes_at timestamptz,
  status public.company_status,
  applicant_count integer,
  bidding_mode text,
  inactivity_timeout_seconds integer,
  auto_closes_at timestamptz,
  participants jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  with ranked_applications as (
    select
      a.*,
      row_number() over (
        partition by a.company_id
        order by
          case when a.status = 'withdrawn' then 1 else 0 end,
          a.accepted_bid desc,
          a.bid_updated_at asc,
          a.id asc
      )::integer as display_rank
    from public.applications a
    where a.status in (
      'active_bid',
      'confirmation_required',
      'confirmed',
      'selected',
      'finalized',
      'not_selected',
      'withdrawn'
    )
  )
  select
    c.id,
    c.name,
    c.industry,
    c.location,
    c.available_roles,
    c.cv_requirement,
    c.current_bid,
    c.maximum_bid,
    c.opens_at,
    c.closes_at,
    c.status,
    c.applicant_count,
    c.bidding_mode,
    c.inactivity_timeout_seconds,
    c.auto_closes_at,
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'full_name', p.full_name,
          'response_state', case a.status
            when 'confirmation_required' then 'pending'
            when 'selected' then 'selected'
            when 'finalized' then 'finalized'
            when 'not_selected' then 'not_selected'
            when 'withdrawn' then 'withdrawn'
            else 'staying'
          end,
          'bid_amount', a.accepted_bid,
          'rank_position', case
            when a.status = 'withdrawn' then null
            else a.display_rank
          end,
          'is_currently_selected', case
            when a.status in ('withdrawn', 'not_selected') then false
            when a.status in ('selected', 'finalized') then true
            else a.display_rank <= c.cv_requirement
          end
        )
        order by a.display_rank, p.full_name
      )
      from ranked_applications a
      join public.profiles p on p.id = a.student_id
      where a.company_id = c.id
    ), '[]'::jsonb)
  from public.companies c
  where c.status <> 'cancelled'
  order by
    case c.status
      when 'open' then 0
      when 'bid_increase_pending' then 1
      when 'paused' then 2
      when 'registration_open' then 3
      when 'upcoming' then 4
      when 'closed' then 5
      when 'finalized' then 6
      else 7
    end,
    c.opens_at nulls last,
    c.name;
$$;

revoke all on function private.withdraw_pre_bidding_registration(uuid, uuid)
from public, anon, authenticated;
revoke all on function private.submit_automatic_bid_registered_cohort(uuid, integer)
from public, anon, authenticated;
revoke all on function private.change_company_status_legacy(uuid, public.company_status, text)
from public, anon, authenticated;

revoke all on function public.apply_to_company(uuid) from public, anon;
revoke all on function public.withdraw_application(uuid) from public, anon;
revoke all on function public.submit_automatic_bid(uuid, integer) from public, anon;
revoke all on function public.change_company_status(uuid, public.company_status, text)
from public, anon;
revoke all on function public.get_bid_participants(uuid) from public, anon;
revoke all on function public.get_public_bid_analytics() from public;

grant execute on function public.apply_to_company(uuid) to authenticated;
grant execute on function public.withdraw_application(uuid) to authenticated;
grant execute on function public.submit_automatic_bid(uuid, integer) to authenticated;
grant execute on function public.change_company_status(uuid, public.company_status, text)
to authenticated;
grant execute on function public.get_bid_participants(uuid) to authenticated;
grant execute on function public.get_public_bid_analytics() to anon, authenticated;

insert into public.system_settings (key, value, description)
values (
  'pre_bidding_registration',
  'true',
  'Students must join during registration; the cohort is locked when bidding starts.'
)
on conflict (key) do update
set value = excluded.value,
    description = excluded.description,
    updated_at = now();
