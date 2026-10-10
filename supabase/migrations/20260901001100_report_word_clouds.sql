-- 1100: the lesson report lists word-cloud answers with the written answers (who wrote which words).

create or replace function public.session_report(p_session uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_s      public.class_sessions;
  v_mon    boolean;
  v_people jsonb;
  v_qs     jsonb;
begin
  select * into v_s from public.class_sessions where id = p_session;
  if v_s.id is null or not app.can_manage_session(v_s.id) then raise exception 'Session not found.' using errcode = 'P0002'; end if;
  select coalesce(monitoring_enabled, false) into v_mon from public.tenant_settings where tenant_id = v_s.tenant_id;

  -- "ans": everyone's answers in this lesson, one row per question answered.
  with ans as (select t.student_id as user_id, qa.question_id, qa.is_correct, qa.response, qa.response_ms
                from public.quiz_attempts t join public.quiz_answers qa on qa.attempt_id = t.id where t.session_id = p_session),
  per as (select user_id, count(*) as answered, count(*) filter (where is_correct) as correct, count(is_correct) as graded,
                 round(avg(response_ms) / 1000.0, 1) as avg_seconds from ans group by user_id),
  people as (
    select distinct on (x.user_id) x.user_id, x.guest, x.removed, x.display_name
      from (select cm.user_id, false as guest, false as removed, null::text as display_name, 1 as pref
              from public.class_members cm where cm.class_id = v_s.class_id and cm.role = 'student'
            union all
            select g.user_id, g.is_guest, g.removed_at is not null, g.display_name, 2
              from public.session_guests g where g.session_id = p_session) x
     order by x.user_id, x.pref),
  scored as (
    select pe.user_id, coalesce(pe.display_name, u.full_name) as name, pe.guest, pe.removed,
           p.user_id is not null as joined, coalesce(p.total_score, 0) as score, coalesce(p.best_streak, 0) as best_streak,
           coalesce(pr.answered, 0) as answered, coalesce(pr.correct, 0) as correct, coalesce(pr.graded, 0) as graded, pr.avg_seconds,
           case when v_mon then (select count(*) from public.environment_events e
                                 where e.class_session_id = p_session and e.student_id = pe.user_id and e.kind <> 'connection_lost') end as alerts
      from people pe
      join public.users u on u.id = pe.user_id
      left join public.session_participants p on p.session_id = p_session and p.user_id = pe.user_id
      left join per pr on pr.user_id = pe.user_id)
  select coalesce(jsonb_agg(jsonb_build_object(
           'student_id', s.user_id, 'name', s.name, 'guest', s.guest, 'removed', s.removed, 'joined', s.joined,
           'score', s.score, 'rank', case when s.joined then s.rk end, 'best_streak', s.best_streak,
           'answers', s.answered, 'correct', s.correct, 'graded', s.graded,
           'accuracy', case when s.graded > 0 then round(100.0 * s.correct / s.graded) end,
           'avg_seconds', s.avg_seconds, 'alerts', s.alerts)
         order by s.joined desc, s.rk nulls last, s.name), '[]'::jsonb)
    into v_people
    from (select sc.*, rank() over (partition by sc.joined order by sc.score desc) as rk from scored sc) s;

  with ans as (select t.student_id as user_id, qa.question_id, qa.is_correct, qa.response, qa.response_ms
                from public.quiz_attempts t join public.quiz_answers qa on qa.attempt_id = t.id where t.session_id = p_session),
  names as (select (x ->> 'student_id')::uuid as id, x ->> 'name' as name from jsonb_array_elements(v_people) x)
  select coalesce(jsonb_agg(q.j order by q.slide_pos, q.act_title, q.q_pos), '[]'::jsonb) into v_qs from (
    select coalesce((select min(sl.position) from public.lesson_slides sl where sl.lesson_id = v_s.lesson_id and sl.activity_id = act.id), 100000) as slide_pos,
           act.title as act_title, q.position as q_pos,
           jsonb_build_object(
             'question_id', q.id, 'activity_id', act.id, 'activity', act.title, 'prompt', q.prompt, 'kind', q.kind,
             'answered', (select count(*) from ans a where a.question_id = q.id),
             'correct', (select count(*) from ans a where a.question_id = q.id and a.is_correct),
             'accuracy', (select round(100.0 * count(*) filter (where a.is_correct) / nullif(count(a.is_correct), 0))
                          from ans a where a.question_id = q.id),
             'avg_seconds', (select round(avg(a.response_ms) / 1000.0, 1) from ans a where a.question_id = q.id),
             'options', (select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'label', o.label, 'is_correct', o.is_correct,
                            'count', (select count(*) from ans a where a.question_id = q.id
                                      and (a.response ->> 'option_id' = o.id::text or coalesce(a.response -> 'option_ids', '[]'::jsonb) ? o.id::text)))
                          order by o.position), '[]'::jsonb)
                         from public.question_options o where o.question_id = q.id),
             'missed_by', (select coalesce(jsonb_agg(p.name order by p.name), '[]'::jsonb)
                           from ans a
                           join names p on p.id = a.user_id
                           where a.question_id = q.id and a.is_correct = false),
             'written', case when q.kind in ('open', 'short', 'fill_blank', 'word_cloud') then
                          (select coalesce(jsonb_agg(jsonb_build_object('name', p.name, 'text', left(a.response ->> 'text', 500), 'is_correct', a.is_correct)
                                   order by p.name), '[]'::jsonb)
                             from ans a
                             join names p on p.id = a.user_id
                            where a.question_id = q.id and coalesce(a.response ->> 'text', '') <> '') end) as j
      from public.activities act
      join public.questions q on q.activity_id = act.id
     where exists (select 1 from public.quiz_attempts t where t.activity_id = act.id and t.session_id = p_session)) q;

  return jsonb_build_object(
    'version', 2,
    'session', jsonb_build_object('id', v_s.id, 'title', v_s.title, 'mode', v_s.mode, 'started_at', v_s.started_at, 'ended_at', v_s.ended_at,
                                  'minutes', round(extract(epoch from coalesce(v_s.ended_at, now()) - coalesce(v_s.started_at, v_s.created_at)) / 60),
                                  'lesson_title', (select title from public.lessons where id = v_s.lesson_id)),
    'class', (select jsonb_build_object('id', c.id, 'name', c.name) from public.classes c where c.id = v_s.class_id),
    'monitoring', v_mon,
    'enrolled', (select count(*) from public.class_members where class_id = v_s.class_id and role = 'student'),
    'joined', (select count(*) from jsonb_array_elements(v_people) x where (x ->> 'joined')::boolean),
    'guests', (select count(*) from jsonb_array_elements(v_people) x where (x ->> 'guest')::boolean),
    'accuracy', (select round(100.0 * sum((x ->> 'correct')::int) / nullif(sum((x ->> 'graded')::int), 0)) from jsonb_array_elements(v_people) x),
    'answers', (select coalesce(sum((x ->> 'answers')::int), 0) from jsonb_array_elements(v_people) x),
    'hands', (select count(*) from public.raise_hands where session_id = p_session),
    'commands', case when v_mon then (select count(*) from public.teacher_commands where class_session_id = p_session) end,
    'alerts', case when v_mon then (select coalesce(jsonb_object_agg(kind, n), '{}'::jsonb) from
                (select kind, count(*) n from public.environment_events where class_session_id = p_session group by kind) x) else '{}'::jsonb end,
    'activities', (select coalesce(jsonb_agg(jsonb_build_object('activity_id', a.id, 'title', a.title, 'kind', a.kind,
                     'attempts', (select count(*) from public.quiz_attempts t where t.activity_id = a.id and t.session_id = p_session),
                     'avg_percent', (select round(avg(100.0 * t.score / nullif(t.max_score, 0))) from public.quiz_attempts t
                                     where t.activity_id = a.id and t.session_id = p_session and t.status <> 'in_progress'))), '[]'::jsonb)
                   from public.activities a where exists (select 1 from public.quiz_attempts t where t.activity_id = a.id and t.session_id = p_session)),
    'questions', v_qs,
    'students', v_people);
end$$;

create or replace function public.health() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('ok', true, 'db_time', now(), 'schema', '1100')
$$;
