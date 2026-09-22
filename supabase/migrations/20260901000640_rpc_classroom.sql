-- =============================================================================
-- SwiftCipher — 0640 live classroom RPCs (§3.4, §3.7, §16, §30)
-- =============================================================================

create or replace function public.start_session(
  p_class uuid, p_lesson uuid default null, p_mode text default 'live_participation',
  p_title text default null, p_environment uuid default null
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me    public.users := app.me();
  v_class public.classes;
  v_s     public.class_sessions;
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
  if exists (select 1 from public.class_sessions where class_id = p_class and status = 'live') then
    raise exception 'This class already has a live session. End it first.' using errcode = 'P0001';
  end if;

  insert into public.class_sessions (tenant_id, class_id, teacher_id, lesson_id, lesson_version, title, mode, join_code,
                                     status, environment_id, environment_active, started_at)
    values (v_me.tenant_id, p_class, v_me.id, p_lesson,
            (select current_version from public.lessons where id = p_lesson),
            coalesce(nullif(btrim(p_title), ''), (select title from public.lessons where id = p_lesson), v_class.name || ' live'),
            p_mode, app.unique_code(6, 'class_sessions'), 'live', p_environment, p_environment is not null, now())
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

create or replace function public.end_session(p_session uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_s      public.class_sessions := app.require_live_session(p_session);
  v_report uuid;
begin
  update public.class_sessions set status = 'ended', ended_at = now(), environment_active = false where id = p_session;
  update public.session_participants set left_at = coalesce(left_at, now()), status = 'offline' where session_id = p_session;
  update public.browser_sessions set ended_at = now() where class_session_id = p_session and ended_at is null;
  update public.environment_events set resolved_at = now() where class_session_id = p_session and resolved_at is null;
  update public.spotlights set ended_at = now() where session_id = p_session and ended_at is null;
  update public.teacher_commands set status = 'expired' where class_session_id = p_session and status in ('queued','delivered');
  update public.raise_hands set status = 'resolved', resolved_at = now() where session_id = p_session and status = 'open';
  update public.rtc_rooms set status = 'closed', closed_at = now() where session_id = p_session and status = 'open';
  update public.quiz_attempts set status = 'submitted', submitted_at = now() where session_id = p_session and status = 'in_progress';
  perform app.recompute_attempt(id) from public.quiz_attempts where session_id = p_session;

  -- Attendance from participation; manual entries always win.
  insert into public.attendance (tenant_id, class_id, session_id, student_id, date, status, source, recorded_by)
    select v_s.tenant_id, v_s.class_id, p_session, m.user_id, (v_s.started_at at time zone 'UTC')::date,
           case when exists (select 1 from public.session_participants p where p.session_id = p_session and p.user_id = m.user_id)
                then 'present' else 'absent' end,
           'session', auth.uid()
    from public.class_members m where m.class_id = v_s.class_id and m.role = 'student'
    on conflict (class_id, student_id, date) do update
      set status = case when public.attendance.source = 'session' and excluded.status = 'present' then 'present'
                        else public.attendance.status end;

  insert into public.reports (tenant_id, kind, title, scope_type, scope_id, payload, created_by)
    values (v_s.tenant_id, 'session_summary', 'Session report: ' || v_s.title, 'class_session', p_session,
            public.session_report(p_session), auth.uid())
    returning id into v_report;
  perform app.audit('session.ended', 'class_session', p_session::text, jsonb_build_object('report_id', v_report));
  return jsonb_build_object('ended', true, 'report_id', v_report);
end$$;

create or replace function public.join_session(p_code text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_me public.users := app.me(); v_s public.class_sessions;
begin
  select * into v_s from public.class_sessions where join_code = upper(btrim(coalesce(p_code, ''))) and status = 'live';
  if v_s.id is null then raise exception 'No live class with that code.' using errcode = 'P0002'; end if;
  if not app.in_class(v_s.class_id) then raise exception 'This live class is for another class roster.' using errcode = '42501'; end if;
  insert into public.session_participants (session_id, user_id, tenant_id, status, current_slide)
    values (v_s.id, v_me.id, v_me.tenant_id, 'online', v_s.current_slide)
    on conflict (session_id, user_id) do update set status = 'online', left_at = null, last_seen_at = now();
  return jsonb_build_object('session_id', v_s.id, 'title', v_s.title);
end$$;

-- Student view of a session; also joins/refreshes presence (§30 reconnect restores state).
create or replace function public.session_student_state(p_session uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me    public.users := app.me();
  v_s     public.class_sessions;
  v_p     public.session_participants;
  v_spot  public.spotlights;
  v_act   public.activities;
begin
  select * into v_s from public.class_sessions where id = p_session;
  if v_s.id is null or not app.in_class(v_s.class_id) then raise exception 'Session not found.' using errcode = 'P0002'; end if;
  if v_s.status = 'live' then
    insert into public.session_participants (session_id, user_id, tenant_id, status, current_slide)
      values (v_s.id, v_me.id, v_me.tenant_id, 'online', v_s.current_slide)
      on conflict (session_id, user_id) do update set last_seen_at = now(), left_at = null,
        status = case when public.session_participants.status = 'offline' then 'online' else public.session_participants.status end
      returning * into v_p;
  end if;
  select * into v_spot from public.spotlights where session_id = p_session and ended_at is null;
  select * into v_act from public.activities where id = v_s.active_activity_id;

  return jsonb_build_object(
    'session', jsonb_build_object('id', v_s.id, 'title', v_s.title, 'status', v_s.status, 'mode', v_s.mode,
                                  'current_slide', v_s.current_slide, 'group_chat_enabled', v_s.group_chat_enabled,
                                  'responses_visible', v_s.responses_visible, 'class_id', v_s.class_id,
                                  'teacher', (select full_name from public.users where id = v_s.teacher_id),
                                  'environment_active', v_s.environment_active),
    'my_slide', coalesce(v_p.current_slide, v_s.current_slide),
    'active_activity', case when v_act.id is null then null else jsonb_build_object(
                         'id', v_act.id, 'kind', v_act.kind, 'title', v_act.title) end,
    'spotlight', case when v_spot.id is null then null else jsonb_build_object(
                   'me', v_spot.student_id = v_me.id, 'show_to_class', v_spot.show_to_class, 'anonymized', v_spot.anonymized) end,
    'hand', (select jsonb_build_object('id', h.id, 'created_at', h.created_at) from public.raise_hands h
             where h.session_id = p_session and h.student_id = v_me.id and h.status = 'open'),
    'environment_notice', case when exists (select 1 from public.environment_events e where e.class_session_id = p_session
                                            and e.student_id = v_me.id and e.resolved_at is null
                                            and e.kind in ('environment_left','domain_blocked'))
                               then 'Your class session requires you to return to the lesson.' end,
    'device_monitored', exists (select 1 from public.browser_sessions b where b.class_session_id = p_session
                                and b.student_id = v_me.id and b.last_heartbeat_at > now() - interval '45 seconds'),
    'announcements', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'body', a.body, 'created_at', a.created_at)
                       order by a.created_at desc), '[]'::jsonb)
                      from (select * from public.announcements where session_id = p_session order by created_at desc limit 5) a),
    'server_now', now());
end$$;

create or replace function public.session_lesson(p_session uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_s public.class_sessions;
begin
  select * into v_s from public.class_sessions where id = p_session;
  if v_s.id is null or not (app.in_class(v_s.class_id) or app.can_manage_class(v_s.class_id)) then
    raise exception 'Session not found.' using errcode = 'P0002';
  end if;
  if v_s.lesson_id is null then return jsonb_build_object('lesson', null, 'slides', '[]'::jsonb); end if;
  return app.lesson_payload(v_s.lesson_id);
end$$;

-- Web-client presence heartbeat (§3.4). Students control their slide only in student-paced mode.
create or replace function public.session_heartbeat(p_session uuid, p_slide int default null, p_status text default 'online')
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_s public.class_sessions;
begin
  select * into v_s from public.class_sessions where id = p_session;
  if v_s.id is null or not app.in_class(v_s.class_id) then raise exception 'Session not found.' using errcode = 'P0002'; end if;
  if v_s.status <> 'live' then return jsonb_build_object('status', v_s.status); end if;
  update public.session_participants set last_seen_at = now(), left_at = null,
    status = case when p_status in ('online','idle') then p_status else 'online' end,
    current_slide = case when v_s.mode = 'student_paced' and p_slide is not null and p_slide >= 0 then p_slide
                         else v_s.current_slide end
  where session_id = p_session and user_id = auth.uid();
  if not found then
    insert into public.session_participants (session_id, user_id, tenant_id, status, current_slide)
      values (p_session, auth.uid(), v_s.tenant_id, 'online', v_s.current_slide);
  end if;
  return jsonb_build_object('status', v_s.status, 'current_slide', v_s.current_slide,
                            'active_activity_id', v_s.active_activity_id);
end$$;

create or replace function public.leave_session(p_session uuid) returns void
language sql volatile security definer set search_path = '' as $$
  update public.session_participants set left_at = now(), status = 'offline'
  where session_id = p_session and user_id = auth.uid()
$$;

create or replace function public.set_session_state(
  p_session uuid, p_slide int default null, p_activity uuid default null, p_clear_activity boolean default false,
  p_group_chat boolean default null, p_responses_visible boolean default null, p_mode text default null
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_s public.class_sessions := app.require_live_session(p_session); v_allow boolean;
begin
  if p_activity is not null and not exists (select 1 from public.activities where id = p_activity and tenant_id = v_s.tenant_id) then
    raise exception 'Activity not found.' using errcode = 'P0002';
  end if;
  if p_group_chat then
    select allow_group_chat into v_allow from public.tenant_settings where tenant_id = v_s.tenant_id;
    if not v_allow then raise exception 'Group chat is disabled by your school.' using errcode = 'P0001'; end if;
  end if;
  if p_mode is not null and p_mode not in ('live_participation','student_paced','front_of_class') then
    raise exception 'Unknown delivery mode.' using errcode = '22023';
  end if;
  update public.class_sessions set
    current_slide = coalesce(greatest(p_slide, 0), current_slide),
    active_activity_id = case when p_clear_activity then null else coalesce(p_activity, active_activity_id) end,
    group_chat_enabled = coalesce(p_group_chat, group_chat_enabled),
    responses_visible = coalesce(p_responses_visible, responses_visible),
    mode = coalesce(p_mode, mode)
  where id = p_session returning * into v_s;
  if p_slide is not null and v_s.mode <> 'student_paced' then
    update public.session_participants set current_slide = v_s.current_slide where session_id = p_session;
  end if;
  if p_activity is not null then
    perform app.audit('activity.launched', 'activity', p_activity::text, jsonb_build_object('session_id', p_session));
  end if;
  return to_jsonb(v_s);
end$$;

-- Everything the teacher's live dashboard needs (§11). Also performs the lazy
-- housekeeping that turns silent devices into "connection lost" (never a
-- violation, §3.6/§30) and expires stale commands.
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
    for r in update public.browser_sessions set connection_lost_at = now()
             where class_session_id = p_session and ended_at is null and connection_lost_at is null
               and last_heartbeat_at < now() - interval '45 seconds'
             returning * loop
      perform app.raise_event(r, v_s, v_s.environment_id, 'connection_lost', 'info',
                              'Extension stopped reporting — connection lost, not a rule violation', null, null);
    end loop;
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
                                   'thumbnail_interval_seconds', v_settings.thumbnail_interval_seconds),
    'server_now', now(),
    'roster', (select coalesce(jsonb_agg(jsonb_build_object(
        'student_id', u.id, 'name', u.full_name,
        'presence', case when p.user_id is null then 'not_joined'
                         when p.left_at is not null or p.last_seen_at < now() - interval '45 seconds' then 'offline'
                         else p.status end,
        'last_seen_at', p.last_seen_at, 'current_slide', p.current_slide,
        'device', (select jsonb_build_object('device_id', b.device_id, 'url', b.active_url, 'domain', b.active_domain,
                     'title', b.active_title, 'tab_count', b.tab_count, 'idle_state', b.idle_state,
                     'online', b.connection_lost_at is null and b.last_heartbeat_at > now() - interval '45 seconds',
                     'last_heartbeat_at', b.last_heartbeat_at, 'focus_locked', b.focus_locked,
                     'violation', b.violation_rule, 'violation_since', b.violation_since,
                     'snapshot_at', (select max(sn.captured_at) from public.screen_snapshots sn
                                     where sn.device_id = b.device_id and sn.class_session_id = p_session and sn.quality = 'thumbnail'))
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
                 'student', u.full_name, 'created_at', e.created_at, 'resolved_at', e.resolved_at)
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

-- Thumbnails for the screen wall; stale frames are flagged, never shown as live (§30).
create or replace function public.session_screens(p_session uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_s public.class_sessions; v_interval int;
begin
  select * into v_s from public.class_sessions where id = p_session;
  if v_s.id is null or not app.can_manage_class(v_s.class_id) then raise exception 'Session not found.' using errcode = 'P0002'; end if;
  select thumbnail_interval_seconds into v_interval from public.tenant_settings where tenant_id = v_s.tenant_id;
  return (select coalesce(jsonb_agg(jsonb_build_object('student_id', sn.student_id, 'device_id', sn.device_id,
            'image', sn.image_data, 'captured_at', sn.captured_at, 'url', sn.url,
            'stale', sn.captured_at < now() - make_interval(secs => v_interval * 3))), '[]'::jsonb)
          from public.screen_snapshots sn where sn.class_session_id = p_session and sn.quality = 'thumbnail');
end$$;

-- ---------------------------------------------------------------------------
-- Spotlight (§3.7)
-- ---------------------------------------------------------------------------
create or replace function public.spotlight_start(
  p_session uuid, p_student uuid, p_anonymized boolean default false, p_show_to_class boolean default false
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_s public.class_sessions := app.require_live_session(p_session); v_id uuid;
begin
  if not (select allow_spotlight and allow_screen_capture from public.tenant_settings where tenant_id = v_s.tenant_id) then
    raise exception 'Student screen spotlighting is disabled by your school.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.class_members where class_id = v_s.class_id and user_id = p_student and role = 'student') then
    raise exception 'Student is not in this class.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.browser_sessions where class_session_id = p_session and student_id = p_student
                 and last_heartbeat_at > now() - interval '45 seconds') then
    raise exception 'That student''s device is not connected.' using errcode = 'P0001';
  end if;
  update public.spotlights set ended_at = now() where session_id = p_session and ended_at is null;
  insert into public.spotlights (tenant_id, session_id, student_id, anonymized, show_to_class, started_by)
    values (v_s.tenant_id, p_session, p_student, p_anonymized, p_show_to_class, auth.uid()) returning id into v_id;
  update public.browser_sessions set snapshot_requested_at = now() where class_session_id = p_session and student_id = p_student;
  perform app.notify(p_student, 'spotlight', 'Your teacher is sharing your screen with the class',
                     case when p_anonymized then 'Your name is hidden.' end, '/student/live/' || p_session, 'info',
                     jsonb_build_object('session_id', p_session));
  perform app.audit('spotlight.started', 'user', p_student::text,
                    jsonb_build_object('session_id', p_session, 'anonymized', p_anonymized, 'show_to_class', p_show_to_class));
  return jsonb_build_object('id', v_id);
end$$;

create or replace function public.spotlight_stop(p_session uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_s public.class_sessions := app.require_live_session(p_session);
begin
  update public.spotlights set ended_at = now() where session_id = p_session and ended_at is null;
  perform app.audit('spotlight.stopped', 'class_session', p_session::text);
end$$;

-- The spotlighted frame, for the teacher/projector or (when shared) the class.
create or replace function public.spotlight_view(p_session uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_spot public.spotlights; v_img record; v_manager boolean;
begin
  select * into v_spot from public.spotlights where session_id = p_session and ended_at is null;
  if v_spot.id is null then return null; end if;
  v_manager := app.can_manage_session(p_session);
  if not (v_manager or (v_spot.show_to_class and app.in_session(p_session)) or v_spot.student_id = auth.uid()) then
    raise exception 'Not available.' using errcode = '42501';
  end if;
  select image_data, captured_at, quality into v_img from public.screen_snapshots
   where class_session_id = p_session and student_id = v_spot.student_id and quality in ('spotlight','thumbnail')
   order by case quality when 'spotlight' then 0 else 1 end, captured_at desc limit 1;
  return jsonb_build_object(
    'student', case when v_spot.anonymized and not v_manager then 'A classmate'
                    when v_spot.anonymized then 'A classmate (' || (select full_name from public.users where id = v_spot.student_id) || ')'
                    else (select full_name from public.users where id = v_spot.student_id) end,
    'image', v_img.image_data, 'captured_at', v_img.captured_at,
    'stale', v_img.captured_at is null or v_img.captured_at < now() - interval '20 seconds',
    'show_to_class', v_spot.show_to_class);
end$$;

-- ---------------------------------------------------------------------------
-- Help queue, chat (§3.4)
-- ---------------------------------------------------------------------------
create or replace function public.resolve_hand(p_hand uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v public.raise_hands;
begin
  select * into v from public.raise_hands where id = p_hand;
  if v.id is null or not app.can_manage_session(v.session_id) then raise exception 'Not found.' using errcode = 'P0002'; end if;
  update public.raise_hands set status = 'resolved', resolved_at = now(), resolved_by = auth.uid() where id = p_hand;
end$$;

create or replace function public.lower_hand(p_session uuid) returns void
language sql volatile security definer set search_path = '' as $$
  update public.raise_hands set status = 'resolved', resolved_at = now(), resolved_by = auth.uid()
  where session_id = p_session and student_id = auth.uid() and status = 'open'
$$;

create or replace function public.open_direct_thread(p_class uuid, p_student uuid default null) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare v_me public.users := app.me(); v_teacher uuid; v_student uuid; v_id uuid;
begin
  if app.can_manage_class(p_class) and v_me.role <> 'student' then
    v_teacher := v_me.id; v_student := p_student;
    if not exists (select 1 from public.class_members where class_id = p_class and user_id = p_student and role = 'student') then
      raise exception 'Student is not in this class.' using errcode = '22023';
    end if;
  elsif app.in_class(p_class) then
    v_student := v_me.id;
    select teacher_id into v_teacher from public.classes where id = p_class;
  else
    raise exception 'Not your class.' using errcode = '42501';
  end if;
  select id into v_id from public.chat_threads
   where class_id = p_class and kind = 'direct' and student_id = v_student and teacher_id = v_teacher;
  if v_id is null then
    insert into public.chat_threads (tenant_id, class_id, kind, student_id, teacher_id)
      values (v_me.tenant_id, p_class, 'direct', v_student, v_teacher) returning id into v_id;
  end if;
  return v_id;
end$$;

create or replace function public.open_group_thread(p_session uuid) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare v_s public.class_sessions; v_id uuid;
begin
  select * into v_s from public.class_sessions where id = p_session;
  if v_s.id is null or not (app.in_class(v_s.class_id) or app.can_manage_class(v_s.class_id)) then
    raise exception 'Session not found.' using errcode = 'P0002';
  end if;
  if not v_s.group_chat_enabled then raise exception 'Group chat is off for this session.' using errcode = 'P0001'; end if;
  select id into v_id from public.chat_threads where session_id = p_session and kind = 'group';
  if v_id is null then
    insert into public.chat_threads (tenant_id, class_id, kind, session_id)
      values (v_s.tenant_id, v_s.class_id, 'group', p_session) returning id into v_id;
  end if;
  return v_id;
end$$;

create or replace function public.send_message(p_thread uuid, p_body text) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare v_me public.users := app.me(); v_t public.chat_threads; v_id uuid; v_to uuid;
begin
  select * into v_t from public.chat_threads where id = p_thread and tenant_id = v_me.tenant_id;
  if v_t.id is null then raise exception 'Conversation not found.' using errcode = 'P0002'; end if;
  if length(btrim(coalesce(p_body, ''))) not between 1 and 2000 then raise exception 'Messages are 1-2000 characters.' using errcode = '22023'; end if;
  if v_t.kind = 'direct' then
    if v_me.id not in (v_t.student_id, v_t.teacher_id) then raise exception 'Not your conversation.' using errcode = '42501'; end if;
    v_to := case when v_me.id = v_t.student_id then v_t.teacher_id else v_t.student_id end;
  else
    if not (app.can_manage_class(v_t.class_id)
            or (app.in_class(v_t.class_id) and exists (select 1 from public.class_sessions s where s.id = v_t.session_id
                                                       and s.status = 'live' and s.group_chat_enabled))) then
      raise exception 'Group chat is off for this session.' using errcode = 'P0001';
    end if;
  end if;
  insert into public.chat_messages (tenant_id, thread_id, sender_id, body)
    values (v_me.tenant_id, p_thread, v_me.id, btrim(p_body)) returning id into v_id;
  if v_to is not null then
    perform app.notify(v_to, 'chat_message', 'New message from ' || v_me.full_name, left(btrim(p_body), 140),
                       case when v_me.role = 'student' then '/messages?thread=' else '/messages?thread=' end || p_thread,
                       'info', jsonb_build_object('thread_id', p_thread));
  end if;
  return v_id;
end$$;

create or replace function public.hide_message(p_message uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_class uuid;
begin
  select t.class_id into v_class from public.chat_messages m join public.chat_threads t on t.id = m.thread_id where m.id = p_message;
  if v_class is null or not app.can_manage_class(v_class) then raise exception 'Not found.' using errcode = 'P0002'; end if;
  update public.chat_messages set hidden = true where id = p_message;
  perform app.audit('chat.message_hidden', 'chat_message', p_message::text);
end$$;

-- ---------------------------------------------------------------------------
-- WebRTC signalling (teacher screen share / optional A/V)
-- ---------------------------------------------------------------------------
create or replace function public.rtc_open_room(p_session uuid, p_purpose text default 'av') returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare v_s public.class_sessions := app.require_live_session(p_session); v_id uuid;
begin
  if p_purpose not in ('av','screen_share','spotlight') then raise exception 'Unknown purpose.' using errcode = '22023'; end if;
  select id into v_id from public.rtc_rooms where session_id = p_session and purpose = p_purpose and status = 'open';
  if v_id is null then
    insert into public.rtc_rooms (tenant_id, session_id, host_id, purpose) values (v_s.tenant_id, p_session, auth.uid(), p_purpose)
      returning id into v_id;
    perform app.audit('rtc.room_opened', 'class_session', p_session::text, jsonb_build_object('purpose', p_purpose));
  end if;
  return v_id;
end$$;

create or replace function public.rtc_join(p_room uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_r public.rtc_rooms; v_peer uuid; v_host boolean;
begin
  select * into v_r from public.rtc_rooms where id = p_room and status = 'open';
  if v_r.id is null then raise exception 'Room is closed.' using errcode = 'P0002'; end if;
  v_host := app.can_manage_session(v_r.session_id);
  if not v_host and not app.in_session(v_r.session_id) then raise exception 'Not your class.' using errcode = '42501'; end if;
  insert into public.rtc_peers (tenant_id, room_id, user_id, role)
    values (v_r.tenant_id, p_room, auth.uid(), case when v_host then 'host' else 'participant' end)
    on conflict (room_id, user_id) do update set left_at = null, last_seen_at = now()
    returning id into v_peer;
  return jsonb_build_object('peer_id', v_peer, 'role', case when v_host then 'host' else 'participant' end,
    'peers', (select coalesce(jsonb_agg(jsonb_build_object('peer_id', p.id, 'user_id', p.user_id, 'role', p.role,
                'name', u.full_name)), '[]'::jsonb)
              from public.rtc_peers p join public.users u on u.id = p.user_id
              where p.room_id = p_room and p.left_at is null and p.id <> v_peer and p.last_seen_at > now() - interval '60 seconds'));
end$$;

create or replace function public.rtc_signal(p_room uuid, p_to_peer uuid, p_kind text, p_payload jsonb) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_from uuid; v_tenant uuid;
begin
  select id, tenant_id into v_from, v_tenant from public.rtc_peers where room_id = p_room and user_id = auth.uid() and left_at is null;
  if v_from is null then raise exception 'Join the room first.' using errcode = '42501'; end if;
  if not exists (select 1 from public.rtc_peers where id = p_to_peer and room_id = p_room) then
    raise exception 'Peer not in room.' using errcode = 'P0002';
  end if;
  if length(p_payload::text) > 65536 then raise exception 'Signal too large.' using errcode = '22023'; end if;
  insert into public.rtc_signals (tenant_id, room_id, from_peer_id, to_peer_id, kind, payload)
    values (v_tenant, p_room, v_from, p_to_peer, p_kind, p_payload);
end$$;

create or replace function public.rtc_poll(p_room uuid, p_after bigint default 0) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_me uuid;
begin
  update public.rtc_peers set last_seen_at = now() where room_id = p_room and user_id = auth.uid() and left_at is null
    returning id into v_me;
  if v_me is null then raise exception 'Join the room first.' using errcode = '42501'; end if;
  return jsonb_build_object(
    'signals', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'from', s.from_peer_id, 'kind', s.kind,
                  'payload', s.payload) order by s.id), '[]'::jsonb)
                from public.rtc_signals s where s.to_peer_id = v_me and s.id > coalesce(p_after, 0)),
    'peers', (select coalesce(jsonb_agg(jsonb_build_object('peer_id', p.id, 'user_id', p.user_id, 'role', p.role,
                'name', u.full_name)), '[]'::jsonb)
              from public.rtc_peers p join public.users u on u.id = p.user_id
              where p.room_id = p_room and p.left_at is null and p.id <> v_me and p.last_seen_at > now() - interval '60 seconds'),
    'open', exists (select 1 from public.rtc_rooms where id = p_room and status = 'open'));
end$$;

create or replace function public.rtc_leave(p_room uuid) returns void
language sql volatile security definer set search_path = '' as $$
  update public.rtc_peers set left_at = now() where room_id = p_room and user_id = auth.uid()
$$;

create or replace function public.rtc_close(p_room uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_r public.rtc_rooms;
begin
  select * into v_r from public.rtc_rooms where id = p_room;
  if v_r.id is null or not app.can_manage_session(v_r.session_id) then raise exception 'Not found.' using errcode = 'P0002'; end if;
  update public.rtc_rooms set status = 'closed', closed_at = now() where id = p_room;
end$$;
