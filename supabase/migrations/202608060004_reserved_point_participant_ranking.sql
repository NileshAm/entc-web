-- Rank every live participant by reserved/bid points. Earlier reservations win
-- ties, and the CV requirement forms the visible selection cutoff.

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
      row_number() over (
        order by a.accepted_bid desc, a.bid_updated_at asc, a.id asc
      )::integer as bid_rank
    from public.applications a
    where a.company_id = p_company_id
      and a.status in (
        'active_bid', 'confirmation_required', 'confirmed', 'selected', 'finalized'
      )
  )
  select
    p.full_name,
    case r.status
      when 'confirmation_required' then 'pending'
      when 'selected' then 'selected'
      when 'finalized' then 'finalized'
      else 'staying'
    end,
    r.accepted_bid,
    r.bid_rank,
    r.bid_rank <= c.cv_requirement,
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
  order by r.bid_rank;
$$;

revoke all on function public.get_bid_participants(uuid) from public, anon;
grant execute on function public.get_bid_participants(uuid) to authenticated;
