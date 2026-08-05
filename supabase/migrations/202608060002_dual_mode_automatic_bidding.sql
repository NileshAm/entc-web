-- Add per-company bidding modes while preserving the existing committee flow.
-- Existing companies remain committee controlled. Automatic companies accept
-- student bids, rank them by amount and bid time, and settle after inactivity.

alter table public.companies
add column if not exists bidding_mode text not null default 'committee'
  check (bidding_mode in ('committee', 'automatic')),
add column if not exists inactivity_timeout_seconds integer not null default 120
  check (inactivity_timeout_seconds between 30 and 86400),
add column if not exists last_bid_at timestamptz,
add column if not exists auto_closes_at timestamptz;

create index if not exists companies_automatic_deadline_idx
on public.companies (auto_closes_at)
where bidding_mode = 'automatic' and status = 'open';

create or replace function private.enforce_bidding_mode_and_deadline()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  v_inactivity_deadline timestamptz;
begin
  if tg_op = 'UPDATE'
    and new.bidding_mode is distinct from old.bidding_mode
    and old.status <> 'upcoming' then
    raise exception 'The bidding mode can only be changed while a company is upcoming.'
      using errcode = 'P0001';
  end if;

  if new.bidding_mode = 'automatic' then
    if new.status in ('bid_increase_pending', 'closed') then
      raise exception 'Automatic bidding must be settled through the automatic close workflow.'
        using errcode = 'P0001';
    end if;

    if new.status = 'open' and tg_op = 'INSERT' then
      new.last_bid_at := clock_timestamp();
      v_inactivity_deadline := new.last_bid_at
        + make_interval(secs => new.inactivity_timeout_seconds);
      new.auto_closes_at := case when new.closes_at is null
        then v_inactivity_deadline
        else least(v_inactivity_deadline, new.closes_at)
      end;
    elsif tg_op = 'UPDATE'
      and new.status = 'open'
      and old.status is distinct from 'open' then
      new.last_bid_at := clock_timestamp();
      v_inactivity_deadline := new.last_bid_at
        + make_interval(secs => new.inactivity_timeout_seconds);
      new.auto_closes_at := case when new.closes_at is null
        then v_inactivity_deadline
        else least(v_inactivity_deadline, new.closes_at)
      end;
    elsif tg_op = 'UPDATE'
      and new.status = 'open'
      and (
        new.inactivity_timeout_seconds is distinct from old.inactivity_timeout_seconds
        or new.closes_at is distinct from old.closes_at
      ) then
      v_inactivity_deadline := coalesce(new.last_bid_at, clock_timestamp())
        + make_interval(secs => new.inactivity_timeout_seconds);
      new.auto_closes_at := case when new.closes_at is null
        then v_inactivity_deadline
        else least(v_inactivity_deadline, new.closes_at)
      end;
    elsif new.status in ('upcoming', 'paused', 'finalized', 'cancelled') then
      new.auto_closes_at := null;
    end if;
  else
    new.last_bid_at := null;
    new.auto_closes_at := null;
  end if;

  return new;
end;
$$;

drop trigger if exists companies_enforce_bidding_mode on public.companies;
create trigger companies_enforce_bidding_mode
before insert or update on public.companies
for each row execute function private.enforce_bidding_mode_and_deadline();

-- Preserve the existing committee implementations behind private wrappers.
alter function public.apply_to_company(uuid)
rename to apply_to_company_committee;
alter function public.apply_to_company_committee(uuid)
set schema private;

alter function public.withdraw_application(uuid)
rename to withdraw_application_committee;
alter function public.withdraw_application_committee(uuid)
set schema private;

alter function public.respond_to_bid_increase(uuid, boolean)
rename to respond_to_bid_increase_committee;
alter function public.respond_to_bid_increase_committee(uuid, boolean)
set schema private;

alter function public.increase_company_bid(uuid, integer, text)
rename to increase_company_bid_committee;
alter function public.increase_company_bid_committee(uuid, integer, text)
set schema private;

alter function public.finalize_company(uuid)
rename to finalize_company_committee;
alter function public.finalize_company_committee(uuid)
set schema private;

create or replace function public.apply_to_company(p_company_id uuid)
returns public.applications
language plpgsql
security definer set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.companies
    where id = p_company_id and bidding_mode = 'committee'
  ) then
    raise exception 'This company uses automatic bidding. Enter a bid amount instead.'
      using errcode = 'P0001';
  end if;
  return private.apply_to_company_committee(p_company_id);
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
begin
  if not exists (
    select 1
    from public.applications a
    join public.companies c on c.id = a.company_id
    where a.id = p_application_id and c.bidding_mode = 'committee'
  ) then
    raise exception 'Stay or Withdraw rounds apply only to committee-controlled bidding.'
      using errcode = 'P0001';
  end if;
  return private.respond_to_bid_increase_committee(p_application_id, p_accept);
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
begin
  if not exists (
    select 1 from public.companies
    where id = p_company_id and bidding_mode = 'committee'
  ) then
    raise exception 'Administrators cannot increase bids for an automatic company.'
      using errcode = 'P0001';
  end if;
  return private.increase_company_bid_committee(p_company_id, p_custom_bid, p_reason);
end;
$$;

create or replace function public.finalize_company(p_company_id uuid)
returns public.companies
language plpgsql
security definer set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.companies
    where id = p_company_id and bidding_mode = 'committee'
  ) then
    raise exception 'Use automatic settlement for this company.' using errcode = 'P0001';
  end if;
  return private.finalize_company_committee(p_company_id);
end;
$$;

create or replace function public.submit_automatic_bid(
  p_company_id uuid,
  p_bid integer
)
returns public.applications
language plpgsql
security definer set search_path = ''
as $$
declare
  v_company public.companies;
  v_profile public.profiles;
  v_application public.applications;
  v_available integer;
  v_previous_bid integer := 0;
  v_additional integer;
  v_previous_highest integer;
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
  if v_company.status <> 'open' then
    raise exception 'This automatic auction is not open.' using errcode = 'P0001';
  end if;
  if v_company.opens_at is not null and now() < v_company.opens_at then
    raise exception 'This bidding session has not opened yet.' using errcode = 'P0001';
  end if;
  if v_company.closes_at is not null and now() >= v_company.closes_at then
    raise exception 'This bidding session has reached its scheduled closing time.'
      using errcode = 'P0001';
  end if;
  if v_company.auto_closes_at is not null and v_now >= v_company.auto_closes_at then
    raise exception 'The inactivity timer has expired and this auction is closing.'
      using errcode = 'P0001';
  end if;
  if p_bid < v_company.minimum_bid then
    raise exception 'Your bid must be at least % points.', v_company.minimum_bid
      using errcode = 'P0001';
  end if;
  if v_company.maximum_bid is not null and p_bid > v_company.maximum_bid then
    raise exception 'Your bid cannot exceed % points.', v_company.maximum_bid
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

  select * into v_application
  from public.applications
  where student_id = v_profile.id and company_id = v_company.id
  for update;

  if v_application.id is not null
    and v_application.status in ('active_bid', 'confirmed') then
    v_previous_bid := v_application.accepted_bid;
    if p_bid <= v_previous_bid then
      raise exception 'Your new bid must be higher than your current % point bid.',
        v_previous_bid using errcode = 'P0001';
    end if;
  elsif v_application.id is not null
    and v_application.status not in ('withdrawn', 'cancelled', 'not_selected') then
    raise exception 'This application can no longer be changed.' using errcode = 'P0001';
  end if;

  v_available := v_profile.initial_points + v_profile.point_adjustments
    - v_profile.reserved_points - v_profile.spent_points;
  v_additional := p_bid - v_previous_bid;

  if v_available < v_additional then
    raise exception 'You need % additional points, but only % points are available.',
      v_additional, v_available using errcode = 'P0001';
  end if;

  update public.profiles
  set reserved_points = reserved_points + v_additional
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
    set initial_bid = case
          when status in ('withdrawn', 'cancelled', 'not_selected') then p_bid
          else initial_bid
        end,
        accepted_bid = p_bid,
        reserved_points = p_bid,
        final_points_deducted = 0,
        withdrawal_charge = 0,
        bid_response_penalty_percent = v_company.withdrawal_penalty_percent,
        status = 'active_bid',
        applied_at = case
          when status in ('withdrawn', 'cancelled', 'not_selected') then v_now
          else applied_at
        end,
        bid_updated_at = v_now,
        confirmation_deadline = null,
        confirmed_at = v_now,
        withdrawn_at = null,
        finalized_at = null
    where id = v_application.id
    returning * into v_application;
  end if;

  if v_additional > 0 then
    insert into public.point_transactions (
      student_id, company_id, application_id, type, amount,
      balance_before, balance_after, description, created_by
    ) values (
      v_profile.id, v_company.id, v_application.id, 'reservation',
      v_additional, v_available, v_available - v_additional,
      case when v_previous_bid = 0
        then 'Automatic bid reserved for ' || v_company.name
        else 'Automatic bid increased for ' || v_company.name
      end,
      v_profile.id
    );
  end if;

  v_previous_highest := v_company.current_bid;
  update public.companies
  set current_bid = greatest(current_bid, p_bid),
      last_bid_at = v_now,
      auto_closes_at = case when closes_at is null
        then v_now + make_interval(secs => inactivity_timeout_seconds)
        else least(
          v_now + make_interval(secs => inactivity_timeout_seconds),
          closes_at
        )
      end
  where id = v_company.id
  returning * into v_company;

  if p_bid > v_previous_highest then
    insert into public.bid_history (
      company_id, previous_bid, new_bid, bid_increment,
      applicant_count_before, applicant_count_after, reason, changed_by
    ) values (
      v_company.id, v_previous_highest, p_bid, p_bid - v_previous_highest,
      greatest(v_company.applicant_count - case when v_previous_bid = 0 then 1 else 0 end, 0),
      v_company.applicant_count, 'Student automatic bid', v_profile.id
    );
  end if;

  insert into public.audit_logs (
    actor_id, actor_role, action, entity_type, entity_id,
    previous_value, new_value
  ) values (
    v_profile.id, v_profile.role, 'automatic_bid.submitted', 'application',
    v_application.id,
    jsonb_build_object('bid', nullif(v_previous_bid, 0)),
    jsonb_build_object(
      'company_id', v_company.id,
      'bid', p_bid,
      'auto_closes_at', v_company.auto_closes_at
    )
  );

  return v_application;
end;
$$;

create or replace function private.withdraw_automatic_bid(
  p_application_id uuid,
  p_actor uuid
)
returns public.applications
language plpgsql
security definer set search_path = ''
as $$
declare
  v_company public.companies;
  v_application public.applications;
  v_profile public.profiles;
  v_available integer;
  v_release integer;
  v_calculated_charge integer;
  v_charge integer;
  v_penalty_percent integer;
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
  if v_company.bidding_mode <> 'automatic' then
    raise exception 'This is not an automatic bid.' using errcode = 'P0001';
  end if;
  if v_company.status <> 'open'
    or v_application.status not in ('active_bid', 'confirmed') then
    raise exception 'This bid can no longer be withdrawn.' using errcode = 'P0001';
  end if;

  select * into v_profile
  from public.profiles
  where id = v_application.student_id
  for update;

  v_available := v_profile.initial_points + v_profile.point_adjustments
    - v_profile.reserved_points - v_profile.spent_points;
  v_release := v_application.reserved_points;
  v_penalty_percent := coalesce(
    v_application.bid_response_penalty_percent,
    v_company.withdrawal_penalty_percent
  );
  v_calculated_charge := v_application.initial_bid + ceil(
    greatest(v_application.accepted_bid - v_application.initial_bid, 0)
      * v_penalty_percent / 100.0
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
      'Automatic bid reservation released for ' || v_company.name, p_actor
    );
  end if;

  if v_charge > 0 then
    insert into public.point_transactions (
      student_id, company_id, application_id, type, amount,
      balance_before, balance_after, description, created_by
    ) values (
      v_profile.id, v_company.id, v_application.id, 'spend', v_charge,
      v_available + v_release, v_available + v_release - v_charge,
      'Automatic bidding withdrawal charge for ' || v_company.name,
      p_actor
    );
  end if;

  update public.companies
  set current_bid = greatest(
    minimum_bid,
    coalesce((
      select max(accepted_bid) from public.applications
      where company_id = v_company.id and status in ('active_bid', 'confirmed')
    ), minimum_bid)
  )
  where id = v_company.id;

  insert into public.notifications (user_id, title, message, kind, action_url)
  values (
    v_profile.id,
    'Automatic bid withdrawn',
    'You left ' || v_company.name || '. A ' || v_charge ||
      '-point withdrawal charge was applied.',
    'warning',
    '/student/activity'
  );

  insert into public.audit_logs (
    actor_id, actor_role, action, entity_type, entity_id, new_value
  ) values (
    p_actor, v_profile.role, 'automatic_bid.withdrawn', 'application',
    v_application.id,
    jsonb_build_object(
      'company_id', v_company.id,
      'initial_bid', v_application.initial_bid,
      'final_bid', v_application.accepted_bid,
      'penalty_percent', v_penalty_percent,
      'applied_charge', v_charge
    )
  );

  return v_application;
end;
$$;

create or replace function public.withdraw_application(p_application_id uuid)
returns public.applications
language plpgsql
security definer set search_path = ''
as $$
declare
  v_mode text;
begin
  select c.bidding_mode into v_mode
  from public.applications a
  join public.companies c on c.id = a.company_id
  where a.id = p_application_id and a.student_id = (select auth.uid());

  if v_mode is null then
    raise exception 'Application not found.' using errcode = 'P0001';
  end if;
  if v_mode = 'automatic' then
    return private.withdraw_automatic_bid(p_application_id, (select auth.uid()));
  end if;
  return private.withdraw_application_committee(p_application_id);
end;
$$;

create or replace function private.finalize_automatic_company(
  p_company_id uuid,
  p_actor uuid,
  p_require_expired boolean
)
returns public.companies
language plpgsql
security definer set search_path = ''
as $$
declare
  v_company public.companies;
  app_row record;
  v_available integer;
  v_selected integer := 0;
  v_not_selected integer := 0;
  v_total_points integer := 0;
begin
  select * into v_company
  from public.companies
  where id = p_company_id
  for update;

  if v_company.id is null or v_company.bidding_mode <> 'automatic'
    or v_company.status not in ('open', 'paused') then
    raise exception 'This automatic auction cannot be finalized.' using errcode = 'P0001';
  end if;
  if p_require_expired and (
    v_company.status <> 'open'
    or v_company.auto_closes_at is null
    or clock_timestamp() < v_company.auto_closes_at
  ) then
    raise exception 'The inactivity deadline has not expired.' using errcode = 'P0001';
  end if;

  for app_row in
    with ranked as (
      select id,
        row_number() over (
          order by accepted_bid desc, bid_updated_at asc, id asc
        ) as bid_rank
      from public.applications
      where company_id = p_company_id and status in ('active_bid', 'confirmed')
    )
    select a.*, r.bid_rank,
      p.initial_points, p.point_adjustments,
      p.reserved_points as profile_reserved, p.spent_points
    from ranked r
    join public.applications a on a.id = r.id
    join public.profiles p on p.id = a.student_id
    order by r.bid_rank
    for update of a, p
  loop
    v_available := app_row.initial_points + app_row.point_adjustments
      - app_row.profile_reserved - app_row.spent_points;

    if app_row.bid_rank <= v_company.cv_requirement then
      update public.profiles
      set reserved_points = reserved_points - app_row.reserved_points,
          spent_points = spent_points + app_row.accepted_bid
      where id = app_row.student_id;

      update public.applications
      set status = 'selected', reserved_points = 0,
          final_points_deducted = app_row.accepted_bid,
          finalized_at = now(), confirmation_deadline = null
      where id = app_row.id;

      insert into public.point_transactions (
        student_id, company_id, application_id, type, amount,
        balance_before, balance_after, description, created_by
      ) values (
        app_row.student_id, v_company.id, app_row.id, 'spend',
        app_row.accepted_bid,
        app_row.initial_points + app_row.point_adjustments - app_row.spent_points,
        app_row.initial_points + app_row.point_adjustments
          - app_row.spent_points - app_row.accepted_bid,
        'Selected automatic bid for ' || v_company.name, p_actor
      );

      insert into public.notifications (user_id, title, message, kind, action_url)
      values (
        app_row.student_id,
        'Selected for ' || v_company.name,
        'Your ' || app_row.accepted_bid || '-point bid ranked #' ||
          app_row.bid_rank || ' and was selected.',
        'success', '/student/activity'
      );

      v_selected := v_selected + 1;
      v_total_points := v_total_points + app_row.accepted_bid;
    else
      update public.profiles
      set reserved_points = reserved_points - app_row.reserved_points
      where id = app_row.student_id;

      update public.applications
      set status = 'not_selected', reserved_points = 0,
          finalized_at = now(), confirmation_deadline = null
      where id = app_row.id;

      if app_row.reserved_points > 0 then
        insert into public.point_transactions (
          student_id, company_id, application_id, type, amount,
          balance_before, balance_after, description, created_by
        ) values (
          app_row.student_id, v_company.id, app_row.id, 'release',
          -app_row.reserved_points, v_available,
          v_available + app_row.reserved_points,
          'Bid not selected; reservation released for ' || v_company.name,
          p_actor
        );
      end if;

      insert into public.notifications (user_id, title, message, kind, action_url)
      values (
        app_row.student_id,
        'Not selected for ' || v_company.name,
        'Your ' || app_row.accepted_bid || '-point bid ranked #' ||
          app_row.bid_rank || '. Your reserved points were released.',
        'info', '/student/activity'
      );

      v_not_selected := v_not_selected + 1;
    end if;
  end loop;

  update public.companies
  set status = 'finalized', finalized_at = now(), auto_closes_at = null
  where id = v_company.id
  returning * into v_company;

  insert into public.audit_logs (
    actor_id, actor_role, action, entity_type, entity_id, new_value, reason
  ) values (
    p_actor,
    case when p_actor is null then null else 'admin'::public.user_role end,
    'automatic_bid.finalized', 'company', v_company.id,
    jsonb_build_object(
      'selected', v_selected,
      'not_selected', v_not_selected,
      'total_points', v_total_points,
      'inactivity_timeout_seconds', v_company.inactivity_timeout_seconds
    ),
    case when p_require_expired then 'Inactivity timeout expired'
      else 'Administrator closed automatic auction' end
  );

  return v_company;
end;
$$;

create or replace function public.finalize_automatic_bidding(p_company_id uuid)
returns public.companies
language plpgsql
security definer set search_path = ''
as $$
begin
  if not private.has_role(array['admin']::public.user_role[]) then
    raise exception 'Administrator access is required.' using errcode = 'P0001';
  end if;
  return private.finalize_automatic_company(
    p_company_id, (select auth.uid()), false
  );
end;
$$;

create or replace function public.close_inactive_automatic_bidding()
returns integer
language plpgsql
security definer set search_path = ''
as $$
declare
  due_company record;
  processed integer := 0;
begin
  for due_company in
    select id from public.companies
    where bidding_mode = 'automatic'
      and status = 'open'
      and auto_closes_at <= clock_timestamp()
    order by auto_closes_at, id
  loop
    begin
      perform private.finalize_automatic_company(due_company.id, null, true);
      processed := processed + 1;
    exception when sqlstate 'P0001' then
      null;
    end;
  end loop;
  return processed;
end;
$$;

-- Include bid and live-rank information in authenticated participant lists.
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
      row_number() over (
        order by a.accepted_bid desc, a.bid_updated_at asc, a.id asc
      )::integer as bid_rank
    from public.applications a
    where a.company_id = p_company_id
      and a.status in ('active_bid', 'confirmation_required', 'confirmed', 'selected', 'finalized')
  )
  select
    p.full_name,
    case r.status
      when 'confirmation_required' then 'pending'
      when 'selected' then 'selected'
      when 'finalized' then 'finalized'
      else 'staying'
    end,
    r.accepted_bid,
    case when c.bidding_mode = 'automatic' then r.bid_rank else null end,
    case when c.bidding_mode = 'automatic'
      then r.bid_rank <= c.cv_requirement
      else r.status <> 'confirmation_required'
    end,
    r.student_id = (select auth.uid())
  from ranked r
  join public.profiles p on p.id = r.student_id
  join public.companies c on c.id = p_company_id
  where c.status in ('open', 'paused', 'bid_increase_pending', 'closed', 'finalized')
    and exists (
      select 1 from public.profiles viewer
      where viewer.id = (select auth.uid()) and viewer.account_status = 'active'
    )
  order by
    case when c.bidding_mode = 'automatic' then r.bid_rank else null end nulls last,
    p.full_name;
$$;

-- Extend the public DTO with mode, deadline, bid, and rank data only.
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
  select
    c.id, c.name, c.industry, c.location, c.cv_requirement,
    c.current_bid, c.maximum_bid, c.opens_at, c.closes_at,
    c.status, c.applicant_count, c.bidding_mode,
    c.inactivity_timeout_seconds, c.auto_closes_at,
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'full_name', participant.full_name,
          'response_state', participant.response_state,
          'bid_amount', participant.bid_amount,
          'rank_position', participant.rank_position,
          'is_currently_selected', participant.is_currently_selected
        ) order by participant.sort_rank, participant.full_name
      )
      from (
        select
          p.full_name,
          case a.status
            when 'confirmation_required' then 'pending'
            when 'selected' then 'selected'
            when 'finalized' then 'finalized'
            else 'staying'
          end as response_state,
          a.accepted_bid as bid_amount,
          case when c.bidding_mode = 'automatic'
            then row_number() over (
              order by a.accepted_bid desc, a.bid_updated_at asc, a.id asc
            )::integer
            else null
          end as rank_position,
          case when c.bidding_mode = 'automatic'
            then row_number() over (
              order by a.accepted_bid desc, a.bid_updated_at asc, a.id asc
            ) <= c.cv_requirement
            else a.status <> 'confirmation_required'
          end as is_currently_selected,
          row_number() over (
            order by
              case when c.bidding_mode = 'automatic' then a.accepted_bid end desc,
              a.bid_updated_at asc, p.full_name, a.id
          ) as sort_rank
        from public.applications a
        join public.profiles p on p.id = a.student_id
        where a.company_id = c.id
          and a.status in ('active_bid', 'confirmation_required', 'confirmed', 'selected', 'finalized')
      ) participant
    ), '[]'::jsonb)
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

revoke all on function private.apply_to_company_committee(uuid) from public, anon, authenticated;
revoke all on function private.withdraw_application_committee(uuid) from public, anon, authenticated;
revoke all on function private.respond_to_bid_increase_committee(uuid, boolean) from public, anon, authenticated;
revoke all on function private.increase_company_bid_committee(uuid, integer, text) from public, anon, authenticated;
revoke all on function private.finalize_company_committee(uuid) from public, anon, authenticated;
revoke all on function private.withdraw_automatic_bid(uuid, uuid) from public, anon, authenticated;
revoke all on function private.finalize_automatic_company(uuid, uuid, boolean) from public, anon, authenticated;

revoke all on function public.apply_to_company(uuid) from public, anon;
revoke all on function public.withdraw_application(uuid) from public, anon;
revoke all on function public.respond_to_bid_increase(uuid, boolean) from public, anon;
revoke all on function public.increase_company_bid(uuid, integer, text) from public, anon;
revoke all on function public.finalize_company(uuid) from public, anon;
revoke all on function public.submit_automatic_bid(uuid, integer) from public, anon;
revoke all on function public.finalize_automatic_bidding(uuid) from public, anon;
revoke all on function public.close_inactive_automatic_bidding() from public, anon, authenticated;
revoke all on function public.get_bid_participants(uuid) from public, anon;
revoke all on function public.get_public_bid_analytics() from public;

grant execute on function public.apply_to_company(uuid) to authenticated;
grant execute on function public.withdraw_application(uuid) to authenticated;
grant execute on function public.respond_to_bid_increase(uuid, boolean) to authenticated;
grant execute on function public.increase_company_bid(uuid, integer, text) to authenticated;
grant execute on function public.finalize_company(uuid) to authenticated;
grant execute on function public.submit_automatic_bid(uuid, integer) to authenticated;
grant execute on function public.finalize_automatic_bidding(uuid) to authenticated;
grant execute on function public.get_bid_participants(uuid) to authenticated;
grant execute on function public.get_public_bid_analytics() to anon, authenticated;

insert into public.system_settings (key, value, description)
values
  ('bidding_modes', '["committee", "automatic"]', 'Each company chooses committee-controlled or automatic ranked bidding.'),
  ('automatic_bid_default_timeout_seconds', '120', 'Default inactivity period before an automatic auction settles.'),
  ('automatic_bid_tie_breaker', '"earliest_bid"', 'Equal bids rank by the earliest time that bid amount was submitted.'),
  ('student_controlled_bids', '"per_company"', 'Student-entered bids are enabled only for companies using automatic bidding.'),
  ('ranked_bid_selection', '"automatic_only"', 'Top-bid ranking is used only for companies using automatic bidding.'),
  ('target_bid_auto_close', '"automatic_only"', 'Automatic companies settle after their configured inactivity timeout; committee companies close through administrator actions.')
on conflict (key) do update
set value = excluded.value,
    description = excluded.description,
    updated_at = now();

-- Supabase Cron supports sub-minute jobs. Install a 10-second settlement poll
-- when pg_cron is available. The function remains callable manually if a local
-- environment does not include the extension.
do $extension$
begin
  execute 'create extension if not exists pg_cron';
exception
  when insufficient_privilege or feature_not_supported or undefined_file then
    raise notice 'pg_cron is unavailable; schedule public.close_inactive_automatic_bidding() externally.';
end;
$extension$;

do $schedule$
declare
  existing_job bigint;
begin
  if to_regnamespace('cron') is null then
    return;
  end if;

  select jobid into existing_job
  from cron.job
  where jobname = 'internbid-close-inactive-automatic-bids';

  if existing_job is not null then
    perform cron.unschedule(existing_job);
  end if;

  perform cron.schedule(
    'internbid-close-inactive-automatic-bids',
    '10 seconds',
    'select public.close_inactive_automatic_bidding();'
  );
exception
  when insufficient_privilege or undefined_function or undefined_table then
    raise notice 'Automatic close cron job could not be installed; configure it in Supabase Cron.';
end;
$schedule$;
