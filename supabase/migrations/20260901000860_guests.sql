-- 0860: guests in live lessons (Nearpod-style: the code and a name, no account).
--
-- A guest is a Supabase anonymous sign-in with a "guest" profile in the school,
-- holding a pass for ONE live lesson (session_guests). The pass grants exactly
-- what the lesson needs: its slides and files, answering activities, raising a
-- hand, the teacher's shared screen and the lesson's live boards. It never grants
-- class membership, so guests can't see the class list, assignments, other
-- lessons, chats or files from other lessons.
--
-- The teacher decides per lesson whether guests are monitored (lockdown, screen
-- sharing, leave alerts). Where the school requires parental monitoring consent,
-- a guest's screen is never captured: a guest has no parent on record.
--
-- Anonymous accounts can only ever be guests (enforced by a trigger), and guests
-- can never become class members. Guests are deleted 30 days after their last lesson.
--
-- Supabase: Authentication -> Sign In / Providers -> turn on "Allow anonymous sign-ins".

insert into public.roles (code, label, description, rank) values
  ('guest', 'Guest', 'Joined one live lesson with its code and a name; no account.', 5)
on conflict (code) do nothing;

alter table public.class_sessions
  add column if not exists guest_monitoring boolean not null default false,
  add column if not exists guests_closed   boolean not null default false;

create table if not exists public.session_guests (
  session_id   uuid not null references public.class_sessions(id) on delete cascade,
  user_id      uuid not null references public.users(id) on delete cascade,
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  display_name text not null check (length(btrim(display_name)) between 2 and 40),
  joined_at    timestamptz not null default now(),
  removed_at   timestamptz,
  primary key (session_id, user_id)
);
create index if not exists session_guests_user_idx on public.session_guests(user_id);
create index if not exists session_guests_tenant_idx on public.session_guests(tenant_id);
alter table public.session_guests enable row level security;
revoke all on public.session_guests from anon, authenticated;
grant select on public.session_guests to authenticated;
drop policy if exists session_guests_read on public.session_guests;
create policy session_guests_read on public.session_guests for select to authenticated
  using (user_id = (select auth.uid()) or app.can_manage_session(session_id));

-- Is the caller an anonymous (guest) sign-in?
create or replace function app.is_anonymous() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select a.is_anonymous from auth.users a where a.id = auth.uid()), false)
$$;

-- A guest pass for this lesson (kept after the lesson ends so the guest sees "ended").
create or replace function app.is_session_guest(p_session uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.session_guests g
     where g.session_id = p_session and g.user_id = auth.uid() and g.removed_at is null)
$$;

create or replace function app.in_session(p_session uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.in_class(app.session_class(p_session)) or app.is_session_guest(p_session)
$$;

-- Anonymous sign-ins can only ever be guests, a guest is always an anonymous sign-in,
-- and guests never become class members.
create or replace function app.guard_guest_profile() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_anon boolean := coalesce((select a.is_anonymous from auth.users a where a.id = new.id), false);
begin
  if v_anon and new.role <> 'guest' then
    raise exception 'Create an account to join a school.' using errcode = '42501';
  end if;
  if new.role = 'guest' and not v_anon then
    raise exception 'Only a guest sign-in can be a guest.' using errcode = '42501';
  end if;
  return new;
end$$;
drop trigger if exists users_guest_guard on public.users;
create trigger users_guest_guard before insert or update of role on public.users
  for each row execute function app.guard_guest_profile();

create or replace function app.guard_guest_membership() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.users u where u.id = new.user_id and u.role = 'guest') then
    raise exception 'Guests can''t join a class. Create an account first.' using errcode = '42501';
  end if;
  return new;
end$$;
drop trigger if exists class_members_no_guests on public.class_members;
create trigger class_members_no_guests before insert or update of user_id on public.class_members
  for each row execute function app.guard_guest_membership();

-- Join a live lesson as a guest. Returns {session_id, title}, or {error, code} so a
-- wrong code still counts towards the 8-per-15-minutes limit.
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

-- The teacher's guest controls for one lesson: monitor guests, and stop new guests joining.
create or replace function public.set_session_guests(p_session uuid, p_monitor boolean default null, p_closed boolean default null)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_s public.class_sessions;
begin
  if not app.can_manage_session(p_session) then raise exception 'Not your session.' using errcode = '42501'; end if;
  update public.class_sessions set guest_monitoring = coalesce(p_monitor, guest_monitoring),
                                   guests_closed = coalesce(p_closed, guests_closed),
                                   state_version = state_version + 1
   where id = p_session returning * into v_s;
  perform app.audit('session.guests_changed', 'class_session', p_session::text,
                    jsonb_build_object('monitor', v_s.guest_monitoring, 'closed', v_s.guests_closed));
  return jsonb_build_object('guest_monitoring', v_s.guest_monitoring, 'guests_closed', v_s.guests_closed);
end$$;

create or replace function public.remove_session_guest(p_session uuid, p_user uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not app.can_manage_session(p_session) then raise exception 'Not your session.' using errcode = '42501'; end if;
  update public.session_guests set removed_at = now() where session_id = p_session and user_id = p_user and removed_at is null;
  if not found then raise exception 'Guest not found.' using errcode = 'P0002'; end if;
  update public.session_participants set left_at = now(), status = 'offline' where session_id = p_session and user_id = p_user;
  update public.raise_hands set status = 'resolved' where session_id = p_session and student_id = p_user and status = 'open';
  perform app.audit('session.guest_removed', 'user', p_user::text, jsonb_build_object('session_id', p_session));
end$$;

revoke execute on function public.join_session_as_guest(text, text) from public, anon;
revoke execute on function public.set_session_guests(uuid, boolean, boolean) from public, anon;
revoke execute on function public.remove_session_guest(uuid, uuid) from public, anon;
grant execute on function public.join_session_as_guest(text, text) to authenticated;
grant execute on function public.set_session_guests(uuid, boolean, boolean) to authenticated;
grant execute on function public.remove_session_guest(uuid, uuid) to authenticated;

-- Guests can read the session row of their own lesson.
drop policy if exists class_sessions_read on public.class_sessions;
create policy class_sessions_read on public.class_sessions for select to authenticated
  using (tenant_id = (select app.tenant_id())
         and (app.can_manage_class(class_id) or app.in_class(class_id) or (select app.is_it()) or app.is_session_guest(id)));

-- Files: school members read the school's lesson files; a guest only those of their live lesson.
create or replace function app.guest_can_read_media(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.session_guests g
      join public.class_sessions s on s.id = g.session_id and s.status = 'live'
     where g.user_id = auth.uid() and g.removed_at is null and s.lesson_id is not null
       and (exists (select 1 from public.lesson_slides sl where sl.lesson_id = s.lesson_id
                    and p_name in (sl.content ->> 'media_path', sl.content ->> 'captions_path'))
            or exists (select 1 from public.lesson_media lm where lm.lesson_id = s.lesson_id and lm.storage_path = p_name)))
$$;
drop policy if exists "lesson media read" on storage.objects;
create policy "lesson media read" on storage.objects for select to authenticated
  using (bucket_id = 'lesson-media' and (storage.foldername(name))[1] = (select app.tenant_id())::text
         and ((select app.role()) is distinct from 'guest' or app.guest_can_read_media(name)));

-- Guests are removed 30 days after their last lesson (their answers go with them).
create or replace function app.purge_guests() returns int
language plpgsql volatile security definer set search_path = '' as $$
declare v_n int;
begin
  delete from auth.users a
   where a.is_anonymous
     and exists (select 1 from public.users u where u.id = a.id and u.role = 'guest')
     and not exists (select 1 from public.session_guests g join public.class_sessions s on s.id = g.session_id
                      where g.user_id = a.id and (s.status = 'live' or coalesce(s.ended_at, s.created_at) > now() - interval '30 days'));
  get diagnostics v_n = row_count;
  return v_n;
end$$;
revoke execute on function app.purge_guests() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('swiftcipher-purge-guests', '23 3 * * *', 'select app.purge_guests()');
  end if;
end$$;

-- ---------------------------------------------------------------------------
-- Live-lesson functions that now also accept a guest pass for that lesson.
-- (Current definitions, each changed only where noted by "guest".)
-- ---------------------------------------------------------------------------

create or replace function public.session_lesson(p_session uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_s public.class_sessions;
begin
  select * into v_s from public.class_sessions where id = p_session;
  if v_s.id is null or not (app.in_class(v_s.class_id) or app.is_session_guest(v_s.id) or app.can_manage_class(v_s.class_id)) then
    raise exception 'Session not found.' using errcode = 'P0002';
  end if;
  if v_s.lesson_id is null then return jsonb_build_object('lesson', null, 'slides', '[]'::jsonb); end if;
  return app.lesson_payload(v_s.lesson_id);
end$$;

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
  if v_s.id is null or not (app.in_class(v_s.class_id) or app.is_session_guest(v_s.id)) then raise exception 'Session not found.' using errcode = 'P0002'; end if;
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
    'server_now', now());
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
  v_lock := v_s.lockdown and (not v_guest or v_s.guest_monitoring);
  if v_s.status <> 'live' then return jsonb_build_object('status', v_s.status, 'state_version', v_s.state_version); end if;
  select * into v_set from public.tenant_settings where tenant_id = v_s.tenant_id;
  -- Screen sharing is requested only if the school allows it and, where the school
  -- requires it, a parent/guardian monitoring consent is on file for this student.
  -- A guest has no parent on record, so where the school requires consent their screen is never captured.
  v_capture := v_set.allow_screen_capture and case when v_guest then v_s.guest_monitoring and not v_set.require_monitoring_consent
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

create or replace function app.attempt_context_ok(
  p_activity public.activities, p_session uuid, p_assignment uuid, p_share text
) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v_s public.class_sessions; v_a public.assignments;
begin
  if p_session is not null then
    select * into v_s from public.class_sessions where id = p_session;
    -- coalesce: a NULL active_activity_id must mean "no", never "unknown".
    return coalesce(v_s.id is not null and v_s.status = 'live' and (app.in_class(v_s.class_id) or app.is_session_guest(v_s.id))
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

create or replace function app.raise_web_event(
  p_s public.class_sessions, p_student uuid, p_rule text, p_evidence text default null
) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare v_id uuid; v_name text;
begin
  -- Never the teacher, a co-teacher or an admin who opened the lesson.
  if not exists (select 1 from public.class_members m
                 where m.class_id = p_s.class_id and m.user_id = p_student and m.role = 'student')
     and not (p_s.guest_monitoring and exists (select 1 from public.session_guests g
                                               where g.session_id = p_s.id and g.user_id = p_student and g.removed_at is null)) then
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
                  or (p_s.guest_monitoring and exists (select 1 from public.session_guests g
                                                       where g.session_id = p_s.id and g.user_id = p.user_id and g.removed_at is null)))
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

create or replace function public.health() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('ok', true, 'db_time', now(), 'schema', '0860')
$$;
