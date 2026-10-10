-- 1020: when the teacher closes the lesson, it ends, even without "End session".
--
-- The teacher's pages (control room, Present, a game hosted from the lesson) say
-- "here" every 20 seconds (teacher_here), and "left" the moment the tab or
-- browser is closed. A live lesson ends for everyone:
--   * 45 seconds after the teacher closed it (a page refresh comes back sooner), or
--   * 3 minutes after the teacher's pages last said "here" (crash, no internet,
--     laptop shut).
-- It is checked on every student's tick (no scheduler needed) and every minute
-- by pg_cron where it is on, for lessons nobody is in. Its report is saved like
-- any other; the teacher sees it under Reports.

alter table public.class_sessions add column if not exists teacher_left_at timestamptz;

-- The teacher's comings and goings are not lesson state: students don't refetch for them.
create or replace function app.session_version_bump() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (to_jsonb(new) - 'teacher_seen_at' - 'teacher_left_at' - 'state_version' - 'updated_at')
     is distinct from (to_jsonb(old) - 'teacher_seen_at' - 'teacher_left_at' - 'state_version' - 'updated_at')
     and new.state_version = old.state_version then
    new.state_version := old.state_version + 1;
  end if;
  return new;
end$$;

/** Ends a live lesson for everyone and saves its report. Callers check who may do this. */
create or replace function app.finish_session(p_session uuid, p_reason text default 'teacher') returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_s      public.class_sessions;
  v_report uuid;
  v_by_teacher boolean := p_reason = 'teacher';
begin
  select * into v_s from public.class_sessions where id = p_session for update;
  if v_s.id is null or v_s.status <> 'live' then return null; end if;
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

  -- The full report needs the teacher's view (session_report checks it). Ended any
  -- other way, a placeholder is saved and Reports builds it when the teacher opens it.
  insert into public.reports (tenant_id, kind, title, scope_type, scope_id, payload, created_by)
    values (v_s.tenant_id, 'session_summary', 'Session report: ' || v_s.title, 'class_session', p_session,
            case when v_by_teacher then public.session_report(p_session) else jsonb_build_object('ended_because', p_reason) end,
            case when v_by_teacher then auth.uid() else v_s.teacher_id end)
    returning id into v_report;
  if v_by_teacher then
    perform app.audit('session.ended', 'class_session', p_session::text, jsonb_build_object('report_id', v_report));
  else
    perform app.audit('session.auto_ended', 'class_session', p_session::text,
                      jsonb_build_object('report_id', v_report, 'reason', p_reason), v_s.tenant_id, null);
  end if;
  return v_report;
end$$;
revoke execute on function app.finish_session(uuid, text) from public, anon, authenticated;

create or replace function public.end_session(p_session uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_s public.class_sessions := app.require_live_session(p_session);
begin
  return jsonb_build_object('ended', true, 'report_id', app.finish_session(v_s.id, 'teacher'));
end$$;

/** Has the teacher closed this live lesson (see the header)? */
create or replace function app.teacher_gone(p_s public.class_sessions) returns boolean
language sql stable set search_path = '' as $$
  select p_s.status = 'live'
     and ((p_s.teacher_left_at is not null and p_s.teacher_left_at < now() - interval '45 seconds')
          or coalesce(p_s.teacher_seen_at, p_s.started_at, p_s.created_at) < now() - interval '3 minutes')
$$;

/** The teacher's pages: "here" every 20 seconds, "left" when the tab is closed. */
create or replace function public.teacher_here(p_session uuid, p_here boolean default true) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_s public.class_sessions;
begin
  select * into v_s from public.class_sessions where id = p_session;
  if v_s.id is null or not app.can_manage_session(v_s.id) then raise exception 'Session not found.' using errcode = 'P0002'; end if;
  if v_s.status = 'live' and app.teacher_gone(v_s) then
    perform app.finish_session(v_s.id, 'teacher_left');
  elsif v_s.status = 'live' and p_here then
    if v_s.teacher_left_at is not null or v_s.teacher_seen_at is null or v_s.teacher_seen_at < now() - interval '10 seconds' then
      update public.class_sessions set teacher_seen_at = now(), teacher_left_at = null where id = p_session;
    end if;
  elsif v_s.status = 'live' then
    update public.class_sessions set teacher_left_at = now() where id = p_session;
  end if;
  return jsonb_build_object('status', (select status from public.class_sessions where id = p_session));
end$$;
revoke execute on function public.teacher_here(uuid, boolean) from public, anon;
grant execute on function public.teacher_here(uuid, boolean) to authenticated;

-- Checked on every student's tick (student_report refreshes last_seen_at).
create or replace function app.end_if_teacher_gone() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_s public.class_sessions;
begin
  select * into v_s from public.class_sessions where id = new.session_id;
  if v_s.id is not null and app.teacher_gone(v_s) then perform app.finish_session(v_s.id, 'teacher_left'); end if;
  return null;
end$$;
drop trigger if exists session_participants_teacher_gone on public.session_participants;
create trigger session_participants_teacher_gone after update of last_seen_at on public.session_participants
  for each row when (new.last_seen_at is distinct from old.last_seen_at and new.left_at is null)
  execute function app.end_if_teacher_gone();

/** For pg_cron (every minute) and hourly maintenance: lessons nobody is in. */
create or replace function app.end_teacherless_sessions() returns int
language plpgsql volatile security definer set search_path = '' as $$
declare r public.class_sessions; v_n int := 0;
begin
  for r in select * from public.class_sessions s where s.status = 'live' loop
    if app.teacher_gone(r) then perform app.finish_session(r.id, 'teacher_left'); v_n := v_n + 1; end if;
  end loop;
  return v_n;
end$$;
revoke execute on function app.end_teacherless_sessions() from public, anon, authenticated;

create or replace function app.run_maintenance() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_ended int;
begin
  v_ended := app.end_abandoned_sessions() + app.end_teacherless_sessions();
  perform app.apply_retention_all();
  delete from public.invites where expires_at < now() - interval '30 days';
  delete from public.error_events where last_seen_at < now() - interval '30 days';
  perform app.refresh_platform_stats();
  return jsonb_build_object('ok', true, 'ran_at', now(), 'sessions_auto_ended', v_ended);
end$$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('swiftcipher-teacherless', '* * * * *', 'select app.end_teacherless_sessions()');
  end if;
end$$;

create or replace function public.health() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('ok', true, 'db_time', now(), 'schema', '1020')
$$;
