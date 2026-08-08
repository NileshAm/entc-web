-- Preserve manual bid rounds while allowing an administrator to atomically undo
-- the most recent active increase and every balance/application effect it caused.

alter table public.bid_history
add column if not exists reverted_at timestamptz,
add column if not exists reverted_by uuid references public.profiles(id),
add column if not exists revert_reason text;

create index if not exists bid_history_active_company_created_idx
on public.bid_history (company_id, created_at desc)
where reverted_at is null;

create or replace function public.revert_last_manual_bid(
  p_company_id uuid,
  p_reason text default null
)
returns public.companies
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_company public.companies;
  v_history public.bid_history;
  v_application record;
  v_available integer;
  v_reservation_change integer;
  v_restored_status public.application_status;
  v_refunded integer := 0;
  v_released integer := 0;
  v_restored_students integer := 0;
  v_readded_students integer := 0;
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
  if v_company.bidding_mode <> 'committee' then
    raise exception 'Only a manual bidding round can be reverted.' using errcode = 'P0001';
  end if;
  if v_company.status not in ('open', 'paused', 'bid_increase_pending') then
    raise exception 'The latest bid can only be reverted while manual bidding is active.'
      using errcode = 'P0001';
  end if;
  if v_company.manual_round_deadline is not null
    and clock_timestamp() >= v_company.manual_round_deadline then
    raise exception 'This response deadline has passed and the manual round can no longer be reverted.'
      using errcode = 'P0001';
  end if;

  select * into v_history
  from public.bid_history
  where company_id = v_company.id
    and reverted_at is null
    and new_bid = v_company.current_bid
  order by created_at desc, id desc
  limit 1
  for update;

  if v_history.id is null then
    raise exception 'There is no active manual bid increase to revert.' using errcode = 'P0001';
  end if;

  -- The cohort is still in active_bid before its first committee increase and
  -- confirmed before every later increase. Restore that exact phase as well.
  v_restored_status := case
    when exists (
      select 1
      from public.bid_history h
      where h.company_id = v_company.id
        and h.reverted_at is null
        and (h.created_at, h.id) < (v_history.created_at, v_history.id)
    ) then 'confirmed'::public.application_status
    else 'active_bid'::public.application_status
  end;

  for v_application in
    select
      a.id,
      a.student_id,
      a.status,
      a.reserved_points as application_reserved_points,
      a.withdrawal_charge,
      a.withdrawn_at,
      p.initial_points,
      p.point_adjustments,
      p.reserved_points as profile_reserved_points,
      p.spent_points
    from public.applications a
    join public.profiles p on p.id = a.student_id
    where a.company_id = v_company.id
      and (
        a.status in ('active_bid', 'confirmed', 'confirmation_required')
        or (
          a.status = 'withdrawn'
          and a.withdrawn_at >= v_history.created_at
        )
      )
    order by a.id
    for update of a, p
  loop
    v_available := v_application.initial_points
      + v_application.point_adjustments
      - v_application.profile_reserved_points
      - v_application.spent_points;

    if v_application.status = 'withdrawn' then
      if v_application.withdrawal_charge > v_application.spent_points then
        raise exception 'The withdrawal charge for one student cannot be refunded safely.'
          using errcode = 'P0001';
      end if;
      if v_available + v_application.withdrawal_charge < v_history.previous_bid then
        raise exception 'A withdrawn student no longer has enough available points to restore the previous % point reservation.',
          v_history.previous_bid using errcode = 'P0001';
      end if;

      update public.profiles
      set reserved_points = reserved_points + v_history.previous_bid,
          spent_points = spent_points - v_application.withdrawal_charge
      where id = v_application.student_id;

      update public.applications
      set status = v_restored_status,
          accepted_bid = v_history.previous_bid,
          reserved_points = v_history.previous_bid,
          withdrawal_charge = 0,
          bid_response_penalty_percent = null,
          confirmation_deadline = null,
          withdrawn_at = null,
          finalized_at = null
      where id = v_application.id;

      if v_application.withdrawal_charge > 0 then
        insert into public.point_transactions (
          student_id, company_id, application_id, type, amount,
          balance_before, balance_after, description, created_by
        ) values (
          v_application.student_id, v_company.id, v_application.id,
          'refund', v_application.withdrawal_charge,
          v_available, v_available + v_application.withdrawal_charge,
          'Withdrawal charge refunded after reverting the latest manual bid for ' ||
            v_company.name,
          v_actor
        );
      end if;

      if v_history.previous_bid > 0 then
        insert into public.point_transactions (
          student_id, company_id, application_id, type, amount,
          balance_before, balance_after, description, created_by
        ) values (
          v_application.student_id, v_company.id, v_application.id,
          'reservation', v_history.previous_bid,
          v_available + v_application.withdrawal_charge,
          v_available + v_application.withdrawal_charge - v_history.previous_bid,
          'Previous manual bid restored for ' || v_company.name,
          v_actor
        );
      end if;

      v_refunded := v_refunded + v_application.withdrawal_charge;
      v_readded_students := v_readded_students + 1;
    else
      v_reservation_change := v_history.previous_bid
        - v_application.application_reserved_points;

      if v_reservation_change > v_available then
        raise exception 'A student no longer has enough available points to restore the previous % point reservation.',
          v_history.previous_bid using errcode = 'P0001';
      end if;
      if v_application.profile_reserved_points + v_reservation_change < 0 then
        raise exception 'A student reservation cannot be restored safely.' using errcode = 'P0001';
      end if;

      update public.profiles
      set reserved_points = reserved_points + v_reservation_change
      where id = v_application.student_id;

      update public.applications
      set status = v_restored_status,
          accepted_bid = v_history.previous_bid,
          reserved_points = v_history.previous_bid,
          bid_response_penalty_percent = null,
          confirmation_deadline = null
      where id = v_application.id;

      if v_reservation_change < 0 then
        insert into public.point_transactions (
          student_id, company_id, application_id, type, amount,
          balance_before, balance_after, description, created_by
        ) values (
          v_application.student_id, v_company.id, v_application.id,
          'release', v_reservation_change,
          v_available, v_available - v_reservation_change,
          'Bid increase reservation released after reverting ' || v_company.name,
          v_actor
        );
        v_released := v_released - v_reservation_change;
      elsif v_reservation_change > 0 then
        insert into public.point_transactions (
          student_id, company_id, application_id, type, amount,
          balance_before, balance_after, description, created_by
        ) values (
          v_application.student_id, v_company.id, v_application.id,
          'reservation', v_reservation_change,
          v_available, v_available - v_reservation_change,
          'Previous manual bid restored for ' || v_company.name,
          v_actor
        );
      end if;
    end if;

    v_restored_students := v_restored_students + 1;

    insert into public.notifications (user_id, title, message, kind, action_url)
    values (
      v_application.student_id,
      'Manual bid reverted for ' || v_company.name,
      case
        when v_application.status = 'withdrawn' then
          'The latest bid increase was reverted. Your withdrawal charge was refunded and you were re-added at ' ||
            v_history.previous_bid || ' points.'
        else
          'The latest bid increase was reverted. Your reservation is now ' ||
            v_history.previous_bid || ' points and no response is required.'
      end,
      'info',
      '/student'
    );
  end loop;

  update public.bid_history
  set reverted_at = now(),
      reverted_by = v_actor,
      revert_reason = nullif(trim(p_reason), '')
  where id = v_history.id;

  update public.companies
  set current_bid = v_history.previous_bid,
      status = 'open',
      manual_round_deadline = null
  where id = v_company.id;

  perform private.recompute_company_counts(v_company.id);

  insert into public.audit_logs (
    actor_id, actor_role, action, entity_type, entity_id,
    previous_value, new_value, reason
  ) values (
    v_actor,
    private.current_role(),
    'company.bid_reverted',
    'company',
    v_company.id,
    jsonb_build_object(
      'bid', v_history.new_bid,
      'bid_history_id', v_history.id,
      'round_started_at', v_history.created_at
    ),
    jsonb_build_object(
      'bid', v_history.previous_bid,
      'restored_students', v_restored_students,
      'readded_students', v_readded_students,
      'refunded_points', v_refunded,
      'released_points', v_released
    ),
    nullif(trim(p_reason), '')
  );

  select * into v_company
  from public.companies
  where id = p_company_id;

  return v_company;
end;
$$;

revoke all on function public.revert_last_manual_bid(uuid, text)
from public, anon;
grant execute on function public.revert_last_manual_bid(uuid, text)
to authenticated;

comment on function public.revert_last_manual_bid(uuid, text) is
  'Atomically reverts the latest manual bid round, its point effects, and withdrawals made during that round.';
