-- 0850: the super admin can change any school's settings.
--
-- Until now the platform console could create, rename, re-plan, suspend, restore
-- and delete a school and appoint its admins, but only read its settings. The
-- super admin can now change the same settings a school admin can, plus the
-- school's time zone. Two things stay with the school:
--   * support_access_until: a school's own consent to support access;
--   * brand_logo_path: logos are uploaded into the school's own storage folder.
--
-- Changes are recorded in the platform audit log, and in the school's audit log as
-- "platform.settings.updated" without the operator's identity (as for every
-- other platform action).

create or replace function public.sa_update_tenant_settings(p_tenant uuid, p_changes jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  allowed constant text[] := array[
    'allow_spotlight', 'allow_group_chat', 'allow_screen_capture', 'store_event_screenshots',
    'parent_portal_enabled', 'email_alerts_enabled', 'parent_focus_details', 'require_monitoring_consent',
    'nickname_mode', 'learning_retention_days', 'telemetry_retention_days',
    'default_grace_seconds', 'default_idle_seconds', 'thumbnail_interval_seconds', 'monitoring_notice',
    'brand_name', 'brand_primary', 'brand_accent', 'welcome_message', 'timezone'];
  v_bad   text;
  v_old   public.tenant_settings;
  v_new   public.tenant_settings;
  v_tz    text;
begin
  perform app.sa_require();
  if not exists (select 1 from public.tenants where id = p_tenant) then
    raise exception 'School not found.' using errcode = 'P0002';
  end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' or p_changes = '{}'::jsonb then
    raise exception 'Nothing to change.' using errcode = '22023';
  end if;
  select k into v_bad from jsonb_object_keys(p_changes) k where k <> all (allowed) limit 1;
  if v_bad is not null then
    raise exception 'This setting can''t be changed here: %.', v_bad using errcode = '22023';
  end if;

  if p_changes ? 'timezone' then
    v_tz := nullif(btrim(p_changes ->> 'timezone'), '');
    if v_tz is null or not exists (select 1 from pg_catalog.pg_timezone_names where name = v_tz) then
      raise exception 'Unknown time zone: %.', coalesce(v_tz, '(empty)') using errcode = '22023';
    end if;
    update public.tenants set timezone = v_tz where id = p_tenant;
  end if;

  select * into v_old from public.tenant_settings where tenant_id = p_tenant;
  v_new := jsonb_populate_record(v_old, p_changes - 'timezone');
  -- Database checks (ranges, colour format, nickname modes) still apply.
  update public.tenant_settings set
    allow_spotlight            = v_new.allow_spotlight,
    allow_group_chat           = v_new.allow_group_chat,
    allow_screen_capture       = v_new.allow_screen_capture,
    store_event_screenshots    = v_new.store_event_screenshots,
    parent_portal_enabled      = v_new.parent_portal_enabled,
    email_alerts_enabled       = v_new.email_alerts_enabled,
    parent_focus_details       = v_new.parent_focus_details,
    require_monitoring_consent = v_new.require_monitoring_consent,
    nickname_mode              = v_new.nickname_mode,
    learning_retention_days    = v_new.learning_retention_days,
    telemetry_retention_days   = v_new.telemetry_retention_days,
    default_grace_seconds      = v_new.default_grace_seconds,
    default_idle_seconds       = v_new.default_idle_seconds,
    thumbnail_interval_seconds = v_new.thumbnail_interval_seconds,
    monitoring_notice          = v_new.monitoring_notice,
    brand_name                 = nullif(btrim(v_new.brand_name), ''),
    brand_primary              = nullif(btrim(v_new.brand_primary), ''),
    brand_accent               = nullif(btrim(v_new.brand_accent), ''),
    welcome_message            = nullif(btrim(v_new.welcome_message), '')
  where tenant_id = p_tenant;

  perform app.sa_log('settings.updated', p_tenant, 'tenant_settings', p_tenant::text,
                     jsonb_build_object('changed', (select jsonb_agg(k order by k) from jsonb_object_keys(p_changes) k)));
  return (select to_jsonb(ts) - 'tenant_id' from public.tenant_settings ts where ts.tenant_id = p_tenant)
         || jsonb_build_object('timezone', (select timezone from public.tenants where id = p_tenant));
end$$;

revoke execute on function public.sa_update_tenant_settings(uuid, jsonb) from public, anon;
grant execute on function public.sa_update_tenant_settings(uuid, jsonb) to authenticated, service_role;

-- The settings audit trigger would name the super admin in the school's own log;
-- platform changes are already logged (anonymously for the school) by sa_log above.
create or replace function app.audit_settings_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if app.is_super_admin() then return new; end if;
  perform app.audit('settings.updated', 'tenant_settings', new.tenant_id::text,
                    (to_jsonb(new) - 'updated_at') - coalesce(
                      (select array_agg(k) from jsonb_object_keys(to_jsonb(old)) k
                       where to_jsonb(old) -> k = to_jsonb(new) -> k), '{}'::text[]),
                    new.tenant_id);
  return new;
end$$;

create or replace function public.health() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('ok', true, 'db_time', now(), 'schema', '0850')
$$;
