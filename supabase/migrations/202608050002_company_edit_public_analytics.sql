-- Public bidding analytics is exposed through a minimal DTO function. Anonymous
-- users never receive direct SELECT access to companies or any private tables.
create or replace function public.get_public_bid_analytics()
returns table (
  id uuid,
  name text,
  industry text,
  location text,
  cv_requirement integer,
  current_bid integer,
  opens_at timestamptz,
  closes_at timestamptz,
  status public.company_status,
  applicant_count integer
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
    c.opens_at,
    c.closes_at,
    c.status,
    c.applicant_count
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

-- Keep authenticated private bidding updates and add an identity-free public
-- signal. The browser refreshes the safe RPC instead of trusting event payloads.
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

  perform realtime.send(
    jsonb_build_object('company_id', new.id),
    'company_changed',
    'bidding:public',
    false
  );
  return null;
end;
$$;
