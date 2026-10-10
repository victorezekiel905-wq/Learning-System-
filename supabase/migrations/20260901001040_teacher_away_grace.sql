-- 1040: kinder timings for "the teacher closed the lesson" (1020).
--
-- An iPad or phone pauses a page completely while the teacher uses another app
-- (a video, Keynote), so the teacher's "here" stops without the lesson being
-- closed. A lesson now ends:
--   * 1 minute after the teacher closed the tab (a slow refresh still comes back), or
--   * 10 minutes after the teacher's pages last said "here" (crash, no internet,
--     laptop shut, or another app for that long).

create or replace function app.teacher_gone(p_s public.class_sessions) returns boolean
language sql stable set search_path = '' as $$
  select p_s.status = 'live'
     and ((p_s.teacher_left_at is not null and p_s.teacher_left_at < now() - interval '1 minute')
          or coalesce(p_s.teacher_seen_at, p_s.started_at, p_s.created_at) < now() - interval '10 minutes')
$$;

create or replace function public.health() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('ok', true, 'db_time', now(), 'schema', '1040')
$$;
