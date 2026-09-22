-- =============================================================================
-- SwiftCipher — 0650 Insights (§18), reports, parent portal, retention &
-- privacy workflows (§20), billing metrics (§26), function privileges.
-- =============================================================================

create table public.reports (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  kind        text not null check (kind in ('session_summary','class_analytics','tenant_overview','attendance','custom')),
  title       text not null,
  scope_type  text,
  scope_id    uuid,
  payload     jsonb not null,
  created_by  uuid,
  created_at  timestamptz not null default now()
);
create index reports_tenant_idx on public.reports(tenant_id, created_at desc);
alter table public.reports enable row level security;
revoke all on public.reports from anon;
revoke insert, update, delete on public.reports from authenticated;
create policy reports_read on public.reports for select to authenticated
  using (tenant_id = (select app.tenant_id())
         and ((select app.is_admin())
              or created_by = (select auth.uid())
              or (scope_type = 'class_session' and app.can_manage_session(scope_id))
              or (scope_type = 'class' and app.can_manage_class(scope_id))));

-- ---------------------------------------------------------------------------
create or replace function public.session_report(p_session uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_s public.class_sessions;
begin
  select * into v_s from public.class_sessions where id = p_session;
  if v_s.id is null or not app.can_manage_class(v_s.class_id) then raise exception 'Session not found.' using errcode = 'P0002'; end if;
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

create or replace function public.class_analytics(p_class uuid, p_days int default 30) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_from     timestamptz := now() - make_interval(days => least(greatest(coalesce(p_days, 30), 1), 365));
  v_students bigint;
  v_sessions bigint;
begin
  if not app.can_manage_class(p_class) then raise exception 'Not your class.' using errcode = '42501'; end if;
  select count(*) into v_students from public.class_members where class_id = p_class and role = 'student';
  select count(*) into v_sessions from public.class_sessions where class_id = p_class and created_at >= v_from;

  return jsonb_build_object(
    'range_days', p_days, 'students', v_students, 'sessions', v_sessions,
    -- Learning analytics
    'participation_rate', (select round(100.0 * count(*) / nullif(v_students * v_sessions, 0), 1)
                           from public.session_participants p join public.class_sessions s on s.id = p.session_id
                           join public.class_members m on m.class_id = s.class_id and m.user_id = p.user_id and m.role = 'student'
                           where s.class_id = p_class and s.created_at >= v_from),
    'question_accuracy', (select round(100.0 * count(*) filter (where qa.is_correct) / nullif(count(*) filter (where qa.is_correct is not null), 0), 1)
                          from public.quiz_answers qa join public.quiz_attempts t on t.id = qa.attempt_id
                          join public.class_members m on m.user_id = t.student_id and m.class_id = p_class
                          where qa.answered_at >= v_from),
    'avg_response_ms', (select round(avg(qa.elapsed_ms)) from public.quiz_answers qa join public.quiz_attempts t on t.id = qa.attempt_id
                        join public.class_members m on m.user_id = t.student_id and m.class_id = p_class
                        where qa.answered_at >= v_from and qa.elapsed_ms > 0),
    'hardest_questions', (select coalesce(jsonb_agg(x order by (x ->> 'accuracy')::numeric), '[]'::jsonb) from (
        select jsonb_build_object('question_id', q.id, 'prompt', left(q.prompt, 140), 'responses', count(*),
               'accuracy', round(100.0 * count(*) filter (where qa.is_correct) / nullif(count(*), 0), 1)) x
        from public.quiz_answers qa join public.questions q on q.id = qa.question_id
        join public.quiz_attempts t on t.id = qa.attempt_id
        join public.class_members m on m.user_id = t.student_id and m.class_id = p_class
        where qa.answered_at >= v_from and qa.is_correct is not null
        group by q.id having count(*) >= 3 order by 100.0 * count(*) filter (where qa.is_correct) / count(*) limit 5) h),
    'score_distribution', (select coalesce(jsonb_object_agg(bucket, n), '{}'::jsonb) from (
        select (least(floor(100.0 * t.score / t.max_score / 20), 4) * 20)::int::text || '%' as bucket, count(*) n
        from public.quiz_attempts t join public.class_members m on m.user_id = t.student_id and m.class_id = p_class
        where t.submitted_at >= v_from and t.max_score > 0 and t.score is not null group by 1) d),
    'assignment_completion', (select round(100.0 * count(distinct (s.assignment_id, s.student_id)) /
                                nullif(v_students * (select count(*) from public.assignments a where a.class_id = p_class
                                                     and a.status <> 'draft' and a.created_at >= v_from), 0), 1)
                              from public.submissions s join public.assignments a on a.id = s.assignment_id
                              where a.class_id = p_class and a.created_at >= v_from),
    'games', (select coalesce(jsonb_agg(jsonb_build_object('game_id', g.id, 'title', g.title, 'ended_at', g.ended_at,
                'players', (select count(*) from public.game_players p where p.game_id = g.id),
                'winner', (select p.display_name from public.game_players p where p.game_id = g.id order by p.score desc limit 1))
                order by g.created_at desc), '[]'::jsonb)
              from (select * from public.game_sessions where class_id = p_class and created_at >= v_from order by created_at desc limit 10) g),
    -- Classroom-focus signals, reported separately from learning (§18)
    'environment_leave_rate', (select round(count(*)::numeric / nullif(v_sessions, 0), 2) from public.environment_events e
                               join public.class_sessions s on s.id = e.class_session_id
                               where s.class_id = p_class and s.created_at >= v_from and e.kind in ('environment_left','domain_blocked')),
    'off_task_rate', (select round(count(*)::numeric / nullif(v_sessions, 0), 2) from public.environment_events e
                      join public.class_sessions s on s.id = e.class_session_id
                      where s.class_id = p_class and s.created_at >= v_from and e.kind = 'off_task'),
    'device_connectivity_rate', (select round(100.0 * count(*) filter (where not exists (
                                    select 1 from public.environment_events e where e.class_session_id = b.class_session_id
                                    and e.student_id = b.student_id and e.kind = 'connection_lost')) / nullif(count(*), 0), 1)
                                 from public.browser_sessions b join public.class_sessions s on s.id = b.class_session_id
                                 where s.class_id = p_class and s.created_at >= v_from),
    'interventions_per_session', (select round((count(distinct c.id) + count(distinct e.id))::numeric / nullif(v_sessions, 0), 2)
                                  from public.class_sessions s
                                  left join public.teacher_commands c on c.class_session_id = s.id
                                  left join public.environment_events e on e.class_session_id = s.id and e.handled_by is not null
                                  where s.class_id = p_class and s.created_at >= v_from),
    'per_student', (select coalesce(jsonb_agg(jsonb_build_object(
        'student_id', u.id, 'name', u.full_name,
        'sessions_joined', (select count(*) from public.session_participants p join public.class_sessions s on s.id = p.session_id
                            where p.user_id = u.id and s.class_id = p_class and s.created_at >= v_from),
        'accuracy', (select round(100.0 * count(*) filter (where qa.is_correct) / nullif(count(*) filter (where qa.is_correct is not null), 0), 1)
                     from public.quiz_answers qa join public.quiz_attempts t on t.id = qa.attempt_id
                     where t.student_id = u.id and qa.answered_at >= v_from),
        'submissions', (select count(*) from public.submissions s join public.assignments a on a.id = s.assignment_id
                        where s.student_id = u.id and a.class_id = p_class),
        'alerts', (select count(*) from public.environment_events e join public.class_sessions s on s.id = e.class_session_id
                   where e.student_id = u.id and s.class_id = p_class and s.created_at >= v_from and e.kind <> 'connection_lost'))
        order by u.full_name), '[]'::jsonb)
      from public.class_members m join public.users u on u.id = m.user_id where m.class_id = p_class and m.role = 'student'));
end$$;

create or replace function public.tenant_overview() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_t uuid := app.tenant_id();
begin
  if not app.is_admin() then raise exception 'Administrators only.' using errcode = '42501'; end if;
  return jsonb_build_object(
    'teachers', (select count(*) from public.users where tenant_id = v_t and role in ('teacher','school_admin') and status = 'active'),
    'students', (select count(*) from public.users where tenant_id = v_t and role = 'student' and status = 'active'),
    'parents', (select count(*) from public.users where tenant_id = v_t and role = 'parent'),
    'classes', (select count(*) from public.classes where tenant_id = v_t and archived_at is null),
    'lessons', (select count(*) from public.lessons where tenant_id = v_t),
    'devices_active', (select count(*) from public.devices where tenant_id = v_t and status = 'active'),
    'devices_online', (select count(*) from public.devices where tenant_id = v_t and status = 'active' and last_seen_at > now() - interval '45 seconds'),
    'weekly', (select coalesce(jsonb_agg(jsonb_build_object('week', to_char(w.wk, 'YYYY-MM-DD'), 'sessions', w.sessions,
                 'participants', w.participants,
                 'answers', (select count(*) from public.quiz_answers qa where qa.tenant_id = v_t
                             and date_trunc('week', qa.answered_at) = w.wk)) order by w.wk), '[]'::jsonb) from (
        select date_trunc('week', s.created_at) wk, count(distinct s.id) sessions,
               count(distinct (p.session_id, p.user_id)) participants
        from public.class_sessions s left join public.session_participants p on p.session_id = s.id
        where s.tenant_id = v_t and s.created_at > now() - interval '12 weeks' group by 1) w));
end$$;

-- Billing metrics (§26).
create or replace function public.usage_metrics() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_t uuid := app.tenant_id();
begin
  if not app.is_admin() then raise exception 'Administrators only.' using errcode = '42501'; end if;
  return jsonb_build_object(
    'active_teachers_30d', (select count(distinct s.teacher_id) from public.class_sessions s where s.tenant_id = v_t and s.created_at > now() - interval '30 days'),
    'active_students_30d', (select count(distinct p.user_id) from public.session_participants p where p.tenant_id = v_t and p.joined_at > now() - interval '30 days'),
    'max_students_per_class', (select coalesce(max(n), 0) from (select count(*) n from public.class_members m join public.classes c on c.id = m.class_id
                                                              where c.tenant_id = v_t and m.role = 'student' group by m.class_id) x),
    'classes', (select count(*) from public.classes where tenant_id = v_t and archived_at is null),
    'storage_mb', (select round(coalesce(sum(bytes), 0) / 1048576.0, 1) from public.lesson_media where tenant_id = v_t),
    'managed_devices', (select count(*) from public.devices where tenant_id = v_t and status = 'active'),
    'monitoring_minutes_30d', (select round(coalesce(sum(extract(epoch from coalesce(b.ended_at, b.last_heartbeat_at) - b.started_at)), 0) / 60)
                               from public.browser_sessions b where b.tenant_id = v_t and b.started_at > now() - interval '30 days'),
    'retention', (select jsonb_build_object('learning_days', learning_retention_days, 'telemetry_days', telemetry_retention_days)
                  from public.tenant_settings where tenant_id = v_t),
    'plan', (select jsonb_build_object('code', p.code, 'name', p.name, 'limits', p.limits, 'features', p.features)
             from public.tenants t join public.plans p on p.code = t.plan_code where t.id = v_t));
end$$;

-- Student summary for the student, their teachers, admins and linked parents.
create or replace function public.student_summary(p_student uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_parent boolean; v_u public.users;
begin
  select * into v_u from public.users where id = p_student and role = 'student' and tenant_id = app.tenant_id();
  if v_u.id is null then raise exception 'Student not found.' using errcode = 'P0002'; end if;
  v_parent := app.is_parent_of(p_student);
  if not (p_student = auth.uid() or app.is_admin() or app.teaches_student(p_student) or v_parent) then
    raise exception 'Not available.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'student', jsonb_build_object('id', v_u.id, 'name', v_u.full_name),
    'classes', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'subject', c.subject)), '[]'::jsonb)
                from public.class_members m join public.classes c on c.id = m.class_id where m.user_id = p_student and m.role = 'student'),
    'attendance', (select jsonb_build_object('present', count(*) filter (where status = 'present'),
                     'late', count(*) filter (where status = 'late'), 'absent', count(*) filter (where status = 'absent'),
                     'excused', count(*) filter (where status = 'excused'),
                     'recent', (select coalesce(jsonb_agg(jsonb_build_object('date', a2.date, 'status', a2.status,
                                  'class', (select name from public.classes where id = a2.class_id)) order by a2.date desc), '[]'::jsonb)
                                from (select * from public.attendance where student_id = p_student order by date desc limit 10) a2))
                   from public.attendance where student_id = p_student and date > now() - interval '90 days'),
    'learning', jsonb_build_object(
      'accuracy_30d', (select round(100.0 * count(*) filter (where qa.is_correct) / nullif(count(*) filter (where qa.is_correct is not null), 0), 1)
                       from public.quiz_answers qa join public.quiz_attempts t on t.id = qa.attempt_id
                       where t.student_id = p_student and qa.answered_at > now() - interval '30 days'),
      'activities_completed_30d', (select count(*) from public.quiz_attempts where student_id = p_student and status <> 'in_progress'
                                   and submitted_at > now() - interval '30 days'),
      'sessions_joined_30d', (select count(*) from public.session_participants where user_id = p_student and joined_at > now() - interval '30 days'),
      'released_grades', (select coalesce(jsonb_agg(jsonb_build_object('assignment', a.title, 'score', g.score,
                             'out_of', a.points_possible, 'feedback', g.feedback, 'released_at', g.released_at)
                             order by g.released_at desc), '[]'::jsonb)
                          from public.grades g join public.submissions s on s.id = g.submission_id
                          join public.assignments a on a.id = s.assignment_id
                          where s.student_id = p_student and g.released_at is not null)),
    -- Screen-time summary: minutes inside managed class sessions only (§2 parent portal).
    'screen_time', jsonb_build_object(
      'managed_minutes_30d', (select round(coalesce(sum(extract(epoch from coalesce(b.ended_at, b.last_heartbeat_at) - b.started_at)), 0) / 60)
                              from public.browser_sessions b where b.student_id = p_student and b.started_at > now() - interval '30 days'),
      'focus_alerts_30d', (select count(*) from public.environment_events e where e.student_id = p_student
                           and e.kind in ('environment_left','domain_blocked','off_task') and e.created_at > now() - interval '30 days')));
end$$;

create or replace function public.parent_children() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'name', u.full_name, 'relation', pl.relation) order by u.full_name), '[]'::jsonb)
  from public.parent_links pl join public.users u on u.id = pl.student_id
  where pl.parent_id = auth.uid() and pl.revoked_at is null and app.is_parent_of(pl.student_id)
$$;

-- ---------------------------------------------------------------------------
-- Retention (§18/§20): learning data and device telemetry have separate clocks.
-- ---------------------------------------------------------------------------
create or replace function app.apply_retention(p_tenant uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_set    public.tenant_settings;
  v_tel    timestamptz;
  v_learn  timestamptz;
  v_counts jsonb := '{}'::jsonb;
  v_n      int;
begin
  select * into v_set from public.tenant_settings where tenant_id = p_tenant;
  if v_set.tenant_id is null then return null; end if;
  v_tel := now() - make_interval(days => v_set.telemetry_retention_days);
  v_learn := now() - make_interval(days => v_set.learning_retention_days);

  delete from public.browser_events where tenant_id = p_tenant and created_at < v_tel; get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('browser_events', v_n);
  delete from public.screen_snapshots where tenant_id = p_tenant and captured_at < v_tel; get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('screen_snapshots', v_n);
  -- Live thumbnails are not kept after the session at all.
  delete from public.screen_snapshots sn using public.class_sessions s
   where sn.class_session_id = s.id and sn.tenant_id = p_tenant and s.status = 'ended' and sn.quality <> 'event';
  delete from public.environment_events where tenant_id = p_tenant and created_at < v_tel; get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('environment_events', v_n);
  delete from public.browser_sessions where tenant_id = p_tenant and started_at < v_tel; get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('browser_sessions', v_n);
  delete from public.teacher_commands where tenant_id = p_tenant and created_at < v_tel;
  delete from public.rtc_signals where tenant_id = p_tenant and created_at < now() - interval '1 day';
  delete from public.device_pairing_codes where tenant_id = p_tenant and expires_at < now() - interval '1 day';

  delete from public.quiz_attempts where tenant_id = p_tenant and started_at < v_learn; get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('quiz_attempts', v_n);
  delete from public.game_sessions where tenant_id = p_tenant and created_at < v_learn;
  delete from public.chat_messages where tenant_id = p_tenant and created_at < v_learn;
  delete from public.notifications where tenant_id = p_tenant and created_at < now() - interval '90 days';

  perform app.audit('retention.applied', 'tenant', p_tenant::text, v_counts, p_tenant, null);
  return v_counts;
end$$;

create or replace function public.apply_retention() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not app.is_admin() then raise exception 'Administrators only.' using errcode = '42501'; end if;
  return app.apply_retention(app.tenant_id());
end$$;

create or replace function app.apply_retention_all() returns void
language plpgsql volatile security definer set search_path = '' as $$
declare r record;
begin
  for r in select tenant_id from public.tenant_settings loop perform app.apply_retention(r.tenant_id); end loop;
end$$;

-- Data export (§20) — everything the school holds about one person.
create or replace function public.export_user_data(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_u public.users;
begin
  select * into v_u from public.users where id = p_user and tenant_id = app.tenant_id();
  if v_u.id is null then raise exception 'User not found.' using errcode = 'P0002'; end if;
  if not (app.is_admin() or p_user = auth.uid()) then raise exception 'Administrators only.' using errcode = '42501'; end if;
  perform app.audit('privacy.export', 'user', p_user::text);
  return jsonb_build_object(
    'exported_at', now(),
    'profile', to_jsonb(v_u),
    'classes', (select coalesce(jsonb_agg(to_jsonb(m)), '[]'::jsonb) from public.class_members m where m.user_id = p_user),
    'attempts', (select coalesce(jsonb_agg(to_jsonb(t) || jsonb_build_object('answers',
                  (select coalesce(jsonb_agg(to_jsonb(a) - 'tenant_id'), '[]'::jsonb) from public.quiz_answers a where a.attempt_id = t.id))), '[]'::jsonb)
                 from public.quiz_attempts t where t.student_id = p_user),
    'submissions', (select coalesce(jsonb_agg(to_jsonb(s) || jsonb_build_object('grade',
                      (select to_jsonb(g) from public.grades g where g.submission_id = s.id and g.released_at is not null))), '[]'::jsonb)
                    from public.submissions s where s.student_id = p_user),
    'attendance', (select coalesce(jsonb_agg(to_jsonb(a)), '[]'::jsonb) from public.attendance a where a.student_id = p_user),
    'games', (select coalesce(jsonb_agg(to_jsonb(p)), '[]'::jsonb) from public.game_players p where p.user_id = p_user),
    'messages', (select coalesce(jsonb_agg(to_jsonb(m)), '[]'::jsonb) from public.chat_messages m where m.sender_id = p_user),
    'devices', (select coalesce(jsonb_agg(to_jsonb(d) - 'secret_hash'), '[]'::jsonb) from public.devices d where d.student_id = p_user),
    'environment_events', (select coalesce(jsonb_agg(to_jsonb(e)), '[]'::jsonb) from public.environment_events e where e.student_id = p_user),
    'browser_events', (select coalesce(jsonb_agg(to_jsonb(b)), '[]'::jsonb) from public.browser_events b where b.student_id = p_user),
    'consents', (select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) from public.consents c where c.user_id = p_user),
    'notifications', (select coalesce(jsonb_agg(to_jsonb(n)), '[]'::jsonb) from public.notifications n where n.user_id = p_user));
end$$;

-- Deletion (§20): removes the tenant profile and cascades. The auth account is
-- deleted by the server route with the service-role key afterwards.
create or replace function public.delete_user_data(p_user uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_u public.users;
begin
  if not app.is_admin() then raise exception 'Administrators only.' using errcode = '42501'; end if;
  select * into v_u from public.users where id = p_user and tenant_id = app.tenant_id();
  if v_u.id is null then raise exception 'User not found.' using errcode = 'P0002'; end if;
  if p_user = auth.uid() then raise exception 'You cannot delete your own account here.' using errcode = 'P0001'; end if;
  if exists (select 1 from public.classes where teacher_id = p_user) then
    raise exception 'Transfer this teacher''s classes before deleting them.' using errcode = 'P0001';
  end if;
  perform app.audit('privacy.delete', 'user', p_user::text, jsonb_build_object('role', v_u.role, 'email', v_u.email));
  update public.devices set student_id = null, status = 'unenrolled' where student_id = p_user;
  delete from public.game_players where user_id = p_user;
  delete from public.chat_messages where sender_id = p_user;
  delete from public.chat_threads where student_id = p_user or teacher_id = p_user;
  delete from public.environment_events where student_id = p_user;
  delete from public.browser_events where student_id = p_user;
  delete from public.browser_sessions where student_id = p_user;
  delete from public.screen_snapshots where student_id = p_user;
  delete from public.teacher_commands where student_id = p_user;
  delete from public.quiz_attempts where student_id = p_user;
  delete from public.submissions where student_id = p_user;
  delete from public.users where id = p_user;
end$$;

-- ---------------------------------------------------------------------------
-- Billing (service role only: called from the verified webhook handler).
-- ---------------------------------------------------------------------------
create or replace function public.billing_apply_subscription(
  p_tenant uuid, p_plan text, p_status text, p_provider text, p_ref text, p_period_end timestamptz
) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.plans where code = p_plan) then raise exception 'Unknown plan.' using errcode = '22023'; end if;
  update public.subscriptions set status = 'canceled'
   where tenant_id = p_tenant and status in ('trialing','active','past_due') and coalesce(provider_ref, '') <> coalesce(p_ref, '');
  insert into public.subscriptions (tenant_id, plan_code, status, provider, provider_ref, current_period_end)
    select p_tenant, p_plan, p_status, p_provider, p_ref, p_period_end
    where not exists (select 1 from public.subscriptions where tenant_id = p_tenant and provider_ref = p_ref);
  update public.subscriptions set plan_code = p_plan, status = p_status, current_period_end = p_period_end
   where tenant_id = p_tenant and provider_ref = p_ref;
  update public.tenants set plan_code = case when p_status in ('active','trialing','past_due') then p_plan else 'free_teacher' end
   where id = p_tenant;
  perform app.audit('billing.subscription', 'tenant', p_tenant::text,
                    jsonb_build_object('plan', p_plan, 'status', p_status, 'provider', p_provider), p_tenant, null);
end$$;

create or replace function public.billing_record_invoice(
  p_tenant uuid, p_amount_cents int, p_currency text, p_status text, p_ref text, p_paid_at timestamptz
) returns void
language sql volatile security definer set search_path = '' as $$
  insert into public.invoices (tenant_id, subscription_id, amount_cents, currency, status, provider_ref, paid_at)
  values (p_tenant, (select id from public.subscriptions where tenant_id = p_tenant and status in ('trialing','active','past_due') limit 1),
          p_amount_cents, upper(p_currency), p_status, p_ref, p_paid_at)
  on conflict (provider_ref) do update set status = excluded.status, paid_at = excluded.paid_at
$$;

-- ---------------------------------------------------------------------------
-- Scheduled retention via pg_cron when the project has it (optional).
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    begin
      create extension if not exists pg_cron;
      perform cron.schedule('swiftcipher-retention', '17 3 * * *', 'select app.apply_retention_all()');
    exception when others then
      raise notice 'pg_cron not enabled (%); run app.apply_retention_all() from a scheduler instead.', sqlerrm;
    end;
  end if;
end$$;

-- ---------------------------------------------------------------------------
-- Function privileges: nothing is callable by anon except the device agent
-- entry points; billing mutators are service-role only.
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema app from public, anon;
grant execute on all functions in schema public to authenticated, service_role;
grant execute on all functions in schema app to authenticated, service_role;
grant execute on function public.device_pair(text, text, text, text, text) to anon;
grant execute on function public.device_heartbeat(uuid, text, text, text, int, text, text, text) to anon;
grant execute on function public.device_event(uuid, text, text, text, text, int, text, text) to anon;
grant execute on function public.device_snapshot(uuid, text, text, int, int, text, text) to anon;
grant execute on function public.device_command_ack(uuid, text, uuid, boolean, text) to anon;
grant execute on function public.device_status(uuid, text) to anon;
revoke execute on function public.billing_apply_subscription(uuid, text, text, text, text, timestamptz) from authenticated;
revoke execute on function public.billing_record_invoice(uuid, int, text, text, text, timestamptz) from authenticated;
revoke execute on function app.apply_retention(uuid) from authenticated;
revoke execute on function app.apply_retention_all() from authenticated;
-- Future functions follow the same default.
alter default privileges in schema public revoke execute on functions from public, anon;
