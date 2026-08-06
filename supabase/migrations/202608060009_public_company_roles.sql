-- Expose the public role names needed by the live-session analytics summary.
-- Participant history remains intact so withdrawn and not-selected outcomes
-- stay visible instead of disappearing from the public roster.

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
      when 'upcoming' then 3
      when 'closed' then 4
      when 'finalized' then 5
      else 6
    end,
    c.opens_at nulls last,
    c.name;
$$;

revoke all on function public.get_public_bid_analytics() from public;
grant execute on function public.get_public_bid_analytics() to anon, authenticated;

update public.system_settings
set
  value = '"names_rank_outcome_and_roles"',
  description = 'Public analytics includes company role names and retains withdrawn, selected, finalized, and not-selected bidder outcomes.',
  updated_at = now()
where key = 'public_applicant_visibility';
