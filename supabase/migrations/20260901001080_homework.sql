-- 1080: homework with a due date.
--
-- A teacher sets a lesson as homework for one class with a due date. It is a
-- student-paced lesson (class_sessions.is_homework, due_at): students work through
-- it at home in the usual lesson player, answers are scored as in class, and it
-- feeds progress reports, parent reports and the lesson report like any lesson.
-- It runs alongside live lessons (only live lessons are one per class), never
-- shows as "live", and closes at its due date: on any student's activity, every
-- minute where pg_cron is on, and in hourly maintenance.

alter table public.class_sessions
  add column if not exists is_homework boolean not null default false,
  add column if not exists due_at timestamptz;

drop index if exists public.class_sessions_one_live_per_class;
create unique index if not exists class_sessions_one_live_per_class on public.class_sessions(class_id) where status = 'live' and not is_homework;
create index if not exists class_sessions_homework_idx on public.class_sessions(class_id, due_at) where is_homework;

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
  if p_class is not null and not app.can_teach_class(p_class) then raise exception 'Not your class.' using errcode = '42501'; end if;
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
  -- Homework (1080) runs alongside: only a live lesson blocks another.
  if p_class is not null and exists (select 1 from public.class_sessions where class_id = p_class and status = 'live' and not is_homework) then
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

/** Teacher: set a lesson as homework for a class, due at p_due. Returns the homework (a session). */
create or replace function public.set_homework(p_class uuid, p_lesson uuid, p_due timestamptz, p_title text default null) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me public.users := app.me();
  v_l  public.lessons;
  v_s  public.class_sessions;
begin
  if p_class is null or not app.can_teach_class(p_class) then raise exception 'Choose one of your classes.' using errcode = '42501'; end if;
  select * into v_l from public.lessons where id = p_lesson;
  if v_l.id is null or not app.can_view_lesson(p_lesson) then raise exception 'Lesson not found.' using errcode = 'P0002'; end if;
  if p_due is null or p_due < now() + interval '10 minutes' then raise exception 'Choose a due date in the future.' using errcode = '22023'; end if;
  if p_due > now() + interval '90 days' then raise exception 'Choose a due date within the next 90 days.' using errcode = '22023'; end if;
  if not exists (select 1 from public.lesson_slides where lesson_id = p_lesson) then raise exception 'This lesson has no slides yet.' using errcode = 'P0001'; end if;

  insert into public.class_sessions (tenant_id, class_id, teacher_id, lesson_id, lesson_version, title, mode, join_code,
                                     status, phase, started_at, lockdown, is_homework, due_at)
    values (v_me.tenant_id, p_class, v_me.id, p_lesson, v_l.current_version, coalesce(nullif(btrim(p_title), ''), v_l.title),
            'student_paced', app.unique_code(6, 'class_sessions'), 'live', 'active', now(), false, true, p_due)
    returning * into v_s;
  perform app.audit('homework.set', 'class_session', v_s.id::text, jsonb_build_object('class_id', p_class, 'lesson_id', p_lesson, 'due_at', p_due));
  perform app.notify(m.user_id, 'homework_set', 'Homework: ' || v_s.title,
                     'Due ' || to_char(p_due at time zone coalesce((select timezone from public.tenants where id = v_me.tenant_id), 'UTC'), 'Dy DD Mon, HH24:MI'),
                     '/student/live/' || v_s.id, 'info', jsonb_build_object('session_id', v_s.id))
  from public.class_members m where m.class_id = p_class and m.role = 'student';
  return to_jsonb(v_s);
end$$;

/** Teacher: move an open homework's due date. */
create or replace function public.set_homework_due(p_session uuid, p_due timestamptz) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_s public.class_sessions;
begin
  select * into v_s from public.class_sessions where id = p_session and is_homework;
  if v_s.id is null or not app.can_manage_session(p_session) then raise exception 'Homework not found.' using errcode = 'P0002'; end if;
  if v_s.status <> 'live' then raise exception 'This homework has closed. Set it again to give more time.' using errcode = 'P0001'; end if;
  if p_due is null or p_due < now() + interval '10 minutes' or p_due > now() + interval '90 days' then
    raise exception 'Choose a due date between now and 90 days from now.' using errcode = '22023';
  end if;
  update public.class_sessions set due_at = p_due where id = p_session;
end$$;

/** Students: their homework, open and recently closed, with how far they have got. */
create or replace function public.my_homework() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id, 'title', s.title, 'class', c.name, 'due_at', s.due_at, 'open', s.status = 'live',
           'questions', (select count(*) from public.questions q join public.activities a on a.id = q.activity_id where a.lesson_id = s.lesson_id),
           'answered', (select count(distinct qa.question_id) from public.quiz_answers qa join public.quiz_attempts t on t.id = qa.attempt_id
                         where t.session_id = s.id and t.student_id = auth.uid()),
           'started', exists (select 1 from public.session_participants p where p.session_id = s.id and p.user_id = auth.uid()))
         order by (s.status = 'live') desc, s.due_at), '[]'::jsonb)
    from public.class_sessions s join public.classes c on c.id = s.class_id
   where s.is_homework and app.in_class(s.class_id)
     and (s.status = 'live' or s.due_at > now() - interval '14 days')
$$;

/** Teachers: homework they set (or the school's, for admins), with who has started and finished. */
create or replace function public.teacher_homework() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(x order by (x ->> 'open')::boolean desc, x ->> 'due_at' desc), '[]'::jsonb) from (
    select jsonb_build_object(
             'id', s.id, 'title', s.title, 'class', c.name, 'class_id', c.id, 'due_at', s.due_at, 'open', s.status = 'live',
             'students', (select count(*) from public.class_members m where m.class_id = s.class_id and m.role = 'student'),
             'started', (select count(*) from public.session_participants p where p.session_id = s.id and p.user_id <> s.teacher_id),
             'finished', (select count(*) from (
                            select t.student_id from public.quiz_attempts t join public.quiz_answers qa on qa.attempt_id = t.id
                             where t.session_id = s.id group by t.student_id
                            having count(distinct qa.question_id) >= greatest(1, (select count(*) from public.questions q join public.activities a on a.id = q.activity_id where a.lesson_id = s.lesson_id))) f)) x
      from public.class_sessions s join public.classes c on c.id = s.class_id
     where s.is_homework and s.tenant_id = app.tenant_id() and (s.teacher_id = auth.uid() or app.can_manage_class(s.class_id) or app.is_admin())
       and (s.status = 'live' or s.due_at > now() - interval '30 days')
     limit 100) h
$$;

revoke execute on function public.set_homework(uuid, uuid, timestamptz, text), public.set_homework_due(uuid, timestamptz),
  public.my_homework(), public.teacher_homework() from public, anon;
grant execute on function public.set_homework(uuid, uuid, timestamptz, text), public.set_homework_due(uuid, timestamptz),
  public.my_homework(), public.teacher_homework() to authenticated;

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
             where s.status = 'live' and not s.is_homework and app.in_class(s.class_id)),
    -- Homework (1080): open ones, and those that closed in the last two weeks.
    'homework', public.my_homework(),
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

/** Closes homework whose due date has passed. */
create or replace function app.end_due_homework() returns int
language plpgsql volatile security definer set search_path = '' as $$
declare r record; v_n int := 0;
begin
  for r in select id from public.class_sessions where is_homework and status = 'live' and due_at <= now() loop
    perform app.finish_session(r.id, 'homework_due'); v_n := v_n + 1;
  end loop;
  return v_n;
end$$;
revoke execute on function app.end_due_homework() from public, anon, authenticated;

-- Homework never ends for lack of a teacher or after 12 hours: only at its due date.
create or replace function app.end_abandoned_sessions() returns int
language plpgsql volatile security definer set search_path = '' as $$
declare r record; v_n int := 0;
begin
  for r in select s.* from public.class_sessions s
           where s.status = 'live' and not s.is_homework and s.started_at < now() - interval '12 hours'
             and not exists (select 1 from public.session_participants p where p.session_id = s.id
                             and p.last_seen_at > now() - interval '2 hours') loop
    perform app.finish_session(r.id, 'abandoned');
    v_n := v_n + 1;
  end loop;
  return v_n;
end$$;

create or replace function app.end_teacherless_sessions() returns int
language plpgsql volatile security definer set search_path = '' as $$
declare r public.class_sessions; v_n int := 0;
begin
  for r in select * from public.class_sessions s where s.status = 'live' and not s.is_homework loop
    if app.teacher_gone(r) then perform app.finish_session(r.id, 'teacher_left'); v_n := v_n + 1; end if;
  end loop;
  return v_n + app.end_due_homework();
end$$;

-- On a student's tick: the teacher has gone (teacher-paced), or the homework is past due.
create or replace function app.end_if_teacher_gone() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_s public.class_sessions;
begin
  select * into v_s from public.class_sessions where id = new.session_id;
  if v_s.id is null or v_s.status <> 'live' then return null; end if;
  if v_s.is_homework then
    if v_s.due_at <= now() then perform app.finish_session(v_s.id, 'homework_due'); end if;
  elsif app.teacher_gone(v_s) then
    perform app.finish_session(v_s.id, 'teacher_left');
  end if;
  return null;
end$$;

create or replace function public.health() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('ok', true, 'db_time', now(), 'schema', '1080')
$$;
