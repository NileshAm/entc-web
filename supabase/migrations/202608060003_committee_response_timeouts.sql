-- Enforce each committee company's bid-response timeout. Applications that do
-- not answer in time are withdrawn using the existing, atomic penalty routine.

create index if not exists applications_pending_confirmation_deadline_idx
on public.applications (confirmation_deadline, id)
where status = 'confirmation_required';

create or replace function public.process_expired_bid_responses()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  due_application record;
  processed integer := 0;
begin
  for due_application in
    select a.id
    from public.applications a
    join public.companies c on c.id = a.company_id
    where c.bidding_mode = 'committee'
      and a.status = 'confirmation_required'
      and a.confirmation_deadline is not null
      and a.confirmation_deadline <= clock_timestamp()
    order by a.confirmation_deadline, a.id
  loop
    begin
      perform private.withdraw_after_bid_increase(
        due_application.id,
        null,
        'Company bid response timeout expired'
      );
      processed := processed + 1;
    exception when sqlstate 'P0001' then
      -- The student may have responded while this worker waited for a lock.
      null;
    end;
  end loop;

  return processed;
end;
$$;

revoke all on function public.process_expired_bid_responses() from public, anon, authenticated;

insert into public.system_settings (key, value, description)
values (
  'committee_response_timeout_enforcement',
  'true',
  'Overdue committee bid responses are force-withdrawn and charged the configured withdrawal penalty.'
)
on conflict (key) do update
set value = excluded.value,
    description = excluded.description,
    updated_at = now();

-- Run beside automatic-auction settlement. The routine is also callable by an
-- external scheduler when pg_cron is unavailable in a local environment.
do $schedule$
declare
  existing_job bigint;
begin
  if to_regnamespace('cron') is null then
    return;
  end if;

  select jobid into existing_job
  from cron.job
  where jobname = 'internbid-process-expired-bid-responses';

  if existing_job is not null then
    perform cron.unschedule(existing_job);
  end if;

  perform cron.schedule(
    'internbid-process-expired-bid-responses',
    '10 seconds',
    'select public.process_expired_bid_responses();'
  );
exception
  when insufficient_privilege or undefined_function or undefined_table then
    raise notice 'Bid response timeout cron job could not be installed; configure it in Supabase Cron.';
end;
$schedule$;
