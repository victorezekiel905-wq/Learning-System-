-- Present shows students' screens beside the lesson; clicking one shows it large on the
-- projector only (a spotlight with show_to_class = false: the student is told, the
-- rest of the class keeps the lesson on their own screens).
-- Same as 0740, except guests in the lesson can be shown too (they were refused as
-- "not in this class", since guests aren't class members).
create or replace function public.spotlight_start(
  p_session uuid, p_student uuid, p_anonymized boolean default false, p_show_to_class boolean default false
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_s public.class_sessions := app.require_live_session(p_session); v_id uuid;
begin
  if not (select allow_spotlight and allow_screen_capture from public.tenant_settings where tenant_id = v_s.tenant_id) then
    raise exception 'Student screen spotlighting is disabled by your school.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.class_members where class_id = v_s.class_id and user_id = p_student and role = 'student')
     and not exists (select 1 from public.session_guests where session_id = p_session and user_id = p_student and removed_at is null) then
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
  perform app.broadcast('staff:' || p_session, 'state', jsonb_build_object('spotlight', v_id));
  return jsonb_build_object('id', v_id);
end$$;

create or replace function public.spotlight_stop(p_session uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_s public.class_sessions := app.require_live_session(p_session);
begin
  update public.spotlights set ended_at = now() where session_id = p_session and ended_at is null;
  perform app.audit('spotlight.stopped', 'class_session', p_session::text);
  perform app.broadcast('staff:' || p_session, 'state', jsonb_build_object('spotlight', null));
end$$;

create or replace function public.health() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('ok', true, 'db_time', now(), 'schema', '1120')
$$;
