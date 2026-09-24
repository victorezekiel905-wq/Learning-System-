-- =============================================================================
-- SwiftCipher — 0750 production operations
--
-- * Live screen thumbnails are deleted the moment a session ends (the privacy
--   notice promises this), so the database never accumulates screen images.
-- * Error log: the app reports client and server errors here; the platform
--   super admin reviews them in /super/errors. Deduplicated by fingerprint.
-- * Health check for uptime monitors.
-- * Scheduled maintenance (hourly): retention for every school, abandoned
--   sessions, expired codes, old error rows. Runs with pg_cron when the
--   database has it (Supabase does), and can also be triggered by the
--   service role (GitHub Actions workflow "maintenance").
-- * Terms of service acceptance is recorded as a consent.
-- =============================================================================

-- ---------- Thumbnails never outlive the session ----------
create or replace function app.on_session_ended() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'ended' and old.status is distinct from 'ended' then
    delete from public.screen_snapshots where class_session_id = new.id and quality <> 'event';
    update public.session_participants set away_since = null, away_reason = null, screen_sharing = false
     where session_id = new.id;
  end if;
  return new;
end$$;
drop trigger if exists class_sessions_ended on public.class_sessions;
create trigger class_sessions_ended after update of status on public.class_sessions
  for each row execute function app.on_session_ended();

-- ---------- Error log ----------
create table if not exists public.error_events (
  id            bigint generated always as identity primary key,
  fingerprint   text not null,
  source        text not null check (source in ('client','server','api')),
  message       text not null check (length(message) <= 2000),
  stack         text check (length(stack) <= 8000),
  url           text check (length(url) <= 2000),
  user_agent    text check (length(user_agent) <= 500),
  release       text check (length(release) <= 100),
  tenant_id     uuid references public.tenants(id) on delete set null,
  user_id       uuid,
  count         int not null default 1,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  resolved_at   timestamptz
);
create unique index if not exists error_events_open_fp on public.error_events(fingerprint) where resolved_at is null;
create index if not exists error_events_recent on public.error_events(last_seen_at desc);
alter table public.error_events enable row level security;
-- No policies: nobody reads or writes the table directly. Writes go through
-- log_error(); reads through the super-admin RPC below.
revoke all on public.error_events from anon, authenticated;

create or replace function public.log_error(
  p_source text, p_message text, p_stack text default null, p_url text default null,
  p_user_agent text default null, p_release text default null
) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_fp text; v_tenant uuid; v_recent int;
begin
  if p_source not in ('client','server','api') or coalesce(btrim(p_message), '') = '' then return; end if;
  -- Flood guard: at most 600 new rows an hour platform-wide (repeats only bump a counter).
  select count(*) into v_recent from public.error_events where first_seen_at > now() - interval '1 hour';
  v_fp := md5(p_source || '|' || left(p_message, 300) || '|' || coalesce(left(split_part(coalesce(p_stack, ''), E'\n', 2), 300), ''));
  begin v_tenant := app.tenant_id(); exception when others then v_tenant := null; end;
  update public.error_events set count = count + 1, last_seen_at = now(),
         url = coalesce(left(p_url, 2000), url), tenant_id = coalesce(v_tenant, tenant_id)
   where fingerprint = v_fp and resolved_at is null;
  if found or v_recent >= 600 then return; end if;
  insert into public.error_events (fingerprint, source, message, stack, url, user_agent, release, tenant_id, user_id)
    values (v_fp, p_source, left(p_message, 2000), left(p_stack, 8000), left(p_url, 2000), left(p_user_agent, 500),
            left(p_release, 100), v_tenant, auth.uid())
    on conflict (fingerprint) where resolved_at is null do update set count = public.error_events.count + 1, last_seen_at = now();
end$$;

create or replace function public.sa_errors(p_include_resolved boolean default false, p_limit int default 200) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.sa_require();
  return (select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'source', e.source, 'message', e.message, 'stack', e.stack,
            'url', e.url, 'user_agent', e.user_agent, 'release', e.release, 'tenant', t.name, 'count', e.count,
            'first_seen_at', e.first_seen_at, 'last_seen_at', e.last_seen_at, 'resolved_at', e.resolved_at)
            order by e.resolved_at nulls first, e.last_seen_at desc), '[]'::jsonb)
          from (select * from public.error_events where p_include_resolved or resolved_at is null
                order by last_seen_at desc limit least(greatest(p_limit, 1), 1000)) e
          left join public.tenants t on t.id = e.tenant_id);
end$$;

create or replace function public.sa_resolve_error(p_id bigint) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform app.sa_require();
  update public.error_events set resolved_at = now() where id = p_id and resolved_at is null;
end$$;

-- ---------- Health ----------
create or replace function public.health() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('ok', true, 'db_time', now(), 'schema', '0750')
$$;

-- ---------- Maintenance ----------
-- Sessions a teacher forgot to end: live for 12 h with nobody seen for 2 h.
create or replace function app.end_abandoned_sessions() returns int
language plpgsql volatile security definer set search_path = '' as $$
declare r record; v_n int := 0;
begin
  for r in select s.* from public.class_sessions s
           where s.status = 'live' and s.started_at < now() - interval '12 hours'
             and not exists (select 1 from public.session_participants p where p.session_id = s.id
                             and p.last_seen_at > now() - interval '2 hours') loop
    update public.class_sessions set status = 'ended', ended_at = now(), environment_active = false where id = r.id;
    update public.session_participants set left_at = coalesce(left_at, now()), status = 'offline' where session_id = r.id;
    update public.browser_sessions set ended_at = now() where class_session_id = r.id and ended_at is null;
    update public.environment_events set resolved_at = now() where class_session_id = r.id and resolved_at is null;
    update public.spotlights set ended_at = now() where session_id = r.id and ended_at is null;
    update public.teacher_commands set status = 'expired' where class_session_id = r.id and status in ('queued','delivered');
    perform app.audit('session.auto_ended', 'class_session', r.id::text, '{}'::jsonb, r.tenant_id, null);
    v_n := v_n + 1;
  end loop;
  return v_n;
end$$;

create or replace function app.run_maintenance() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_ended int;
begin
  v_ended := app.end_abandoned_sessions();
  perform app.apply_retention_all();
  delete from public.invites where expires_at < now() - interval '30 days';
  delete from public.error_events where last_seen_at < now() - interval '30 days';
  return jsonb_build_object('ok', true, 'ran_at', now(), 'sessions_auto_ended', v_ended);
end$$;

-- For the scheduled GitHub Action (service role only).
create or replace function public.run_maintenance() returns jsonb
language sql volatile security definer set search_path = '' as $$ select app.run_maintenance() $$;

-- Hourly with pg_cron where available (Supabase: Database → Extensions → pg_cron).
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.unschedule(jobid) from cron.job where jobname = 'swiftcipher-maintenance';
    perform cron.schedule('swiftcipher-maintenance', '17 * * * *', 'select app.run_maintenance()');
  end if;
exception when others then
  raise notice 'pg_cron not scheduled (%). Use the GitHub "maintenance" workflow instead.', sqlerrm;
end$$;

-- ---------- Terms of service consent ----------
alter table public.consents drop constraint if exists consents_kind_check;
alter table public.consents add constraint consents_kind_check
  check (kind in ('monitoring_notice','acceptable_use','privacy_notice','terms_of_service'));

create or replace function public.accept_notice(p_kind text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_me public.users := app.me(); v_version int;
begin
  if p_kind not in ('monitoring_notice','acceptable_use','privacy_notice','terms_of_service') then
    raise exception 'Unknown notice.' using errcode = '22023';
  end if;
  select case when p_kind = 'monitoring_notice' then monitoring_notice_version else 1 end into v_version
    from public.tenant_settings where tenant_id = v_me.tenant_id;
  insert into public.consents (tenant_id, user_id, kind, version)
    values (v_me.tenant_id, v_me.id, p_kind, coalesce(v_version, 1))
    on conflict (user_id, kind, version) do nothing;
end$$;

-- ---------- Privileges ----------
revoke execute on function public.log_error(text, text, text, text, text, text),
                           public.sa_errors(boolean, int), public.sa_resolve_error(bigint),
                           public.health(), public.run_maintenance(),
                           app.run_maintenance(), app.end_abandoned_sessions(), app.on_session_ended()
  from public, anon, authenticated;
grant execute on function public.log_error(text, text, text, text, text, text) to anon, authenticated, service_role;
grant execute on function public.health() to anon, authenticated, service_role;
grant execute on function public.sa_errors(boolean, int), public.sa_resolve_error(bigint) to authenticated, service_role;
grant execute on function public.run_maintenance(), app.run_maintenance(), app.end_abandoned_sessions() to service_role;
