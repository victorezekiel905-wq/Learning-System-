-- =============================================================================
-- SwiftCipher — 0760 scale: 5,000,000 users / 50,000 schools
--
-- 1. Indexes: every foreign key and every tenant_id gets an index (RLS filters
--    by tenant_id on every query), plus composite (tenant_id, time) indexes for
--    lists and retention, keyset-pagination indexes and trigram search.
-- 2. Push, not poll: the database broadcasts tiny "something changed" signals
--    on private Realtime channels ("Broadcast from Database"); clients refetch
--    only when told. postgres_changes (which evaluates every change against
--    every subscriber) is no longer used, and tables leave the publication.
-- 3. The student tick (student_report) replaces the separate heartbeat, writes
--    only when something changed (or every 15 s for presence), and tells the
--    page when lesson state changed (state_version) so it refetches only then.
-- 4. Live screen frames no longer touch the database: the student's page sends
--    them on its own private channel screen:<session>:<student>, which only
--    that session's teachers can receive, and only while a teacher is watching.
-- 5. Retention is set-based and batched across all schools; platform stats are
--    cached; super-admin lists use keyset pagination.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Indexes
-- ---------------------------------------------------------------------------
-- Lists and retention scans: (tenant_id, time). These also serve the tenant_id FKs.
create index if not exists screen_snapshots_tenant_time_idx on public.screen_snapshots(tenant_id, captured_at);
create index if not exists browser_sessions_tenant_time_idx on public.browser_sessions(tenant_id, started_at);
create index if not exists teacher_commands_tenant_time_idx on public.teacher_commands(tenant_id, created_at);
create index if not exists rtc_signals_tenant_time_idx      on public.rtc_signals(tenant_id, created_at);
create index if not exists pairing_codes_tenant_exp_idx     on public.device_pairing_codes(tenant_id, expires_at);
create index if not exists quiz_attempts_tenant_time_idx    on public.quiz_attempts(tenant_id, started_at);
create index if not exists game_sessions_tenant_time_idx    on public.game_sessions(tenant_id, created_at);
create index if not exists chat_messages_tenant_time_idx    on public.chat_messages(tenant_id, created_at);
create index if not exists notifications_tenant_time_idx    on public.notifications(tenant_id, created_at);
create index if not exists class_sessions_tenant_time_idx   on public.class_sessions(tenant_id, created_at desc);
create index if not exists class_sessions_teacher_live_idx  on public.class_sessions(teacher_id) where status = 'live';
create index if not exists class_sessions_live_idx          on public.class_sessions(started_at) where status = 'live';
create index if not exists devices_online_idx               on public.devices(last_seen_at) where status = 'active';
create index if not exists error_events_first_seen_idx      on public.error_events(first_seen_at);
-- Keyset pagination for the platform console.
create index if not exists tenants_created_idx              on public.tenants(created_at desc, id desc);
create index if not exists users_created_idx                on public.users(created_at desc, id desc);
create index if not exists users_tenant_created_idx         on public.users(tenant_id, created_at desc, id desc);
create index if not exists users_tenant_name_idx            on public.users(tenant_id, full_name, id);

-- Every remaining foreign key gets an index on its columns unless an index
-- already starts with the key's first column (lookups, joins and cascading
-- deletes stay index-driven). Small lookup tables (plans, roles) are skipped.
do $$
declare r record; v_name text;
begin
  for r in
    select c.conrelid::regclass as tbl, c.conrelid, c.conkey,
           (select string_agg(quote_ident(a.attname), ', ' order by k.ord)
              from unnest(c.conkey) with ordinality k(attnum, ord)
              join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) as cols,
           (select string_agg(a.attname, '_' order by k.ord)
              from unnest(c.conkey) with ordinality k(attnum, ord)
              join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) as colnames,
           (select relname from pg_class where oid = c.conrelid) as relname
    from pg_constraint c join pg_namespace n on n.oid = c.connamespace
    where c.contype = 'f' and n.nspname = 'public'
      and c.confrelid not in ('public.plans'::regclass, 'public.roles'::regclass)
  loop
    if not exists (select 1 from pg_index i where i.indrelid = r.conrelid and i.indkey[0] = r.conkey[1]) then
      v_name := left(r.relname || '_' || r.colnames, 52) || '_fkx';
      execute format('create index if not exists %I on %s (%s)', v_name, r.tbl, r.cols);
    end if;
  end loop;
end$$;

-- Fast "contains" search on names and emails (Supabase ships pg_trgm).
do $$
declare v_schema text;
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_trgm') then
    create extension if not exists pg_trgm with schema extensions;
    -- pg_trgm may already live in another schema (e.g. public) on older projects.
    select n.nspname into v_schema from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
    execute format('create index if not exists users_name_trgm on public.users using gin (full_name %I.gin_trgm_ops)', v_schema);
    execute format('create index if not exists users_email_trgm on public.users using gin (email %I.gin_trgm_ops)', v_schema);
    execute format('create index if not exists tenants_name_trgm on public.tenants using gin (name %I.gin_trgm_ops)', v_schema);
  end if;
exception when others then
  raise notice 'pg_trgm search indexes skipped: %', sqlerrm;
end$$;

-- ---------------------------------------------------------------------------
-- 2. Broadcast from Database
-- ---------------------------------------------------------------------------
-- Sends a tiny signal on a private Realtime channel. Never blocks the write.
create or replace function app.broadcast(p_topic text, p_event text, p_payload jsonb default '{}'::jsonb) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  if to_regprocedure('realtime.send(jsonb, text, text, boolean)') is null then return; end if;
  execute 'select realtime.send($1, $2, $3, true)' using coalesce(p_payload, '{}'::jsonb), p_event, p_topic;
exception when others then
  null; -- a missed signal is recovered by the next poll/tick; the data write must succeed
end$$;

alter table public.class_sessions
  add column if not exists state_version   bigint not null default 0,
  add column if not exists teacher_seen_at timestamptz;

-- Anything students must refetch bumps state_version (and broadcasts).
create or replace function app.session_version_bump() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (to_jsonb(new) - 'teacher_seen_at' - 'state_version' - 'updated_at')
     is distinct from (to_jsonb(old) - 'teacher_seen_at' - 'state_version' - 'updated_at')
     and new.state_version = old.state_version then
    new.state_version := old.state_version + 1;
  end if;
  return new;
end$$;
drop trigger if exists class_sessions_version on public.class_sessions;
create trigger class_sessions_version before update on public.class_sessions
  for each row execute function app.session_version_bump();

create or replace function app.session_changed() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.state_version is distinct from old.state_version then
    perform app.broadcast('session:' || new.id, 'state', jsonb_build_object('v', new.state_version));
    perform app.broadcast('staff:' || new.id, 'state', '{}'::jsonb);
  end if;
  return null;
end$$;
drop trigger if exists class_sessions_broadcast on public.class_sessions;
create trigger class_sessions_broadcast after update on public.class_sessions
  for each row execute function app.session_changed();

-- Child rows that change what students see: bump the session's version.
create or replace function app.touch_session() returns trigger
language plpgsql security definer set search_path = '' as $$
declare r jsonb := to_jsonb(coalesce(new, old)); v_session uuid;
begin
  v_session := coalesce((r ->> 'class_session_id')::uuid, (r ->> 'session_id')::uuid);
  if v_session is not null then
    update public.class_sessions set state_version = state_version + 1 where id = v_session;
    if tg_table_name = 'environment_events' then
      perform app.broadcast('staff:' || v_session, 'alert', '{}'::jsonb);
    end if;
  end if;
  return null;
end$$;
do $$
declare t text;
begin
  foreach t in array array['announcements','spotlights','environment_events','rtc_rooms'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_touch_session', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function app.touch_session()', t || '_touch_session', t);
  end loop;
end$$;

-- Teacher-only signals: roster changes and raised hands. Answers are not
-- signalled one by one (a 500,000-player quiz would flood the channel); the
-- teacher's responses panel refreshes every few seconds instead.
create or replace function app.staff_signal() returns trigger
language plpgsql security definer set search_path = '' as $$
declare r jsonb := to_jsonb(coalesce(new, old)); v_session uuid := (r ->> 'session_id')::uuid; v_event text;
begin
  if tg_table_name = 'session_participants' then
    -- Presence ticks (last_seen_at only) are not worth a signal.
    if tg_op = 'UPDATE' and (to_jsonb(new) - 'last_seen_at') = (to_jsonb(old) - 'last_seen_at') then return null; end if;
    v_event := 'roster';
  else
    v_event := 'hand';
  end if;
  if v_session is not null then perform app.broadcast('staff:' || v_session, v_event, '{}'::jsonb); end if;
  return null;
end$$;
do $$
declare t text;
begin
  foreach t in array array['session_participants','raise_hands'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_staff_signal', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function app.staff_signal()', t || '_staff_signal', t);
  end loop;
end$$;

-- Per-user, per-thread, per-board and per-game signals.
create or replace function app.row_signal() returns trigger
language plpgsql security definer set search_path = '' as $$
declare r jsonb := to_jsonb(coalesce(new, old));
begin
  case tg_table_name
    when 'notifications' then perform app.broadcast('user:' || (r ->> 'user_id'), 'notification', '{}'::jsonb);
    when 'chat_messages' then perform app.broadcast('thread:' || (r ->> 'thread_id'), 'message', '{}'::jsonb);
    when 'collab_posts'  then perform app.broadcast('board:' || (r ->> 'board_id'), 'post', '{}'::jsonb);
    when 'game_sessions' then perform app.broadcast('game:' || (r ->> 'id'), 'state', '{}'::jsonb);
    when 'game_players'  then perform app.broadcast('game:' || (r ->> 'game_id'), 'players', '{}'::jsonb);
    else null;
  end case;
  return null;
end$$;
do $$
declare t text;
begin
  foreach t in array array['notifications','chat_messages','collab_posts','game_sessions','game_players'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_signal', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function app.row_signal()', t || '_signal', t);
  end loop;
end$$;

-- Nothing uses postgres_changes any more: take every table out of the publication.
do $$
declare r record;
begin
  for r in select tablename from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' loop
    execute format('alter publication supabase_realtime drop table public.%I', r.tablename);
  end loop;
end$$;

-- Topic rules (also unit-tested directly):
--   session:<s>        students in the class + the session's teachers
--   staff:<s>          the session's teachers
--   screen:<s>:<u>     listen: the session's teachers; send: student <u> only, while in the class
--   user:<u>           that user
--   thread:<t> / board:<b> / game:<g>   whoever can read that row (RLS decides)
create or replace function app.can_listen(p_topic text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v_kind text := split_part(p_topic, ':', 1); v_id uuid;
begin
  begin v_id := nullif(split_part(p_topic, ':', 2), '')::uuid; exception when others then return false; end;
  if v_id is null or app.tenant_id() is null then return false; end if;
  return case v_kind
    when 'session' then app.in_session(v_id) or app.can_manage_session(v_id)
    when 'staff'   then app.can_manage_session(v_id)
    when 'screen'  then app.can_manage_session(v_id)
    when 'user'    then v_id = auth.uid()
    when 'thread'  then exists (select 1 from public.chat_threads t where t.id = v_id and t.tenant_id = app.tenant_id()
                                and (t.student_id = auth.uid() or t.teacher_id = auth.uid()
                                     or (t.kind = 'group' and app.in_session(t.session_id)) or app.can_manage_class(t.class_id)))
    -- boards and games: exactly the people who can read the row (mirrors their RLS policies)
    when 'board'   then exists (select 1 from public.collab_boards b where b.id = v_id and b.tenant_id = app.tenant_id()
                                and (b.owner_id = auth.uid()
                                     or (b.session_id is not null and (app.can_manage_session(b.session_id) or app.in_session(b.session_id)))
                                     or (b.session_id is null and app.is_teacher())))
    when 'game'    then exists (select 1 from public.game_sessions g where g.id = v_id and g.tenant_id = app.tenant_id()
                                and (app.can_manage_class(g.class_id) or app.in_class(g.class_id)))
    when 'annot'   then app.in_session(v_id) or app.can_manage_session(v_id)
    else false end;
end$$;

create or replace function app.can_send(p_topic text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v_kind text := split_part(p_topic, ':', 1); v_id uuid; v_user uuid;
begin
  begin
    v_id := nullif(split_part(p_topic, ':', 2), '')::uuid;
    v_user := nullif(split_part(p_topic, ':', 3), '')::uuid;
  exception when others then return false; end;
  if v_id is null then return false; end if;
  return case v_kind
    when 'screen' then v_user = auth.uid() and app.in_session(v_id)
                       and exists (select 1 from public.class_sessions s where s.id = v_id and s.status = 'live')
    when 'annot'  then app.can_manage_session(v_id)
    else false end;
end$$;

-- Private channel authorisation (Supabase Realtime checks these on join/send).
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'realtime' and table_name = 'messages') then
    execute 'drop policy if exists "swiftcipher channels: listen" on realtime.messages';
    execute 'drop policy if exists "swiftcipher channels: send" on realtime.messages';
    execute $p$
      create policy "swiftcipher channels: listen" on realtime.messages for select to authenticated
      using (app.can_listen(realtime.topic()))$p$;
    execute $p$
      create policy "swiftcipher channels: send" on realtime.messages for insert to authenticated
      with check (app.can_send(realtime.topic()))$p$;
  end if;
end$$;


-- ---------------------------------------------------------------------------
-- 3. The student tick
-- ---------------------------------------------------------------------------
-- Platform-wide knobs the operator can turn without a deploy, e.g. at peak load:
--   update public.platform_config set value = '30' where key = 'student_tick_seconds';
-- Every student page adopts it on its next tick; presence and leave detection
-- widen their windows to match.
create table if not exists public.platform_config (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.platform_config enable row level security;
revoke all on public.platform_config from anon, authenticated;
insert into public.platform_config (key, value) values ('student_tick_seconds', '10') on conflict (key) do nothing;

create or replace function app.tick_seconds() returns int
language sql stable security definer set search_path = '' as $$
  select least(greatest(coalesce((select (value #>> '{}')::int from public.platform_config where key = 'student_tick_seconds'), 10), 5), 60)
$$;

-- How long a student may be silent before counting as gone: three ticks plus slack, at least 45 s.
create or replace function app.presence_window() returns interval
language sql stable security definer set search_path = '' as $$
  select make_interval(secs => greatest(45, app.tick_seconds() * 3 + 15))
$$;

drop function if exists public.student_report(uuid, boolean, boolean, boolean, text, boolean);
create or replace function public.student_report(
  p_session uuid, p_visible boolean, p_fullscreen boolean, p_sharing boolean,
  p_surface text default null, p_unsupported boolean default false,
  p_slide int default null, p_idle boolean default false
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_s        public.class_sessions;
  v_p        public.session_participants;
  v_old      public.session_participants;
  v_set      public.tenant_settings;
  v_reason   text;
  v_setup    boolean := false;
  v_status   text := case when p_idle then 'idle' else 'online' end;
  v_slide    int;
  v_changed  boolean;
  v_returned int;
begin
  select * into v_s from public.class_sessions where id = p_session;
  if v_s.id is null or not app.in_class(v_s.class_id) then raise exception 'Session not found.' using errcode = 'P0002'; end if;
  if v_s.status <> 'live' then return jsonb_build_object('status', v_s.status, 'state_version', v_s.state_version); end if;
  select * into v_set from public.tenant_settings where tenant_id = v_s.tenant_id;

  v_reason := case
    when not v_s.lockdown then null
    when not coalesce(p_visible, true) then 'Left the lesson (switched tab, app or window)'
    when not coalesce(p_fullscreen, false) and not p_unsupported then 'Left full-screen mode'
    when v_set.allow_screen_capture and not coalesce(p_sharing, false) and not p_unsupported then 'Stopped sharing their screen'
  end;

  select * into v_old from public.session_participants where session_id = p_session and user_id = auth.uid();
  if v_old.session_id is null then
    insert into public.session_participants (session_id, user_id, tenant_id, status, current_slide)
      values (p_session, auth.uid(), v_s.tenant_id, v_status, v_s.current_slide)
      on conflict (session_id, user_id) do nothing;
    select * into v_old from public.session_participants where session_id = p_session and user_id = auth.uid();
  end if;

  if v_reason is not null and v_old.ready_at is null then
    if v_old.joined_at > now() - interval '2 minutes' then v_reason := null; v_setup := true;
    else v_reason := 'Did not start the lesson (screen share and full screen are required)'; end if;
  end if;

  v_slide := case when v_s.mode = 'student_paced' then coalesce(case when p_slide >= 0 then p_slide end, v_old.current_slide)
                  else v_s.current_slide end;

  v_changed := v_old.left_at is not null
    or v_old.status is distinct from v_status
    or v_old.current_slide is distinct from v_slide
    or v_old.tab_visible is distinct from coalesce(p_visible, true)
    or v_old.fullscreen is distinct from coalesce(p_fullscreen, false)
    or v_old.screen_sharing is distinct from coalesce(p_sharing, false)
    or v_old.share_unsupported is distinct from coalesce(p_unsupported, false)
    or v_old.screen_surface is distinct from left(p_surface, 20)
    or v_old.away_reason is distinct from v_reason
    or (v_reason is null and not v_setup and v_old.ready_at is null);

  -- Presence only needs a write every 15 s; everything else writes on change.
  if v_changed or v_old.last_seen_at < now() - make_interval(secs => app.tick_seconds() * 1.5) then
    update public.session_participants set
      last_seen_at = now(), left_at = null, status = v_status, current_slide = v_slide,
      tab_visible = coalesce(p_visible, true), fullscreen = coalesce(p_fullscreen, false),
      screen_sharing = coalesce(p_sharing, false), share_unsupported = coalesce(p_unsupported, false),
      screen_surface = left(p_surface, 20),
      ready_at = case when v_reason is null and not v_setup then coalesce(ready_at, now()) else ready_at end,
      away_since = case when v_reason is null then null else coalesce(away_since, now()) end,
      away_reason = v_reason
    where session_id = p_session and user_id = auth.uid()
    returning * into v_p;
  else
    v_p := v_old;
  end if;

  if v_setup then
    null;
  elsif v_reason is null then
    -- Only look for alerts to close if the student may have had one.
    if v_old.away_since is not null or v_old.left_at is not null or v_old.last_seen_at < now() - interval '40 seconds' then
      update public.environment_events set resolved_at = now()
       where class_session_id = p_session and student_id = auth.uid() and resolved_at is null
         and kind = 'environment_left' and device_id is null;
      get diagnostics v_returned = row_count;
      if v_returned > 0 then
        perform app.notify(v_s.teacher_id, 'student_returned',
          (select full_name from public.users where id = auth.uid()) || ' returned to the class', null,
          '/teacher/live/' || p_session, 'info', jsonb_build_object('student_id', auth.uid()));
      end if;
    end if;
  else
    perform app.web_leave_check(v_s);
  end if;

  return jsonb_build_object(
    'status', v_s.status,
    'lockdown', v_s.lockdown,
    'away', v_reason is not null,
    'reason', v_reason,
    'setting_up', v_setup,
    'tick_seconds', app.tick_seconds(),
    'state_version', v_s.state_version,
    'current_slide', v_s.current_slide,
    'active_activity_id', v_s.active_activity_id,
    'capture', jsonb_build_object(
      'enabled', v_set.allow_screen_capture,
      -- frames are only worth sending while a teacher has the live room open
      'send', v_set.allow_screen_capture and coalesce(v_s.teacher_seen_at > now() - interval '45 seconds', false),
      'interval_seconds', greatest(v_set.thumbnail_interval_seconds, 5),
      'high_quality', v_p.hq_requested_at is not null and v_p.hq_requested_at > now() - interval '30 seconds'
                      or exists (select 1 from public.spotlights sp where sp.session_id = p_session
                                 and sp.student_id = auth.uid() and sp.ended_at is null)));
end$$;
revoke execute on function public.student_report(uuid, boolean, boolean, boolean, text, boolean, int, boolean) from public, anon;
grant execute on function public.student_report(uuid, boolean, boolean, boolean, text, boolean, int, boolean) to authenticated, service_role;

-- New schools refresh rail thumbnails every 10 s (admins can change it).
alter table public.tenant_settings alter column thumbnail_interval_seconds set default 10;

-- Presence is written every 15 s now, so "stopped responding" means 45 s of silence.
create or replace function app.web_leave_check(p_s public.class_sessions) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare r record; v_grace int; v_default int; v_keep boolean; v_img text;
begin
  if p_s.status <> 'live' or not p_s.lockdown then return; end if;
  select default_grace_seconds, store_event_screenshots into v_default, v_keep
    from public.tenant_settings where tenant_id = p_s.tenant_id;
  for r in select p.user_id,
                  case when p.away_since is not null then p.away_since
                       when p.left_at is not null then p.left_at
                       else p.last_seen_at + app.presence_window() end as since,
                  coalesce(p.away_reason, case when p.left_at is not null then 'Closed the lesson'
                                               else 'Lesson page stopped responding (closed or lost connection)' end) as why
           from public.session_participants p
           where p.session_id = p_s.id
             and (p.away_since is not null or p.left_at is not null or p.last_seen_at < now() - app.presence_window())
             -- a student still setting up (first 2 minutes, never fully in class) hasn't left
             and (p.ready_at is not null or p.joined_at < now() - interval '2 minutes')
             -- students monitored by the extension are covered by its own leave rules
             and not exists (select 1 from public.browser_sessions b where b.class_session_id = p_s.id
                             and b.student_id = p.user_id and b.last_heartbeat_at > now() - interval '45 seconds') loop
    v_grace := coalesce((app.effective_policy(p_s, r.user_id)).grace_seconds, v_default, 15);
    if now() - r.since >= make_interval(secs => v_grace) then
      v_img := case when v_keep then (select image_data from public.screen_snapshots
                     where class_session_id = p_s.id and student_id = r.user_id and quality in ('thumbnail','spotlight')
                     order by captured_at desc limit 1) end;
      perform app.raise_web_event(p_s, r.user_id, r.why, v_img);
    end if;
  end loop;
end$$;

-- The live room records that a teacher is watching (frames are only sent then).
create or replace function public.teacher_session_state(p_session uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_s        public.class_sessions;
  v_settings public.tenant_settings;
  r          public.browser_sessions;
begin
  select * into v_s from public.class_sessions where id = p_session;
  if v_s.id is null or not app.can_manage_class(v_s.class_id) then raise exception 'Session not found.' using errcode = 'P0002'; end if;
  select * into v_settings from public.tenant_settings where tenant_id = v_s.tenant_id;

  if v_s.status = 'live' then
    -- Students only send screen frames while a teacher is watching (throttled write).
    if v_s.teacher_seen_at is null or v_s.teacher_seen_at < now() - interval '20 seconds' then
      update public.class_sessions set teacher_seen_at = now() where id = p_session;
    end if;
    for r in update public.browser_sessions set connection_lost_at = now()
             where class_session_id = p_session and ended_at is null and connection_lost_at is null
               and last_heartbeat_at < now() - interval '45 seconds'
             returning * loop
      perform app.raise_event(r, v_s, v_s.environment_id, 'connection_lost', 'info',
                              'Extension stopped reporting — connection lost, not a rule violation', null, null);
    end loop;
    perform app.web_leave_check(v_s);
    update public.teacher_commands set status = 'expired'
     where class_session_id = p_session and status in ('queued','delivered') and expires_at < now();
  end if;

  return jsonb_build_object(
    'session', to_jsonb(v_s) || jsonb_build_object(
      'class_name', (select name from public.classes where id = v_s.class_id),
      'lesson_title', (select title from public.lessons where id = v_s.lesson_id),
      'environment_name', (select name from public.environment_policies where id = v_s.environment_id)),
    'settings', jsonb_build_object('allow_spotlight', v_settings.allow_spotlight, 'allow_group_chat', v_settings.allow_group_chat,
                                   'allow_screen_capture', v_settings.allow_screen_capture,
                                   'store_event_screenshots', v_settings.store_event_screenshots,
                                   'thumbnail_interval_seconds', v_settings.thumbnail_interval_seconds),
    'server_now', now(),
    'roster', (select coalesce(jsonb_agg(jsonb_build_object(
        'student_id', u.id, 'name', u.full_name,
        'presence', case when p.user_id is null then 'not_joined'
                         when p.left_at is not null or p.last_seen_at < now() - app.presence_window() then 'offline'
                         else p.status end,
        'last_seen_at', p.last_seen_at, 'current_slide', p.current_slide,
        'web', case when p.user_id is null then null else jsonb_build_object(
                 'sharing', p.screen_sharing and p.last_seen_at > now() - app.presence_window(),
                 'unsupported', p.share_unsupported, 'surface', p.screen_surface,
                 'visible', p.tab_visible, 'fullscreen', p.fullscreen,
                 'away_since', p.away_since, 'away_reason', p.away_reason) end,
        'device', (select jsonb_build_object('device_id', b.device_id, 'url', b.active_url, 'domain', b.active_domain,
                     'title', b.active_title, 'tab_count', b.tab_count, 'idle_state', b.idle_state,
                     'online', b.connection_lost_at is null and b.last_heartbeat_at > now() - interval '45 seconds',
                     'last_heartbeat_at', b.last_heartbeat_at, 'focus_locked', b.focus_locked,
                     'violation', b.violation_rule, 'violation_since', b.violation_since,
                     'snapshot_at', (select max(sn.captured_at) from public.screen_snapshots sn
                                     where sn.student_id = u.id and sn.class_session_id = p_session and sn.quality = 'thumbnail'))
                   from public.browser_sessions b where b.class_session_id = p_session and b.student_id = u.id
                   order by b.last_heartbeat_at desc limit 1),
        'open_alerts', (select count(*) from public.environment_events e where e.class_session_id = p_session
                        and e.student_id = u.id and e.status = 'open'),
        'hand_raised', exists (select 1 from public.raise_hands h where h.session_id = p_session and h.student_id = u.id and h.status = 'open'))
        order by u.full_name), '[]'::jsonb)
      from public.class_members m join public.users u on u.id = m.user_id
      left join public.session_participants p on p.session_id = p_session and p.user_id = u.id
      where m.class_id = v_s.class_id and m.role = 'student'),
    'alerts', (select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'kind', e.kind, 'severity', e.severity, 'rule', e.rule,
                 'domain', e.domain, 'confidence', e.confidence, 'status', e.status, 'student_id', e.student_id,
                 'student', u.full_name, 'created_at', e.created_at, 'resolved_at', e.resolved_at,
                 'has_evidence', e.evidence_image is not null)
                 order by e.created_at desc), '[]'::jsonb)
               from (select * from public.environment_events where class_session_id = p_session
                     and (status = 'open' or created_at > now() - interval '10 minutes') order by created_at desc limit 50) e
               join public.users u on u.id = e.student_id),
    'hands', (select coalesce(jsonb_agg(jsonb_build_object('id', h.id, 'student_id', h.student_id, 'student', u.full_name,
                'message', h.message, 'created_at', h.created_at) order by h.created_at), '[]'::jsonb)
              from public.raise_hands h join public.users u on u.id = h.student_id
              where h.session_id = p_session and h.status = 'open'),
    'commands', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'kind', c.kind, 'status', c.status, 'error', c.error,
                   'student', u.full_name, 'created_at', c.created_at) order by c.created_at desc), '[]'::jsonb)
                 from (select * from public.teacher_commands where class_session_id = p_session order by created_at desc limit 20) c
                 join public.users u on u.id = c.student_id),
    'spotlight', (select jsonb_build_object('id', s.id, 'student_id', s.student_id, 'anonymized', s.anonymized,
                    'show_to_class', s.show_to_class, 'started_at', s.started_at)
                  from public.spotlights s where s.session_id = p_session and s.ended_at is null),
    'activity', case when v_s.active_activity_id is null then null
                     else public.activity_results(v_s.active_activity_id, p_session) end);
end$$;

-- ---------------------------------------------------------------------------
-- 4. Retention across 50,000 schools: set-based, batched, time-boxed
-- ---------------------------------------------------------------------------
-- Deletes rows older than each school's retention, at most p_batch per round,
-- using the (tenant_id, time) indexes: one index probe per school per table.
create or replace function app.purge_expired(p_table text, p_time_col text, p_setting text, p_fixed interval default null,
                                             p_batch int default 20000, p_deadline timestamptz default null) returns bigint
language plpgsql volatile security definer set search_path = '' as $$
declare v_total bigint := 0; v_n bigint; v_age text;
begin
  v_age := case when p_fixed is not null then quote_literal(p_fixed) || '::interval'
                else format('make_interval(days => s.%I)', p_setting) end;
  loop
    execute format(
      'delete from public.%1$I x where x.ctid = any (array(
         select e.ctid from public.tenant_settings s
         cross join lateral (select y.ctid from public.%1$I y
                             where y.tenant_id = s.tenant_id and y.%2$I < now() - %3$s
                             limit 2000) e
         limit %4$s))', p_table, p_time_col, v_age, p_batch);
    get diagnostics v_n = row_count;
    v_total := v_total + v_n;
    exit when v_n < p_batch or clock_timestamp() > coalesce(p_deadline, clock_timestamp() + interval '1 minute');
  end loop;
  return v_total;
end$$;

create or replace function app.apply_retention_all() returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_deadline timestamptz := clock_timestamp() + interval '4 minutes';
begin
  perform app.purge_expired('browser_events',     'created_at',  'telemetry_retention_days', null, 20000, v_deadline);
  perform app.purge_expired('screen_snapshots',   'captured_at', 'telemetry_retention_days', null, 20000, v_deadline);
  perform app.purge_expired('environment_events', 'created_at',  'telemetry_retention_days', null, 20000, v_deadline);
  perform app.purge_expired('browser_sessions',   'started_at',  'telemetry_retention_days', null, 20000, v_deadline);
  perform app.purge_expired('teacher_commands',   'created_at',  'telemetry_retention_days', null, 20000, v_deadline);
  perform app.purge_expired('rtc_signals',        'created_at',  null, interval '1 day', 20000, v_deadline);
  perform app.purge_expired('device_pairing_codes','expires_at', null, interval '1 day', 20000, v_deadline);
  perform app.purge_expired('quiz_attempts',      'started_at',  'learning_retention_days', null, 20000, v_deadline);
  perform app.purge_expired('game_sessions',      'created_at',  'learning_retention_days', null, 20000, v_deadline);
  perform app.purge_expired('chat_messages',      'created_at',  'learning_retention_days', null, 20000, v_deadline);
  perform app.purge_expired('notifications',      'created_at',  null, interval '90 days', 20000, v_deadline);
  -- Live thumbnails of ended sessions (normally already removed by trigger).
  delete from public.screen_snapshots sn using public.class_sessions s
   where sn.class_session_id = s.id and s.status = 'ended' and sn.quality <> 'event'
     and s.ended_at > now() - interval '2 hours';
end$$;

-- ---------------------------------------------------------------------------
-- 5. Platform console at scale
-- ---------------------------------------------------------------------------
create table if not exists public.platform_stats (
  id          int primary key default 1 check (id = 1),
  stats       jsonb not null,
  computed_at timestamptz not null default now()
);
alter table public.platform_stats enable row level security;
revoke all on public.platform_stats from anon, authenticated;

create or replace function app.refresh_platform_stats() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v jsonb;
begin
  v := jsonb_build_object(
    'tenants', (select count(*) from public.tenants),
    'tenants_suspended', (select count(*) from public.tenants where status = 'suspended'),
    'users', (select count(*) from public.users),
    'users_suspended', (select count(*) from public.users where status = 'suspended'),
    'by_role', (select coalesce(jsonb_object_agg(role, n), '{}'::jsonb) from (select role, count(*) n from public.users group by role) r),
    'devices', (select count(*) from public.devices where status = 'active'),
    'sessions_30d', (select count(*) from public.class_sessions where created_at > now() - interval '30 days'),
    'by_plan', (select coalesce(jsonb_object_agg(plan_code, n), '{}'::jsonb) from (select plan_code, count(*) n from public.tenants group by plan_code) p));
  insert into public.platform_stats (id, stats, computed_at) values (1, v, now())
    on conflict (id) do update set stats = excluded.stats, computed_at = excluded.computed_at;
  return v;
end$$;

create or replace function public.sa_overview() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v public.platform_stats;
begin
  perform app.sa_require();
  select * into v from public.platform_stats where id = 1;
  if v.id is null or v.computed_at < now() - interval '1 hour' then
    perform app.refresh_platform_stats();
    select * into v from public.platform_stats where id = 1;
  end if;
  -- Live figures come from small partial indexes; totals are at most an hour old.
  return v.stats || jsonb_build_object(
    'live_sessions', (select count(*) from public.class_sessions where status = 'live'),
    'devices_online', (select count(*) from public.devices where status = 'active' and last_seen_at > now() - interval '45 seconds'),
    'stats_at', v.computed_at);
end$$;

-- Keyset pagination: fetch one row more than asked to know whether a next page exists.
drop function if exists public.sa_list_tenants(text);
create or replace function public.sa_list_tenants(p_search text default null, p_cursor text default null, p_limit int default 50) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_at timestamptz; v_id uuid; v_rows jsonb; v_next text;
  v_q text := nullif(btrim(p_search), '');
begin
  perform app.sa_require();
  if p_cursor is not null then
    v_at := split_part(p_cursor, '|', 1)::timestamptz; v_id := split_part(p_cursor, '|', 2)::uuid;
  end if;
  with page as (
    select t.* from public.tenants t
    where (v_q is null or t.name ilike '%' || v_q || '%' or t.slug ilike '%' || v_q || '%')
      and (v_at is null or (t.created_at, t.id) < (v_at, v_id))
    order by t.created_at desc, t.id desc
    limit v_limit + 1),
  numbered as (select p.*, row_number() over (order by p.created_at desc, p.id desc) rn, count(*) over () total from page p)
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', t.id, 'name', t.name, 'slug', t.slug, 'plan_code', t.plan_code, 'status', t.status, 'country', t.country,
      'created_at', t.created_at, 'suspended_at', t.suspended_at, 'suspended_reason', t.suspended_reason,
      'users', u.users, 'students', u.students, 'staff', u.staff,
      'classes', (select count(*) from public.classes c where c.tenant_id = t.id),
      'devices', (select count(*) from public.devices d where d.tenant_id = t.id and d.status = 'active'),
      'last_session_at', (select s.created_at from public.class_sessions s where s.tenant_id = t.id order by s.created_at desc limit 1))
      order by t.rn) filter (where t.rn <= v_limit), '[]'::jsonb),
    max(case when t.rn = v_limit and t.total > v_limit then t.created_at::text || '|' || t.id::text end)
  into v_rows, v_next
  from numbered t
  cross join lateral (select count(*) users, count(*) filter (where x.role = 'student') students,
                             count(*) filter (where x.role in ('teacher','school_admin','it_admin')) staff
                      from public.users x where x.tenant_id = t.id and t.rn <= v_limit) u;
  return jsonb_build_object('rows', v_rows, 'next_cursor', v_next);
end$$;

drop function if exists public.sa_list_users(text, uuid);
create or replace function public.sa_list_users(p_search text default null, p_tenant uuid default null,
                                                p_cursor text default null, p_limit int default 50) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_at timestamptz; v_id uuid; v_rows jsonb; v_next text;
  v_q text := nullif(btrim(p_search), '');
begin
  perform app.sa_require();
  if p_cursor is not null then
    v_at := split_part(p_cursor, '|', 1)::timestamptz; v_id := split_part(p_cursor, '|', 2)::uuid;
  end if;
  with page as (
    select u.id, u.created_at, u.full_name, u.email, u.role, u.status, u.tenant_id
    from public.users u
    where (p_tenant is null or u.tenant_id = p_tenant)
      and (v_q is null or u.full_name ilike '%' || v_q || '%' or u.email ilike '%' || v_q || '%')
      and (v_at is null or (u.created_at, u.id) < (v_at, v_id))
    order by u.created_at desc, u.id desc
    limit v_limit + 1),
  numbered as (select p.*, row_number() over (order by p.created_at desc, p.id desc) rn, count(*) over () total from page p)
  select coalesce(jsonb_agg(jsonb_build_object('id', n.id, 'full_name', n.full_name, 'email', n.email, 'role', n.role,
             'status', n.status, 'created_at', n.created_at, 'tenant_id', t.id, 'tenant', t.name, 'tenant_status', t.status)
             order by n.rn) filter (where n.rn <= v_limit), '[]'::jsonb),
         max(case when n.rn = v_limit and n.total > v_limit then n.created_at::text || '|' || n.id::text end)
  into v_rows, v_next
  from numbered n join public.tenants t on t.id = n.tenant_id;
  return jsonb_build_object('rows', v_rows, 'next_cursor', v_next);
end$$;

-- ---------------------------------------------------------------------------
-- Maintenance also refreshes the platform stats.
-- ---------------------------------------------------------------------------
create or replace function app.run_maintenance() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_ended int;
begin
  v_ended := app.end_abandoned_sessions();
  perform app.apply_retention_all();
  delete from public.invites where expires_at < now() - interval '30 days';
  delete from public.error_events where last_seen_at < now() - interval '30 days';
  perform app.refresh_platform_stats();
  return jsonb_build_object('ok', true, 'ran_at', now(), 'sessions_auto_ended', v_ended);
end$$;

create or replace function public.health() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('ok', true, 'db_time', now(), 'schema', '0760')
$$;

-- ---------- Privileges ----------
revoke execute on function app.broadcast(text, text, jsonb), app.purge_expired(text, text, text, interval, int, timestamptz),
                           app.refresh_platform_stats(), app.can_listen(text), app.can_send(text)
  from public, anon;
grant execute on function app.can_listen(text), app.can_send(text) to authenticated;
revoke execute on function public.sa_list_tenants(text, text, int), public.sa_list_users(text, uuid, text, int) from public, anon;
grant execute on function public.sa_list_tenants(text, text, int), public.sa_list_users(text, uuid, text, int) to authenticated, service_role;
