-- 0880: live engine core (docs/LIVE_ENGINE.md, increment 2).
--
-- * Session phases: lobby -> active <-> paused -> ended. New sessions open in the
--   lobby; answers are accepted only while the lesson is active.
-- * One teacher control path, public.session_control(session, action, args): start,
--   pause, resume, next, prev, goto, kick, settings, end. It checks the caller and the
--   transition, writes the state, and the existing trigger broadcasts it, now with the
--   compact state in the payload.
-- * A class is optional. Anyone with the code joins: guests (0860) and, new here,
--   signed-in students of the same school who aren't in a class, by a session pass.
-- * Per-session settings (leaderboard, anonymous names, late join, speed bonus) and a
--   participant avatar for the lobby.

alter table public.class_sessions
  add column if not exists phase text not null default 'active'
    check (phase in ('lobby','active','paused','ended')),
  add column if not exists settings jsonb not null
    default '{"leaderboard": true, "anonymous_names": false, "late_join": true, "speed_bonus": true}'::jsonb;
update public.class_sessions set phase = 'ended' where status = 'ended' and phase <> 'ended';
alter table public.class_sessions alter column phase set default 'lobby';
alter table public.class_sessions alter column class_id drop not null;

alter table public.session_participants
  add column if not exists avatar text check (avatar is null or avatar ~ '^[a-z]{2,16}$'),
  add column if not exists removed_at timestamptz;

-- Session passes: guests (is_guest) and signed-in students without a class.
alter table public.session_guests add column if not exists is_guest boolean not null default true;

alter table public.announcements alter column class_id drop not null;

-- Who runs a session: its own teacher, a school admin, or a teacher of its class.
create or replace function app.can_manage_session(p_session uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.class_sessions s
                  where s.id = p_session and s.tenant_id = app.tenant_id()
                    and (s.teacher_id = auth.uid() or app.is_admin()
                         or (s.class_id is not null and app.can_manage_class(s.class_id))))
$$;

-- A pass held by a real guest (an anonymous sign-in), as opposed to a student's pass.
create or replace function app.is_true_guest(p_session uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.session_guests g
     where g.session_id = p_session and g.user_id = auth.uid() and g.removed_at is null and g.is_guest)
$$;

drop policy if exists class_sessions_read on public.class_sessions;
create policy class_sessions_read on public.class_sessions for select to authenticated
  using (tenant_id = (select app.tenant_id())
         and (teacher_id = (select auth.uid()) or (select app.is_admin()) or (select app.is_it())
              or app.can_manage_class(class_id) or app.in_class(class_id) or app.is_session_guest(id)));

drop policy if exists announcements_insert on public.announcements;
create policy announcements_insert on public.announcements for insert to authenticated
  with check (tenant_id = (select app.tenant_id()) and author_id = (select auth.uid())
              and (case when session_id is not null then app.can_manage_session(session_id)
                        and (class_id is null or app.session_class(session_id) = class_id)
                        else app.can_manage_class(class_id) end));
drop policy if exists announcements_read on public.announcements;
create policy announcements_read on public.announcements for select to authenticated
  using (app.can_manage_class(class_id) or app.in_class(class_id)
         or (session_id is not null and (app.can_manage_session(session_id) or app.in_session(session_id))));

-- Signed-in students join by code: their class's lessons as before, and any other
-- live lesson in their school by a session pass.
create or replace function public.join_session(p_code text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me   public.users := app.me();
  v_s    public.class_sessions;
  v_pass public.session_guests;
begin
  select * into v_s from public.class_sessions
   where join_code = upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g')) and status = 'live';
  if v_s.id is null then raise exception 'No live lesson has that code.' using errcode = 'P0002'; end if;
  if v_s.tenant_id <> v_me.tenant_id then
    raise exception 'This lesson belongs to another school. Sign out, then join as a guest.' using errcode = '42501';
  end if;
  if exists (select 1 from public.session_participants where session_id = v_s.id and user_id = v_me.id and removed_at is not null) then
    raise exception 'Your teacher removed you from this lesson.' using errcode = '42501';
  end if;
  if not app.in_class(v_s.class_id) and not app.can_manage_session(v_s.id) then
    if v_me.role <> 'student' then raise exception 'Only students can join a lesson with a code.' using errcode = '42501'; end if;
    select * into v_pass from public.session_guests where session_id = v_s.id and user_id = v_me.id;
    if v_pass.removed_at is not null then raise exception 'Your teacher removed you from this lesson.' using errcode = '42501'; end if;
    if v_pass.session_id is null then
      if v_s.phase <> 'lobby' and not coalesce((v_s.settings ->> 'late_join')::boolean, true) then
        raise exception 'This lesson has already started and isn''t taking late joiners.' using errcode = 'P0001';
      end if;
      if v_s.guests_closed then raise exception 'This lesson isn''t taking new joiners. Ask your teacher.' using errcode = 'P0001'; end if;
      insert into public.session_guests (session_id, user_id, tenant_id, display_name, is_guest)
        values (v_s.id, v_me.id, v_s.tenant_id,
                case when length(btrim(v_me.full_name)) < 2 then rpad(btrim(v_me.full_name), 2, '.')
                     else left(btrim(v_me.full_name), 40) end, false);
    end if;
  end if;
  insert into public.session_participants (session_id, user_id, tenant_id, status, current_slide)
    values (v_s.id, v_me.id, v_me.tenant_id, 'online', v_s.current_slide)
    on conflict (session_id, user_id) do update set status = 'online', left_at = null, last_seen_at = now();
  return jsonb_build_object('session_id', v_s.id, 'title', v_s.title);
end$$;

-- The one teacher control path (state machine in docs/LIVE_ENGINE.md §2).
create or replace function public.session_control(p_session uuid, p_action text, p_args jsonb default '{}'::jsonb)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_s      public.class_sessions := app.require_live_session(p_session);
  v_n      int;
  v_target int;
  v_user   uuid;
  v_bad    text;
begin
  p_args := coalesce(p_args, '{}'::jsonb);
  case p_action
    when 'start' then
      if v_s.phase <> 'lobby' then raise exception 'The lesson has already started.' using errcode = 'P0001'; end if;
      update public.class_sessions set phase = 'active', started_at = now() where id = p_session;
    when 'pause' then
      if v_s.phase <> 'active' then raise exception 'Only a running lesson can be paused.' using errcode = 'P0001'; end if;
      update public.class_sessions set phase = 'paused' where id = p_session;
    when 'resume' then
      if v_s.phase <> 'paused' then raise exception 'The lesson isn''t paused.' using errcode = 'P0001'; end if;
      update public.class_sessions set phase = 'active' where id = p_session;
    when 'next', 'prev', 'goto' then
      if v_s.phase <> 'active' then raise exception 'Start the lesson first.' using errcode = 'P0001'; end if;
      select count(*) into v_n from public.lesson_slides where lesson_id = v_s.lesson_id;
      v_target := case p_action when 'next' then v_s.current_slide + 1 when 'prev' then v_s.current_slide - 1
                                else (p_args ->> 'slide')::int end;
      if v_target is null then raise exception 'Which slide?' using errcode = '22023'; end if;
      perform public.set_session_state(p_session, greatest(0, least(v_target, greatest(v_n - 1, 0))));
    when 'kick' then
      v_user := nullif(p_args ->> 'user_id', '')::uuid;
      if v_user is null or v_user = v_s.teacher_id then raise exception 'Who should be removed?' using errcode = '22023'; end if;
      update public.session_participants set removed_at = now(), left_at = now(), status = 'offline'
       where session_id = p_session and user_id = v_user and removed_at is null;
      if not found then raise exception 'That person isn''t in this lesson.' using errcode = 'P0002'; end if;
      update public.session_guests set removed_at = now() where session_id = p_session and user_id = v_user and removed_at is null;
      update public.raise_hands set status = 'resolved', resolved_at = now() where session_id = p_session and student_id = v_user and status = 'open';
      perform app.audit('session.participant_removed', 'user', v_user::text, jsonb_build_object('session_id', p_session));
    when 'settings' then
      select k into v_bad from jsonb_object_keys(p_args) k
       where k <> all (array['leaderboard', 'anonymous_names', 'late_join', 'speed_bonus'])
          or jsonb_typeof(p_args -> k) <> 'boolean' limit 1;
      if v_bad is not null then raise exception 'Unknown or invalid setting: %.', v_bad using errcode = '22023'; end if;
      update public.class_sessions set settings = settings || p_args where id = p_session;
    when 'end' then
      return public.end_session(p_session);
    else
      raise exception 'Unknown action: %.', p_action using errcode = '22023';
  end case;
  select * into v_s from public.class_sessions where id = p_session;
  return jsonb_build_object('phase', v_s.phase, 'slide', v_s.current_slide, 'settings', v_s.settings, 'v', v_s.state_version);
end$$;

-- A participant picks their lobby avatar (a word from the app's avatar set).
create or replace function public.set_avatar(p_session uuid, p_avatar text) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  if p_avatar !~ '^[a-z]{2,16}$' then raise exception 'Unknown avatar.' using errcode = '22023'; end if;
  update public.session_participants set avatar = p_avatar
   where session_id = p_session and user_id = auth.uid() and removed_at is null;
  if not found then raise exception 'Join the lesson first.' using errcode = 'P0002'; end if;
end$$;

revoke execute on function public.session_control(uuid, text, jsonb) from public, anon;
revoke execute on function public.set_avatar(uuid, text) from public, anon;
grant execute on function public.session_control(uuid, text, jsonb) to authenticated;
grant execute on function public.set_avatar(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Existing functions, changed only where noted (session-based management instead of
-- class-based, phases, passes for students).
-- ---------------------------------------------------------------------------

create or replace function app.require_live_session(p_session uuid) returns public.class_sessions
language plpgsql stable security definer set search_path = '' as $$
declare v public.class_sessions;
begin
  select * into v from public.class_sessions where id = p_session;
  if v.id is null then raise exception 'Session not found.' using errcode = 'P0002'; end if;
  if not app.can_manage_session(v.id) then raise exception 'Not your session.' using errcode = '42501'; end if;
  if v.status <> 'live' then raise exception 'The session is not live.' using errcode = 'P0001'; end if;
  return v;
end$$;

create or replace function public.session_lesson(p_session uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_s public.class_sessions;
begin
  select * into v_s from public.class_sessions where id = p_session;
  if v_s.id is null or not (app.in_class(v_s.class_id) or app.is_session_guest(v_s.id) or app.can_manage_session(v_s.id)) then
    raise exception 'Session not found.' using errcode = 'P0002';
  end if;
  if v_s.lesson_id is null then return jsonb_build_object('lesson', null, 'slides', '[]'::jsonb); end if;
  return app.lesson_payload(v_s.lesson_id);
end$$;

create or replace function public.session_screens(p_session uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_s public.class_sessions; v_interval int;
begin
  select * into v_s from public.class_sessions where id = p_session;
  if v_s.id is null or not app.can_manage_session(v_s.id) then raise exception 'Session not found.' using errcode = 'P0002'; end if;
  select thumbnail_interval_seconds into v_interval from public.tenant_settings where tenant_id = v_s.tenant_id;
  return (select coalesce(jsonb_agg(jsonb_build_object('student_id', sn.student_id, 'device_id', sn.device_id,
            'image', sn.image_data, 'captured_at', sn.captured_at, 'url', sn.url, 'source', sn.source,
            'stale', sn.captured_at < now() - make_interval(secs => greatest(v_interval * 3, 30)))), '[]'::jsonb)
          from (select distinct on (student_id) * from public.screen_snapshots
                where class_session_id = p_session and quality = 'thumbnail'
                order by student_id, captured_at desc) sn);
end$$;

create or replace function public.session_screen(p_session uuid, p_student uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_s public.class_sessions; v_interval int;
begin
  select * into v_s from public.class_sessions where id = p_session;
  if v_s.id is null or not app.can_manage_session(v_s.id) then raise exception 'Session not found.' using errcode = 'P0002'; end if;
  select thumbnail_interval_seconds into v_interval from public.tenant_settings where tenant_id = v_s.tenant_id;
  return (select jsonb_build_object('image', sn.image_data, 'captured_at', sn.captured_at, 'url', sn.url, 'quality', sn.quality,
                   'stale', sn.captured_at < now() - make_interval(secs => greatest(v_interval * 3, 60)))
          from public.screen_snapshots sn
          where sn.class_session_id = p_session and sn.student_id = p_student and sn.quality in ('spotlight','thumbnail')
          order by sn.captured_at desc limit 1);
end$$;

create or replace function public.session_report(p_session uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_s public.class_sessions;
begin
  select * into v_s from public.class_sessions where id = p_session;
  if v_s.id is null or not app.can_manage_session(v_s.id) then raise exception 'Session not found.' using errcode = 'P0002'; end if;
  return jsonb_build_object(
    'session', jsonb_build_object('id', v_s.id, 'title', v_s.title, 'mode', v_s.mode, 'started_at', v_s.started_at,
                                  'ended_at', v_s.ended_at,
                                  'minutes', round(extract(epoch from coalesce(v_s.ended_at, now()) - coalesce(v_s.started_at, v_s.created_at)) / 60)),
    'class', (select jsonb_build_object('id', c.id, 'name', c.name) from public.classes c where c.id = v_s.class_id),
    'enrolled', (select count(*) from public.class_members where class_id = v_s.class_id and role = 'student'),
    'joined', (select count(*) from public.session_participants p join public.class_members m
               on m.class_id = v_s.class_id and m.user_id = p.user_id and m.role = 'student' where p.session_id = p_session),
    'activities', (select coalesce(jsonb_agg(jsonb_build_object('activity_id', a.id, 'title', a.title, 'kind', a.kind,
                     'attempts', (select count(*) from public.quiz_attempts t where t.activity_id = a.id and t.session_id = p_session),
                     'avg_percent', (select round(avg(100.0 * t.score / nullif(t.max_score, 0))) from public.quiz_attempts t
                                     where t.activity_id = a.id and t.session_id = p_session and t.status <> 'in_progress'))), '[]'::jsonb)
                   from public.activities a where exists (select 1 from public.quiz_attempts t where t.activity_id = a.id and t.session_id = p_session)),
    'alerts', (select coalesce(jsonb_object_agg(kind, n), '{}'::jsonb) from
                (select kind, count(*) n from public.environment_events where class_session_id = p_session group by kind) x),
    'commands', (select count(*) from public.teacher_commands where class_session_id = p_session),
    'hands', (select count(*) from public.raise_hands where session_id = p_session),
    'students', (select coalesce(jsonb_agg(jsonb_build_object(
        'student_id', u.id, 'name', u.full_name,
        'joined', exists (select 1 from public.session_participants p where p.session_id = p_session and p.user_id = u.id),
        'answers', (select count(*) from public.quiz_answers qa join public.quiz_attempts t on t.id = qa.attempt_id
                    where t.session_id = p_session and t.student_id = u.id),
        'correct', (select count(*) from public.quiz_answers qa join public.quiz_attempts t on t.id = qa.attempt_id
                    where t.session_id = p_session and t.student_id = u.id and qa.is_correct),
        'alerts', (select count(*) from public.environment_events e where e.class_session_id = p_session and e.student_id = u.id
                   and e.kind <> 'connection_lost'))
        order by u.full_name), '[]'::jsonb)
      from public.class_members m join public.users u on u.id = m.user_id
      where m.class_id = v_s.class_id and m.role = 'student'));
end$$;

create or replace function public.teacher_session_state(p_session uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_s        public.class_sessions;
  v_settings public.tenant_settings;
  r          public.browser_sessions;
begin
  select * into v_s from public.class_sessions where id = p_session;
  if v_s.id is null or not app.can_manage_session(v_s.id) then raise exception 'Session not found.' using errcode = 'P0002'; end if;
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
        'student_id', u.id, 'name', u.full_name, 'guest', m.guest, 'avatar', p.avatar,
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
            select g.user_id, g.is_guest from public.session_guests g where g.session_id = p_session and g.removed_at is null) m
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
  -- A class is optional: without one, anyone with the code joins (live engine, 0880).
  if p_class is not null and not app.can_manage_class(p_class) then raise exception 'Not your class.' using errcode = '42501'; end if;
  if p_class is null and not app.is_teacher() then raise exception 'Only teachers can start a live lesson.' using errcode = '42501'; end if;
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
  if p_class is not null and exists (select 1 from public.class_sessions where class_id = p_class and status = 'live') then
    raise exception 'This class already has a live session. End it first.' using errcode = 'P0001';
  end if;

  insert into public.class_sessions (tenant_id, class_id, teacher_id, lesson_id, lesson_version, title, mode, join_code,
                                     status, environment_id, environment_active, started_at, lockdown)
    values (v_me.tenant_id, p_class, v_me.id, p_lesson,
            (select current_version from public.lessons where id = p_lesson),
            coalesce(nullif(btrim(p_title), ''), (select title from public.lessons where id = p_lesson), coalesce(v_class.name || ' live', 'Live lesson')),
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

create or replace function public.end_session(p_session uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_s      public.class_sessions := app.require_live_session(p_session);
  v_report uuid;
begin
  update public.class_sessions set status = 'ended', phase = 'ended', ended_at = now(), environment_active = false where id = p_session;
  update public.session_participants set left_at = coalesce(left_at, now()), status = 'offline' where session_id = p_session;
  update public.browser_sessions set ended_at = now() where class_session_id = p_session and ended_at is null;
  update public.environment_events set resolved_at = now() where class_session_id = p_session and resolved_at is null;
  update public.spotlights set ended_at = now() where session_id = p_session and ended_at is null;
  update public.teacher_commands set status = 'expired' where class_session_id = p_session and status in ('queued','delivered');
  update public.raise_hands set status = 'resolved', resolved_at = now() where session_id = p_session and status = 'open';
  update public.rtc_rooms set status = 'closed', closed_at = now() where session_id = p_session and status = 'open';
  update public.quiz_attempts set status = 'submitted', submitted_at = now() where session_id = p_session and status = 'in_progress';
  perform app.recompute_attempt(id) from public.quiz_attempts where session_id = p_session;

  insert into public.reports (tenant_id, kind, title, scope_type, scope_id, payload, created_by)
    values (v_s.tenant_id, 'session_summary', 'Session report: ' || v_s.title, 'class_session', p_session,
            public.session_report(p_session), auth.uid())
    returning id into v_report;
  perform app.audit('session.ended', 'class_session', p_session::text, jsonb_build_object('report_id', v_report));
  return jsonb_build_object('ended', true, 'report_id', v_report);
end$$;

create or replace function public.join_session_as_guest(p_code text, p_name text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid  uuid := auth.uid();
  v_code text := upper(regexp_replace(coalesce(p_code, ''), '\s', '', 'g'));
  v_name text := regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g');
  v_s    public.class_sessions;
  v_user public.users;
  v_pass public.session_guests;
begin
  if v_uid is null or not app.is_anonymous() then
    raise exception 'Use the guest sign-in to join as a guest.' using errcode = '42501';
  end if;
  if (select count(*) from public.code_attempts where user_id = v_uid and at > now() - interval '15 minutes') >= 8 then
    raise exception 'Too many wrong codes. Wait 15 minutes, then check the code with your teacher.' using errcode = 'P0001';
  end if;
  if length(v_name) < 2 or length(v_name) > 40 or v_name !~ '^[[:alnum:]][[:alnum:] .''_-]*$' then
    raise exception 'Use 2 to 40 letters or numbers for your name.' using errcode = '22023';
  end if;

  select * into v_s from public.class_sessions where join_code = v_code and status = 'live';
  if v_s.id is null then
    insert into public.code_attempts (user_id) values (v_uid);
    return jsonb_build_object('error', 'No live lesson has that code. Check it with your teacher.', 'code', 'P0002');
  end if;
  if exists (select 1 from public.tenants t where t.id = v_s.tenant_id and t.status <> 'active') then
    raise exception 'This school isn''t available right now.' using errcode = '42501';
  end if;

  select * into v_user from public.users where id = v_uid;
  if v_user.id is not null and v_user.tenant_id <> v_s.tenant_id then
    return jsonb_build_object('error', 'Start a new guest sign-in for this school.', 'code', 'GUEST_OTHER_SCHOOL');
  end if;

  select * into v_pass from public.session_guests where session_id = v_s.id and user_id = v_uid;
  if v_pass.removed_at is not null then
    raise exception 'Your teacher removed you from this lesson.' using errcode = '42501';
  end if;
  if v_pass.session_id is null then
    if v_s.phase <> 'lobby' and not coalesce((v_s.settings ->> 'late_join')::boolean, true) then
      raise exception 'This lesson has already started and isn''t taking late joiners.' using errcode = 'P0001';
    end if;
    if v_s.guests_closed then
      raise exception 'This lesson isn''t taking new guests. Ask your teacher.' using errcode = 'P0001';
    end if;
    if (select count(*) from public.session_guests where session_id = v_s.id and removed_at is null) >= 300 then
      raise exception 'This lesson is full.' using errcode = 'P0001';
    end if;
    if exists (select 1 from public.session_guests where session_id = v_s.id and removed_at is null
                and lower(display_name) = lower(v_name)) then
      raise exception 'Someone in this lesson already uses that name. Add a surname or a number.' using errcode = 'P0001';
    end if;
  end if;

  if v_user.id is null then
    insert into public.users (id, tenant_id, email, full_name, role)
      values (v_uid, v_s.tenant_id, '', v_name, 'guest');
  else
    update public.users set full_name = v_name where id = v_uid;
  end if;
  -- Joining as a guest means accepting the Terms of Service, as the join page says.
  insert into public.consents (tenant_id, user_id, kind, version)
    values (v_s.tenant_id, v_uid, 'terms_of_service', 1) on conflict (user_id, kind, version) do nothing;

  insert into public.session_guests (session_id, user_id, tenant_id, display_name)
    values (v_s.id, v_uid, v_s.tenant_id, v_name)
    on conflict (session_id, user_id) do update set display_name = excluded.display_name;
  insert into public.session_participants (session_id, user_id, tenant_id, status, current_slide)
    values (v_s.id, v_uid, v_s.tenant_id, 'online', v_s.current_slide)
    on conflict (session_id, user_id) do update set status = 'online', left_at = null, last_seen_at = now();
  delete from public.code_attempts where user_id = v_uid;
  perform app.audit('session.guest_joined', 'class_session', v_s.id::text, jsonb_build_object('name', v_name), v_s.tenant_id);
  return jsonb_build_object('session_id', v_s.id, 'title', v_s.title);
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
  v_guest := not app.in_class(v_s.class_id) and app.is_true_guest(v_s.id);
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

create or replace function app.raise_web_event(
  p_s public.class_sessions, p_student uuid, p_rule text, p_evidence text default null
) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare v_id uuid; v_name text;
begin
  -- Never the teacher, a co-teacher or an admin who opened the lesson.
  if not exists (select 1 from public.class_members m
                 where m.class_id = p_s.class_id and m.user_id = p_student and m.role = 'student')
     and not exists (select 1 from public.session_guests g
                      where g.session_id = p_s.id and g.user_id = p_student and g.removed_at is null
                        and (not g.is_guest or p_s.guest_monitoring)) then
    return false;
  end if;
  insert into public.environment_events (tenant_id, class_session_id, class_id, student_id, device_id, policy_id,
                                         kind, severity, rule, evidence_image)
    values (p_s.tenant_id, p_s.id, p_s.class_id, p_student, null, p_s.environment_id,
            'environment_left', 'warning', p_rule, p_evidence)
    on conflict (class_session_id, student_id, kind) where resolved_at is null do nothing
    returning id into v_id;
  if v_id is null then return false; end if;
  select full_name into v_name from public.users where id = p_student;
  perform app.notify(p_s.teacher_id, 'environment_left', v_name || ' left the class', p_rule,
                     '/teacher/live/' || p_s.id, 'warning',
                     jsonb_build_object('event_id', v_id, 'session_id', p_s.id, 'student_id', p_student));
  return true;
end$$;

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
             -- only the class's students (the teacher has a participant row too)
             and (exists (select 1 from public.class_members m
                          where m.class_id = p_s.class_id and m.user_id = p.user_id and m.role = 'student')
                  or exists (select 1 from public.session_guests g
                              where g.session_id = p_s.id and g.user_id = p.user_id and g.removed_at is null
                                and (not g.is_guest or p_s.guest_monitoring)))
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

create or replace function app.attempt_context_ok(
  p_activity public.activities, p_session uuid, p_assignment uuid, p_share text
) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v_s public.class_sessions; v_a public.assignments;
begin
  if p_session is not null then
    select * into v_s from public.class_sessions where id = p_session;
    -- coalesce: a NULL active_activity_id must mean "no", never "unknown".
    return coalesce(v_s.id is not null and v_s.status = 'live' and v_s.phase = 'active' and (app.in_class(v_s.class_id) or app.is_session_guest(v_s.id))
       and (v_s.active_activity_id = p_activity.id
            or (p_activity.lesson_id is not null and p_activity.lesson_id = v_s.lesson_id
                and (v_s.mode = 'student_paced'
                     or exists (select 1 from public.lesson_slides sl where sl.lesson_id = v_s.lesson_id
                                and sl.activity_id = p_activity.id and sl.position = v_s.current_slide)
                     or exists (select 1 from public.video_checkpoints vc
                                join public.questions q on q.id = vc.question_id
                                join public.lesson_slides sl on sl.id = vc.slide_id
                                where q.activity_id = p_activity.id and sl.lesson_id = v_s.lesson_id)))), false);
  elsif p_assignment is not null then
    select * into v_a from public.assignments where id = p_assignment;
    return coalesce(v_a.id is not null and v_a.status = 'published' and v_a.activity_id = p_activity.id
       and app.in_class(v_a.class_id)
       and (v_a.due_at is null or v_a.due_at > now() or v_a.allow_late), false);
  elsif p_share is not null then
    return coalesce(p_activity.lesson_id = (app.valid_share(p_share)).lesson_id, false);
  end if;
  return false;
end$$;

create or replace function public.session_student_state(p_session uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me    public.users := app.me();
  v_s     public.class_sessions;
  v_p     public.session_participants;
  v_spot  public.spotlights;
  v_act   public.activities;
  v_pass  public.session_guests;
begin
  select * into v_s from public.class_sessions where id = p_session;
  if exists (select 1 from public.session_participants where session_id = p_session and user_id = v_me.id and removed_at is not null) then
    raise exception 'Your teacher removed you from this lesson.' using errcode = '42501';
  end if;
  if v_s.id is null or not (app.in_class(v_s.class_id) or app.is_session_guest(v_s.id)) then raise exception 'Session not found.' using errcode = 'P0002'; end if;
  select * into v_p from public.session_participants where session_id = p_session and user_id = v_me.id;
  if v_p.removed_at is not null then raise exception 'Your teacher removed you from this lesson.' using errcode = '42501'; end if;
  select * into v_pass from public.session_guests where session_id = p_session and user_id = v_me.id;
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
    'session', jsonb_build_object('id', v_s.id, 'title', v_s.title, 'status', v_s.status, 'phase', v_s.phase, 'mode', v_s.mode,
                                  'join_code', v_s.join_code, 'settings', v_s.settings,
                                  'current_slide', v_s.current_slide, 'group_chat_enabled', v_s.group_chat_enabled and v_me.role <> 'guest',
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
    'guest', v_me.role = 'guest',
    'me', jsonb_build_object('name', coalesce(v_pass.display_name, v_me.full_name), 'avatar', v_p.avatar),
    'participants', (select count(*) from public.session_participants sp
                      where sp.session_id = p_session and sp.user_id <> v_s.teacher_id and sp.left_at is null and sp.removed_at is null
                        and sp.last_seen_at > now() - app.presence_window()),
    'summary', case when v_s.status = 'ended' then (
       select jsonb_build_object('answered', count(*), 'correct', count(*) filter (where a.is_correct))
         from public.quiz_answers a join public.quiz_attempts t on t.id = a.attempt_id
        where t.session_id = p_session and t.student_id = v_me.id) end,
    'server_now', now());
end$$;

create or replace function app.session_changed() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.state_version is distinct from old.state_version then
    -- The compact state travels with the signal, so screens can change without refetching.
    perform app.broadcast('session:' || new.id, 'state', jsonb_build_object('v', new.state_version, 'phase', new.phase, 'status', new.status,
      'slide', new.current_slide, 'activity', new.active_activity_id, 'mode', new.mode));
    perform app.broadcast('staff:' || new.id, 'state', '{}'::jsonb);
  end if;
  return null;
end$$;

create or replace function public.health() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('ok', true, 'db_time', now(), 'schema', '0880')
$$;
