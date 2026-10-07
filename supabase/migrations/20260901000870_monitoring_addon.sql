-- 0870: classroom monitoring becomes an optional add-on per school.
--
-- SwiftCipher is now a live presentation and engagement engine (docs/LIVE_ENGINE.md).
-- Monitoring (lockdown, screen capture, leave alerts, blocked-site environments) is an
-- add-on a school switches on. New schools start with it off; schools that already
-- exist keep it on, so nothing changes for them. When it is off the database refuses
-- lockdown and screen capture outright: the switch is not just hidden in the interface.

alter table public.tenant_settings add column if not exists monitoring_enabled boolean;
update public.tenant_settings set monitoring_enabled = true where monitoring_enabled is null;
alter table public.tenant_settings alter column monitoring_enabled set default false;
alter table public.tenant_settings alter column monitoring_enabled set not null;
grant update (monitoring_enabled) on public.tenant_settings to authenticated;

-- Sessions already running in a school without monitoring stop locking down.
update public.class_sessions s set lockdown = false
  from public.tenant_settings t
 where t.tenant_id = s.tenant_id and not t.monitoring_enabled and s.status = 'live' and s.lockdown;

create or replace function public.start_session(
  p_class uuid, p_lesson uuid default null, p_mode text default 'live_participation',
  p_title text default null, p_environment uuid default null
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me    public.users := app.me();
  v_class public.classes;
  v_s     public.class_sessions;
  v_mon   boolean;
begin
  if not app.can_manage_class(p_class) then raise exception 'Not your class.' using errcode = '42501'; end if;
  select * into v_class from public.classes where id = p_class;
  if p_mode not in ('live_participation','student_paced','front_of_class') then
    raise exception 'Unknown delivery mode.' using errcode = '22023';
  end if;
  if p_lesson is not null and not app.can_view_lesson(p_lesson) then
    raise exception 'Lesson not found.' using errcode = 'P0002';
  end if;
  if p_environment is not null and not exists (select 1 from public.environment_policies
                                               where id = p_environment and tenant_id = v_me.tenant_id) then
    raise exception 'Environment not found.' using errcode = 'P0002';
  end if;
  -- Monitoring is an add-on: without it, no lockdown and no blocked-site environment.
  v_mon := coalesce((select monitoring_enabled from public.tenant_settings where tenant_id = v_me.tenant_id), false);
  if not v_mon then p_environment := null; end if;
  if exists (select 1 from public.class_sessions where class_id = p_class and status = 'live') then
    raise exception 'This class already has a live session. End it first.' using errcode = 'P0001';
  end if;

  insert into public.class_sessions (tenant_id, class_id, teacher_id, lesson_id, lesson_version, title, mode, join_code,
                                     status, environment_id, environment_active, started_at, lockdown)
    values (v_me.tenant_id, p_class, v_me.id, p_lesson,
            (select current_version from public.lessons where id = p_lesson),
            coalesce(nullif(btrim(p_title), ''), (select title from public.lessons where id = p_lesson), v_class.name || ' live'),
            p_mode, app.unique_code(6, 'class_sessions'), 'live', p_environment, p_environment is not null, now(), v_mon)
    returning * into v_s;

  insert into public.session_participants (session_id, user_id, tenant_id, status)
    values (v_s.id, v_me.id, v_me.tenant_id, 'online');
  perform app.audit('session.started', 'class_session', v_s.id::text,
                    jsonb_build_object('class_id', p_class, 'lesson_id', p_lesson, 'environment_id', p_environment));
  perform app.notify(m.user_id, 'session_started', 'Live class started: ' || v_s.title, 'Join code ' || v_s.join_code,
                     '/student/live/' || v_s.id, 'info', jsonb_build_object('session_id', v_s.id))
  from public.class_members m where m.class_id = p_class and m.role = 'student';
  return to_jsonb(v_s);
end$$;

create or replace function public.set_session_lockdown(p_session uuid, p_on boolean) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_s public.class_sessions := app.require_live_session(p_session);
begin
  if p_on and not coalesce((select ts.monitoring_enabled from public.tenant_settings ts
                             join public.class_sessions cs on cs.tenant_id = ts.tenant_id where cs.id = p_session), false) then
    raise exception 'Classroom monitoring is switched off for this school.' using errcode = 'P0001';
  end if;
  update public.class_sessions set lockdown = p_on where id = p_session;
  if not p_on then
    update public.session_participants set away_since = null, away_reason = null where session_id = p_session;
    update public.environment_events set resolved_at = now()
     where class_session_id = p_session and resolved_at is null and kind = 'environment_left' and device_id is null;
  end if;
  perform app.audit('session.lockdown_' || case when p_on then 'on' else 'off' end, 'class_session', p_session::text);
end$$;

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
  v_capture  boolean;
  v_guest    boolean;
  v_lock     boolean;
begin
  select * into v_s from public.class_sessions where id = p_session;
  if v_s.id is null then raise exception 'Session not found.' using errcode = 'P0002'; end if;
  -- Guests (code and a name, no account) are only monitored when the teacher chose that for this lesson.
  v_guest := not app.in_class(v_s.class_id) and app.is_session_guest(v_s.id);
  if not (v_guest or app.in_class(v_s.class_id)) then raise exception 'Session not found.' using errcode = 'P0002'; end if;
  select * into v_set from public.tenant_settings where tenant_id = v_s.tenant_id;
  -- Monitoring is an add-on: when the school has it off, nothing is locked or captured.
  v_lock := v_set.monitoring_enabled and v_s.lockdown and (not v_guest or v_s.guest_monitoring);
  if v_s.status <> 'live' then return jsonb_build_object('status', v_s.status, 'state_version', v_s.state_version); end if;
  select * into v_set from public.tenant_settings where tenant_id = v_s.tenant_id;
  -- Screen sharing is requested only if the school allows it and, where the school
  -- requires it, a parent/guardian monitoring consent is on file for this student.
  -- A guest has no parent on record, so where the school requires consent their screen is never captured.
  v_capture := v_set.monitoring_enabled and v_set.allow_screen_capture and case when v_guest then v_s.guest_monitoring and not v_set.require_monitoring_consent
                                                   else not v_set.require_monitoring_consent or app.has_monitoring_consent(auth.uid()) end;

  v_reason := case
    when not v_lock then null
    when not coalesce(p_visible, true) then 'Left the lesson (switched tab, app or window)'
    when not coalesce(p_fullscreen, false) and not p_unsupported then 'Left full-screen mode'
    when v_capture and not coalesce(p_sharing, false) and not p_unsupported then 'Stopped sharing their screen'
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
    'lockdown', v_lock,
    'away', v_reason is not null,
    'reason', v_reason,
    'setting_up', v_setup,
    'tick_seconds', app.tick_seconds(),
    'state_version', v_s.state_version,
    'current_slide', v_s.current_slide,
    'active_activity_id', v_s.active_activity_id,
    'capture', jsonb_build_object(
      'enabled', v_capture,
      -- frames are only worth sending while a teacher has the live room open
      'send', v_capture and coalesce(v_s.teacher_seen_at > now() - interval '45 seconds', false),
      'interval_seconds', greatest(v_set.thumbnail_interval_seconds, 5),
      'high_quality', v_p.hq_requested_at is not null and v_p.hq_requested_at > now() - interval '30 seconds'
                      or exists (select 1 from public.spotlights sp where sp.session_id = p_session
                                 and sp.student_id = auth.uid() and sp.ended_at is null)));
end$$;

create or replace function public.student_screen_frame(
  p_session uuid, p_image text, p_width int default null, p_height int default null, p_quality text default 'thumbnail'
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_s public.class_sessions; v_set public.tenant_settings; v_last timestamptz;
begin
  if p_quality not in ('thumbnail','spotlight') then raise exception 'Unknown quality.' using errcode = '22023'; end if;
  if p_image is null or p_image not like 'data:image/%' or length(p_image) > 400000 then
    raise exception 'Frame must be a data:image URL under 400 KB.' using errcode = '22023';
  end if;
  select * into v_s from public.class_sessions where id = p_session;
  if v_s.id is null or v_s.status <> 'live'
     or not (app.in_class(v_s.class_id) or (v_s.guest_monitoring and app.is_session_guest(v_s.id))) then
    return jsonb_build_object('stored', false, 'reason', 'no live session');
  end if;
  select * into v_set from public.tenant_settings where tenant_id = v_s.tenant_id;
  if not (v_set.allow_screen_capture and v_set.monitoring_enabled) then return jsonb_build_object('stored', false, 'reason', 'screen capture disabled by school'); end if;

  select captured_at into v_last from public.screen_snapshots
   where class_session_id = p_session and student_id = auth.uid() and quality = p_quality and source = 'web';
  if v_last is not null and now() - v_last < interval '1500 milliseconds' then
    return jsonb_build_object('stored', false, 'reason', 'rate limited');
  end if;

  insert into public.screen_snapshots (tenant_id, device_id, class_session_id, student_id, image_data, width, height, quality, source)
    values (v_s.tenant_id, null, p_session, auth.uid(), p_image, p_width, p_height, p_quality, 'web')
    on conflict (class_session_id, student_id, quality, source) where quality <> 'event'
    do update set image_data = excluded.image_data, width = excluded.width, height = excluded.height, captured_at = now();

  -- Attach "what they switched to" to a fresh leave alert (school setting).
  if v_set.store_event_screenshots then
    update public.environment_events set evidence_image = p_image
     where class_session_id = p_session and student_id = auth.uid() and resolved_at is null
       and kind = 'environment_left' and device_id is null
       and created_at > now() - interval '60 seconds';
  end if;
  if p_quality = 'spotlight' then
    update public.session_participants set hq_requested_at = null where session_id = p_session and user_id = auth.uid();
  end if;
  return jsonb_build_object('stored', true);
end$$;

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
    'settings', jsonb_build_object('monitoring_enabled', v_settings.monitoring_enabled, 'allow_spotlight', v_settings.allow_spotlight, 'allow_group_chat', v_settings.allow_group_chat,
                                   'allow_screen_capture', v_settings.allow_screen_capture,
                                   'store_event_screenshots', v_settings.store_event_screenshots,
                                   'thumbnail_interval_seconds', v_settings.thumbnail_interval_seconds),
    'server_now', now(),
    'roster', (select coalesce(jsonb_agg(jsonb_build_object(
        'student_id', u.id, 'name', u.full_name, 'guest', m.guest,
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
      from (select cm.user_id, false as guest from public.class_members cm where cm.class_id = v_s.class_id and cm.role = 'student'
            union all
            select g.user_id, true from public.session_guests g where g.session_id = p_session and g.removed_at is null) m
      join public.users u on u.id = m.user_id
      left join public.session_participants p on p.session_id = p_session and p.user_id = u.id),
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

create or replace function public.sa_update_tenant_settings(p_tenant uuid, p_changes jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  allowed constant text[] := array[
    'allow_spotlight', 'allow_group_chat', 'allow_screen_capture', 'store_event_screenshots',
    'parent_portal_enabled', 'email_alerts_enabled', 'parent_focus_details', 'require_monitoring_consent',
    'nickname_mode', 'learning_retention_days', 'telemetry_retention_days',
    'default_grace_seconds', 'default_idle_seconds', 'thumbnail_interval_seconds', 'monitoring_notice',
    'brand_name', 'brand_primary', 'brand_accent', 'welcome_message', 'timezone', 'monitoring_enabled'];
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
    monitoring_enabled         = v_new.monitoring_enabled,
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

create or replace function public.health() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('ok', true, 'db_time', now(), 'schema', '0870')
$$;
