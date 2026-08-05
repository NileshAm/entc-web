-- Expose the current bidding roster through the existing public analytics DTO.
-- Only a display name and bid response state are returned. Emails, student
-- indexes, point balances, profile IDs, and application IDs remain private.
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
    case a.status
      when 'confirmation_required' then 'pending'
      when 'selected' then 'selected'
      when 'finalized' then 'finalized'
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
  participants jsonb
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
    c.applicant_count,
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'full_name', p.full_name,
          'response_state', case a.status
            when 'confirmation_required' then 'pending'
            when 'selected' then 'selected'
            when 'finalized' then 'finalized'
            else 'staying'
          end
        )
        order by p.full_name, p.id
      )
      from public.applications a
      join public.profiles p on p.id = a.student_id
      where a.company_id = c.id
        and a.status in (
          'active_bid',
          'confirmation_required',
          'confirmed',
          'selected',
          'finalized'
        )
    ), '[]'::jsonb) as participants
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

revoke all on function public.get_public_bid_analytics() from public;
revoke all on function public.get_bid_participants(uuid) from public, anon;
grant execute on function public.get_public_bid_analytics() to anon, authenticated;
grant execute on function public.get_bid_participants(uuid) to authenticated;

insert into public.system_settings (key, value, description)
values (
  'public_applicant_visibility',
  '"names_and_response_state"',
  'Public analytics shows current participant names and their staying, pending, selected, or finalized status.'
)
on conflict (key) do update
set value = excluded.value,
    description = excluded.description,
    updated_at = now();
