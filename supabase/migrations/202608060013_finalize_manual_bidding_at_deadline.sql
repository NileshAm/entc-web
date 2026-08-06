-- A committee response deadline is now terminal for the company. Settle missed
-- responses, select up to the CV requirement, release non-selected reserves,
-- deduct winner bids, and finalize the company in one locked transaction.

alter table public.companies
add column if not exists manual_round_deadline timestamptz;

create index if not exists companies_manual_round_deadline_idx
on public.companies (manual_round_deadline)
where bidding_mode = 'committee'
  and status in ('open', 'bid_increase_pending');

-- Keep one durable deadline on the company. Individual response actions can
-- clear their application deadline, but must not make the round disappear
-- before the admin page or the scheduled processor settles it.
update public.companies c
set manual_round_deadline = due.deadline
from (
  select company_id, max(confirmation_deadline) as deadline
  from public.applications
  where status in ('confirmation_required', 'confirmed')
    and confirmation_deadline is not null
  group by company_id
) due
where c.id = due.company_id
  and c.bidding_mode = 'committee'
  and c.status in ('open', 'bid_increase_pending');

create or replace function public.increase_company_bid(
  p_company_id uuid,
  p_custom_bid integer default null,
  p_reason text default null
)
returns public.companies
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company public.companies;
  v_deadline timestamptz;
begin
  if not exists (
    select 1 from public.companies
    where id = p_company_id and bidding_mode = 'committee'
  ) then
    raise exception 'Administrators cannot increase bids for an automatic company.'
      using errcode = 'P0001';
  end if;

  v_company := private.increase_company_bid_committee(
    p_company_id,
    p_custom_bid,
    p_reason
  );

  select max(confirmation_deadline) into v_deadline
  from public.applications
  where company_id = p_company_id
    and status = 'confirmation_required';

  update public.companies
  set manual_round_deadline = v_deadline
  where id = p_company_id
  returning * into v_company;

  return v_company;
end;
$$;

create or replace function private.finalize_expired_committee_company(
  p_company_id uuid,
  p_actor uuid
)
returns public.companies
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company public.companies;
  v_deadline timestamptz;
  app_row record;
  v_available integer;
  v_selected integer := 0;
  v_not_selected integer := 0;
  v_withdrawn integer := 0;
  v_total_points integer := 0;
begin
  select * into v_company
  from public.companies
  where id = p_company_id
  for update;

  if v_company.id is null or v_company.bidding_mode <> 'committee' then
    raise exception 'Manual bidding company not found.' using errcode = 'P0001';
  end if;
  if v_company.status = 'finalized' then
    return v_company;
  end if;
  if v_company.status not in ('open', 'bid_increase_pending') then
    raise exception 'This manual bidding round cannot be finalized.' using errcode = 'P0001';
  end if;

  v_deadline := v_company.manual_round_deadline;

  if v_deadline is null then
    select max(confirmation_deadline) into v_deadline
    from public.applications
    where company_id = p_company_id
      and status in ('confirmation_required', 'confirmed')
      and confirmation_deadline is not null;
  end if;

  if v_deadline is null or clock_timestamp() < v_deadline then
    raise exception 'The manual bidding deadline has not expired.' using errcode = 'P0001';
  end if;

  for app_row in
    select id
    from public.applications
    where company_id = p_company_id
      and status = 'confirmation_required'
      and confirmation_deadline <= clock_timestamp()
    order by id
  loop
    perform private.withdraw_after_bid_increase(
      app_row.id,
      null,
      'Manual bidding deadline expired'
    );
    v_withdrawn := v_withdrawn + 1;
  end loop;

  if exists (
    select 1 from public.applications
    where company_id = p_company_id and status = 'confirmation_required'
  ) then
    raise exception 'Some manual responses are still pending.' using errcode = 'P0001';
  end if;

  for app_row in
    with ranked as (
      select id,
        row_number() over (
          order by accepted_bid desc, bid_updated_at asc, id asc
        ) as bid_rank
      from public.applications
      where company_id = p_company_id
        and status in ('active_bid', 'confirmed')
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
        'Selected manual bid for ' || v_company.name, p_actor
      );

      insert into public.notifications (user_id, title, message, kind, action_url)
      values (
        app_row.student_id,
        'Selected for ' || v_company.name,
        'You were selected at ' || app_row.accepted_bid || ' points.',
        'success',
        '/student/companies/' || v_company.slug || '?roundResults=1'
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
          'Manual bid not selected; reservation released for ' || v_company.name,
          p_actor
        );
      end if;

      insert into public.notifications (user_id, title, message, kind, action_url)
      values (
        app_row.student_id,
        'Not selected for ' || v_company.name,
        'The manual round ended outside the available positions. Your reservation was released.',
        'info',
        '/student/companies/' || v_company.slug || '?roundResults=1'
      );

      v_not_selected := v_not_selected + 1;
    end if;
  end loop;

  update public.companies
  set status = 'finalized', finalized_at = now(), manual_round_deadline = null
  where id = v_company.id
  returning * into v_company;

  insert into public.audit_logs (
    actor_id, actor_role, action, entity_type, entity_id, new_value, reason
  ) values (
    p_actor,
    case when p_actor is null then null else 'admin'::public.user_role end,
    'committee_bid.deadline_finalized', 'company', v_company.id,
    jsonb_build_object(
      'selected', v_selected,
      'not_selected', v_not_selected,
      'timeout_withdrawals', v_withdrawn,
      'total_selected_points', v_total_points,
      'deadline', v_deadline
    ),
    'Manual response timer ended'
  );

  return v_company;
end;
$$;

create or replace function public.finish_expired_committee_bidding(p_company_id uuid)
returns public.companies
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_role(array['admin']::public.user_role[]) then
    raise exception 'Administrator access is required.' using errcode = 'P0001';
  end if;
  return private.finalize_expired_committee_company(
    p_company_id,
    (select auth.uid())
  );
end;
$$;

create or replace function public.process_expired_bid_responses()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  due_company record;
  processed integer := 0;
begin
  for due_company in
    select c.id
    from public.companies c
    where c.bidding_mode = 'committee'
      and c.status in ('open', 'bid_increase_pending')
      and c.manual_round_deadline is not null
      and c.manual_round_deadline <= clock_timestamp()
    order by c.id
  loop
    begin
      perform private.finalize_expired_committee_company(
        due_company.id,
        null
      );
      processed := processed + 1;
    exception when sqlstate 'P0001' then
      null;
    end;
  end loop;
  return processed;
end;
$$;

revoke all on function private.finalize_expired_committee_company(uuid, uuid)
from public, anon, authenticated;
revoke all on function public.increase_company_bid(uuid, integer, text)
from public, anon;
revoke all on function public.finish_expired_committee_bidding(uuid)
from public, anon;
revoke all on function public.process_expired_bid_responses()
from public, anon, authenticated;
grant execute on function public.finish_expired_committee_bidding(uuid)
to authenticated;
grant execute on function public.increase_company_bid(uuid, integer, text)
to authenticated;

insert into public.system_settings (key, value, description)
values (
  'committee_deadline_finalization',
  'true',
  'Manual response deadlines finalize the company and publish selected outcomes.'
)
on conflict (key) do update
set value = excluded.value,
    description = excluded.description,
    updated_at = now();
