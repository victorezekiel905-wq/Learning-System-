-- =============================================================================
-- SwiftCipher — 0730 make "no action" foreign keys deferred
--
-- Deleting a school cascades to its users AND (via lessons) to activities etc.
-- Postgres checks NO ACTION references while the cascades are still running,
-- so e.g. activities.owner_id -> users failed even though the activity was
-- about to be deleted too. Checking these at commit time fixes the ordering;
-- integrity is unchanged (a dangling reference still aborts the transaction).
-- =============================================================================
-- Every tenant-owned table gets a direct ON DELETE CASCADE link to its school,
-- so deleting a school can never leave orphaned rows (e.g. environment
-- policies were only linked through their owner). platform_audit keeps its
-- history on purpose.
do $$
declare r record;
begin
  for r in
    select c.table_name
    from information_schema.columns c
    join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
    where c.table_schema = 'public' and c.column_name = 'tenant_id'
      and c.table_name not in ('tenants', 'platform_audit')
      and not exists (
        select 1 from pg_constraint k
        where k.conrelid = format('public.%I', c.table_name)::regclass and k.contype = 'f'
          and k.confrelid = 'public.tenants'::regclass
          and k.conkey = array[(select attnum from pg_attribute where attrelid = format('public.%I', c.table_name)::regclass and attname = 'tenant_id')]::smallint[])
  loop
    execute format('alter table public.%I add constraint %I foreign key (tenant_id) references public.tenants(id) on delete cascade',
                   r.table_name, r.table_name || '_tenant_cascade_fkey');
  end loop;
end$$;

do $$
declare r record;
begin
  for r in
    select c.conname, c.conrelid::regclass as tbl
    from pg_constraint c
    join pg_namespace n on n.oid = c.connamespace
    where n.nspname = 'public' and c.contype = 'f'
      and c.confdeltype = 'a'            -- ON DELETE NO ACTION
      and not c.condeferrable
  loop
    execute format('alter table %s alter constraint %I deferrable initially deferred', r.tbl, r.conname);
  end loop;
end$$;

-- While a school is being deleted, its rows' delete triggers must not try to
-- write audit entries for that (already removed) school.
create or replace function app.audit(
  p_action text, p_target_type text default null, p_target_id text default null,
  p_meta jsonb default '{}'::jsonb, p_tenant uuid default null, p_actor uuid default null
) returns void
language sql volatile security definer set search_path = '' as $$
  insert into public.audit_logs (tenant_id, actor_id, action, target_type, target_id, meta)
  select t.tenant_id, coalesce(p_actor, auth.uid()), p_action, p_target_type, p_target_id, coalesce(p_meta, '{}'::jsonb)
  from (select coalesce(p_tenant, app.tenant_id()) as tenant_id) t
  where t.tenant_id is null or exists (select 1 from public.tenants x where x.id = t.tenant_id)
$$;

create or replace function app.audit_row_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_row  jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  v_meta jsonb;
begin
  if not exists (select 1 from public.tenants where id = (v_row ->> 'tenant_id')::uuid) then
    return null;  -- the whole school is being deleted
  end if;
  v_meta := jsonb_build_object('op', lower(tg_op));
  if tg_op = 'UPDATE' then
    v_meta := v_meta || jsonb_build_object('changed',
      (select coalesce(jsonb_object_agg(k, to_jsonb(new) -> k), '{}'::jsonb)
       from jsonb_object_keys(to_jsonb(new)) k
       where k not in ('updated_at') and to_jsonb(old) -> k is distinct from to_jsonb(new) -> k));
  elsif tg_op = 'INSERT' then
    v_meta := v_meta || jsonb_build_object('row', v_row - 'secret_hash');
  end if;
  perform app.audit(tg_table_name || '.' || lower(tg_op), tg_table_name,
                    coalesce(v_row ->> 'id', v_row ->> 'user_id'), v_meta,
                    (v_row ->> 'tenant_id')::uuid, auth.uid());
  return null;
end$$;
