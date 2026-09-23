-- =============================================================================
-- SwiftCipher update 2026-09-23b: web classroom lockdown.
-- Students' screens appear on the teacher's screen without the extension,
-- lockdown (full screen + screen share), and "left the class" alerts that
-- include the student's screen.
--
-- For a database that already ran supabase/setup.sql AND
-- supabase/updates/2026-09-23_super_admin_branding.sql.
-- Supabase dashboard -> SQL Editor -> New query -> paste all -> Run (once).
-- =============================================================================

-- =============================================================================
-- SwiftCipher — 0740 screens and leave detection from the website itself
--
-- Without the extension, a student's lesson page can (with the student's
-- permission, which browsers always require) share their entire screen and
-- report when they leave the lesson: switching tab or app, minimising,
-- leaving full screen, or stopping the share. Under "lockdown" (on by
-- default) that counts as leaving the class: after the grace period the
-- teacher is notified, and the alert carries the student's screen.
-- =============================================================================

-- ---------- Schema ----------
alter table public.screen_snapshots alter column device_id drop not null;
alter table public.screen_snapshots add column if not exists source text not null default 'extension'
  check (source in ('extension','web'));
drop index if exists public.screen_snapshots_latest_uidx;
-- Keep only the newest latest-frame row per student before tightening the key.
delete from public.screen_snapshots a using public.screen_snapshots b
 where a.quality <> 'event' and b.quality = a.quality and b.class_session_id = a.class_session_id
   and b.student_id = a.student_id and b.source = a.source
   and (b.captured_at, b.id) > (a.captured_at, a.id);
create unique index screen_snapshots_latest_uidx
  on public.screen_snapshots(class_session_id, student_id, quality, source) where quality <> 'event';

alter table public.environment_events add column if not exists evidence_image text
  check (evidence_image is null or (evidence_image like 'data:image/%' and length(evidence_image) <= 400000));

alter table public.session_participants
  add column if not exists tab_visible       boolean not null default true,
  add column if not exists fullscreen        boolean not null default false,
  add column if not exists screen_sharing    boolean not null default false,
  add column if not exists share_unsupported boolean not null default false,
  add column if not exists screen_surface    text,
  add column if not exists away_since        timestamptz,
  add column if not exists away_reason       text,
  add column if not exists hq_requested_at   timestamptz;

alter table public.class_sessions add column if not exists lockdown boolean not null default true;

-- ---------- Helpers ----------
create or replace function app.raise_web_event(
  p_s public.class_sessions, p_student uuid, p_rule text, p_evidence text default null
) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare v_id uuid; v_name text;
begin
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

-- Raise events for students who have been away longer than the grace period.
-- Away = the lesson page reported it (tab/app switch, left full screen,
-- stopped sharing), the page was closed, or it stopped reporting entirely.
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
                       else p.last_seen_at + interval '30 seconds' end as since,
                  coalesce(p.away_reason, case when p.left_at is not null then 'Closed the lesson'
                                               else 'Lesson page stopped responding (closed or lost connection)' end) as why
           from public.session_participants p
           where p.session_id = p_s.id
             and (p.away_since is not null or p.left_at is not null or p.last_seen_at < now() - interval '30 seconds')
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

-- ---------- Student side ----------
-- Called by the lesson page every few seconds and whenever focus changes.
create or replace function public.student_report(
  p_session uuid, p_visible boolean, p_fullscreen boolean, p_sharing boolean,
  p_surface text default null, p_unsupported boolean default false
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_s        public.class_sessions;
  v_p        public.session_participants;
  v_set      public.tenant_settings;
  v_reason   text;
  v_returned int;
begin
  select * into v_s from public.class_sessions where id = p_session;
  if v_s.id is null or not app.in_class(v_s.class_id) then raise exception 'Session not found.' using errcode = 'P0002'; end if;
  if v_s.status <> 'live' then return jsonb_build_object('status', v_s.status); end if;
  select * into v_set from public.tenant_settings where tenant_id = v_s.tenant_id;

  -- Why is the student away (if at all)? Only counts under lockdown.
  v_reason := case
    when not v_s.lockdown then null
    when not coalesce(p_visible, true) then 'Left the lesson (switched tab, app or window)'
    when not coalesce(p_fullscreen, false) and not p_unsupported then 'Left full-screen mode'
    when v_set.allow_screen_capture and not coalesce(p_sharing, false) and not p_unsupported then 'Stopped sharing their screen'
  end;

  insert into public.session_participants (session_id, user_id, tenant_id, status)
    values (p_session, auth.uid(), v_s.tenant_id, 'online')
    on conflict (session_id, user_id) do nothing;
  update public.session_participants set
    last_seen_at = now(), left_at = null,
    status = case when status = 'offline' then 'online' else status end,
    tab_visible = coalesce(p_visible, true), fullscreen = coalesce(p_fullscreen, false),
    screen_sharing = coalesce(p_sharing, false), share_unsupported = coalesce(p_unsupported, false),
    screen_surface = left(p_surface, 20),
    away_since = case when v_reason is null then null else coalesce(away_since, now()) end,
    away_reason = v_reason
  where session_id = p_session and user_id = auth.uid()
  returning * into v_p;

  if v_reason is null then
    update public.environment_events set resolved_at = now()
     where class_session_id = p_session and student_id = auth.uid() and resolved_at is null
       and kind = 'environment_left' and device_id is null;
    get diagnostics v_returned = row_count;
    if v_returned > 0 then
      perform app.notify(v_s.teacher_id, 'student_returned',
        (select full_name from public.users where id = auth.uid()) || ' returned to the class', null,
        '/teacher/live/' || p_session, 'info', jsonb_build_object('student_id', auth.uid()));
    end if;
  else
    perform app.web_leave_check(v_s);
  end if;

  return jsonb_build_object(
    'status', v_s.status,
    'lockdown', v_s.lockdown,
    'away', v_reason is not null,
    'reason', v_reason,
    'capture', jsonb_build_object(
      'enabled', v_set.allow_screen_capture,
      'interval_seconds', least(v_set.thumbnail_interval_seconds, 5),
      'high_quality', v_p.hq_requested_at is not null and v_p.hq_requested_at > now() - interval '30 seconds'
                      or exists (select 1 from public.spotlights sp where sp.session_id = p_session
                                 and sp.student_id = auth.uid() and sp.ended_at is null)));
end$$;

-- A frame from the student's shared screen (the student chose to share it).
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
  if v_s.id is null or not app.in_class(v_s.class_id) or v_s.status <> 'live' then
    return jsonb_build_object('stored', false, 'reason', 'no live session');
  end if;
  select * into v_set from public.tenant_settings where tenant_id = v_s.tenant_id;
  if not v_set.allow_screen_capture then return jsonb_build_object('stored', false, 'reason', 'screen capture disabled by school'); end if;

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

-- ---------- Teacher side ----------
create or replace function public.set_session_lockdown(p_session uuid, p_on boolean) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_s public.class_sessions := app.require_live_session(p_session);
begin
  update public.class_sessions set lockdown = p_on where id = p_session;
  if not p_on then
    update public.session_participants set away_since = null, away_reason = null where session_id = p_session;
    update public.environment_events set resolved_at = now()
     where class_session_id = p_session and resolved_at is null and kind = 'environment_left' and device_id is null;
  end if;
  perform app.audit('session.lockdown_' || case when p_on then 'on' else 'off' end, 'class_session', p_session::text);
end$$;

create or replace function public.event_evidence(p_event uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v public.environment_events;
begin
  select * into v from public.environment_events where id = p_event;
  if v.id is null or not app.can_manage_session(v.class_session_id) then raise exception 'Alert not found.' using errcode = 'P0002'; end if;
  return jsonb_build_object('image', v.evidence_image, 'rule', v.rule, 'created_at', v.created_at);
end$$;

create or replace function public.request_screenshot(p_session uuid, p_student uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_s public.class_sessions := app.require_live_session(p_session); v_prev timestamptz;
begin
  if not (select allow_screen_capture from public.tenant_settings where tenant_id = v_s.tenant_id) then
    raise exception 'Screen capture is disabled by your school.' using errcode = 'P0001';
  end if;
  select greatest(max(b.snapshot_requested_at), max(p.hq_requested_at)) into v_prev
  from public.session_participants p
  left join public.browser_sessions b on b.class_session_id = p.session_id and b.student_id = p.user_id
  where p.session_id = p_session and p.user_id = p_student;
  update public.browser_sessions set snapshot_requested_at = now()
   where class_session_id = p_session and student_id = p_student
     and (snapshot_requested_at is null or snapshot_requested_at < now() - interval '3 seconds');
  update public.session_participants set hq_requested_at = now() where session_id = p_session and user_id = p_student;
  if v_prev is null or v_prev < now() - interval '60 seconds' then
    perform app.audit('screen.viewed', 'user', p_student::text, jsonb_build_object('session_id', p_session));
  end if;
end$$;

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
                 and last_heartbeat_at > now() - interval '45 seconds')
     and not exists (select 1 from public.session_participants where session_id = p_session and user_id = p_student
                     and screen_sharing and last_seen_at > now() - interval '45 seconds') then
    raise exception 'That student isn''t sharing their screen right now.' using errcode = 'P0001';
  end if;
  update public.spotlights set ended_at = now() where session_id = p_session and ended_at is null;
  insert into public.spotlights (tenant_id, session_id, student_id, anonymized, show_to_class, started_by)
    values (v_s.tenant_id, p_session, p_student, p_anonymized, p_show_to_class, auth.uid()) returning id into v_id;
  update public.browser_sessions set snapshot_requested_at = now() where class_session_id = p_session and student_id = p_student;
  update public.session_participants set hq_requested_at = now() where session_id = p_session and user_id = p_student;
  perform app.notify(p_student, 'spotlight', 'Your teacher is sharing your screen with the class',
                     case when p_anonymized then 'Your name is hidden.' end, '/student/live/' || p_session, 'info',
                     jsonb_build_object('session_id', p_session));
  perform app.audit('spotlight.started', 'user', p_student::text,
                    jsonb_build_object('session_id', p_session, 'anonymized', p_anonymized, 'show_to_class', p_show_to_class));
  return jsonb_build_object('id', v_id);
end$$;

-- Same as 0630, with the new latest-frame key (session, student, quality, source).
create or replace function public.device_snapshot(
  p_device uuid, p_secret text, p_image text, p_width int default null, p_height int default null,
  p_quality text default 'thumbnail', p_url text default null
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_dev      public.devices := app.device_auth(p_device, p_secret);
  v_session  public.class_sessions;
  v_settings public.tenant_settings;
  v_last     timestamptz;
  v_min_gap  interval;
begin
  if p_quality not in ('thumbnail','spotlight') then raise exception 'Unknown quality.' using errcode = '22023'; end if;
  if p_image is null or p_image not like 'data:image/%' or length(p_image) > 400000 then
    raise exception 'Snapshot must be a data:image URL under 400 KB.' using errcode = '22023';
  end if;
  select * into v_settings from public.tenant_settings where tenant_id = v_dev.tenant_id;
  if not v_settings.allow_screen_capture then
    return jsonb_build_object('stored', false, 'reason', 'screen capture disabled by school');
  end if;
  v_session := app.device_live_session(v_dev.student_id);
  if v_session.id is null then return jsonb_build_object('stored', false, 'reason', 'no live session'); end if;

  v_min_gap := case when p_quality = 'thumbnail'
                    then make_interval(secs => greatest(v_settings.thumbnail_interval_seconds / 2, 2))
                    else interval '2 seconds' end;
  select captured_at into v_last from public.screen_snapshots
   where class_session_id = v_session.id and student_id = v_dev.student_id and quality = p_quality and source = 'extension';
  if v_last is not null and now() - v_last < v_min_gap then
    return jsonb_build_object('stored', false, 'reason', 'rate limited');
  end if;

  insert into public.screen_snapshots (tenant_id, device_id, class_session_id, student_id, image_data, width, height, quality, url, source)
    values (v_dev.tenant_id, v_dev.id, v_session.id, v_dev.student_id, p_image, p_width, p_height, p_quality, left(p_url, 2000), 'extension')
    on conflict (class_session_id, student_id, quality, source) where quality <> 'event'
    do update set image_data = excluded.image_data, width = excluded.width, height = excluded.height,
                  url = excluded.url, captured_at = now(), device_id = excluded.device_id;

  if v_settings.store_event_screenshots and exists (
       select 1 from public.environment_events e where e.class_session_id = v_session.id and e.student_id = v_dev.student_id
       and e.resolved_at is null and e.kind in ('environment_left','domain_blocked') and e.created_at > now() - interval '60 seconds')
     and not exists (select 1 from public.screen_snapshots s where s.student_id = v_dev.student_id and s.class_session_id = v_session.id
                     and s.quality = 'event' and s.captured_at > now() - interval '60 seconds') then
    insert into public.screen_snapshots (tenant_id, device_id, class_session_id, student_id, image_data, width, height, quality, url, source)
      values (v_dev.tenant_id, v_dev.id, v_session.id, v_dev.student_id, p_image, p_width, p_height, 'event', left(p_url, 2000), 'extension');
    update public.environment_events set evidence_image = coalesce(evidence_image, p_image)
     where class_session_id = v_session.id and student_id = v_dev.student_id and resolved_at is null
       and kind in ('environment_left','domain_blocked') and created_at > now() - interval '60 seconds';
  end if;

  if p_quality = 'spotlight' then
    update public.browser_sessions set snapshot_requested_at = null where device_id = v_dev.id and class_session_id = v_session.id;
  end if;
  return jsonb_build_object('stored', true);
end$$;

-- Same as 0640 plus: web leave detection, the 'web' roster block, lockdown,
-- and whether an alert has a screenshot attached.
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
                         when p.left_at is not null or p.last_seen_at < now() - interval '45 seconds' then 'offline'
                         else p.status end,
        'last_seen_at', p.last_seen_at, 'current_slide', p.current_slide,
        'web', case when p.user_id is null then null else jsonb_build_object(
                 'sharing', p.screen_sharing and p.last_seen_at > now() - interval '45 seconds',
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

-- Closing the lesson under lockdown counts as leaving (after the grace period).
create or replace function public.leave_session(p_session uuid) returns void
language sql volatile security definer set search_path = '' as $$
  update public.session_participants set left_at = now(), status = 'offline',
    away_since = coalesce(away_since, now()), away_reason = coalesce(away_reason, 'Closed the lesson')
  where session_id = p_session and user_id = auth.uid()
$$;

-- One thumbnail per student: the newest, whichever source it came from.
create or replace function public.session_screens(p_session uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_s public.class_sessions; v_interval int;
begin
  select * into v_s from public.class_sessions where id = p_session;
  if v_s.id is null or not app.can_manage_class(v_s.class_id) then raise exception 'Session not found.' using errcode = 'P0002'; end if;
  select thumbnail_interval_seconds into v_interval from public.tenant_settings where tenant_id = v_s.tenant_id;
  return (select coalesce(jsonb_agg(jsonb_build_object('student_id', sn.student_id, 'device_id', sn.device_id,
            'image', sn.image_data, 'captured_at', sn.captured_at, 'url', sn.url, 'source', sn.source,
            'stale', sn.captured_at < now() - make_interval(secs => greatest(v_interval * 3, 30)))), '[]'::jsonb)
          from (select distinct on (student_id) * from public.screen_snapshots
                where class_session_id = p_session and quality = 'thumbnail'
                order by student_id, captured_at desc) sn);
end$$;

-- Grants for the new functions:
revoke execute on function public.student_report(uuid, boolean, boolean, boolean, text, boolean),
                           public.student_screen_frame(uuid, text, int, int, text),
                           public.set_session_lockdown(uuid, boolean),
                           public.event_evidence(uuid),
                           app.raise_web_event(public.class_sessions, uuid, text, text),
                           app.web_leave_check(public.class_sessions) from public, anon;
grant execute on function public.student_report(uuid, boolean, boolean, boolean, text, boolean),
                          public.student_screen_frame(uuid, text, int, int, text),
                          public.set_session_lockdown(uuid, boolean),
                          public.event_evidence(uuid),
                          app.raise_web_event(public.class_sessions, uuid, text, text),
                          app.web_leave_check(public.class_sessions) to authenticated, service_role;

-- Done. Should return true:
select exists (select 1 from information_schema.columns
               where table_name = 'class_sessions' and column_name = 'lockdown') as web_lockdown_ready;
