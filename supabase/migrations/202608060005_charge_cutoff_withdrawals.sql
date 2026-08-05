-- Bids outside an automatic company's CV cutoff are forced withdrawals. Apply
-- the same charge as a voluntary automatic withdrawal: the first bid plus the
-- configured percentage of the bidder's increase, capped at usable points.

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
  v_calculated_charge integer;
  v_charge integer;
  v_after_release integer;
  v_selected integer := 0;
  v_forced_withdrawn integer := 0;
  v_total_points integer := 0;
  v_total_cutoff_charges integer := 0;
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
      v_calculated_charge := app_row.initial_bid + ceil(
        greatest(app_row.accepted_bid - app_row.initial_bid, 0)
          * coalesce(
              app_row.bid_response_penalty_percent,
              v_company.withdrawal_penalty_percent
            ) / 100.0
      )::integer;
      v_charge := least(
        v_calculated_charge,
        v_available + app_row.reserved_points
      );
      v_after_release := v_available + app_row.reserved_points;

      update public.profiles
      set reserved_points = reserved_points - app_row.reserved_points,
          spent_points = spent_points + v_charge
      where id = app_row.student_id;

      update public.applications
      set status = 'withdrawn', reserved_points = 0,
          withdrawal_charge = v_charge, withdrawn_at = now(),
          finalized_at = now(), confirmation_deadline = null
      where id = app_row.id;

      if app_row.reserved_points > 0 then
        insert into public.point_transactions (
          student_id, company_id, application_id, type, amount,
          balance_before, balance_after, description, created_by
        ) values (
          app_row.student_id, v_company.id, app_row.id, 'release',
          -app_row.reserved_points, v_available, v_after_release,
          'Cutoff withdrawal reservation released for ' || v_company.name,
          p_actor
        );
      end if;

      if v_charge > 0 then
        insert into public.point_transactions (
          student_id, company_id, application_id, type, amount,
          balance_before, balance_after, description, created_by
        ) values (
          app_row.student_id, v_company.id, app_row.id, 'spend', v_charge,
          v_after_release, v_after_release - v_charge,
          'Automatic bidding cutoff withdrawal charge for ' || v_company.name,
          p_actor
        );
      end if;

      insert into public.notifications (user_id, title, message, kind, action_url)
      values (
        app_row.student_id,
        'Withdrawn outside ' || v_company.name || ' cutoff',
        'Your ' || app_row.accepted_bid || '-point bid ranked #' ||
          app_row.bid_rank || ' outside the available slots. You were withdrawn and a ' ||
          v_charge || '-point charge was deducted.',
        'warning', '/student/activity'
      );

      insert into public.audit_logs (
        actor_id, actor_role, action, entity_type, entity_id, new_value, reason
      ) values (
        p_actor,
        case when p_actor is null then null else 'admin'::public.user_role end,
        'automatic_bid.cutoff_withdrawal', 'application', app_row.id,
        jsonb_build_object(
          'company_id', v_company.id,
          'rank', app_row.bid_rank,
          'initial_bid', app_row.initial_bid,
          'final_bid', app_row.accepted_bid,
          'penalty_percent', coalesce(
            app_row.bid_response_penalty_percent,
            v_company.withdrawal_penalty_percent
          ),
          'calculated_charge', v_calculated_charge,
          'applied_charge', v_charge,
          'charge_capped', v_charge < v_calculated_charge
        ),
        'Bid ranked outside the company CV cutoff'
      );

      v_forced_withdrawn := v_forced_withdrawn + 1;
      v_total_cutoff_charges := v_total_cutoff_charges + v_charge;
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
      'cutoff_withdrawals', v_forced_withdrawn,
      'total_selected_points', v_total_points,
      'total_cutoff_charges', v_total_cutoff_charges,
      'inactivity_timeout_seconds', v_company.inactivity_timeout_seconds
    ),
    case when p_require_expired then 'Inactivity timeout expired'
      else 'Administrator closed automatic auction' end
  );

  return v_company;
end;
$$;

revoke all on function private.finalize_automatic_company(uuid, uuid, boolean)
from public, anon, authenticated;
