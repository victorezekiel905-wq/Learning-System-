-- 0840: only students are monitored.
--
-- start_session records the teacher in session_participants, but the teacher's
-- live room never refreshes that row. Under lockdown the leave sweep treated the
-- teacher like a student whose page had gone silent: about two minutes into every
-- locked-down lesson the teacher was alerted that they had "left the class", and
-- the false alert was counted in the lesson summary. The same could happen to a
-- co-teacher or admin who opened the student view of a lesson.
--
-- Leave alerts are now raised only for the class's students, and the false alerts
-- already stored (about people who are not students) are removed.

create or replace function app.raise_web_event(
  p_s public.class_sessions, p_student uuid, p_rule text, p_evidence text default null
) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare v_id uuid; v_name text;
begin
  -- Never the teacher, a co-teacher or an admin who opened the lesson.
  if not exists (select 1 from public.class_members m
                 where m.class_id = p_s.class_id and m.user_id = p_student and m.role = 'student') then
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
             and exists (select 1 from public.class_members m
                         where m.class_id = p_s.class_id and m.user_id = p.user_id and m.role = 'student')
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

-- Remove the false alerts already raised about teachers and admins (a student's own
-- history is kept, even if they have since left the class).
delete from public.notifications n
 where n.kind = 'environment_left'
   and exists (select 1 from public.users u where u.id::text = n.payload ->> 'student_id' and u.role <> 'student');
delete from public.environment_events e
 where e.kind = 'environment_left' and e.device_id is null
   and exists (select 1 from public.users u where u.id = e.student_id and u.role <> 'student');

create or replace function public.health() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('ok', true, 'db_time', now(), 'schema', '0840')
$$;
