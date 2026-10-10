-- 1050: student-paced lessons stay open when the teacher leaves.
--
-- In a teacher-paced lesson the teacher's screen leads, so the lesson ends when
-- the teacher closes it (1020, 1040). In a student-paced lesson students work
-- through the slides on their own, often while the teacher is elsewhere, so the
-- teacher leaving doesn't end it; the teacher ends it, or hourly maintenance does
-- after 12 hours (end_abandoned_sessions).

create or replace function app.teacher_gone(p_s public.class_sessions) returns boolean
language sql stable set search_path = '' as $$
  select p_s.status = 'live' and p_s.mode <> 'student_paced'
     and ((p_s.teacher_left_at is not null and p_s.teacher_left_at < now() - interval '1 minute')
          or coalesce(p_s.teacher_seen_at, p_s.started_at, p_s.created_at) < now() - interval '10 minutes')
$$;

create or replace function public.health() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('ok', true, 'db_time', now(), 'schema', '1050')
$$;
