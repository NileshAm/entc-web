-- Restrict student identities to University of Moratuwa email addresses and
-- enforce one case-insensitive, normalized student index per profile.

do $preflight$
declare
  duplicate_index text;
  invalid_email_count integer;
  invalid_index_count integer;
begin
  select upper(trim(registration_number))
  into duplicate_index
  from public.profiles
  where registration_number is not null
  group by upper(trim(registration_number))
  having count(*) > 1
  limit 1;

  if duplicate_index is not null then
    raise exception
      'Cannot enforce case-insensitive student indexes: duplicate normalized index % exists. Resolve duplicate profiles before applying this migration.',
      duplicate_index;
  end if;

  select count(*)
  into invalid_email_count
  from public.profiles
  where role = 'student'
    and (
      email is null
      or lower(trim(email)) !~ '^[^@[:space:]]+@uom[.]lk$'
    );

  if invalid_email_count > 0 then
    raise exception
      'Cannot enforce UOM student emails: % existing student profile(s) do not use @uom.lk. Correct or disable them before applying this migration.',
      invalid_email_count;
  end if;

  select count(*)
  into invalid_index_count
  from public.profiles
  where role = 'student'
    and (
      registration_number is null
      or upper(trim(registration_number)) !~ '^[A-Z0-9/_-]{4,30}$'
    );

  if invalid_index_count > 0 then
    raise exception
      'Cannot enforce student indexes: % existing student profile(s) have a missing or invalid index. Correct them before applying this migration.',
      invalid_index_count;
  end if;
end;
$preflight$;

update public.profiles
set registration_number = upper(trim(registration_number))
where registration_number is not null
  and registration_number is distinct from upper(trim(registration_number));

alter table public.profiles
drop constraint if exists profiles_registration_number_key;

create unique index profiles_registration_number_ci_unique
on public.profiles (upper(trim(registration_number)))
where registration_number is not null;

alter table public.profiles
add constraint profiles_registration_number_normalized_check
check (
  registration_number is null
  or registration_number = upper(trim(registration_number))
);

alter table public.profiles
add constraint profiles_student_registration_number_check
check (
  role <> 'student'
  or (
    registration_number is not null
    and registration_number ~ '^[A-Z0-9/_-]{4,30}$'
  )
);

alter table public.profiles
add constraint profiles_student_uom_email_check
check (
  role <> 'student'
  or lower(trim(email)) ~ '^[^@[:space:]]+@uom[.]lk$'
);

create or replace function private.enforce_uom_auth_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.email := lower(trim(coalesce(new.email, '')));

  if new.email !~ '^[^@[:space:]]+@uom[.]lk$' then
    raise exception 'A valid @uom.lk university email address is required.'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_uom_auth_email on auth.users;
create trigger enforce_uom_auth_email
before insert or update of email on auth.users
for each row execute function private.enforce_uom_auth_email();

create or replace function private.sync_auth_user_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles
  set email = new.email
  where id = new.id;

  return new;
end;
$$;

drop trigger if exists sync_auth_user_email on auth.users;
create trigger sync_auth_user_email
after update of email on auth.users
for each row execute function private.sync_auth_user_email();

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_email text := lower(trim(coalesce(new.email, '')));
  normalized_index text := upper(trim(coalesce(
    new.raw_user_meta_data ->> 'registration_number',
    ''
  )));
begin
  if normalized_email !~ '^[^@[:space:]]+@uom[.]lk$' then
    raise exception 'A valid @uom.lk university email address is required.'
      using errcode = 'P0001';
  end if;

  if normalized_index !~ '^[A-Z0-9/_-]{4,30}$' then
    raise exception 'A valid student index is required.'
      using errcode = 'P0001';
  end if;

  insert into public.profiles (id, email, full_name, registration_number)
  values (
    new.id,
    normalized_email,
    coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
      split_part(normalized_email, '@', 1)
    ),
    normalized_index
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

revoke all on function private.enforce_uom_auth_email()
from public, anon, authenticated;
revoke all on function private.sync_auth_user_email()
from public, anon, authenticated;
revoke all on function private.handle_new_user()
from public, anon, authenticated;
