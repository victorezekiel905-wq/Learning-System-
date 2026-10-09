-- 0990: class teachers and subject teachers.
--
-- * A class has one class teacher (classes.teacher_id, plus any co-teachers)
--   and subject teachers (class_subjects: Mathematics -> Mr Bello). The class
--   teacher or a school admin assigns them.
-- * A subject teacher sees the class and its students, teaches live lessons to
--   it, and sees results for their own subject only. Looking after accounts,
--   parent codes and promotion stay with the class teacher and admins.
-- * A class teacher sees every subject for their class's students; school
--   admins see every class.
-- * A result's subject: the lesson's subject, else the subject the session's
--   teacher teaches in that class, else the class's subject or name.
-- * Parents can write to each subject teacher as well as the class teacher.

create table if not exists public.class_subjects (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null,
  class_id    uuid not null,
  teacher_id  uuid not null,
  subject     text not null check (length(btrim(subject)) between 1 and 60),
  created_at  timestamptz not null default now(),
  foreign key (class_id, tenant_id) references public.classes(id, tenant_id) on delete cascade,
  foreign key (teacher_id, tenant_id) references public.users(id, tenant_id) on delete cascade
);
create unique index if not exists class_subjects_uidx on public.class_subjects(class_id, lower(subject));
create index if not exists class_subjects_teacher_idx on public.class_subjects(teacher_id);
create index if not exists class_subjects_tenant_idx on public.class_subjects(tenant_id);
alter table public.class_subjects enable row level security;
revoke all on public.class_subjects from anon;
revoke insert, update, delete on public.class_subjects from authenticated;
grant select on public.class_subjects to authenticated;
drop policy if exists class_subjects_read on public.class_subjects;
create policy class_subjects_read on public.class_subjects for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (teacher_id = (select auth.uid()) or app.can_manage_class(class_id) or app.in_class(class_id)));

create or replace function app.is_subject_teacher(p_class uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.class_subjects where class_id = p_class and teacher_id = auth.uid())
$$;

/** Teaches this class at all: class teacher, co-teacher, school admin, or subject teacher. */
create or replace function app.can_teach_class(p_class uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.can_manage_class(p_class) or app.is_subject_teacher(p_class)
$$;

/** The subject a result counts under (see the header). */
create or replace function app.row_subject(p_class uuid, p_teacher uuid, p_lesson_subject text, p_class_subject text, p_class_name text)
returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select cs.subject from public.class_subjects cs
      where cs.class_id = p_class and cs.teacher_id = p_teacher and lower(cs.subject) = lower(btrim(p_lesson_subject)) limit 1),
    nullif(btrim(p_lesson_subject), ''),
    (select cs.subject from public.class_subjects cs where cs.class_id = p_class and cs.teacher_id = p_teacher order by cs.subject limit 1),
    nullif(btrim(p_class_subject), ''), p_class_name, 'Other lessons')
$$;

/** Is this subject, in this class, one the teacher teaches there? */
create or replace function app.subject_visible(p_class uuid, p_subject text, p_teacher uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.class_subjects cs
                  where cs.class_id = p_class and cs.teacher_id = p_teacher and lower(cs.subject) = lower(p_subject))
$$;
revoke execute on function app.row_subject(uuid, uuid, text, text, text), app.subject_visible(uuid, text, uuid) from public, anon;

-- Subject teachers see the classes they teach, and their students.
drop policy if exists classes_read on public.classes;
create policy classes_read on public.classes for select to authenticated
  using (tenant_id = (select app.tenant_id())
         and ((select app.is_admin()) or (select app.is_it())
              or teacher_id = (select auth.uid()) or app.in_class(id) or app.is_subject_teacher(id)));
drop policy if exists class_members_read on public.class_members;
create policy class_members_read on public.class_members for select to authenticated
  using (tenant_id = (select app.tenant_id())
         and (user_id = (select auth.uid()) or app.can_manage_class(class_id) or app.is_subject_teacher(class_id) or (select app.is_it())
              or (role = 'teacher' and app.in_class(class_id))));

/** Class teacher or school admin: who teaches which subject in this class. */
create or replace function public.set_class_subject(p_class uuid, p_subject text, p_teacher uuid) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare v_c public.classes; v_id uuid;
begin
  select * into v_c from public.classes where id = p_class;
  if v_c.id is null or not app.can_manage_class(p_class) then raise exception 'Class not found.' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.users where id = p_teacher and tenant_id = v_c.tenant_id and role in ('teacher', 'school_admin') and status = 'active') then
    raise exception 'Choose a teacher of your school.' using errcode = '22023';
  end if;
  insert into public.class_subjects (tenant_id, class_id, teacher_id, subject) values (v_c.tenant_id, p_class, p_teacher, btrim(p_subject))
    on conflict (class_id, lower(subject)) do update set teacher_id = excluded.teacher_id
    returning id into v_id;
  perform app.audit('class.subject_teacher', 'class', p_class::text, jsonb_build_object('subject', btrim(p_subject), 'teacher', p_teacher));
  return v_id;
end$$;

create or replace function public.remove_class_subject(p_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v public.class_subjects;
begin
  select * into v from public.class_subjects where id = p_id;
  if v.id is null or not app.can_manage_class(v.class_id) then raise exception 'Not found.' using errcode = 'P0002'; end if;
  delete from public.class_subjects where id = p_id;
  perform app.audit('class.subject_teacher_removed', 'class', v.class_id::text, jsonb_build_object('subject', v.subject));
end$$;

/** The subject teachers of a class, for the class page. */
create or replace function public.class_subject_teachers(p_class uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', cs.id, 'subject', cs.subject, 'teacher_id', cs.teacher_id, 'teacher', u.full_name)
           order by cs.subject), '[]'::jsonb)
    from public.class_subjects cs join public.users u on u.id = cs.teacher_id
   where cs.class_id = p_class and app.can_teach_class(p_class)
$$;

drop function if exists public.send_parent_feedback(uuid, uuid, text);

create or replace function app.progress_answers(p_student uuid, p_from timestamptz, p_to timestamptz, p_teacher uuid default null)
returns table (at timestamptz, session_id uuid, subject text, topic text, is_correct boolean)
language sql stable security definer set search_path = '' as $$
  select qa.answered_at, t.session_id,
         app.row_subject(c.id, s.teacher_id, l.subject, c.subject, c.name),
         coalesce(nullif(btrim(q.topic), ''), l.title, a.title),
         qa.is_correct
    from public.quiz_attempts t
    join public.quiz_answers qa on qa.attempt_id = t.id
    join public.questions q on q.id = qa.question_id
    join public.activities a on a.id = t.activity_id
    left join public.lessons l on l.id = a.lesson_id
    left join public.class_sessions s on s.id = t.session_id
    left join public.classes c on c.id = s.class_id
   where t.student_id = p_student and qa.answered_at >= p_from and qa.answered_at < p_to
     -- A teacher sees their own lessons, every subject of a class they are class teacher of,
     -- and their own subject in a class they teach as a subject teacher.
     and (p_teacher is null or s.teacher_id = p_teacher or app.can_manage_class(s.class_id)
          or app.subject_visible(s.class_id, app.row_subject(c.id, s.teacher_id, l.subject, c.subject, c.name), p_teacher)
          or (t.session_id is null and a.owner_id = p_teacher))
$$;

create or replace function app.progress_lessons(p_student uuid, p_from timestamptz, p_to timestamptz, p_teacher uuid default null)
returns table (session_id uuid, title text, subject text, started_at timestamptz, attended boolean, points int)
language sql stable security definer set search_path = '' as $$
  select s.id, s.title,
         app.row_subject(c.id, s.teacher_id, l.subject, c.subject, c.name),
         s.started_at, p.user_id is not null, coalesce(p.total_score, 0)
    from public.class_sessions s
    left join public.lessons l on l.id = s.lesson_id
    left join public.classes c on c.id = s.class_id
    left join public.session_participants p on p.session_id = s.id and p.user_id = p_student
   where s.tenant_id = (select u.tenant_id from public.users u where u.id = p_student)
     and s.started_at >= p_from and s.started_at < p_to
     and (p_teacher is null or s.teacher_id = p_teacher or app.can_manage_class(s.class_id)
          or app.subject_visible(s.class_id, app.row_subject(c.id, s.teacher_id, l.subject, c.subject, c.name), p_teacher))
     and (p.user_id is not null
          or exists (select 1 from public.class_members m where m.class_id = s.class_id and m.user_id = p_student and m.role = 'student'))
$$;

create or replace function public.school_progress(p_period text default 'term', p_date date default null, p_class uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_tenant uuid := app.tenant_id();
  v_tz text; v_today date; v_day date; v_b record; v_from timestamptz; v_to timestamptz;
  v_admin boolean := app.is_admin();
  v_scope uuid;   -- a subject teacher: only their own subjects in this class
begin
  -- School admins: the whole school or any class. A class teacher: their class, every subject.
  -- A subject teacher: their class, their own subjects only.
  if v_tenant is null or not (v_admin or (p_class is not null and app.can_teach_class(p_class))) then
    raise exception 'Only school admins can see this.' using errcode = '42501';
  end if;
  if not v_admin and not app.can_manage_class(p_class) then v_scope := auth.uid(); end if;
  if p_class is not null and not exists (select 1 from public.classes where id = p_class and tenant_id = v_tenant) then
    raise exception 'Class not found.' using errcode = 'P0002';
  end if;
  select coalesce(timezone, 'UTC') into v_tz from public.tenants where id = v_tenant;
  v_today := (now() at time zone v_tz)::date;
  v_day := coalesce(p_date, v_today);
  select * into v_b from app.period_bounds(v_tenant, p_period, v_day);
  if v_b.starts is null then
    return jsonb_build_object('period', p_period, 'date', v_day, 'needs_terms', true);
  end if;
  v_from := v_b.starts::timestamp at time zone v_tz;
  v_to := v_b.ends::timestamp at time zone v_tz;

  return (
    with pupils as (
      select u.id, u.full_name from public.users u
       where u.tenant_id = v_tenant and u.role = 'student' and u.status = 'active'
         and (p_class is null or exists (select 1 from public.class_members m where m.class_id = p_class and m.user_id = u.id and m.role = 'student'))),
    ans as (
      select t.student_id, qa.is_correct,
             app.row_subject(c.id, s.teacher_id, l.subject, c.subject, c.name) as subject,
             coalesce(nullif(btrim(q.topic), ''), l.title, a.title) as topic
        from public.quiz_attempts t
        join pupils pu on pu.id = t.student_id
        join public.quiz_answers qa on qa.attempt_id = t.id
        join public.questions q on q.id = qa.question_id
        join public.activities a on a.id = t.activity_id
        left join public.lessons l on l.id = a.lesson_id
        left join public.class_sessions s on s.id = t.session_id
        left join public.classes c on c.id = s.class_id
       where t.tenant_id = v_tenant and qa.answered_at >= v_from and qa.answered_at < v_to
         and (v_scope is null or s.teacher_id = v_scope
              or app.subject_visible(s.class_id, app.row_subject(c.id, s.teacher_id, l.subject, c.subject, c.name), v_scope))),
    per_topic as (
      select subject, topic, count(*) as answers, count(is_correct) as graded,
             round(100.0 * count(*) filter (where is_correct) / nullif(count(is_correct), 0)) as accuracy,
             count(distinct student_id) as pupils
        from ans group by subject, topic),
    per_pupil_topic as (
      select student_id, subject, topic, round(100.0 * count(*) filter (where is_correct) / nullif(count(is_correct), 0)) as accuracy
        from ans group by student_id, subject, topic having count(is_correct) >= 2),
    per_pupil as (
      select a.student_id, count(*) as answers, round(100.0 * count(*) filter (where a.is_correct) / nullif(count(a.is_correct), 0)) as accuracy
        from ans a group by a.student_id)
    select jsonb_build_object(
      'period', p_period, 'date', v_day, 'today', v_today, 'needs_terms', false, 'label', v_b.label, 'from', v_b.starts, 'to', v_b.ends - 1,
      'prev_date', v_b.starts - 1, 'next_date', case when v_b.ends <= v_today then v_b.ends end,
      'classes', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name) order by c.name), '[]'::jsonb)
                    from public.classes c where c.tenant_id = v_tenant and c.archived_at is null and (v_admin or c.id = p_class)),
      'scope', case when v_admin then 'school' when v_scope is null then 'class' else 'subject' end,
      'summary', jsonb_build_object(
        'pupils', (select count(*) from pupils), 'active', (select count(distinct student_id) from ans),
        'answers', (select count(*) from ans),
        'accuracy', (select round(100.0 * count(*) filter (where is_correct) / nullif(count(is_correct), 0)) from ans)),
      'subjects', (select coalesce(jsonb_agg(jsonb_build_object(
          'subject', sb.subject, 'answers', sb.answers, 'accuracy', sb.accuracy, 'pupils', sb.pupils,
          'topics', (select coalesce(jsonb_agg(jsonb_build_object('topic', t.topic, 'answers', t.answers, 'accuracy', t.accuracy, 'pupils', t.pupils,
                       'struggling', (select count(*) from per_pupil_topic x where x.subject = t.subject and x.topic = t.topic and x.accuracy < 50))
                       order by t.accuracy asc nulls last, t.answers desc), '[]'::jsonb)
                     from per_topic t where t.subject = sb.subject))
          order by sb.answers desc), '[]'::jsonb)
        from (select subject, count(*) as answers, count(distinct student_id) as pupils,
                     round(100.0 * count(*) filter (where is_correct) / nullif(count(is_correct), 0)) as accuracy
                from ans group by subject) sb),
      'hardest', (select coalesce(jsonb_agg(jsonb_build_object('subject', t.subject, 'topic', t.topic, 'answers', t.answers,
                     'accuracy', t.accuracy, 'pupils', t.pupils,
                     'struggling', (select count(*) from per_pupil_topic x where x.subject = t.subject and x.topic = t.topic and x.accuracy < 50))
                     order by t.accuracy asc, t.answers desc), '[]'::jsonb)
                    from (select * from per_topic where graded >= 5 and accuracy < 60 order by accuracy asc, answers desc limit 10) t),
      'pupils_needing_help', (select coalesce(jsonb_agg(jsonb_build_object('student_id', pp.student_id, 'name', u.full_name,
                     'answers', pp.answers, 'accuracy', pp.accuracy,
                     'weakest', (select jsonb_build_object('subject', x.subject, 'topic', x.topic, 'accuracy', x.accuracy)
                                   from per_pupil_topic x where x.student_id = pp.student_id order by x.accuracy asc limit 1),
                     'classes', (select coalesce(jsonb_agg(c.name order by c.name), '[]'::jsonb) from public.class_members m
                                   join public.classes c on c.id = m.class_id where m.user_id = pp.student_id and m.role = 'student'))
                     order by pp.accuracy asc, pp.answers desc), '[]'::jsonb)
                    from (select * from per_pupil where answers >= 5 and accuracy < 50 order by accuracy asc limit 30) pp
                    join public.users u on u.id = pp.student_id),
      'feedback', (select jsonb_build_object('total', count(*), 'unanswered', count(*) filter (where reply is null))
                     from public.parent_feedback where tenant_id = v_tenant and created_at >= v_from and created_at < v_to
                       and (v_admin or teacher_id = auth.uid())))
  );
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

create or replace function public.my_teaching_classes() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'subject', c.subject,
           'students', (select count(*) from public.class_members m where m.class_id = c.id and m.role = 'student'))
         order by c.name), '[]'::jsonb)
  from public.classes c where c.archived_at is null and app.can_teach_class(c.id)
$$;

create or replace function public.class_access(p_class uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('manage', app.can_manage_class(p_class), 'member', app.in_class(p_class),
                            'teach', app.can_teach_class(p_class),
                            'subjects', (select coalesce(jsonb_agg(cs.subject order by cs.subject), '[]'::jsonb) from public.class_subjects cs
                                          where cs.class_id = p_class and cs.teacher_id = auth.uid()))
$$;

create or replace function app.teaches_student(p_student uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.class_members m
    where m.user_id = p_student and m.role = 'student' and app.can_teach_class(m.class_id)
  )
$$;

create or replace function app.can_manage_student(p_student uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.class_members m
                 where m.user_id = p_student and m.role = 'student' and app.can_manage_class(m.class_id))
      or (app.is_admin() and exists (select 1 from public.users u where u.id = p_student and u.role = 'student' and u.tenant_id = app.tenant_id()))
$$;

create or replace function public.new_parent_code(p_student uuid) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare v_i public.invites;
begin
  if not (app.can_manage_student(p_student)
          or (app.is_admin() and exists (select 1 from public.users where id = p_student and role = 'student' and tenant_id = app.tenant_id()))) then
    raise exception 'Student not found.' using errcode = 'P0002';
  end if;
  update public.invites set revoked_at = now() where student_id = p_student and standing and revoked_at is null;
  v_i := app.parent_code_for(p_student);
  perform app.audit('parent_code.renewed', 'user', p_student::text, '{}'::jsonb);
  return v_i.code;
end$$;

create or replace function public.feedback_targets(p_student uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  -- The class teacher of each of the child's classes, and each subject teacher there.
  select coalesce(jsonb_agg(jsonb_build_object('class_id', x.class_id, 'subject', x.subject, 'class', x.class, 'teacher_id', x.teacher_id, 'teacher', x.teacher)
                            order by x.class, x.subject), '[]'::jsonb)
    from (
      select c.id as class_id, coalesce(nullif(btrim(c.subject), ''), 'Class teacher') as subject, c.name as class, t.id as teacher_id, t.full_name as teacher
        from public.class_members m join public.classes c on c.id = m.class_id join public.users t on t.id = c.teacher_id
       where m.user_id = p_student and m.role = 'student' and c.archived_at is null
      union all
      select c.id, cs.subject, c.name, t.id, t.full_name
        from public.class_members m join public.classes c on c.id = m.class_id
        join public.class_subjects cs on cs.class_id = c.id join public.users t on t.id = cs.teacher_id
       where m.user_id = p_student and m.role = 'student' and c.archived_at is null) x
   where app.is_parent_of(p_student)
$$;

create or replace function public.send_parent_feedback(p_student uuid, p_class uuid, p_body text, p_teacher uuid default null) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare v_me public.users := app.me(); v_c public.classes; v_id uuid; v_child text; v_teacher uuid; v_subject text;
begin
  if v_me.role <> 'parent' or not app.is_parent_of(p_student) then raise exception 'Not your child.' using errcode = '42501'; end if;
  select c.* into v_c from public.classes c join public.class_members m on m.class_id = c.id
   where c.id = p_class and m.user_id = p_student and m.role = 'student';
  if v_c.id is null then raise exception 'That class isn''t one of your child''s.' using errcode = 'P0002'; end if;
  -- To the class teacher, or to one of the class's subject teachers.
  v_teacher := coalesce(p_teacher, v_c.teacher_id);
  if v_teacher = v_c.teacher_id then
    v_subject := coalesce(nullif(btrim(v_c.subject), ''), v_c.name);
  else
    select cs.subject into v_subject from public.class_subjects cs where cs.class_id = v_c.id and cs.teacher_id = v_teacher order by cs.subject limit 1;
    if v_subject is null then raise exception 'That teacher doesn''t teach this class.' using errcode = 'P0002'; end if;
  end if;
  if (select count(*) from public.parent_feedback where parent_id = v_me.id and created_at > now() - interval '1 day') >= 20 then
    raise exception 'You''ve sent a lot of feedback today. Please try again tomorrow.' using errcode = 'P0001';
  end if;
  insert into public.parent_feedback (tenant_id, student_id, parent_id, teacher_id, class_id, subject, body)
    values (v_me.tenant_id, p_student, v_me.id, v_teacher, v_c.id, v_subject, btrim(p_body))
    returning id into v_id;
  select full_name into v_child from public.users where id = p_student;
  perform app.notify(v_teacher, 'parent_feedback', 'Feedback from ' || v_me.full_name, 'About ' || v_child || ' in ' || v_c.name,
                     '/teacher/feedback', 'info', jsonb_build_object('feedback_id', v_id));
  return v_id;
end$$;

revoke execute on function public.set_class_subject(uuid, text, uuid), public.remove_class_subject(uuid), public.class_subject_teachers(uuid),
  public.send_parent_feedback(uuid, uuid, text, uuid) from public, anon;
grant execute on function public.set_class_subject(uuid, text, uuid), public.remove_class_subject(uuid), public.class_subject_teachers(uuid),
  public.send_parent_feedback(uuid, uuid, text, uuid) to authenticated;

create or replace function public.health() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('ok', true, 'db_time', now(), 'schema', '0990')
$$;
