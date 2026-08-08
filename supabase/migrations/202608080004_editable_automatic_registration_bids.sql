-- Let registered students revise their automatic bid throughout the
-- registration window. Reservation increases and releases remain atomic, the
-- auction timer stays stopped, and full withdrawal remains free until open.

alter function public.submit_automatic_bid(uuid, integer)
rename to submit_automatic_bid_with_initial_registration;
alter function public.submit_automatic_bid_with_initial_registration(uuid, integer)
set schema private;

create or replace function private.upsert_automatic_registration_bid(
  p_company_id uuid,
  p_bid integer,
  p_actor uuid
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
  v_previous_bid integer;
  v_previous_reserved integer := 0;
  v_reservation_change integer;
  v_was_registered boolean := false;
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
  if v_company.status <> 'registration_open' then
    raise exception 'Registration has closed. The active auction is locked to its registered students.'
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

  select * into v_application
  from public.applications
  where student_id = p_actor and company_id = p_company_id
  for update;

  if v_application.id is not null
    and v_application.status not in (
      'active_bid', 'confirmed', 'withdrawn', 'cancelled', 'not_selected'
    ) then
    raise exception 'This registration bid can no longer be changed.'
      using errcode = 'P0001';
  end if;

  v_was_registered := v_application.id is not null
    and v_application.status in ('active_bid', 'confirmed');
  if v_was_registered then
    v_previous_bid := v_application.accepted_bid;
    v_previous_reserved := v_application.reserved_points;
  end if;

  select * into v_profile
  from public.profiles
  where id = p_actor
  for update;

  if v_profile.id is null or v_profile.role <> 'student'
    or v_profile.account_status <> 'active' then
    raise exception 'Only active students can bid.' using errcode = 'P0001';
  end if;

  v_available := v_profile.initial_points + v_profile.point_adjustments
    - v_profile.reserved_points - v_profile.spent_points;
  v_reservation_change := p_bid - v_previous_reserved;

  if v_reservation_change > v_available then
    raise exception 'You need % additional points, but only % points are available.',
      v_reservation_change, v_available using errcode = 'P0001';
  end if;

  update public.profiles
  set reserved_points = reserved_points + v_reservation_change
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
        applied_at = case when v_was_registered then applied_at else v_now end,
        bid_updated_at = case
          when v_was_registered and v_previous_bid = p_bid then bid_updated_at
          else v_now
        end,
        confirmation_deadline = null,
        confirmed_at = v_now,
        withdrawn_at = null,
        finalized_at = null
    where id = v_application.id
    returning * into v_application;
  end if;

  if v_reservation_change > 0 then
    insert into public.point_transactions (
      student_id, company_id, application_id, type, amount,
      balance_before, balance_after, description, created_by
    ) values (
      v_profile.id, v_company.id, v_application.id, 'reservation',
      v_reservation_change, v_available,
      v_available - v_reservation_change,
      case when v_was_registered
        then 'Automatic registration bid increased for ' || v_company.name
        else 'Automatic registration bid reserved for ' || v_company.name
      end,
      v_profile.id
    );
  elsif v_reservation_change < 0 then
    insert into public.point_transactions (
      student_id, company_id, application_id, type, amount,
      balance_before, balance_after, description, created_by
    ) values (
      v_profile.id, v_company.id, v_application.id, 'release',
      v_reservation_change, v_available,
      v_available - v_reservation_change,
      'Automatic registration bid reduced for ' || v_company.name,
      v_profile.id
    );
  end if;

  insert into public.notifications (user_id, title, message, kind, action_url)
  values (
    v_profile.id,
    case when v_was_registered
      then 'Registration bid updated for ' || v_company.name
      else 'Registration bid placed for ' || v_company.name
    end,
    'Your ' || p_bid || '-point bid is registered. You can update it or withdraw without a charge until live bidding starts.',
    'success',
    '/student/companies/' || v_company.slug
  );

  insert into public.audit_logs (
    actor_id, actor_role, action, entity_type, entity_id,
    previous_value, new_value
  ) values (
    v_profile.id, v_profile.role,
    case when v_was_registered
      then 'automatic_bid.pre_registration_updated'
      else 'automatic_bid.pre_registered'
    end,
    'application', v_application.id,
    jsonb_build_object('bid', v_previous_bid),
    jsonb_build_object(
      'company_id', v_company.id,
      'bid', p_bid,
      'reservation_change', v_reservation_change,
      'live_timer_started', false
    )
  );

  return v_application;
end;
$$;

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
  v_mode text;
  v_status public.company_status;
begin
  select bidding_mode, status into v_mode, v_status
  from public.companies
  where id = p_company_id;

  if v_mode is null then
    raise exception 'Company not found.' using errcode = 'P0001';
  end if;
  if v_mode <> 'automatic' then
    raise exception 'This company is committee controlled.' using errcode = 'P0001';
  end if;

  if v_status = 'registration_open' then
    return private.upsert_automatic_registration_bid(
      p_company_id,
      p_bid,
      (select auth.uid())
    );
  end if;

  return private.submit_automatic_bid_with_initial_registration(
    p_company_id,
    p_bid
  );
end;
$$;

revoke all on function private.upsert_automatic_registration_bid(uuid, integer, uuid)
from public, anon, authenticated;
revoke all on function private.submit_automatic_bid_with_initial_registration(uuid, integer)
from public, anon, authenticated;
revoke all on function public.submit_automatic_bid(uuid, integer) from public, anon;
grant execute on function public.submit_automatic_bid(uuid, integer)
to authenticated;

update public.system_settings
set description = 'Students can place, update, or freely withdraw automatic bids during registration; the registered cohort locks when live bidding starts.',
    updated_at = now()
where key = 'pre_bidding_registration';
