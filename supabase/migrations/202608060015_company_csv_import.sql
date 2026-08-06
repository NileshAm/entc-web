-- Add multiple upcoming companies atomically from an administrator-validated CSV.

create or replace function public.import_companies(p_companies jsonb)
returns jsonb
language plpgsql
security definer set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_item jsonb;
  v_company public.companies;
  v_created integer := 0;
begin
  if not private.has_role(array['admin']::public.user_role[]) then
    raise exception 'Administrator access is required.' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_companies) is distinct from 'array' then
    raise exception 'Companies must be supplied as an array.' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p_companies) = 0 then
    raise exception 'The CSV does not contain any company rows.' using errcode = 'P0001';
  end if;

  for v_item in
    select company_item.value
    from jsonb_array_elements(p_companies) as company_item(value)
  loop
    if jsonb_typeof(v_item) is distinct from 'object' then
      raise exception 'Every imported company must be an object.' using errcode = 'P0001';
    end if;

    insert into public.companies (
      name,
      slug,
      description,
      industry,
      location,
      available_roles,
      required_skills,
      cv_requirement,
      minimum_bid,
      current_bid,
      bid_increment,
      maximum_bid,
      withdrawal_penalty_percent,
      response_duration_minutes,
      bidding_mode,
      inactivity_timeout_seconds,
      opens_at,
      closes_at,
      created_by
    ) values (
      nullif(trim(v_item ->> 'name'), ''),
      nullif(trim(v_item ->> 'slug'), ''),
      nullif(trim(v_item ->> 'description'), ''),
      nullif(trim(v_item ->> 'industry'), ''),
      nullif(trim(v_item ->> 'location'), ''),
      array(
        select role_name
        from jsonb_array_elements_text(
          case
            when jsonb_typeof(v_item -> 'available_roles') = 'array'
              then v_item -> 'available_roles'
            else '[]'::jsonb
          end
        ) as imported_role(role_name)
      ),
      array(
        select skill_name
        from jsonb_array_elements_text(
          case
            when jsonb_typeof(v_item -> 'required_skills') = 'array'
              then v_item -> 'required_skills'
            else '[]'::jsonb
          end
        ) as imported_skill(skill_name)
      ),
      (v_item ->> 'cv_requirement')::integer,
      (v_item ->> 'minimum_bid')::integer,
      (v_item ->> 'minimum_bid')::integer,
      (v_item ->> 'bid_increment')::integer,
      nullif(v_item ->> 'maximum_bid', '')::integer,
      (v_item ->> 'withdrawal_penalty_percent')::integer,
      (v_item ->> 'response_duration_minutes')::integer,
      nullif(v_item ->> 'bidding_mode', ''),
      (v_item ->> 'inactivity_timeout_seconds')::integer,
      nullif(v_item ->> 'opens_at', '')::timestamptz,
      nullif(v_item ->> 'closes_at', '')::timestamptz,
      v_actor
    )
    returning * into v_company;

    insert into public.audit_logs (
      actor_id,
      actor_role,
      action,
      entity_type,
      entity_id,
      new_value,
      reason
    ) values (
      v_actor,
      private.current_role(),
      'company.csv_created',
      'company',
      v_company.id,
      jsonb_build_object(
        'name', v_company.name,
        'slug', v_company.slug,
        'cv_requirement', v_company.cv_requirement,
        'minimum_bid', v_company.minimum_bid,
        'bid_increment', v_company.bid_increment,
        'maximum_bid', v_company.maximum_bid,
        'withdrawal_penalty_percent', v_company.withdrawal_penalty_percent,
        'response_duration_minutes', v_company.response_duration_minutes,
        'bidding_mode', v_company.bidding_mode,
        'inactivity_timeout_seconds', v_company.inactivity_timeout_seconds
      ),
      'Company added through administrator CSV import.'
    );

    v_created := v_created + 1;
  end loop;

  return jsonb_build_object('created', v_created);
end;
$$;

revoke all on function public.import_companies(jsonb) from public, anon;
grant execute on function public.import_companies(jsonb) to authenticated;
