-- Administrators can set exact student IP allocations individually or from CSV.
-- CSV imports match registration numbers case-insensitively, default site-only
-- students to 80, and ignore CSV-only students.

alter table public.profiles alter column initial_points set default 80;

create or replace function public.set_student_ip_points(
  p_student_id uuid,
  p_total integer,
  p_reason text
)
returns public.profiles
language plpgsql
security definer set search_path = ''
as $$
declare
  v_profile public.profiles;
  v_before integer;
  v_delta integer;
begin
  if not private.has_role(array['admin']::public.user_role[]) then
    raise exception 'Administrator access is required.' using errcode = 'P0001';
  end if;
  if p_total is null or p_total < 0 then
    raise exception 'Enter a non-negative whole-number IP total.' using errcode = 'P0001';
  end if;
  if nullif(trim(p_reason), '') is null then
    raise exception 'A reason is required.' using errcode = 'P0001';
  end if;

  select * into v_profile
  from public.profiles
  where id = p_student_id
  for update;

  if v_profile.id is null or v_profile.role <> 'student' then
    raise exception 'Student not found.' using errcode = 'P0001';
  end if;
  if p_total < v_profile.reserved_points + v_profile.spent_points then
    raise exception 'The IP total cannot be below % because those points are already reserved or spent.',
      v_profile.reserved_points + v_profile.spent_points using errcode = 'P0001';
  end if;

  v_before := v_profile.initial_points + v_profile.point_adjustments
    - v_profile.reserved_points - v_profile.spent_points;
  v_delta := p_total - (v_profile.initial_points + v_profile.point_adjustments);

  if v_delta = 0 then
    return v_profile;
  end if;

  update public.profiles
  set point_adjustments = point_adjustments + v_delta
  where id = p_student_id
  returning * into v_profile;

  insert into public.point_transactions (
    student_id, type, amount, balance_before, balance_after,
    description, created_by
  ) values (
    p_student_id, 'adjustment', v_delta, v_before,
    p_total - v_profile.reserved_points - v_profile.spent_points,
    trim(p_reason), (select auth.uid())
  );

  insert into public.audit_logs (
    actor_id, actor_role, action, entity_type, entity_id,
    previous_value, new_value, reason
  ) values (
    (select auth.uid()), private.current_role(), 'student.ip_points_set',
    'profile', p_student_id,
    jsonb_build_object(
      'ip_total', p_total - v_delta,
      'available', v_before
    ),
    jsonb_build_object(
      'ip_total', p_total,
      'available', p_total - v_profile.reserved_points - v_profile.spent_points
    ),
    trim(p_reason)
  );

  insert into public.notifications (user_id, title, message, kind, action_url)
  values (
    p_student_id,
    'IP point total updated',
    'Your IP point total was set to ' || p_total || ' points.',
    'info',
    '/student/activity'
  );

  return v_profile;
end;
$$;

create or replace function public.import_student_ip_points(
  p_rows jsonb,
  p_default_total integer default 80
)
returns jsonb
language plpgsql
security definer set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_item jsonb;
  v_profile public.profiles;
  v_index_number text;
  v_seen_indexes text[] := array[]::text[];
  v_target integer;
  v_current_total integer;
  v_before integer;
  v_delta integer;
  v_has_match boolean;
  v_csv_rows integer := 0;
  v_matched integer := 0;
  v_defaulted integer := 0;
  v_ignored integer := 0;
  v_updated integer := 0;
begin
  if not private.has_role(array['admin']::public.user_role[]) then
    raise exception 'Administrator access is required.' using errcode = 'P0001';
  end if;
  if p_default_total is null or p_default_total < 0 then
    raise exception 'The default IP total must be a non-negative whole number.' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'CSV rows must be supplied as an array.' using errcode = 'P0001';
  end if;

  for v_item in
    select csv_item.value
    from jsonb_array_elements(p_rows) as csv_item(value)
  loop
    if jsonb_typeof(v_item) is distinct from 'object' then
      raise exception 'Each CSV row must be an object.' using errcode = 'P0001';
    end if;

    v_index_number := upper(trim(coalesce(v_item ->> 'index_number', '')));
    if v_index_number = '' then
      raise exception 'Every CSV row must contain an index number.' using errcode = 'P0001';
    end if;
    if v_index_number = any(v_seen_indexes) then
      raise exception 'Index number % appears more than once in the CSV.',
        v_index_number using errcode = 'P0001';
    end if;

    begin
      v_target := (v_item ->> 'total')::integer;
    exception
      when invalid_text_representation or numeric_value_out_of_range then
        raise exception 'The IP total for % must be a non-negative whole number.',
          v_index_number using errcode = 'P0001';
    end;
    if v_target is null or v_target < 0 then
      raise exception 'The IP total for % must be a non-negative whole number.',
        v_index_number using errcode = 'P0001';
    end if;

    v_seen_indexes := array_append(v_seen_indexes, v_index_number);
    v_csv_rows := v_csv_rows + 1;
  end loop;

  if v_csv_rows = 0 then
    raise exception 'The CSV does not contain any student rows.' using errcode = 'P0001';
  end if;

  select count(*) into v_ignored
  from jsonb_array_elements(p_rows) as csv_item(value)
  where not exists (
    select 1
    from public.profiles profile
    where profile.role = 'student'
      and upper(trim(coalesce(profile.registration_number, ''))) =
        upper(trim(csv_item.value ->> 'index_number'))
  );

  for v_profile in
    select *
    from public.profiles
    where role = 'student'
    order by id
    for update
  loop
    select (csv_item.value ->> 'total')::integer into v_target
    from jsonb_array_elements(p_rows) as csv_item(value)
    where upper(trim(csv_item.value ->> 'index_number')) =
      upper(trim(coalesce(v_profile.registration_number, '')))
    limit 1;
    v_has_match := found;

    if v_has_match then
      v_matched := v_matched + 1;
    else
      v_target := p_default_total;
      v_defaulted := v_defaulted + 1;
    end if;

    if v_target < v_profile.reserved_points + v_profile.spent_points then
      raise exception 'IP total % for student % is below the % points already reserved or spent. No students were changed.',
        v_target,
        coalesce(v_profile.registration_number, v_profile.id::text),
        v_profile.reserved_points + v_profile.spent_points
        using errcode = 'P0001';
    end if;

    v_current_total := v_profile.initial_points + v_profile.point_adjustments;
    v_before := v_current_total - v_profile.reserved_points - v_profile.spent_points;
    v_delta := v_target - v_current_total;

    if v_delta <> 0 then
      update public.profiles
      set point_adjustments = point_adjustments + v_delta
      where id = v_profile.id;

      insert into public.point_transactions (
        student_id, type, amount, balance_before, balance_after,
        description, created_by
      ) values (
        v_profile.id,
        'adjustment',
        v_delta,
        v_before,
        v_target - v_profile.reserved_points - v_profile.spent_points,
        case
          when v_has_match then 'IP point total set from CSV import.'
          else 'IP point total set to the 80-point CSV default.'
        end,
        v_actor
      );

      insert into public.audit_logs (
        actor_id, actor_role, action, entity_type, entity_id,
        previous_value, new_value, reason
      ) values (
        v_actor,
        private.current_role(),
        case
          when v_has_match then 'student.ip_points_csv_set'
          else 'student.ip_points_csv_defaulted'
        end,
        'profile',
        v_profile.id,
        jsonb_build_object('ip_total', v_current_total, 'available', v_before),
        jsonb_build_object(
          'ip_total', v_target,
          'available', v_target - v_profile.reserved_points - v_profile.spent_points
        ),
        case
          when v_has_match then 'Matched by student index in CSV import.'
          else 'Student was not present in the CSV; applied the default IP total.'
        end
      );

      insert into public.notifications (user_id, title, message, kind, action_url)
      values (
        v_profile.id,
        'IP point total updated',
        'Your IP point total was set to ' || v_target || ' points.',
        'info',
        '/student/activity'
      );

      v_updated := v_updated + 1;
    end if;
  end loop;

  insert into public.audit_logs (
    actor_id, actor_role, action, entity_type,
    previous_value, new_value, reason
  ) values (
    v_actor,
    private.current_role(),
    'student.ip_points_csv_imported',
    'profile',
    null,
    null,
    jsonb_build_object(
      'csv_rows', v_csv_rows,
      'matched_students', v_matched,
      'defaulted_students', v_defaulted,
      'ignored_csv_rows', v_ignored,
      'updated_students', v_updated,
      'default_total', p_default_total
    ),
    'Administrator imported student IP totals from CSV.'
  );

  return jsonb_build_object(
    'csv_rows', v_csv_rows,
    'matched', v_matched,
    'defaulted', v_defaulted,
    'ignored', v_ignored,
    'updated', v_updated
  );
end;
$$;

revoke all on function public.set_student_ip_points(uuid, integer, text)
from public, anon;
revoke all on function public.import_student_ip_points(jsonb, integer)
from public, anon;
grant execute on function public.set_student_ip_points(uuid, integer, text)
to authenticated;
grant execute on function public.import_student_ip_points(jsonb, integer)
to authenticated;
