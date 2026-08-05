-- InternBid: secure, transactional schema for Supabase PostgreSQL.
-- Run with `supabase db push` or paste into the Supabase SQL editor.

create extension if not exists pgcrypto;
create schema if not exists private;

create type public.user_role as enum ('student', 'admin', 'viewer');
create type public.account_status as enum ('active', 'disabled');
create type public.company_status as enum (
  'upcoming', 'open', 'paused', 'bid_increase_pending',
  'closed', 'finalized', 'cancelled'
);
create type public.application_status as enum (
  'active_bid', 'confirmation_required', 'confirmed', 'withdrawn',
  'selected', 'not_selected', 'finalized', 'cancelled'
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text not null,
  registration_number text unique,
  role public.user_role not null default 'student',
  initial_points integer not null default 100 check (initial_points >= 0),
  point_adjustments integer not null default 0,
  reserved_points integer not null default 0 check (reserved_points >= 0),
  spent_points integer not null default 0 check (spent_points >= 0),
  account_status public.account_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint non_negative_available_points check (
    initial_points + point_adjustments - reserved_points - spent_points >= 0
  )
);

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  description text,
  logo_url text,
  industry text not null,
  location text not null,
  available_roles text[] not null default '{}',
  required_skills text[] not null default '{}',
  internship_duration text,
  website_url text,
  contact_name text,
  contact_email text,
  notes_for_students text,
  internal_notes text,
  cv_requirement integer not null check (cv_requirement > 0),
  minimum_bid integer not null check (minimum_bid >= 0),
  current_bid integer not null check (current_bid >= 0),
  bid_increment integer not null default 5 check (bid_increment > 0),
  maximum_bid integer check (maximum_bid is null or maximum_bid >= current_bid),
  opens_at timestamptz,
  closes_at timestamptz,
  response_duration_minutes integer not null default 10 check (response_duration_minutes > 0),
  status public.company_status not null default 'upcoming',
  applicant_count integer not null default 0 check (applicant_count >= 0),
  confirmed_count integer not null default 0 check (confirmed_count >= 0),
  pending_count integer not null default 0 check (pending_count >= 0),
  withdrawal_count integer not null default 0 check (withdrawal_count >= 0),
  created_by uuid references public.profiles(id),
  finalized_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint current_bid_meets_minimum check (current_bid >= minimum_bid),
  constraint valid_company_window check (
    closes_at is null or opens_at is null or closes_at > opens_at
  )
);

create table public.applications (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete restrict,
  company_id uuid not null references public.companies(id) on delete restrict,
  initial_bid integer not null check (initial_bid >= 0),
  accepted_bid integer not null check (accepted_bid >= 0),
  reserved_points integer not null default 0 check (reserved_points >= 0),
  final_points_deducted integer not null default 0 check (final_points_deducted >= 0),
  status public.application_status not null default 'active_bid',
  applied_at timestamptz not null default now(),
  confirmation_deadline timestamptz,
  confirmed_at timestamptz,
  withdrawn_at timestamptz,
  finalized_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_id, company_id)
);

create table public.point_transactions (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete restrict,
  company_id uuid references public.companies(id) on delete restrict,
  application_id uuid references public.applications(id) on delete restrict,
  type text not null check (type in (
    'reservation', 'release', 'spend', 'refund', 'adjustment'
  )),
  amount integer not null,
  balance_before integer not null,
  balance_after integer not null,
  description text not null,
  status text not null default 'completed',
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.bid_history (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  previous_bid integer not null,
  new_bid integer not null check (new_bid > previous_bid),
  bid_increment integer not null,
  applicant_count_before integer not null,
  applicant_count_after integer,
  reason text,
  changed_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  message text not null,
  kind text not null default 'info',
  action_url text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id),
  actor_role public.user_role,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  previous_value jsonb,
  new_value jsonb,
  ip_address inet,
  reason text,
  created_at timestamptz not null default now()
);

create table public.system_settings (
  key text primary key,
  value jsonb not null,
  description text,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

create index applications_student_idx on public.applications(student_id, status);
create index applications_company_idx on public.applications(company_id, status);
create index transactions_student_created_idx on public.point_transactions(student_id, created_at desc);
create index notifications_user_created_idx on public.notifications(user_id, created_at desc);
create index audit_created_idx on public.audit_logs(created_at desc);
create index companies_status_idx on public.companies(status);

create or replace function private.has_role(allowed_roles public.user_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid())
      and role = any(allowed_roles)
      and account_status = 'active'
  );
$$;

create or replace function private.current_role()
returns public.user_role
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.profiles where id = (select auth.uid());
$$;

create or replace function private.assert_active_user()
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  result public.profiles;
begin
  select * into result
  from public.profiles
  where id = (select auth.uid()) and account_status = 'active';

  if result.id is null then
    raise exception 'Your account is not active.' using errcode = 'P0001';
  end if;
  return result;
end;
$$;

create or replace function private.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_touch before update on public.profiles
for each row execute function private.touch_updated_at();
create trigger companies_touch before update on public.companies
for each row execute function private.touch_updated_at();
create trigger applications_touch before update on public.applications
for each row execute function private.touch_updated_at();

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name, registration_number)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(coalesce(new.email, 'Student'), '@', 1)),
    nullif(new.raw_user_meta_data ->> 'registration_number', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function private.handle_new_user();

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

create or replace function private.refresh_company_counts_insert()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare target_company uuid;
begin
  for target_company in select distinct company_id from inserted_rows loop
    perform private.recompute_company_counts(target_company);
  end loop;
  return null;
end;
$$;

create or replace function private.refresh_company_counts_update()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare target_company uuid;
begin
  for target_company in
    select company_id from inserted_rows union select company_id from deleted_rows
  loop
    perform private.recompute_company_counts(target_company);
  end loop;
  return null;
end;
$$;

create or replace function private.refresh_company_counts_delete()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare target_company uuid;
begin
  for target_company in select distinct company_id from deleted_rows loop
    perform private.recompute_company_counts(target_company);
  end loop;
  return null;
end;
$$;

create trigger applications_refresh_counts_after_insert
after insert on public.applications
referencing new table as inserted_rows
for each statement execute function private.refresh_company_counts_insert();

create trigger applications_refresh_counts_after_update
after update on public.applications
referencing old table as deleted_rows new table as inserted_rows
for each statement execute function private.refresh_company_counts_update();

create trigger applications_refresh_counts_after_delete
after delete on public.applications
referencing old table as deleted_rows
for each statement execute function private.refresh_company_counts_delete();

-- Sanitized high-scale realtime messages. No student identity is broadcast.
create or replace function private.broadcast_company_change()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  perform realtime.send(
    jsonb_build_object(
      'company_id', new.id,
      'status', new.status,
      'current_bid', new.current_bid,
      'applicant_count', new.applicant_count,
      'pending_count', new.pending_count,
      'updated_at', new.updated_at
    ),
    'company_changed',
    'bidding:live',
    true
  );
  return null;
end;
$$;

create trigger companies_broadcast
after insert or update on public.companies
for each row execute function private.broadcast_company_change();

create or replace function private.broadcast_notification()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  perform realtime.send(
    jsonb_build_object(
      'notification_id', new.id,
      'kind', new.kind,
      'created_at', new.created_at
    ),
    'notification_created',
    'student:' || new.user_id::text,
    true
  );
  return null;
end;
$$;

create trigger notifications_broadcast
after insert on public.notifications
for each row execute function private.broadcast_notification();

-- Core transactional RPC: apply and atomically reserve points.
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
  select * into v_profile from public.profiles
  where id = (select auth.uid()) for update;
  if v_profile.id is null or v_profile.role <> 'student' or v_profile.account_status <> 'active' then
    raise exception 'Only active students can apply.' using errcode = 'P0001';
  end if;

  select * into v_company from public.companies
  where id = p_company_id for update;
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

  select * into v_application from public.applications
  where student_id = v_profile.id and company_id = v_company.id for update;
  if v_application.id is not null and v_application.status not in ('withdrawn', 'cancelled', 'not_selected') then
    raise exception 'You already have an application for this company.' using errcode = 'P0001';
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
      student_id, company_id, initial_bid, accepted_bid, reserved_points, status
    ) values (
      v_profile.id, v_company.id, v_company.current_bid,
      v_company.current_bid, v_company.current_bid, 'active_bid'
    ) returning * into v_application;
  else
    update public.applications set
      initial_bid = v_company.current_bid,
      accepted_bid = v_company.current_bid,
      reserved_points = v_company.current_bid,
      final_points_deducted = 0,
      status = 'active_bid',
      applied_at = now(),
      confirmation_deadline = null,
      confirmed_at = now(),
      withdrawn_at = null,
      finalized_at = null
    where id = v_application.id returning * into v_application;
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
    v_application.id, jsonb_build_object('company_id', v_company.id, 'bid', v_company.current_bid)
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
  v_application public.applications;
  v_profile public.profiles;
  v_company public.companies;
  v_available integer;
begin
  select * into v_application from public.applications
  where id = p_application_id and student_id = (select auth.uid()) for update;
  if v_application.id is null then
    raise exception 'Application not found.' using errcode = 'P0001';
  end if;
  if v_application.status not in ('active_bid', 'confirmation_required', 'confirmed') then
    raise exception 'This application can no longer be withdrawn.' using errcode = 'P0001';
  end if;

  select * into v_profile from public.profiles where id = v_application.student_id for update;
  select * into v_company from public.companies where id = v_application.company_id for update;
  if v_company.status in ('finalized', 'cancelled') then
    raise exception 'This bidding session no longer permits withdrawal.' using errcode = 'P0001';
  end if;

  v_available := v_profile.initial_points + v_profile.point_adjustments
    - v_profile.reserved_points - v_profile.spent_points;
  update public.profiles
  set reserved_points = reserved_points - v_application.reserved_points
  where id = v_profile.id;

  update public.applications set
    status = 'withdrawn', reserved_points = 0, withdrawn_at = now(),
    confirmation_deadline = null
  where id = v_application.id returning * into v_application;

  insert into public.point_transactions (
    student_id, company_id, application_id, type, amount,
    balance_before, balance_after, description, created_by
  ) values (
    v_profile.id, v_company.id, v_application.id, 'release',
    -v_application.accepted_bid, v_available,
    v_available + v_application.accepted_bid,
    'Reserved points released for ' || v_company.name, v_profile.id
  );

  insert into public.audit_logs (
    actor_id, actor_role, action, entity_type, entity_id, new_value
  ) values (
    v_profile.id, v_profile.role, 'application.withdrawn', 'application',
    v_application.id, jsonb_build_object('company_id', v_company.id)
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
  v_application public.applications;
  v_profile public.profiles;
  v_company public.companies;
  v_available integer;
  v_additional integer;
begin
  select * into v_application from public.applications
  where id = p_application_id and student_id = (select auth.uid()) for update;
  if v_application.id is null or v_application.status <> 'confirmation_required' then
    raise exception 'No bid confirmation is pending for this application.' using errcode = 'P0001';
  end if;
  if v_application.confirmation_deadline is not null and now() >= v_application.confirmation_deadline then
    raise exception 'The response deadline has passed.' using errcode = 'P0001';
  end if;

  select * into v_profile from public.profiles where id = v_application.student_id for update;
  select * into v_company from public.companies where id = v_application.company_id for update;
  v_available := v_profile.initial_points + v_profile.point_adjustments
    - v_profile.reserved_points - v_profile.spent_points;

  if not p_accept then
    update public.profiles
    set reserved_points = reserved_points - v_application.reserved_points
    where id = v_profile.id;
    update public.applications set
      status = 'withdrawn', reserved_points = 0, withdrawn_at = now(),
      confirmation_deadline = null
    where id = v_application.id returning * into v_application;
    insert into public.point_transactions (
      student_id, company_id, application_id, type, amount,
      balance_before, balance_after, description, created_by
    ) values (
      v_profile.id, v_company.id, v_application.id, 'release',
      -v_application.accepted_bid, v_available,
      v_available + v_application.accepted_bid,
      'Bid rejected; reserved points released for ' || v_company.name, v_profile.id
    );
  else
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
    update public.applications set
      accepted_bid = v_company.current_bid,
      reserved_points = v_company.current_bid,
      status = 'confirmed',
      confirmed_at = now(),
      confirmation_deadline = null
    where id = v_application.id returning * into v_application;
    if v_additional > 0 then
      insert into public.point_transactions (
        student_id, company_id, application_id, type, amount,
        balance_before, balance_after, description, created_by
      ) values (
        v_profile.id, v_company.id, v_application.id, 'reservation',
        v_additional, v_available, v_available - v_additional,
        'Additional points reserved for the increased ' || v_company.name || ' bid', v_profile.id
      );
    end if;
  end if;

  insert into public.audit_logs (
    actor_id, actor_role, action, entity_type, entity_id, new_value
  ) values (
    v_profile.id, v_profile.role,
    case when p_accept then 'bid_increase.accepted' else 'bid_increase.rejected' end,
    'application', v_application.id,
    jsonb_build_object('company_id', v_company.id, 'bid', v_company.current_bid)
  );

  if not exists (
    select 1 from public.applications
    where company_id = v_company.id and status = 'confirmation_required'
  ) then
    update public.companies set status = 'open'
    where id = v_company.id and status = 'bid_increase_pending';
    update public.bid_history set applicant_count_after = (
      select count(*) from public.applications
      where company_id = v_company.id
        and status in ('active_bid', 'confirmed', 'selected', 'finalized')
    ) where id = (
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
  select * into v_company from public.companies where id = p_company_id for update;
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
    raise exception 'The new bid exceeds the configured maximum of %.', v_company.maximum_bid using errcode = 'P0001';
  end if;
  v_deadline := now() + make_interval(mins => v_company.response_duration_minutes);

  insert into public.bid_history (
    company_id, previous_bid, new_bid, bid_increment,
    applicant_count_before, reason, changed_by
  ) values (
    v_company.id, v_company.current_bid, v_new_bid,
    v_new_bid - v_company.current_bid, v_company.applicant_count,
    nullif(trim(p_reason), ''), (select auth.uid())
  );

  update public.companies
  set current_bid = v_new_bid, status = 'bid_increase_pending'
  where id = v_company.id returning * into v_company;

  update public.applications
  set status = 'confirmation_required', confirmation_deadline = v_deadline
  where company_id = v_company.id
    and status in ('active_bid', 'confirmed');

  insert into public.notifications (user_id, title, message, kind, action_url)
  select student_id, 'Bid increased for ' || v_company.name,
    'The new bid is ' || v_new_bid || ' points. Respond before ' || to_char(v_deadline, 'DD Mon HH24:MI') || '.',
    'action_required', '/student'
  from public.applications
  where company_id = v_company.id and status = 'confirmation_required';

  insert into public.audit_logs (
    actor_id, actor_role, action, entity_type, entity_id, previous_value, new_value, reason
  ) values (
    (select auth.uid()), private.current_role(), 'company.bid_increased', 'company', v_company.id,
    jsonb_build_object('bid', v_old_bid),
    jsonb_build_object('bid', v_new_bid, 'deadline', v_deadline), nullif(trim(p_reason), '')
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
  select * into v_company from public.companies where id = p_company_id for update;
  if v_company.id is null then
    raise exception 'Company not found.' using errcode = 'P0001';
  end if;
  if v_company.status = 'finalized' then
    raise exception 'A finalized company must use the reversal workflow.' using errcode = 'P0001';
  end if;
  v_previous := v_company.status;

  -- Safe policy default: only one live company at a time.
  if p_status = 'open' and exists (
    select 1 from public.companies
    where id <> p_company_id and status in ('open', 'bid_increase_pending')
  ) then
    raise exception 'Another company is already live. Pause or close it first.' using errcode = 'P0001';
  end if;

  if p_status = 'cancelled' then
    for released in
      select a.*, p.initial_points, p.point_adjustments, p.reserved_points as profile_reserved,
        p.spent_points, c.name as company_name
      from public.applications a
      join public.profiles p on p.id = a.student_id
      join public.companies c on c.id = a.company_id
      where a.company_id = p_company_id
        and a.status in ('active_bid', 'confirmation_required', 'confirmed')
      for update of a, p
    loop
      update public.profiles set reserved_points = reserved_points - released.reserved_points
      where id = released.student_id;
      update public.applications set status = 'cancelled', reserved_points = 0,
        confirmation_deadline = null where id = released.id;
      insert into public.point_transactions (
        student_id, company_id, application_id, type, amount,
        balance_before, balance_after, description, created_by
      ) values (
        released.student_id, p_company_id, released.id, 'release', -released.reserved_points,
        released.initial_points + released.point_adjustments - released.profile_reserved - released.spent_points,
        released.initial_points + released.point_adjustments - released.profile_reserved - released.spent_points + released.reserved_points,
        'Bidding session cancelled; points released for ' || released.company_name, (select auth.uid())
      );
      insert into public.notifications (user_id, title, message, kind, action_url)
      values (released.student_id, released.company_name || ' bidding cancelled',
        'Your reserved points have been released.', 'warning', '/student');
    end loop;
  end if;

  update public.companies set status = p_status
  where id = p_company_id returning * into v_company;
  insert into public.audit_logs (
    actor_id, actor_role, action, entity_type, entity_id, previous_value, new_value, reason
  ) values (
    (select auth.uid()), private.current_role(), 'company.status_changed', 'company', p_company_id,
    jsonb_build_object('status', v_previous), jsonb_build_object('status', p_status), nullif(trim(p_reason), '')
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
  select * into v_company from public.companies where id = p_company_id for update;
  if v_company.id is null or v_company.status = 'finalized' then
    raise exception 'This company cannot be finalized.' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.applications
    where company_id = p_company_id and status = 'confirmation_required'
  ) then
    raise exception 'Resolve all pending bid confirmations before finalizing.' using errcode = 'P0001';
  end if;
  select count(*) into v_eligible_count from public.applications
  where company_id = p_company_id and status in ('active_bid', 'confirmed', 'selected');
  if v_eligible_count > v_company.cv_requirement then
    raise exception 'There are % eligible applicants for only % CV slots.',
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
    for update of a, p
  loop
    update public.profiles set
      reserved_points = reserved_points - app_row.reserved_points,
      spent_points = spent_points + app_row.accepted_bid
    where id = app_row.student_id;
    update public.applications set
      status = 'finalized', final_points_deducted = app_row.accepted_bid,
      reserved_points = 0, finalized_at = now(), confirmation_deadline = null
    where id = app_row.id;
    insert into public.point_transactions (
      student_id, company_id, application_id, type, amount,
      balance_before, balance_after, description, created_by
    ) values (
      app_row.student_id, p_company_id, app_row.id, 'spend', app_row.accepted_bid,
      app_row.initial_points + app_row.point_adjustments - app_row.spent_points,
      app_row.initial_points + app_row.point_adjustments - app_row.spent_points - app_row.accepted_bid,
      'Finalized bid for ' || v_company.name, (select auth.uid())
    );
    insert into public.notifications (user_id, title, message, kind, action_url)
    values (app_row.student_id, 'Application finalized',
      'Your ' || v_company.name || ' application was finalized for ' || app_row.accepted_bid || ' points.',
      'success', '/student/activity');
  end loop;

  update public.companies set status = 'finalized', finalized_at = now()
  where id = p_company_id returning * into v_company;
  insert into public.audit_logs (
    actor_id, actor_role, action, entity_type, entity_id, new_value
  ) values (
    (select auth.uid()), private.current_role(), 'company.finalized', 'company', p_company_id,
    jsonb_build_object('final_bid', v_company.current_bid, 'applicants', v_eligible_count)
  );
  return v_company;
end;
$$;

create or replace function public.adjust_student_points(
  p_student_id uuid,
  p_amount integer,
  p_reason text
)
returns public.profiles
language plpgsql
security definer set search_path = ''
as $$
declare
  v_profile public.profiles;
  v_before integer;
begin
  if not private.has_role(array['admin']::public.user_role[]) then
    raise exception 'Administrator access is required.' using errcode = 'P0001';
  end if;
  if p_amount = 0 or nullif(trim(p_reason), '') is null then
    raise exception 'A non-zero amount and reason are required.' using errcode = 'P0001';
  end if;
  select * into v_profile from public.profiles where id = p_student_id for update;
  if v_profile.id is null or v_profile.role <> 'student' then
    raise exception 'Student not found.' using errcode = 'P0001';
  end if;
  v_before := v_profile.initial_points + v_profile.point_adjustments
    - v_profile.reserved_points - v_profile.spent_points;
  if v_before + p_amount < 0 then
    raise exception 'This adjustment would create a negative available balance.' using errcode = 'P0001';
  end if;
  update public.profiles set point_adjustments = point_adjustments + p_amount
  where id = p_student_id returning * into v_profile;
  insert into public.point_transactions (
    student_id, type, amount, balance_before, balance_after,
    description, created_by
  ) values (
    p_student_id, 'adjustment', p_amount, v_before, v_before + p_amount,
    p_reason, (select auth.uid())
  );
  insert into public.audit_logs (
    actor_id, actor_role, action, entity_type, entity_id, previous_value, new_value, reason
  ) values (
    (select auth.uid()), private.current_role(), 'student.points_adjusted', 'profile', p_student_id,
    jsonb_build_object('available', v_before), jsonb_build_object('available', v_before + p_amount), p_reason
  );
  insert into public.notifications (user_id, title, message, kind, action_url)
  values (p_student_id, 'Point balance adjusted',
    case when p_amount > 0 then p_amount || ' points were added.' else abs(p_amount) || ' points were deducted.' end,
    'info', '/student/activity');
  return v_profile;
end;
$$;

-- Auto-withdraw expired confirmations. Schedule every minute with pg_cron if enabled:
-- select cron.schedule('* * * * *', 'select public.expire_bid_responses()');
create or replace function public.expire_bid_responses()
returns integer
language plpgsql
security definer set search_path = ''
as $$
declare
  expired record;
  processed integer := 0;
  v_available integer;
begin
  for expired in
    select a.*, c.name as company_name
    from public.applications a
    join public.companies c on c.id = a.company_id
    where a.status = 'confirmation_required'
      and a.confirmation_deadline <= now()
    for update of a skip locked
  loop
    select initial_points + point_adjustments - reserved_points - spent_points
      into v_available from public.profiles where id = expired.student_id;
    update public.profiles set reserved_points = reserved_points - expired.reserved_points
    where id = expired.student_id;
    update public.applications set status = 'withdrawn', reserved_points = 0,
      withdrawn_at = now(), confirmation_deadline = null where id = expired.id;
    insert into public.notifications (user_id, title, message, kind, action_url)
    values (expired.student_id, 'Bid response expired',
      'You were automatically withdrawn from ' || expired.company_name || '.', 'warning', '/student/activity');
    insert into public.point_transactions (
      student_id, company_id, application_id, type, amount,
      balance_before, balance_after, description, created_by
    ) values (
      expired.student_id, expired.company_id, expired.id, 'release', -expired.reserved_points,
      v_available, v_available + expired.reserved_points,
      'Bid response expired; reserved points released for ' || expired.company_name, null
    );
    insert into public.audit_logs (
      action, entity_type, entity_id, new_value, reason
    ) values (
      'bid_response.expired', 'application', expired.id,
      jsonb_build_object('company_id', expired.company_id, 'released_points', expired.reserved_points),
      'Automatic withdrawal after response deadline'
    );
    processed := processed + 1;
  end loop;

  update public.companies c set status = 'open'
  where c.status = 'bid_increase_pending'
    and not exists (
      select 1 from public.applications a
      where a.company_id = c.id and a.status = 'confirmation_required'
    );
  return processed;
end;
$$;

-- RLS: students read only their own personal data; staff get scoped oversight.
alter table public.profiles enable row level security;
alter table public.companies enable row level security;
alter table public.applications enable row level security;
alter table public.point_transactions enable row level security;
alter table public.bid_history enable row level security;
alter table public.notifications enable row level security;
alter table public.audit_logs enable row level security;
alter table public.system_settings enable row level security;

create policy "profiles read self or staff" on public.profiles for select to authenticated
using ((select auth.uid()) = id or private.has_role(array['admin','viewer']::public.user_role[]));
create policy "admins manage profiles" on public.profiles for update to authenticated
using (private.has_role(array['admin']::public.user_role[]))
with check (private.has_role(array['admin']::public.user_role[]));

create policy "authenticated read companies" on public.companies for select to authenticated using (true);
create policy "admins insert companies" on public.companies for insert to authenticated
with check (private.has_role(array['admin']::public.user_role[]));
create policy "admins update companies" on public.companies for update to authenticated
using (private.has_role(array['admin']::public.user_role[]))
with check (private.has_role(array['admin']::public.user_role[]));
create policy "admins delete draft companies" on public.companies for delete to authenticated
using (private.has_role(array['admin']::public.user_role[]) and status = 'upcoming');

create policy "applications read own or staff" on public.applications for select to authenticated
using ((select auth.uid()) = student_id or private.has_role(array['admin','viewer']::public.user_role[]));
create policy "transactions read own or staff" on public.point_transactions for select to authenticated
using ((select auth.uid()) = student_id or private.has_role(array['admin','viewer']::public.user_role[]));
create policy "authenticated read bid history" on public.bid_history for select to authenticated using (true);
create policy "notifications read own" on public.notifications for select to authenticated
using ((select auth.uid()) = user_id);
create policy "notifications update own" on public.notifications for update to authenticated
using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
revoke update on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;
create policy "staff read audit logs" on public.audit_logs for select to authenticated
using (private.has_role(array['admin','viewer']::public.user_role[]));
create policy "admins insert audit logs" on public.audit_logs for insert to authenticated
with check (private.has_role(array['admin']::public.user_role[]));
create policy "staff read settings" on public.system_settings for select to authenticated
using (private.has_role(array['admin','viewer']::public.user_role[]));
create policy "admins manage settings" on public.system_settings for all to authenticated
using (private.has_role(array['admin']::public.user_role[]))
with check (private.has_role(array['admin']::public.user_role[]));

-- Private Broadcast authorization: live messages are sanitized; user messages are isolated by topic.
create policy "authenticated receive bidding broadcasts"
on realtime.messages for select to authenticated
using (
  extension = 'broadcast' and (
    (select realtime.topic()) = 'bidding:live'
    or (select realtime.topic()) = 'student:' || (select auth.uid())::text
  )
);

revoke all on function public.apply_to_company(uuid) from public, anon;
revoke all on function public.withdraw_application(uuid) from public, anon;
revoke all on function public.respond_to_bid_increase(uuid, boolean) from public, anon;
revoke all on function public.increase_company_bid(uuid, integer, text) from public, anon;
revoke all on function public.change_company_status(uuid, public.company_status, text) from public, anon;
revoke all on function public.finalize_company(uuid) from public, anon;
revoke all on function public.adjust_student_points(uuid, integer, text) from public, anon;
revoke all on function public.expire_bid_responses() from public, anon, authenticated;
grant execute on function public.apply_to_company(uuid) to authenticated;
grant execute on function public.withdraw_application(uuid) to authenticated;
grant execute on function public.respond_to_bid_increase(uuid, boolean) to authenticated;
grant execute on function public.increase_company_bid(uuid, integer, text) to authenticated;
grant execute on function public.change_company_status(uuid, public.company_status, text) to authenticated;
grant execute on function public.finalize_company(uuid) to authenticated;
grant execute on function public.adjust_student_points(uuid, integer, text) to authenticated;

insert into public.system_settings (key, value, description) values
  ('single_live_company', 'true', 'Only one company can be open at a time.'),
  ('expired_response_rule', '"auto_withdraw"', 'Action when a bid response deadline passes.'),
  ('student_applicant_visibility', '"count_only"', 'Students see applicant counts, not identities.'),
  ('notification_channels', '["portal"]', 'Enabled outbound notification channels.')
on conflict (key) do nothing;

-- Non-sensitive starter catalogue. Administrators can edit or remove these drafts.
insert into public.companies (
  name, slug, description, industry, location, available_roles, required_skills,
  internship_duration, website_url, cv_requirement, minimum_bid, current_bid,
  bid_increment, maximum_bid, status
) values
  (
    'WSO2', 'wso2', 'Build open-source enterprise software with product engineering teams.',
    'Enterprise Software', 'Colombo · Hybrid', array['Software Engineering','Quality Engineering'],
    array['Java','React','Git'], '6 months', 'https://wso2.com', 12, 20, 20, 5, 80, 'upcoming'
  ),
  (
    'Sysco LABS', 'sysco-labs', 'Create technology that powers food-service operations at global scale.',
    'Product Engineering', 'Colombo · Hybrid', array['Software Engineering','Data Engineering'],
    array['TypeScript','Cloud','SQL'], '6 months', 'https://syscolabs.lk', 10, 15, 15, 5, 75, 'upcoming'
  ),
  (
    'Creative Software', 'creative-software', 'Join cross-functional teams delivering digital products for global clients.',
    'Software Services', 'Colombo · On-site', array['Full-stack Engineering','Mobile Engineering'],
    array['C#','React','Flutter'], '6 months', 'https://www.creativesoftware.com', 8, 10, 10, 5, 60, 'upcoming'
  )
on conflict (slug) do nothing;
