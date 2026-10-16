-- Trip Planner: access functions
-- Run after schema.sql. Every function except create_trip, import_trip and ping
-- requires (trip id, edit code). Tables are not directly accessible.

-- ---------- internal helpers ----------

create or replace function public._auth(p_trip uuid, p_code text)
returns void
language plpgsql security definer
set search_path = public, extensions
as $$
begin
  if p_code is null or not exists (
    select 1 from public.trips t
    where t.id = p_trip and t.code_hash = crypt(p_code, t.code_hash)
  ) then
    raise exception 'invalid_code' using errcode = '28000';
  end if;
end $$;

-- ---------- keep-alive ----------

create or replace function public.ping()
returns timestamptz
language sql security definer
set search_path = public
as $$ select now(); $$;

-- ---------- create / read ----------

create or replace function public.create_trip(
  p_name text, p_destination text, p_start date, p_end date, p_currency text
) returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_id uuid := gen_random_uuid();
  v_code text := encode(gen_random_bytes(9), 'hex');
  d date;
  i int := 0;
begin
  if coalesce(trim(p_name), '') = '' then
    raise exception 'name_required';
  end if;

  insert into public.trips (id, name, destination, start_date, end_date, currency, code_hash)
  values (
    v_id, left(trim(p_name), 120), left(p_destination, 120), p_start, p_end,
    upper(left(coalesce(nullif(trim(p_currency), ''), 'USD'), 8)),
    crypt(v_code, gen_salt('bf'))
  );

  if p_start is not null and p_end is not null and p_end >= p_start and p_end - p_start <= 60 then
    for d in select g::date from generate_series(p_start, p_end, interval '1 day') g loop
      insert into public.days (trip_id, date, sort_order) values (v_id, d, i);
      i := i + 1;
    end loop;
  end if;

  return jsonb_build_object('trip_id', v_id, 'code', v_code);
end $$;

create or replace function public.get_trip_snapshot(p_trip uuid, p_code text)
returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
begin
  perform public._auth(p_trip, p_code);
  return jsonb_build_object(
    'version', 1,
    'trip', (select to_jsonb(t) - 'code_hash' from public.trips t where t.id = p_trip),
    'travelers', coalesce((select jsonb_agg(to_jsonb(x) order by x.sort_order, x.name)
                           from public.travelers x where x.trip_id = p_trip), '[]'::jsonb),
    'days', coalesce((select jsonb_agg(to_jsonb(x) order by x.date, x.sort_order)
                      from public.days x where x.trip_id = p_trip), '[]'::jsonb),
    'activities', coalesce((select jsonb_agg(to_jsonb(x) order by x.sort_order, x.start_time)
                            from public.activities x where x.trip_id = p_trip), '[]'::jsonb),
    'budget_items', coalesce((select jsonb_agg(to_jsonb(x) order by x.category, x.label)
                              from public.budget_items x where x.trip_id = p_trip), '[]'::jsonb),
    'bookings', coalesce((select jsonb_agg(to_jsonb(x) order by x.start_at, x.title)
                          from public.bookings x where x.trip_id = p_trip), '[]'::jsonb),
    'bills', coalesce((select jsonb_agg(to_jsonb(x) order by x.bill_date, x.title)
                       from public.bills x where x.trip_id = p_trip), '[]'::jsonb),
    'bill_items', coalesce((select jsonb_agg(to_jsonb(x) order by x.name)
                            from public.bill_items x where x.trip_id = p_trip), '[]'::jsonb)
  );
end $$;

-- ---------- write ----------

create or replace function public.update_trip(p_trip uuid, p_code text, p_row jsonb)
returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
declare result jsonb;
begin
  perform public._auth(p_trip, p_code);
  update public.trips set
    name        = coalesce(nullif(left(trim(p_row->>'name'), 120), ''), name),
    destination = case when p_row ? 'destination' then left(p_row->>'destination', 120) else destination end,
    start_date  = case when p_row ? 'start_date' then nullif(p_row->>'start_date', '')::date else start_date end,
    end_date    = case when p_row ? 'end_date' then nullif(p_row->>'end_date', '')::date else end_date end,
    currency    = case when p_row ? 'currency' then upper(left(coalesce(nullif(trim(p_row->>'currency'), ''), currency), 8)) else currency end
  where id = p_trip
  returning to_jsonb(trips) - 'code_hash' into result;
  return result;
end $$;

create or replace function public.upsert_row(
  p_trip uuid, p_code text, p_table text, p_row jsonb, p_by text default null
) returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v jsonb;
  cols text;
  sets text;
  result jsonb;
  v_exists boolean := false;
  v_cnt int;
begin
  perform public._auth(p_trip, p_code);

  if p_table not in ('travelers','days','activities','budget_items','bookings','bills','bill_items') then
    raise exception 'bad_table';
  end if;
  if length(p_row::text) > 20000 then
    raise exception 'too_large';
  end if;

  v := p_row || jsonb_build_object('trip_id', p_trip);
  if v->>'id' is null then
    v := v - 'id';
  end if;
  if p_table = 'activities' then
    v := v || jsonb_build_object('updated_at', now(), 'updated_by', left(p_by, 60));
  end if;

  -- colors are rendered into CSS: keep them to plain hex
  if p_table = 'travelers' and v ? 'color' and coalesce(v->>'color', '') !~ '^#[0-9a-fA-F]{3,8}$' then
    v := v - 'color';
  end if;

  -- references must point at rows of this same trip (patches that omit a reference keep the existing one)
  if v->>'bill_id' is not null and not exists (
       select 1 from public.bills x where x.id = (v->>'bill_id')::uuid and x.trip_id = p_trip) then
    raise exception 'bad_ref';
  end if;
  if v->>'day_id' is not null and not exists (
       select 1 from public.days x where x.id = (v->>'day_id')::uuid and x.trip_id = p_trip) then
    raise exception 'bad_ref';
  end if;
  if v->>'activity_id' is not null and not exists (
       select 1 from public.activities x where x.id = (v->>'activity_id')::uuid and x.trip_id = p_trip) then
    raise exception 'bad_ref';
  end if;
  if v->>'paid_by' is not null and not exists (
       select 1 from public.travelers x where x.id = (v->>'paid_by')::uuid and x.trip_id = p_trip) then
    raise exception 'bad_ref';
  end if;

  -- does this id already exist in THIS trip?
  if v ? 'id' then
    execute format('select exists(select 1 from public.%I where id = $1 and trip_id = $2)', p_table)
      into v_exists using (v->>'id')::uuid, p_trip;
  end if;

  -- columns present in the patch (only keys that are real columns are used)
  select string_agg(quote_ident(a.attname), ', '),
         string_agg(quote_ident(a.attname) || ' = r.' || quote_ident(a.attname), ', ')
           filter (where a.attname not in ('id', 'trip_id'))
    into cols, sets
  from pg_attribute a
  where a.attrelid = ('public.' || quote_ident(p_table))::regclass
    and a.attnum > 0 and not a.attisdropped
    and v ? (a.attname)::text;

  if v_exists then
    -- UPDATE path: a partial patch must not trip NOT NULL checks on columns it doesn't mention
    if sets is null then
      execute format('select to_jsonb(t) from public.%I t where t.id = $1 and t.trip_id = $2', p_table)
        into result using (v->>'id')::uuid, p_trip;
    else
      execute format(
        'update public.%1$I t set %2$s from jsonb_populate_record(null::public.%1$I, $1) r '
        'where t.id = r.id and t.trip_id = $2 returning to_jsonb(t)',
        p_table, sets
      ) into result using v, p_trip;
    end if;
  else
    -- INSERT path, with a per-trip row cap
    execute format('select count(*) from public.%I where trip_id = $1', p_table)
      into v_cnt using p_trip;
    if v_cnt >= 1000 then
      raise exception 'row_limit';
    end if;
    begin
      execute format(
        'insert into public.%1$I (%2$s) select %2$s from jsonb_populate_record(null::public.%1$I, $1) '
        'returning to_jsonb(%1$I)',
        p_table, cols
      ) into result using v;
    exception when unique_violation then
      raise exception 'not_found';  -- the id belongs to another trip
    end;
  end if;

  if result is null then
    raise exception 'not_found';
  end if;
  return result;
end $$;

create or replace function public.delete_row(p_trip uuid, p_code text, p_table text, p_id uuid)
returns void
language plpgsql security definer
set search_path = public, extensions
as $$
begin
  perform public._auth(p_trip, p_code);
  if p_table not in ('travelers','days','activities','budget_items','bookings','bills','bill_items') then
    raise exception 'bad_table';
  end if;
  execute format('delete from public.%I where id = $1 and trip_id = $2', p_table)
    using p_id, p_trip;
end $$;

create or replace function public.reorder(p_trip uuid, p_code text, p_table text, p_ids uuid[])
returns void
language plpgsql security definer
set search_path = public, extensions
as $$
begin
  perform public._auth(p_trip, p_code);
  if p_table not in ('travelers','days','activities') then
    raise exception 'bad_table';
  end if;
  execute format(
    'update public.%I t set sort_order = o.ord::int - 1 '
    'from unnest($1) with ordinality as o(id, ord) '
    'where t.id = o.id and t.trip_id = $2', p_table
  ) using p_ids, p_trip;
end $$;

-- ---------- duplicate as template ----------

create or replace function public.duplicate_trip(
  p_trip uuid, p_code text, p_name text, p_start date default null, p_keep_costs boolean default true
) returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_src public.trips%rowtype;
  v_new uuid := gen_random_uuid();
  v_code text := encode(gen_random_bytes(9), 'hex');
  v_off int := 0;
  mt jsonb := '{}'::jsonb;
  md jsonb := '{}'::jsonb;
  ma jsonb := '{}'::jsonb;
  r record;
  nid uuid;
begin
  perform public._auth(p_trip, p_code);
  select * into v_src from public.trips where id = p_trip;

  if p_start is not null and v_src.start_date is not null then
    v_off := p_start - v_src.start_date;
  end if;

  insert into public.trips (id, name, destination, start_date, end_date, currency, code_hash)
  values (
    v_new,
    left(coalesce(nullif(trim(p_name), ''), v_src.name || ' (copy)'), 120),
    v_src.destination,
    v_src.start_date + v_off, v_src.end_date + v_off,
    v_src.currency, crypt(v_code, gen_salt('bf'))
  );

  for r in select * from public.travelers where trip_id = p_trip loop
    nid := gen_random_uuid();
    mt := mt || jsonb_build_object(r.id::text, nid);
    insert into public.travelers (id, trip_id, name, color, sort_order, archived)
    values (nid, v_new, r.name, r.color, r.sort_order, r.archived);
  end loop;

  for r in select * from public.days where trip_id = p_trip loop
    nid := gen_random_uuid();
    md := md || jsonb_build_object(r.id::text, nid);
    insert into public.days (id, trip_id, date, title, sort_order)
    values (nid, v_new, r.date + v_off, r.title, r.sort_order);
  end loop;

  for r in select * from public.activities where trip_id = p_trip loop
    nid := gen_random_uuid();
    ma := ma || jsonb_build_object(r.id::text, nid);
    insert into public.activities (id, trip_id, day_id, start_time, end_time, title, category,
                                   notes, link, cost, currency, lat, lng, sort_order)
    values (nid, v_new, (md->>(r.day_id::text))::uuid, r.start_time, r.end_time, r.title, r.category,
            r.notes, r.link, case when p_keep_costs then r.cost else 0 end, r.currency,
            r.lat, r.lng, r.sort_order);
  end loop;

  for r in select * from public.budget_items where trip_id = p_trip loop
    insert into public.budget_items (trip_id, category, label, planned, actual, currency, day_id, activity_id)
    values (v_new, r.category, r.label, case when p_keep_costs then r.planned else 0 end, 0, r.currency,
            (md->>(r.day_id::text))::uuid, (ma->>(r.activity_id::text))::uuid);
  end loop;

  -- bookings and bills are intentionally not copied
  return jsonb_build_object('trip_id', v_new, 'code', v_code);
end $$;

-- ---------- import from an exported snapshot ----------

create or replace function public.import_trip(p_snapshot jsonb)
returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_new uuid := gen_random_uuid();
  v_code text := encode(gen_random_bytes(9), 'hex');
  t jsonb := p_snapshot->'trip';
  mt jsonb := '{}'::jsonb;
  md jsonb := '{}'::jsonb;
  ma jsonb := '{}'::jsonb;
  mb jsonb := '{}'::jsonb;
  e jsonb;
  nid uuid;
  k text;
begin
  if p_snapshot is null or jsonb_typeof(p_snapshot) <> 'object'
     or (p_snapshot->>'version') is distinct from '1' or t is null then
    raise exception 'bad_snapshot';
  end if;
  if length(p_snapshot::text) > 2000000 then
    raise exception 'too_large';
  end if;
  foreach k in array array['travelers','days','activities','budget_items','bookings','bills','bill_items'] loop
    if jsonb_array_length(coalesce(p_snapshot->k, '[]'::jsonb)) > 1000 then
      raise exception 'row_limit';
    end if;
  end loop;

  insert into public.trips (id, name, destination, start_date, end_date, currency, code_hash)
  values (
    v_new,
    left(coalesce(nullif(trim(t->>'name'), ''), 'Imported trip'), 120),
    left(t->>'destination', 120),
    nullif(t->>'start_date', '')::date, nullif(t->>'end_date', '')::date,
    upper(left(coalesce(nullif(trim(t->>'currency'), ''), 'USD'), 8)),
    crypt(v_code, gen_salt('bf'))
  );

  for e in select * from jsonb_array_elements(coalesce(p_snapshot->'travelers', '[]'::jsonb)) loop
    nid := gen_random_uuid();
    mt := mt || jsonb_build_object(coalesce(e->>'id', nid::text), nid);
    insert into public.travelers (id, trip_id, name, color, sort_order, archived)
    values (nid, v_new, left(coalesce(e->>'name', 'Traveler'), 60), left(e->>'color', 20),
            coalesce((e->>'sort_order')::int, 0), coalesce((e->>'archived')::boolean, false));
  end loop;

  for e in select * from jsonb_array_elements(coalesce(p_snapshot->'days', '[]'::jsonb)) loop
    nid := gen_random_uuid();
    md := md || jsonb_build_object(coalesce(e->>'id', nid::text), nid);
    insert into public.days (id, trip_id, date, title, sort_order)
    values (nid, v_new, nullif(e->>'date', '')::date, left(e->>'title', 200),
            coalesce((e->>'sort_order')::int, 0));
  end loop;

  for e in select * from jsonb_array_elements(coalesce(p_snapshot->'activities', '[]'::jsonb)) loop
    nid := gen_random_uuid();
    ma := ma || jsonb_build_object(coalesce(e->>'id', nid::text), nid);
    insert into public.activities (id, trip_id, day_id, start_time, end_time, title, category, notes, link,
                                   cost, currency, lat, lng, sort_order, updated_by)
    values (nid, v_new, (md->>(e->>'day_id'))::uuid,
            nullif(e->>'start_time', '')::time, nullif(e->>'end_time', '')::time,
            left(coalesce(e->>'title', 'Untitled'), 200), left(coalesce(e->>'category', 'activity'), 30),
            left(e->>'notes', 5000), left(e->>'link', 1000),
            coalesce((e->>'cost')::bigint, 0), left(e->>'currency', 8),
            (e->>'lat')::double precision, (e->>'lng')::double precision,
            coalesce((e->>'sort_order')::int, 0), left(e->>'updated_by', 60));
  end loop;

  for e in select * from jsonb_array_elements(coalesce(p_snapshot->'budget_items', '[]'::jsonb)) loop
    insert into public.budget_items (trip_id, category, label, planned, actual, currency, day_id, activity_id)
    values (v_new, left(coalesce(e->>'category', 'other'), 30), left(coalesce(e->>'label', ''), 200),
            coalesce((e->>'planned')::bigint, 0), coalesce((e->>'actual')::bigint, 0), left(e->>'currency', 8),
            (md->>(e->>'day_id'))::uuid, (ma->>(e->>'activity_id'))::uuid);
  end loop;

  for e in select * from jsonb_array_elements(coalesce(p_snapshot->'bookings', '[]'::jsonb)) loop
    insert into public.bookings (trip_id, type, title, provider, confirmation_no, start_at, end_at,
                                 cost, currency, link, notes)
    values (v_new, left(coalesce(e->>'type', 'other'), 30), left(coalesce(e->>'title', 'Untitled'), 200),
            left(e->>'provider', 200), left(e->>'confirmation_no', 100),
            nullif(e->>'start_at', '')::timestamp, nullif(e->>'end_at', '')::timestamp,
            coalesce((e->>'cost')::bigint, 0), left(e->>'currency', 8),
            left(e->>'link', 1000), left(e->>'notes', 5000));
  end loop;

  for e in select * from jsonb_array_elements(coalesce(p_snapshot->'bills', '[]'::jsonb)) loop
    nid := gen_random_uuid();
    mb := mb || jsonb_build_object(coalesce(e->>'id', nid::text), nid);
    insert into public.bills (id, trip_id, title, bill_date, paid_by, tax, tip, fees, currency, notes)
    values (nid, v_new, left(coalesce(e->>'title', 'Untitled'), 200), nullif(e->>'bill_date', '')::date,
            (mt->>(e->>'paid_by'))::uuid,
            coalesce((e->>'tax')::bigint, 0), coalesce((e->>'tip')::bigint, 0), coalesce((e->>'fees')::bigint, 0),
            left(e->>'currency', 8), left(e->>'notes', 5000));
  end loop;

  for e in select * from jsonb_array_elements(coalesce(p_snapshot->'bill_items', '[]'::jsonb)) loop
    if (mb->>(e->>'bill_id')) is not null then
      insert into public.bill_items (trip_id, bill_id, name, price, shared_by)
      values (v_new, (mb->>(e->>'bill_id'))::uuid, left(coalesce(e->>'name', ''), 200),
              coalesce((e->>'price')::bigint, 0),
              coalesce((select array_agg((mt->>x)::uuid)
                        from jsonb_array_elements_text(coalesce(e->'shared_by', '[]'::jsonb)) x
                        where mt ? x), '{}'::uuid[]));
    end if;
  end loop;

  return jsonb_build_object('trip_id', v_new, 'code', v_code);
end $$;

-- ---------- permissions ----------

revoke all on all functions in schema public from public, anon, authenticated;

grant execute on function public.ping() to anon, authenticated;
grant execute on function public.create_trip(text, text, date, date, text) to anon, authenticated;
grant execute on function public.get_trip_snapshot(uuid, text) to anon, authenticated;
grant execute on function public.update_trip(uuid, text, jsonb) to anon, authenticated;
grant execute on function public.upsert_row(uuid, text, text, jsonb, text) to anon, authenticated;
grant execute on function public.delete_row(uuid, text, text, uuid) to anon, authenticated;
grant execute on function public.reorder(uuid, text, text, uuid[]) to anon, authenticated;
grant execute on function public.duplicate_trip(uuid, text, text, date, boolean) to anon, authenticated;
grant execute on function public.import_trip(jsonb) to anon, authenticated;
-- _auth is internal (called only from the functions above, which run as owner)
