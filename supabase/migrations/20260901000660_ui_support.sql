-- =============================================================================
-- SwiftCipher — 0660 small read helpers used by the web UI
-- =============================================================================

create or replace function public.class_access(p_class uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('manage', app.can_manage_class(p_class), 'member', app.in_class(p_class))
$$;

-- Classes the caller can teach (for pickers), with student counts.
create or replace function public.my_teaching_classes() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'subject', c.subject,
           'students', (select count(*) from public.class_members m where m.class_id = c.id and m.role = 'student'))
         order by c.name), '[]'::jsonb)
  from public.classes c where c.archived_at is null and app.can_manage_class(c.id)
$$;

-- Student home: classes, live sessions, open games, assignments, feedback.
create or replace function public.student_home() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_me public.users := app.me();
begin
  return jsonb_build_object(
    'classes', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'subject', c.subject,
                  'teacher', (select full_name from public.users where id = c.teacher_id), 'teacher_id', c.teacher_id)
                  order by c.name), '[]'::jsonb)
                from public.class_members m join public.classes c on c.id = m.class_id
                where m.user_id = v_me.id and m.role = 'student' and c.archived_at is null),
    'live', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'title', s.title, 'class', c.name,
               'environment_active', s.environment_active, 'started_at', s.started_at)), '[]'::jsonb)
             from public.class_sessions s join public.classes c on c.id = s.class_id
             where s.status = 'live' and app.in_class(s.class_id)),
    'games', (select coalesce(jsonb_agg(jsonb_build_object('id', g.id, 'title', g.title, 'join_code', g.join_code,
               'status', g.status, 'class', c.name)), '[]'::jsonb)
              from public.game_sessions g join public.classes c on c.id = g.class_id
              where g.status <> 'ended' and app.in_class(g.class_id)),
    'assignments', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'title', a.title, 'due_at', a.due_at,
                      'class', c.name, 'activity_id', a.activity_id, 'points_possible', a.points_possible,
                      'submitted', exists (select 1 from public.submissions s where s.assignment_id = a.id and s.student_id = v_me.id),
                      'late_allowed', a.allow_late) order by a.due_at nulls last), '[]'::jsonb)
                    from public.assignments a join public.classes c on c.id = a.class_id
                    where a.status = 'published' and app.in_class(a.class_id)),
    'feedback', (select coalesce(jsonb_agg(x order by x ->> 'at' desc), '[]'::jsonb) from (
        select jsonb_build_object('kind', 'grade', 'title', a.title, 'score', g.score, 'out_of', a.points_possible,
               'feedback', g.feedback, 'at', g.released_at) x
        from public.grades g join public.submissions s on s.id = g.submission_id join public.assignments a on a.id = s.assignment_id
        where s.student_id = v_me.id and g.released_at is not null
        union all
        select jsonb_build_object('kind', 'review', 'title', act.title, 'score', qa.manual_score, 'out_of', q.points,
               'feedback', qa.feedback, 'at', qa.reviewed_at)
        from public.quiz_answers qa join public.quiz_attempts t on t.id = qa.attempt_id
        join public.activities act on act.id = t.activity_id join public.questions q on q.id = qa.question_id
        where t.student_id = v_me.id and qa.status = 'reviewed'
        limit 20) f),
    'scores', (select coalesce(jsonb_agg(jsonb_build_object('activity', act.title, 'score', t.score, 'max', t.max_score,
                 'status', t.status, 'at', t.submitted_at) order by t.submitted_at desc), '[]'::jsonb)
               from (select * from public.quiz_attempts where student_id = v_me.id and status <> 'in_progress'
                     order by submitted_at desc limit 10) t join public.activities act on act.id = t.activity_id),
    'devices', (select count(*) from public.devices where student_id = v_me.id and status = 'active'));
end$$;

revoke execute on function public.class_access(uuid), public.my_teaching_classes(), public.student_home() from public, anon;
grant execute on function public.class_access(uuid), public.my_teaching_classes(), public.student_home() to authenticated;
