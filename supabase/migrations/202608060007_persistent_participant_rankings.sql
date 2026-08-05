-- Keep completed application outcomes visible in participant rankings.
-- Withdrawn students remain in the roster but do not occupy a rank or CV slot.

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
      case
        when a.status = 'withdrawn' then null
        else row_number() over (
          order by
            case when a.status = 'withdrawn' then 1 else 0 end,
            a.accepted_bid desc,
            a.bid_updated_at asc,
            a.id asc
        )::integer
      end as bid_rank,
      row_number() over (
        order by
          case when a.status = 'withdrawn' then 1 else 0 end,
          a.accepted_bid desc,
          a.bid_updated_at asc,
          a.id asc
      )::integer as display_order
    from public.applications a
    where a.company_id = p_company_id
      and a.status in (
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
    p.full_name,
    case r.status
      when 'confirmation_required' then 'pending'
      when 'selected' then 'selected'
      when 'finalized' then 'finalized'
      when 'not_selected' then 'not_selected'
      when 'withdrawn' then 'withdrawn'
      else 'staying'
    end,
    r.accepted_bid,
    r.bid_rank,
    case
      when r.status in ('withdrawn', 'not_selected') then false
      when r.status in ('selected', 'finalized') then true
      else coalesce(r.bid_rank <= c.cv_requirement, false)
    end,
    r.student_id = (select auth.uid())
  from ranked r
  join public.profiles p on p.id = r.student_id
  join public.companies c on c.id = p_company_id
  where c.status in (
      'open', 'paused', 'bid_increase_pending', 'closed', 'finalized'
    )
    and exists (
      select 1
      from public.profiles viewer
      where viewer.id = (select auth.uid())
        and viewer.account_status = 'active'
    )
  order by r.display_order;
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

revoke all on function public.get_bid_participants(uuid) from public, anon;
revoke all on function public.get_public_bid_analytics() from public;
grant execute on function public.get_bid_participants(uuid) to authenticated;
grant execute on function public.get_public_bid_analytics() to anon, authenticated;

update public.system_settings
set
  value = '"names_rank_and_outcome"',
  description = 'Participant rankings retain withdrawn, selected, finalized, and not-selected outcomes.',
  updated_at = now()
where key = 'public_applicant_visibility';
