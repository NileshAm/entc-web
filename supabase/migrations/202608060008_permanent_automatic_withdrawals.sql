-- An automatic bid withdrawal is final for that student/company pair. Keep the
-- charged withdrawal record and reject every attempt to reactivate it.

create or replace function private.prevent_automatic_withdrawal_reentry()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'withdrawn'
    and new.status in ('active_bid', 'confirmation_required', 'confirmed')
    and exists (
      select 1
      from public.companies c
      where c.id = old.company_id
        and c.bidding_mode = 'automatic'
    ) then
    raise exception 'Your withdrawal from this automatic auction is final. You cannot apply again.'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists prevent_automatic_withdrawal_reentry
on public.applications;
create trigger prevent_automatic_withdrawal_reentry
before update of status on public.applications
for each row
execute function private.prevent_automatic_withdrawal_reentry();

revoke all on function private.prevent_automatic_withdrawal_reentry()
from public, anon, authenticated;
