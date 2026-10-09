-- 0980: results with names stay with the activity's own teacher.
--
-- Outside a live lesson, activity_results returned every answer with the
-- student's name to any teacher who could view a published lesson, so a
-- colleague could read another teacher's students' answers. Now only the
-- activity's own teacher (or whoever may edit it) and the school's admins get
-- them. Students and parents never could, and a test now proves it for every
-- route to another child's data.

create or replace function public.activity_results(p_activity uuid, p_session uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_act public.activities;
begin
  select * into v_act from public.activities where id = p_activity;
  if v_act.id is null then raise exception 'Activity not found.' using errcode = 'P0002'; end if;
  if p_session is not null then
    if not app.can_manage_session(p_session) then
      -- Students may see anonymised aggregates when the teacher shares results.
      if not (app.in_session(p_session) and exists (select 1 from public.class_sessions s
              where s.id = p_session and s.responses_visible)) then
        raise exception 'Not your session.' using errcode = '42501';
      end if;
      return (select jsonb_build_object('questions', coalesce(jsonb_agg(jsonb_build_object(
                'question_id', q.id, 'prompt', q.prompt, 'kind', q.kind,
                'options', (select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'label', o.label,
                              -- Right answers only once the teacher has revealed them (0900).
                              'is_correct', case when exists (select 1 from public.class_sessions cs where cs.id = p_session
                                                               and cs.revealed_activity_id = p_activity) then o.is_correct end,
                              'count', (select count(*) from public.quiz_answers a join public.quiz_attempts t on t.id = a.attempt_id
                                        where a.question_id = q.id and t.session_id = p_session and a.response ->> 'option_id' = o.id::text))
                              order by o.position), '[]'::jsonb) from public.question_options o where o.question_id = q.id))
              order by q.position), '[]'::jsonb))
              from public.questions q where q.activity_id = p_activity);
    end if;
  -- Outside a live lesson, the full results (with names and written answers) are for the
  -- activity's own teacher and the school's admins only, not for colleagues browsing it.
  elsif not app.can_edit_activity(p_activity) then
    raise exception 'Not visible to you.' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'activity', jsonb_build_object('id', v_act.id, 'title', v_act.title, 'kind', v_act.kind),
    'attempts', (select count(*) from public.quiz_attempts t where t.activity_id = p_activity
                 and (p_session is null or t.session_id = p_session)),
    'submitted', (select count(*) from public.quiz_attempts t where t.activity_id = p_activity and t.status <> 'in_progress'
                  and (p_session is null or t.session_id = p_session)),
    'questions', (select coalesce(jsonb_agg(jsonb_build_object(
        'question_id', q.id, 'prompt', q.prompt, 'kind', q.kind, 'points', q.points,
        'responses', (select count(*) from public.quiz_answers a join public.quiz_attempts t on t.id = a.attempt_id
                      where a.question_id = q.id and (p_session is null or t.session_id = p_session)),
        'correct', (select count(*) from public.quiz_answers a join public.quiz_attempts t on t.id = a.attempt_id
                    where a.question_id = q.id and a.is_correct and (p_session is null or t.session_id = p_session)),
        'avg_elapsed_ms', (select round(avg(a.elapsed_ms)) from public.quiz_answers a join public.quiz_attempts t on t.id = a.attempt_id
                           where a.question_id = q.id and (p_session is null or t.session_id = p_session)),
        'options', (select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'label', o.label, 'is_correct', o.is_correct,
                      'count', (select count(*) from public.quiz_answers a join public.quiz_attempts t on t.id = a.attempt_id
                                where a.question_id = q.id and (p_session is null or t.session_id = p_session)
                                  and (a.response ->> 'option_id' = o.id::text or a.response -> 'option_ids' ? o.id::text)))
                      order by o.position), '[]'::jsonb) from public.question_options o where o.question_id = q.id),
        'text_responses', (select coalesce(jsonb_agg(jsonb_build_object('student', u.full_name, 'response', a.response,
                             'status', a.status, 'answer_id', a.id) order by a.answered_at), '[]'::jsonb)
                           from public.quiz_answers a join public.quiz_attempts t on t.id = a.attempt_id
                           join public.users u on u.id = t.student_id
                           where a.question_id = q.id and q.kind in ('open','short','fill_blank','draw','code','file')
                             and (p_session is null or t.session_id = p_session)))
        order by q.position, q.created_at), '[]'::jsonb)
      from public.questions q where q.activity_id = p_activity));
end$$;

create or replace function public.health() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('ok', true, 'db_time', now(), 'schema', '0980')
$$;
