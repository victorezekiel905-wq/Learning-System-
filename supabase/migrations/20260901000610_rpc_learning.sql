-- =============================================================================
-- SwiftCipher — 0610 Studio + Assess RPCs
-- Students never read public.questions / question_options. Everything they
-- see passes through app.sanitize_question(); everything they submit is graded
-- here by app.grade_response().
-- =============================================================================

-- Deterministic shuffle key: same seed -> same order (reproducible attempts).
create or replace function app.shuffle_key(p_seed bigint, p_id text) returns text
language sql immutable set search_path = '' as $$
  select md5(p_seed::text || ':' || p_id)
$$;

create or replace function app.normalize_text(p text, p_case_sensitive boolean default false) returns text
language sql immutable set search_path = '' as $$
  select case when p_case_sensitive then regexp_replace(btrim(coalesce(p, '')), '\s+', ' ', 'g')
              else lower(regexp_replace(btrim(coalesce(p, '')), '\s+', ' ', 'g')) end
$$;

-- Public view of a question. Secret parts (answer_key, option.is_correct,
-- hidden tests) are dropped; order-revealing lists are always shuffled.
create or replace function app.sanitize_question(p_q public.questions, p_seed bigint, p_shuffle_options boolean)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_cfg     jsonb := coalesce(p_q.config, '{}'::jsonb);
  v_options jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'label', o.label)
                  order by case when p_shuffle_options and p_q.kind in ('mcq','multi_select','poll')
                                then app.shuffle_key(p_seed, o.id::text) else lpad(o.position::text, 6, '0') end), '[]'::jsonb)
    into v_options
  from public.question_options o where o.question_id = p_q.id;

  -- Lists whose stored order IS the answer must never leave in stored order.
  if p_q.kind = 'ordering' and v_cfg ? 'items' then
    v_cfg := jsonb_set(v_cfg, '{items}', (select coalesce(jsonb_agg(e order by app.shuffle_key(p_seed + 7, e ->> 'id')), '[]'::jsonb)
                                           from jsonb_array_elements(v_cfg -> 'items') e));
  end if;
  if p_q.kind = 'matching' and v_cfg ? 'right' then
    v_cfg := jsonb_set(v_cfg, '{right}', (select coalesce(jsonb_agg(e order by app.shuffle_key(p_seed + 11, e ->> 'id')), '[]'::jsonb)
                                           from jsonb_array_elements(v_cfg -> 'right') e));
  end if;
  if p_q.kind = 'categorize' and v_cfg ? 'items' then
    v_cfg := jsonb_set(v_cfg, '{items}', (select coalesce(jsonb_agg(e order by app.shuffle_key(p_seed + 13, e ->> 'id')), '[]'::jsonb)
                                           from jsonb_array_elements(v_cfg -> 'items') e));
  end if;
  v_cfg := v_cfg - 'hidden_tests';

  return jsonb_build_object(
    'id', p_q.id, 'kind', p_q.kind, 'prompt', p_q.prompt, 'media', p_q.media,
    'config', v_cfg, 'options', v_options, 'points', p_q.points);
end$$;

-- ---------------------------------------------------------------------------
-- Grading. Returns { is_correct, score, status }.
--   status: auto_graded | ungraded (polls, zero-point prompts) | pending_review
-- ---------------------------------------------------------------------------
create or replace function app.grade_response(p_q public.questions, p_response jsonb)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_key      jsonb := coalesce(p_q.answer_key, '{}'::jsonb);
  v_pts      numeric := p_q.points;
  v_correct  boolean;
  v_fraction numeric;
  v_total    int;
  v_hits     int;
  v_wrong    int;
  v_cs       boolean := coalesce((p_q.config ->> 'case_sensitive')::boolean, false);
begin
  if p_response is null or jsonb_typeof(p_response) <> 'object' then
    raise exception 'Response must be a JSON object.' using errcode = '22023';
  end if;

  case p_q.kind
  when 'poll' then
    if not exists (select 1 from public.question_options o
                   where o.question_id = p_q.id and o.id::text = p_response ->> 'option_id') then
      raise exception 'Pick one of the options.' using errcode = '22023';
    end if;
    return jsonb_build_object('is_correct', null, 'score', null, 'status', 'ungraded');

  when 'mcq', 'true_false' then
    if not exists (select 1 from public.question_options o
                   where o.question_id = p_q.id and o.id::text = p_response ->> 'option_id') then
      raise exception 'Pick one of the options.' using errcode = '22023';
    end if;
    select o.is_correct into v_correct from public.question_options o
     where o.question_id = p_q.id and o.id::text = p_response ->> 'option_id';
    return jsonb_build_object('is_correct', v_correct, 'score', case when v_correct then v_pts else 0 end,
                              'status', 'auto_graded');

  when 'multi_select' then
    if jsonb_typeof(p_response -> 'option_ids') <> 'array' then
      raise exception 'option_ids must be an array.' using errcode = '22023';
    end if;
    select count(*) filter (where o.is_correct),
           count(*) filter (where o.is_correct and p_response -> 'option_ids' ? o.id::text),
           count(*) filter (where not o.is_correct and p_response -> 'option_ids' ? o.id::text)
      into v_total, v_hits, v_wrong
    from public.question_options o where o.question_id = p_q.id;
    v_correct := v_hits = v_total and v_wrong = 0;
    v_fraction := case when coalesce((p_q.config ->> 'partial_credit')::boolean, false) and v_total > 0
                       then greatest(0, (v_hits - v_wrong)::numeric / v_total)
                       else case when v_correct then 1 else 0 end end;
    return jsonb_build_object('is_correct', v_correct, 'score', round(v_pts * v_fraction, 2), 'status', 'auto_graded');

  when 'fill_blank' then
    -- key: { "blanks": [["paris"], ["seine","the seine"]] } ; response: { "blanks": ["Paris","Seine"] }
    v_total := coalesce(jsonb_array_length(v_key -> 'blanks'), 0);
    if v_total = 0 then return jsonb_build_object('is_correct', null, 'score', null, 'status', 'pending_review'); end if;
    select count(*) into v_hits
    from generate_series(0, v_total - 1) i
    where exists (select 1 from jsonb_array_elements_text(v_key -> 'blanks' -> i) acc
                  where app.normalize_text(acc, v_cs) = app.normalize_text(p_response -> 'blanks' ->> i, v_cs));
    v_correct := v_hits = v_total;
    return jsonb_build_object('is_correct', v_correct, 'score', round(v_pts * v_hits / v_total, 2), 'status', 'auto_graded');

  when 'matching' then
    -- key: { "pairs": { "<leftId>": "<rightId>" } } ; response: { "pairs": {...} }
    select count(*), count(*) filter (where p_response -> 'pairs' ->> k.key = k.value)
      into v_total, v_hits
    from jsonb_each_text(coalesce(v_key -> 'pairs', '{}'::jsonb)) k;
    if v_total = 0 then return jsonb_build_object('is_correct', null, 'score', null, 'status', 'pending_review'); end if;
    v_correct := v_hits = v_total;
    return jsonb_build_object('is_correct', v_correct, 'score', round(v_pts * v_hits / v_total, 2), 'status', 'auto_graded');

  when 'ordering' then
    -- key: { "order": ["a","b","c"] } ; response: { "order": [...] }
    v_total := coalesce(jsonb_array_length(v_key -> 'order'), 0);
    if v_total = 0 then return jsonb_build_object('is_correct', null, 'score', null, 'status', 'pending_review'); end if;
    select count(*) into v_hits from generate_series(0, v_total - 1) i
     where (v_key -> 'order' ->> i) = (p_response -> 'order' ->> i);
    v_correct := v_hits = v_total;
    return jsonb_build_object('is_correct', v_correct, 'score', round(v_pts * v_hits / v_total, 2), 'status', 'auto_graded');

  when 'categorize' then
    -- key: { "placements": { "<itemId>": "<categoryId>" } }
    select count(*), count(*) filter (where p_response -> 'placements' ->> k.key = k.value)
      into v_total, v_hits
    from jsonb_each_text(coalesce(v_key -> 'placements', '{}'::jsonb)) k;
    if v_total = 0 then return jsonb_build_object('is_correct', null, 'score', null, 'status', 'pending_review'); end if;
    v_correct := v_hits = v_total;
    return jsonb_build_object('is_correct', v_correct, 'score', round(v_pts * v_hits / v_total, 2), 'status', 'auto_graded');

  else
    -- open, short, draw, file, code: a teacher decides (review queue).
    if v_pts = 0 then return jsonb_build_object('is_correct', null, 'score', null, 'status', 'ungraded'); end if;
    return jsonb_build_object('is_correct', null, 'score', null, 'status', 'pending_review');
  end case;
end$$;

-- Correct answer, revealed only when the activity's feedback setting allows.
create or replace function app.reveal_answer(p_q public.questions) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'correct_option_ids', (select coalesce(jsonb_agg(o.id), '[]'::jsonb) from public.question_options o
                           where o.question_id = p_q.id and o.is_correct),
    'answer_key', case when p_q.kind in ('fill_blank','matching','ordering','categorize') then p_q.answer_key else null end,
    'explanation', p_q.explanation)
$$;

-- ---------------------------------------------------------------------------
-- Lesson payload for a learner (no keys). Used by live sessions and shares.
-- ---------------------------------------------------------------------------
create or replace function app.lesson_payload(p_lesson uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'lesson', jsonb_build_object('id', l.id, 'title', l.title, 'description', l.description,
                                 'subject', l.subject, 'version', l.current_version),
    'slides', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', s.id, 'position', s.position, 'kind', s.kind, 'content', s.content,
               'activity', case when a.id is null then null else jsonb_build_object(
                  'id', a.id, 'kind', a.kind, 'title', a.title, 'instructions', a.instructions,
                  'settings', a.settings - 'rubric_id') end,
               'checkpoints', (select coalesce(jsonb_agg(jsonb_build_object(
                                  'id', vc.id, 't_seconds', vc.t_seconds, 'required', vc.required,
                                  'question_id', vc.question_id, 'activity_id', q.activity_id)
                                  order by vc.t_seconds), '[]'::jsonb)
                               from public.video_checkpoints vc join public.questions q on q.id = vc.question_id
                               where vc.slide_id = s.id))
             order by s.position)
      from public.lesson_slides s left join public.activities a on a.id = s.activity_id
      where s.lesson_id = l.id), '[]'::jsonb))
  from public.lessons l where l.id = p_lesson
$$;

create or replace function public.publish_lesson(p_lesson uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_lesson public.lessons; v_snapshot jsonb;
begin
  if not app.can_edit_lesson(p_lesson) then raise exception 'You cannot publish this lesson.' using errcode = '42501'; end if;
  if not exists (select 1 from public.lesson_slides where lesson_id = p_lesson) then
    raise exception 'Add at least one slide before publishing.' using errcode = 'P0001';
  end if;
  update public.lessons set status = 'published', current_version = current_version + 1
   where id = p_lesson returning * into v_lesson;
  v_snapshot := app.lesson_payload(p_lesson) || jsonb_build_object(
    'questions', (select coalesce(jsonb_agg(to_jsonb(q) || jsonb_build_object('options',
                    (select coalesce(jsonb_agg(to_jsonb(o) order by o.position), '[]'::jsonb)
                     from public.question_options o where o.question_id = q.id))), '[]'::jsonb)
                  from public.questions q join public.activities a on a.id = q.activity_id
                  where a.lesson_id = p_lesson));
  insert into public.lesson_versions (tenant_id, lesson_id, version, snapshot, published_by)
    values (v_lesson.tenant_id, p_lesson, v_lesson.current_version, v_snapshot, auth.uid());
  perform app.audit('lesson.published', 'lesson', p_lesson::text, jsonb_build_object('version', v_lesson.current_version));
  return jsonb_build_object('id', p_lesson, 'version', v_lesson.current_version);
end$$;

create or replace function public.duplicate_lesson(p_lesson uuid, p_title text default null, p_as_template boolean default false)
returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me     public.users := app.me();
  v_src    public.lessons;
  v_new    uuid;
  v_map_a  jsonb := '{}'::jsonb;   -- old activity id -> new
  v_map_q  jsonb := '{}'::jsonb;   -- old question id -> new
  v_map_s  jsonb := '{}'::jsonb;   -- old slide id -> new
  r        record;
  v_id     uuid;
begin
  if not app.is_teacher() or not app.can_view_lesson(p_lesson) then
    raise exception 'You cannot copy this lesson.' using errcode = '42501';
  end if;
  select * into v_src from public.lessons where id = p_lesson;
  insert into public.lessons (tenant_id, owner_id, title, description, subject, grade_level, default_mode, is_template)
    values (v_me.tenant_id, v_me.id, coalesce(nullif(btrim(p_title), ''), left(v_src.title || ' (copy)', 200)),
            v_src.description, v_src.subject, v_src.grade_level, v_src.default_mode, p_as_template)
    returning id into v_new;

  for r in select * from public.activities where lesson_id = p_lesson loop
    insert into public.activities (tenant_id, lesson_id, owner_id, kind, title, instructions, settings)
      values (v_me.tenant_id, v_new, v_me.id, r.kind, r.title, r.instructions, r.settings) returning id into v_id;
    v_map_a := v_map_a || jsonb_build_object(r.id::text, v_id);
  end loop;

  for r in select q.* from public.questions q join public.activities a on a.id = q.activity_id where a.lesson_id = p_lesson loop
    insert into public.questions (tenant_id, activity_id, owner_id, kind, prompt, media, config, answer_key,
                                  explanation, points, position, tags, difficulty)
      values (v_me.tenant_id, (v_map_a ->> r.activity_id::text)::uuid, v_me.id, r.kind, r.prompt, r.media, r.config,
              r.answer_key, r.explanation, r.points, r.position, r.tags, r.difficulty)
      returning id into v_id;
    v_map_q := v_map_q || jsonb_build_object(r.id::text, v_id);
    insert into public.question_options (tenant_id, question_id, label, is_correct, feedback, position)
      select v_me.tenant_id, v_id, o.label, o.is_correct, o.feedback, o.position
      from public.question_options o where o.question_id = r.id;
  end loop;

  for r in select * from public.lesson_slides where lesson_id = p_lesson order by position loop
    insert into public.lesson_slides (tenant_id, lesson_id, position, kind, content, notes, activity_id)
      values (v_me.tenant_id, v_new, r.position, r.kind, r.content, r.notes, (v_map_a ->> r.activity_id::text)::uuid)
      returning id into v_id;
    v_map_s := v_map_s || jsonb_build_object(r.id::text, v_id);
  end loop;

  insert into public.video_checkpoints (tenant_id, slide_id, question_id, t_seconds, required)
    select v_me.tenant_id, (v_map_s ->> vc.slide_id::text)::uuid, (v_map_q ->> vc.question_id::text)::uuid,
           vc.t_seconds, vc.required
    from public.video_checkpoints vc join public.lesson_slides s on s.id = vc.slide_id
    where s.lesson_id = p_lesson and v_map_q ? vc.question_id::text;

  perform app.audit('lesson.duplicated', 'lesson', v_new::text, jsonb_build_object('source', p_lesson));
  return v_new;
end$$;

create or replace function public.create_lesson_share(
  p_lesson uuid, p_mode text default 'student_paced', p_hours int default 168, p_class uuid default null
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_me public.users := app.me(); v_share public.lesson_shares;
begin
  if not app.can_edit_lesson(p_lesson) then raise exception 'You cannot share this lesson.' using errcode = '42501'; end if;
  if p_hours not between 1 and 2160 then raise exception 'Links last between 1 hour and 90 days.' using errcode = '22023'; end if;
  if p_class is not null and not app.can_manage_class(p_class) then raise exception 'Not your class.' using errcode = '42501'; end if;
  if (select status from public.lessons where id = p_lesson) <> 'published' then
    raise exception 'Publish the lesson before sharing it.' using errcode = 'P0001';
  end if;
  insert into public.lesson_shares (tenant_id, lesson_id, class_id, code, mode, created_by, expires_at)
    values (v_me.tenant_id, p_lesson, p_class, app.unique_code(8, 'lesson_shares'), p_mode, v_me.id,
            now() + make_interval(hours => p_hours))
    returning * into v_share;
  perform app.audit('lesson.shared', 'lesson', p_lesson::text, jsonb_build_object('code', v_share.code, 'hours', p_hours));
  return to_jsonb(v_share);
end$$;

create or replace function app.valid_share(p_code text) returns public.lesson_shares
language plpgsql stable security definer set search_path = '' as $$
declare v public.lesson_shares; v_me public.users := app.me();
begin
  select * into v from public.lesson_shares
   where code = upper(btrim(p_code)) and revoked_at is null and expires_at > now() and tenant_id = v_me.tenant_id;
  if v.id is null then raise exception 'This lesson link is invalid or has expired.' using errcode = 'P0002'; end if;
  if v.class_id is not null and not (app.in_class(v.class_id) or app.can_manage_class(v.class_id)) then
    raise exception 'This lesson link is for a different class.' using errcode = '42501';
  end if;
  return v;
end$$;

create or replace function public.open_lesson_share(p_code text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v public.lesson_shares := app.valid_share(p_code);
begin
  return app.lesson_payload(v.lesson_id) || jsonb_build_object('share', jsonb_build_object(
    'code', v.code, 'mode', v.mode, 'expires_at', v.expires_at));
end$$;

-- ---------------------------------------------------------------------------
-- Attempts
-- ---------------------------------------------------------------------------
create or replace function app.attempt_context_ok(
  p_activity public.activities, p_session uuid, p_assignment uuid, p_share text
) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v_s public.class_sessions; v_a public.assignments;
begin
  if p_session is not null then
    select * into v_s from public.class_sessions where id = p_session;
    -- coalesce: a NULL active_activity_id must mean "no", never "unknown".
    return coalesce(v_s.id is not null and v_s.status = 'live' and app.in_class(v_s.class_id)
       and (v_s.active_activity_id = p_activity.id
            or (p_activity.lesson_id is not null and p_activity.lesson_id = v_s.lesson_id
                and (v_s.mode = 'student_paced'
                     or exists (select 1 from public.lesson_slides sl where sl.lesson_id = v_s.lesson_id
                                and sl.activity_id = p_activity.id and sl.position = v_s.current_slide)
                     or exists (select 1 from public.video_checkpoints vc
                                join public.questions q on q.id = vc.question_id
                                join public.lesson_slides sl on sl.id = vc.slide_id
                                where q.activity_id = p_activity.id and sl.lesson_id = v_s.lesson_id)))), false);
  elsif p_assignment is not null then
    select * into v_a from public.assignments where id = p_assignment;
    return coalesce(v_a.id is not null and v_a.status = 'published' and v_a.activity_id = p_activity.id
       and app.in_class(v_a.class_id)
       and (v_a.due_at is null or v_a.due_at > now() or v_a.allow_late), false);
  elsif p_share is not null then
    return coalesce(p_activity.lesson_id = (app.valid_share(p_share)).lesson_id, false);
  end if;
  return false;
end$$;

create or replace function public.start_attempt(
  p_activity uuid, p_session uuid default null, p_assignment uuid default null, p_share text default null
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me       public.users := app.me();
  v_act      public.activities;
  v_attempt  public.quiz_attempts;
  v_allowed  int;
  v_used     int;
  v_limit    int;
  v_shuffle_q boolean;
  v_shuffle_o boolean;
begin
  select * into v_act from public.activities where id = p_activity and tenant_id = v_me.tenant_id;
  if v_act.id is null then raise exception 'Activity not found.' using errcode = 'P0002'; end if;
  if not app.attempt_context_ok(v_act, p_session, p_assignment, p_share) then
    raise exception 'This activity is not open for you right now.' using errcode = '42501';
  end if;

  -- Resume an unfinished attempt in the same context (§30 reconnect).
  select * into v_attempt from public.quiz_attempts
   where activity_id = p_activity and student_id = v_me.id and status = 'in_progress'
     and session_id is not distinct from p_session and assignment_id is not distinct from p_assignment
   order by attempt_no desc limit 1;

  if v_attempt.id is null then
    v_allowed := coalesce((v_act.settings ->> 'attempts_allowed')::int, 1);
    select coalesce(max(attempt_no), 0) into v_used from public.quiz_attempts
     where activity_id = p_activity and student_id = v_me.id
       and session_id is not distinct from p_session and assignment_id is not distinct from p_assignment;
    if v_allowed > 0 and v_used >= v_allowed then
      raise exception 'No attempts left for this activity.' using errcode = 'P0001';
    end if;
    v_limit := nullif((v_act.settings ->> 'time_limit_seconds')::int, 0);
    insert into public.quiz_attempts (tenant_id, activity_id, student_id, session_id, assignment_id,
                                      attempt_no, seed, deadline_at, max_score)
      values (v_me.tenant_id, p_activity, v_me.id, p_session, p_assignment, v_used + 1,
              (random() * 2147483646)::int,
              case when v_limit is null then null else now() + make_interval(secs => v_limit) end,
              (select coalesce(sum(points), 0) from public.questions where activity_id = p_activity and kind <> 'poll'))
      returning * into v_attempt;
  end if;

  v_shuffle_q := coalesce((v_act.settings ->> 'shuffle_questions')::boolean, false);
  v_shuffle_o := coalesce((v_act.settings ->> 'shuffle_options')::boolean, false);

  return jsonb_build_object(
    'attempt', jsonb_build_object('id', v_attempt.id, 'attempt_no', v_attempt.attempt_no,
                                  'deadline_at', v_attempt.deadline_at, 'status', v_attempt.status,
                                  'server_now', now()),
    'activity', jsonb_build_object('id', v_act.id, 'kind', v_act.kind, 'title', v_act.title,
                                   'instructions', v_act.instructions, 'settings', v_act.settings - 'rubric_id'),
    'questions', (select coalesce(jsonb_agg(app.sanitize_question(q, v_attempt.seed, v_shuffle_o)
                                   order by case when v_shuffle_q then app.shuffle_key(v_attempt.seed, q.id::text)
                                                 else lpad(q.position::text, 6, '0') || q.created_at::text end), '[]'::jsonb)
                  from public.questions q where q.activity_id = p_activity),
    'answers', (select coalesce(jsonb_object_agg(a.question_id, a.response), '{}'::jsonb)
                from public.quiz_answers a where a.attempt_id = v_attempt.id));
end$$;

create or replace function app.recompute_attempt(p_attempt uuid) returns void
language sql volatile security definer set search_path = '' as $$
  update public.quiz_attempts qa set
    score = (select coalesce(sum(coalesce(a.manual_score, a.auto_score, 0)), 0) from public.quiz_answers a where a.attempt_id = qa.id),
    status = case when qa.status = 'in_progress' then 'in_progress'
                  when exists (select 1 from public.quiz_answers a where a.attempt_id = qa.id and a.status = 'pending_review')
                    then 'submitted'
                  else 'graded' end
  where qa.id = p_attempt
$$;

create or replace function public.submit_answer(
  p_attempt uuid, p_question uuid, p_response jsonb, p_elapsed_ms int default null
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me      public.users := app.me();
  v_attempt public.quiz_attempts;
  v_act     public.activities;
  v_q       public.questions;
  v_grade   jsonb;
  v_feedback text;
begin
  select * into v_attempt from public.quiz_attempts where id = p_attempt and student_id = v_me.id for update;
  if v_attempt.id is null then raise exception 'Attempt not found.' using errcode = 'P0002'; end if;
  if v_attempt.status <> 'in_progress' then raise exception 'This attempt has already been submitted.' using errcode = 'P0001'; end if;
  if v_attempt.deadline_at is not null and now() > v_attempt.deadline_at + interval '5 seconds' then
    perform public.finish_attempt(p_attempt);
    raise exception 'Time is up — your attempt was submitted.' using errcode = 'P0001';
  end if;
  if length(p_response::text) > 200000 then raise exception 'Response is too large.' using errcode = '22023'; end if;

  select * into v_q from public.questions where id = p_question and activity_id = v_attempt.activity_id;
  if v_q.id is null then raise exception 'Question not in this activity.' using errcode = 'P0002'; end if;
  select * into v_act from public.activities where id = v_attempt.activity_id;

  v_grade := app.grade_response(v_q, p_response);
  insert into public.quiz_answers (tenant_id, attempt_id, question_id, response, is_correct, auto_score, status, elapsed_ms)
    values (v_me.tenant_id, p_attempt, p_question, p_response, (v_grade ->> 'is_correct')::boolean,
            (v_grade ->> 'score')::numeric, v_grade ->> 'status', greatest(coalesce(p_elapsed_ms, 0), 0))
    on conflict (attempt_id, question_id) do update
      set response = excluded.response, is_correct = excluded.is_correct, auto_score = excluded.auto_score,
          status = excluded.status, elapsed_ms = excluded.elapsed_ms, answered_at = now();

  v_feedback := coalesce(v_act.settings ->> 'show_feedback', 'after_submit');
  if v_feedback = 'immediately' and v_grade ->> 'status' = 'auto_graded' then
    return jsonb_build_object('saved', true, 'status', v_grade ->> 'status',
                              'is_correct', (v_grade ->> 'is_correct')::boolean, 'score', (v_grade ->> 'score')::numeric)
           || app.reveal_answer(v_q);
  end if;
  return jsonb_build_object('saved', true, 'status', v_grade ->> 'status');
end$$;

create or replace function public.finish_attempt(p_attempt uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_attempt public.quiz_attempts;
  v_act     public.activities;
  v_asg     public.assignments;
  v_no      int;
begin
  select * into v_attempt from public.quiz_attempts where id = p_attempt and student_id = auth.uid() for update;
  if v_attempt.id is null then raise exception 'Attempt not found.' using errcode = 'P0002'; end if;
  if v_attempt.status = 'in_progress' then
    update public.quiz_attempts set status = 'submitted', submitted_at = now() where id = p_attempt;
    perform app.recompute_attempt(p_attempt);
    if v_attempt.assignment_id is not null then
      select * into v_asg from public.assignments where id = v_attempt.assignment_id;
      select coalesce(max(attempt_no), 0) + 1 into v_no from public.submissions
       where assignment_id = v_asg.id and student_id = v_attempt.student_id;
      insert into public.submissions (tenant_id, assignment_id, student_id, attempt_no, attempt_id, is_late)
        values (v_attempt.tenant_id, v_asg.id, v_attempt.student_id, v_no, p_attempt,
                v_asg.due_at is not null and now() > v_asg.due_at);
    end if;
  end if;
  select * into v_attempt from public.quiz_attempts where id = p_attempt;
  select * into v_act from public.activities where id = v_attempt.activity_id;

  return jsonb_build_object(
    'attempt', jsonb_build_object('id', v_attempt.id, 'status', v_attempt.status, 'score', v_attempt.score,
                                  'max_score', v_attempt.max_score, 'submitted_at', v_attempt.submitted_at),
    'results', case when coalesce(v_act.settings ->> 'show_feedback', 'after_submit') = 'never' then null else (
       select coalesce(jsonb_agg(jsonb_build_object('question_id', a.question_id, 'is_correct', a.is_correct,
                        'score', coalesce(a.manual_score, a.auto_score), 'status', a.status, 'feedback', a.feedback)
                        || app.reveal_answer(q)), '[]'::jsonb)
       from public.quiz_answers a join public.questions q on q.id = a.question_id where a.attempt_id = p_attempt) end);
end$$;

-- Teacher preview of an activity exactly as students will see it.
create or replace function public.preview_activity(p_activity uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.can_view_activity(p_activity) then raise exception 'Not visible to you.' using errcode = '42501'; end if;
  return jsonb_build_object('questions',
    (select coalesce(jsonb_agg(app.sanitize_question(q, 42, false) order by q.position, q.created_at), '[]'::jsonb)
     from public.questions q where q.activity_id = p_activity));
end$$;

-- ---------------------------------------------------------------------------
-- Review queue & live results
-- ---------------------------------------------------------------------------
create or replace function public.review_queue(p_class uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.is_teacher() then raise exception 'Teachers only.' using errcode = '42501'; end if;
  return (select coalesce(jsonb_agg(row order by row ->> 'answered_at'), '[]'::jsonb) from (
    select jsonb_build_object(
      'answer_id', a.id, 'answered_at', a.answered_at, 'response', a.response, 'status', a.status,
      'question', jsonb_build_object('id', q.id, 'kind', q.kind, 'prompt', q.prompt, 'points', q.points, 'config', q.config),
      'activity', jsonb_build_object('id', act.id, 'title', act.title, 'rubric_id', act.settings ->> 'rubric_id'),
      'student', jsonb_build_object('id', u.id, 'name', u.full_name)) as row
    from public.quiz_answers a
    join public.quiz_attempts t on t.id = a.attempt_id
    join public.questions q on q.id = a.question_id
    join public.activities act on act.id = t.activity_id
    join public.users u on u.id = t.student_id
    where a.status = 'pending_review' and a.tenant_id = app.tenant_id()
      and (app.is_admin() or app.teaches_student(t.student_id))
      and (p_class is null or exists (select 1 from public.class_members m where m.class_id = p_class and m.user_id = t.student_id))
    limit 500) s);
end$$;

create or replace function public.review_answer(p_answer uuid, p_score numeric, p_feedback text default null) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_a public.quiz_answers; v_t public.quiz_attempts; v_q public.questions;
begin
  select * into v_a from public.quiz_answers where id = p_answer;
  if v_a.id is null then raise exception 'Answer not found.' using errcode = 'P0002'; end if;
  select * into v_t from public.quiz_attempts where id = v_a.attempt_id;
  if not (app.is_admin() or app.teaches_student(v_t.student_id)) or v_t.tenant_id <> app.tenant_id() then
    raise exception 'Not your student.' using errcode = '42501';
  end if;
  select * into v_q from public.questions where id = v_a.question_id;
  if p_score < 0 or p_score > v_q.points then
    raise exception 'Score must be between 0 and %.', v_q.points using errcode = '22023';
  end if;
  update public.quiz_answers set manual_score = p_score, feedback = nullif(btrim(p_feedback), ''),
         status = 'reviewed', is_correct = (p_score >= v_q.points), reviewed_by = auth.uid(), reviewed_at = now()
   where id = p_answer;
  perform app.recompute_attempt(v_t.id);
  perform app.notify(v_t.student_id, 'grade_updated', 'Your work was reviewed', null, '/student', 'info',
                     jsonb_build_object('attempt_id', v_t.id));
end$$;

-- Live response panel (§3.4) and question analytics (§18).
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
                              'count', (select count(*) from public.quiz_answers a join public.quiz_attempts t on t.id = a.attempt_id
                                        where a.question_id = q.id and t.session_id = p_session and a.response ->> 'option_id' = o.id::text))
                              order by o.position), '[]'::jsonb) from public.question_options o where o.question_id = q.id))
              order by q.position), '[]'::jsonb))
              from public.questions q where q.activity_id = p_activity);
    end if;
  elsif not app.can_view_activity(p_activity) then
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

-- ---------------------------------------------------------------------------
-- Assignments (§23 assignment/rubric engine)
-- ---------------------------------------------------------------------------
create or replace function public.submit_assignment(p_assignment uuid, p_body text default null, p_files jsonb default '[]'::jsonb)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me  public.users := app.me();
  v_a   public.assignments;
  v_no  int;
  v_sub public.submissions;
  f     jsonb;
begin
  select * into v_a from public.assignments where id = p_assignment and tenant_id = v_me.tenant_id;
  if v_a.id is null or v_a.status <> 'published' or not app.in_class(v_a.class_id) then
    raise exception 'Assignment not available.' using errcode = 'P0002';
  end if;
  if v_a.due_at is not null and now() > v_a.due_at and not v_a.allow_late then
    raise exception 'The due date has passed and late work is not accepted.' using errcode = 'P0001';
  end if;
  if coalesce(btrim(p_body), '') = '' and coalesce(jsonb_array_length(p_files), 0) = 0 then
    raise exception 'Add text or attach a file.' using errcode = '22023';
  end if;
  for f in select * from jsonb_array_elements(coalesce(p_files, '[]'::jsonb)) loop
    if (f ->> 'path') not like v_me.tenant_id::text || '/' || v_me.id::text || '/' || p_assignment::text || '/%' then
      raise exception 'Invalid attachment path.' using errcode = '22023';
    end if;
  end loop;
  select coalesce(max(attempt_no), 0) + 1 into v_no from public.submissions where assignment_id = p_assignment and student_id = v_me.id;
  if v_no > v_a.max_resubmissions + 1 then
    raise exception 'No resubmissions left for this assignment.' using errcode = 'P0001';
  end if;
  insert into public.submissions (tenant_id, assignment_id, student_id, attempt_no, body, files, is_late)
    values (v_me.tenant_id, p_assignment, v_me.id, v_no, nullif(btrim(p_body), ''), coalesce(p_files, '[]'::jsonb),
            v_a.due_at is not null and now() > v_a.due_at)
    returning * into v_sub;
  perform app.notify(v_a.created_by, 'submission', v_me.full_name || ' submitted ' || v_a.title,
                     case when v_sub.is_late then 'Late submission' end,
                     '/teacher/assignments/' || v_a.id, 'info', jsonb_build_object('submission_id', v_sub.id));
  return to_jsonb(v_sub);
end$$;

create or replace function public.grade_submission(
  p_submission uuid, p_score numeric, p_rubric_scores jsonb default '{}'::jsonb,
  p_feedback text default null, p_release boolean default false, p_return boolean default false
) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_s public.submissions; v_a public.assignments;
begin
  select * into v_s from public.submissions where id = p_submission;
  if v_s.id is null then raise exception 'Submission not found.' using errcode = 'P0002'; end if;
  select * into v_a from public.assignments where id = v_s.assignment_id;
  if not app.can_manage_class(v_a.class_id) then raise exception 'Not your class.' using errcode = '42501'; end if;
  if p_score < 0 or p_score > v_a.points_possible then
    raise exception 'Score must be between 0 and %.', v_a.points_possible using errcode = '22023';
  end if;
  insert into public.grades (tenant_id, submission_id, grader_id, score, rubric_scores, feedback, released_at)
    values (v_s.tenant_id, p_submission, auth.uid(), p_score, coalesce(p_rubric_scores, '{}'::jsonb),
            nullif(btrim(p_feedback), ''), case when p_release then now() end)
    on conflict (submission_id) do update set score = excluded.score, rubric_scores = excluded.rubric_scores,
      feedback = excluded.feedback, grader_id = excluded.grader_id, graded_at = now(),
      released_at = coalesce(public.grades.released_at, excluded.released_at);
  update public.submissions set status = case when p_return then 'returned' else 'graded' end where id = p_submission;
  if p_release then
    perform app.notify(v_s.student_id, 'grade_released', 'Grade released: ' || v_a.title, null, '/student', 'info',
                       jsonb_build_object('assignment_id', v_a.id));
  end if;
  perform app.audit('grade.saved', 'submission', p_submission::text, jsonb_build_object('score', p_score, 'released', p_release));
end$$;

create or replace function public.release_grades(p_assignment uuid) returns int
language plpgsql volatile security definer set search_path = '' as $$
declare v_a public.assignments; v_n int := 0; r record;
begin
  select * into v_a from public.assignments where id = p_assignment;
  if v_a.id is null or not app.can_manage_class(v_a.class_id) then raise exception 'Not your class.' using errcode = '42501'; end if;
  for r in with released as (
             update public.grades g set released_at = now()
             from public.submissions s where s.id = g.submission_id and s.assignment_id = p_assignment and g.released_at is null
             returning s.student_id)
           select distinct student_id from released loop
    v_n := v_n + 1;
    perform app.notify(r.student_id, 'grade_released', 'Grade released: ' || v_a.title, null, '/student', 'info',
                       jsonb_build_object('assignment_id', v_a.id));
  end loop;
  perform app.audit('grades.released', 'assignment', p_assignment::text);
  return v_n;
end$$;
