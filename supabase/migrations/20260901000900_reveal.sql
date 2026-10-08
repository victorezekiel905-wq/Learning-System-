-- 0900: reveal and live answer counts (docs/LIVE_ENGINE.md, increment 4).
--
-- * session_control 'reveal' closes the activity on screen: unfinished attempts are
--   submitted as they stand, no further answers are accepted, and everyone sees the
--   right answers with the distribution (responses_visible).
-- * Students see which options were right only after the reveal.
-- * Fix: changing results sharing, chat or mode no longer resets the slide to 1.
-- * The teacher's state reports the activity on screen (launched, or on the current
--   slide) with answered / joined counts and whether it has been revealed.

alter table public.class_sessions add column if not exists revealed_activity_id uuid;

create or replace function public.session_control(p_session uuid, p_action text, p_args jsonb default '{}'::jsonb)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_s      public.class_sessions := app.require_live_session(p_session);
  v_n      int;
  v_target int;
  v_user   uuid;
  v_bad    text;
  v_act    uuid;
  v_att    uuid;
begin
  p_args := coalesce(p_args, '{}'::jsonb);
  case p_action
    when 'start' then
      if v_s.phase <> 'lobby' then raise exception 'The lesson has already started.' using errcode = 'P0001'; end if;
      update public.class_sessions set phase = 'active', started_at = now() where id = p_session;
    when 'pause' then
      if v_s.phase <> 'active' then raise exception 'Only a running lesson can be paused.' using errcode = 'P0001'; end if;
      update public.class_sessions set phase = 'paused' where id = p_session;
    when 'resume' then
      if v_s.phase <> 'paused' then raise exception 'The lesson isn''t paused.' using errcode = 'P0001'; end if;
      update public.class_sessions set phase = 'active' where id = p_session;
    when 'next', 'prev', 'goto' then
      if v_s.phase <> 'active' then raise exception 'Start the lesson first.' using errcode = 'P0001'; end if;
      select count(*) into v_n from public.lesson_slides where lesson_id = v_s.lesson_id;
      v_target := case p_action when 'next' then v_s.current_slide + 1 when 'prev' then v_s.current_slide - 1
                                else (p_args ->> 'slide')::int end;
      if v_target is null then raise exception 'Which slide?' using errcode = '22023'; end if;
      perform public.set_session_state(p_session, greatest(0, least(v_target, greatest(v_n - 1, 0))));
    when 'kick' then
      v_user := nullif(p_args ->> 'user_id', '')::uuid;
      if v_user is null or v_user = v_s.teacher_id then raise exception 'Who should be removed?' using errcode = '22023'; end if;
      update public.session_participants set removed_at = now(), left_at = now(), status = 'offline'
       where session_id = p_session and user_id = v_user and removed_at is null;
      if not found then raise exception 'That person isn''t in this lesson.' using errcode = 'P0002'; end if;
      update public.session_guests set removed_at = now() where session_id = p_session and user_id = v_user and removed_at is null;
      update public.raise_hands set status = 'resolved', resolved_at = now() where session_id = p_session and student_id = v_user and status = 'open';
      perform app.audit('session.participant_removed', 'user', v_user::text, jsonb_build_object('session_id', p_session));
    when 'settings' then
      select k into v_bad from jsonb_object_keys(p_args) k
       where k <> all (array['leaderboard', 'anonymous_names', 'late_join', 'speed_bonus'])
          or jsonb_typeof(p_args -> k) <> 'boolean' limit 1;
      if v_bad is not null then raise exception 'Unknown or invalid setting: %.', v_bad using errcode = '22023'; end if;
      update public.class_sessions set settings = settings || p_args where id = p_session;
    when 'leaderboard' then
      if v_s.phase not in ('active', 'paused') then raise exception 'Start the lesson first.' using errcode = 'P0001'; end if;
      if coalesce((p_args ->> 'show')::boolean, true) then perform app.snapshot_leaderboard(p_session);
      else update public.class_sessions set show_leaderboard = false where id = p_session; end if;
    when 'reveal' then
      if v_s.phase not in ('active', 'paused') then raise exception 'Start the lesson first.' using errcode = 'P0001'; end if;
      v_act := coalesce(nullif(p_args ->> 'activity_id', '')::uuid, v_s.active_activity_id,
                        (select sl.activity_id from public.lesson_slides sl where sl.lesson_id = v_s.lesson_id and sl.position = v_s.current_slide));
      if v_act is null then raise exception 'There is no activity on this slide to reveal.' using errcode = 'P0001'; end if;
      -- Answers close: unfinished attempts are submitted as they stand, then everyone sees the result.
      for v_att in select id from public.quiz_attempts where session_id = p_session and activity_id = v_act and status = 'in_progress' loop
        update public.quiz_attempts set status = 'submitted', submitted_at = now() where id = v_att;
        perform app.recompute_attempt(v_att);
      end loop;
      update public.class_sessions set revealed_activity_id = v_act, responses_visible = true where id = p_session;
    when 'end' then
      return public.end_session(p_session);
    else
      raise exception 'Unknown action: %.', p_action using errcode = '22023';
  end case;
  select * into v_s from public.class_sessions where id = p_session;
  return jsonb_build_object('phase', v_s.phase, 'slide', v_s.current_slide, 'settings', v_s.settings, 'v', v_s.state_version);
end$$;

create or replace function app.attempt_context_ok(
  p_activity public.activities, p_session uuid, p_assignment uuid, p_share text
) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v_s public.class_sessions; v_a public.assignments;
begin
  if p_session is not null then
    select * into v_s from public.class_sessions where id = p_session;
    -- coalesce: a NULL active_activity_id must mean "no", never "unknown".
    return coalesce(v_s.id is not null and v_s.status = 'live' and v_s.phase = 'active'
       and v_s.revealed_activity_id is distinct from p_activity.id and (app.in_class(v_s.class_id) or app.is_session_guest(v_s.id))
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

create or replace function public.submit_answer(
  p_attempt uuid, p_question uuid, p_response jsonb, p_elapsed_ms int default null
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me       public.users := app.me();
  v_attempt  public.quiz_attempts;
  v_act      public.activities;
  v_q        public.questions;
  v_prev     public.quiz_answers;
  v_grade    jsonb;
  v_feedback text;
  v_instant  boolean;
  v_second   boolean;
  v_tries    smallint := 1;
  v_score    numeric;
  v_reveal   boolean;
  v_points   jsonb;
begin
  select * into v_attempt from public.quiz_attempts where id = p_attempt and student_id = v_me.id for update;
  if v_attempt.id is null then raise exception 'Attempt not found.' using errcode = 'P0002'; end if;
  if v_attempt.status <> 'in_progress' then raise exception 'This attempt has already been submitted.' using errcode = 'P0001'; end if;
  if v_attempt.session_id is not null and exists (select 1 from public.class_sessions cs where cs.id = v_attempt.session_id
                                                   and cs.revealed_activity_id = v_attempt.activity_id) then
    raise exception 'The answers have been revealed: this activity is closed.' using errcode = 'P0001';
  end if;
  if v_attempt.deadline_at is not null and now() > v_attempt.deadline_at + interval '5 seconds' then
    perform public.finish_attempt(p_attempt);
    raise exception 'Time is up — your attempt was submitted.' using errcode = 'P0001';
  end if;
  if length(p_response::text) > 200000 then raise exception 'Response is too large.' using errcode = '22023'; end if;

  select * into v_q from public.questions where id = p_question and activity_id = v_attempt.activity_id;
  if v_q.id is null then raise exception 'Question not in this activity.' using errcode = 'P0002'; end if;
  select * into v_act from public.activities where id = v_attempt.activity_id;
  v_feedback := coalesce(v_act.settings ->> 'show_feedback', 'after_submit');
  v_second := coalesce((v_act.settings ->> 'redemption')::boolean, false);
  v_grade := app.grade_response(v_q, p_response);
  v_instant := v_feedback = 'immediately' and v_grade ->> 'status' = 'auto_graded';
  v_score := (v_grade ->> 'score')::numeric;

  select * into v_prev from public.quiz_answers where attempt_id = p_attempt and question_id = p_question;
  if v_prev.id is not null then
    -- Once the correct answer has been shown, the answer is final.
    if v_prev.revealed then
      raise exception 'You have already answered this question. Move on to the next one.' using errcode = 'P0001';
    end if;
    -- Second chance: only after a wrong first try with instant feedback. Worth half,
    -- but never less than any partial credit the first try already earned.
    if v_instant and v_second and v_prev.is_correct is false and v_prev.tries = 1 then
      v_tries := 2;
      v_score := greatest(round(coalesce(v_score, 0) * 0.5, 2), coalesce(v_prev.auto_score, 0));
    end if;
  end if;

  -- With a second chance on, a wrong first try says "not quite" without showing the answer.
  v_reveal := v_instant and not (v_second and v_tries = 1 and (v_grade ->> 'is_correct')::boolean is false);

  insert into public.quiz_answers (tenant_id, attempt_id, question_id, response, is_correct, auto_score, status, elapsed_ms, tries, revealed)
    values (v_me.tenant_id, p_attempt, p_question, p_response, (v_grade ->> 'is_correct')::boolean,
            v_score, v_grade ->> 'status', greatest(coalesce(p_elapsed_ms, 0), 0), v_tries, v_reveal)
    on conflict (attempt_id, question_id) do update
      set response = excluded.response, is_correct = excluded.is_correct, auto_score = excluded.auto_score,
          status = excluded.status, elapsed_ms = excluded.elapsed_ms, answered_at = now(),
          tries = excluded.tries, revealed = excluded.revealed;

  -- Live lessons: points, streak and totals, decided here on the server (0890).
  if v_attempt.session_id is not null then
    v_points := app.score_live_answer(v_attempt, v_q, v_act, (v_grade ->> 'is_correct')::boolean, v_tries, v_prev.points);
    update public.quiz_answers set points = (v_points ->> 'points')::int, response_ms = (v_points ->> 'response_ms')::int
     where attempt_id = p_attempt and question_id = p_question;
  end if;

  if v_instant and v_reveal then
    return jsonb_build_object('saved', true, 'status', v_grade ->> 'status', 'tries', v_tries,
                              'is_correct', (v_grade ->> 'is_correct')::boolean, 'score', v_score)
           || app.reveal_answer(v_q) || case when v_points is not null and v_feedback <> 'never' then jsonb_build_object('points', v_points) else '{}'::jsonb end;
  elsif v_instant then
    return jsonb_build_object('saved', true, 'status', v_grade ->> 'status', 'tries', v_tries,
                              'is_correct', false, 'second_chance', true);
  end if;
  -- No right answer (poll, open...): the participation points can be shown straight away.
  return jsonb_build_object('saved', true, 'status', v_grade ->> 'status')
         || case when (v_grade ->> 'is_correct') is null then case when v_points is not null and v_feedback <> 'never' then jsonb_build_object('points', v_points) else '{}'::jsonb end else '{}'::jsonb end;
end$$;

create or replace function public.session_student_state(p_session uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me    public.users := app.me();
  v_s     public.class_sessions;
  v_p     public.session_participants;
  v_spot  public.spotlights;
  v_act   public.activities;
  v_pass  public.session_guests;
begin
  select * into v_s from public.class_sessions where id = p_session;
  if exists (select 1 from public.session_participants where session_id = p_session and user_id = v_me.id and removed_at is not null) then
    raise exception 'Your teacher removed you from this lesson.' using errcode = '42501';
  end if;
  if v_s.id is null or not (app.in_class(v_s.class_id) or app.is_session_guest(v_s.id)) then raise exception 'Session not found.' using errcode = 'P0002'; end if;
  select * into v_p from public.session_participants where session_id = p_session and user_id = v_me.id;
  if v_p.removed_at is not null then raise exception 'Your teacher removed you from this lesson.' using errcode = '42501'; end if;
  select * into v_pass from public.session_guests where session_id = p_session and user_id = v_me.id;
  if v_s.status = 'live' then
    insert into public.session_participants (session_id, user_id, tenant_id, status, current_slide)
      values (v_s.id, v_me.id, v_me.tenant_id, 'online', v_s.current_slide)
      on conflict (session_id, user_id) do update set last_seen_at = now(), left_at = null,
        status = case when public.session_participants.status = 'offline' then 'online' else public.session_participants.status end
      returning * into v_p;
  end if;
  select * into v_spot from public.spotlights where session_id = p_session and ended_at is null;
  select * into v_act from public.activities where id = v_s.active_activity_id;

  return jsonb_build_object(
    'session', jsonb_build_object('id', v_s.id, 'title', v_s.title, 'status', v_s.status, 'phase', v_s.phase, 'mode', v_s.mode,
                                  'join_code', v_s.join_code, 'settings', v_s.settings,
                                  'current_slide', v_s.current_slide, 'group_chat_enabled', v_s.group_chat_enabled and v_me.role <> 'guest',
                                  'responses_visible', v_s.responses_visible, 'class_id', v_s.class_id,
                                  'teacher', (select full_name from public.users where id = v_s.teacher_id),
                                  'environment_active', v_s.environment_active),
    'my_slide', coalesce(v_p.current_slide, v_s.current_slide),
    'active_activity', case when v_act.id is null then null else jsonb_build_object(
                         'id', v_act.id, 'kind', v_act.kind, 'title', v_act.title) end,
    'spotlight', case when v_spot.id is null then null else jsonb_build_object(
                   'me', v_spot.student_id = v_me.id, 'show_to_class', v_spot.show_to_class, 'anonymized', v_spot.anonymized) end,
    'hand', (select jsonb_build_object('id', h.id, 'created_at', h.created_at) from public.raise_hands h
             where h.session_id = p_session and h.student_id = v_me.id and h.status = 'open'),
    'environment_notice', case when exists (select 1 from public.environment_events e where e.class_session_id = p_session
                                            and e.student_id = v_me.id and e.resolved_at is null
                                            and e.kind in ('environment_left','domain_blocked'))
                               then 'Your class session requires you to return to the lesson.' end,
    'device_monitored', exists (select 1 from public.browser_sessions b where b.class_session_id = p_session
                                and b.student_id = v_me.id and b.last_heartbeat_at > now() - interval '45 seconds'),
    'announcements', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'body', a.body, 'created_at', a.created_at)
                       order by a.created_at desc), '[]'::jsonb)
                      from (select * from public.announcements where session_id = p_session order by created_at desc limit 5) a),
    'guest', v_me.role = 'guest',
    'revealed_activity_id', v_s.revealed_activity_id,
    -- Own score and rank only; the class sees the top 5 when the teacher shows the board.
    'my', (select jsonb_build_object('score', r.score, 'rank', r.rank, 'streak', r.streak,
                                     'of', (select count(*) from app.session_ranks(p_session)))
             from app.session_ranks(p_session) r where r.user_id = v_me.id),
    'leaderboard', case when v_s.show_leaderboard and coalesce((v_s.settings ->> 'leaderboard')::boolean, true) then
      (select coalesce(jsonb_agg(e order by (e ->> 'rank')::int), '[]'::jsonb) from jsonb_array_elements(v_s.leaderboard -> 'top') e
        where (e ->> 'rank')::int <= 5) end,
    'me', jsonb_build_object('name', coalesce(v_pass.display_name, v_me.full_name), 'avatar', v_p.avatar),
    'participants', (select count(*) from public.session_participants sp
                      where sp.session_id = p_session and sp.user_id <> v_s.teacher_id and sp.left_at is null and sp.removed_at is null
                        and sp.last_seen_at > now() - app.presence_window()),
    'summary', case when v_s.status = 'ended' then (
       select jsonb_build_object('answered', count(*), 'correct', count(*) filter (where a.is_correct))
         from public.quiz_answers a join public.quiz_attempts t on t.id = a.attempt_id
        where t.session_id = p_session and t.student_id = v_me.id) end,
    'server_now', now());
end$$;

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

create or replace function public.teacher_session_state(p_session uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_s        public.class_sessions;
  v_settings public.tenant_settings;
  r          public.browser_sessions;
  v_cur      uuid;
begin
  select * into v_s from public.class_sessions where id = p_session;
  if v_s.id is null or not app.can_manage_session(v_s.id) then raise exception 'Session not found.' using errcode = 'P0002'; end if;
  select * into v_settings from public.tenant_settings where tenant_id = v_s.tenant_id;

  if v_s.status = 'live' then
    -- Students only send screen frames while a teacher is watching (throttled write).
    if v_s.teacher_seen_at is null or v_s.teacher_seen_at < now() - interval '20 seconds' then
      update public.class_sessions set teacher_seen_at = now() where id = p_session;
    end if;
    for r in update public.browser_sessions set connection_lost_at = now()
             where class_session_id = p_session and ended_at is null and connection_lost_at is null
               and last_heartbeat_at < now() - interval '45 seconds'
             returning * loop
      perform app.raise_event(r, v_s, v_s.environment_id, 'connection_lost', 'info',
                              'Extension stopped reporting — connection lost, not a rule violation', null, null);
    end loop;
    perform app.web_leave_check(v_s);
    update public.teacher_commands set status = 'expired'
     where class_session_id = p_session and status in ('queued','delivered') and expires_at < now();
  end if;

  -- The activity on screen: the one launched, or the one on the current slide.
  v_cur := coalesce(v_s.active_activity_id,
                    (select sl.activity_id from public.lesson_slides sl where sl.lesson_id = v_s.lesson_id and sl.position = v_s.current_slide));
  return jsonb_build_object(
    'session', to_jsonb(v_s) || jsonb_build_object(
      'class_name', (select name from public.classes where id = v_s.class_id),
      'lesson_title', (select title from public.lessons where id = v_s.lesson_id),
      'environment_name', (select name from public.environment_policies where id = v_s.environment_id)),
    'settings', jsonb_build_object('monitoring_enabled', v_settings.monitoring_enabled, 'allow_spotlight', v_settings.allow_spotlight, 'allow_group_chat', v_settings.allow_group_chat,
                                   'allow_screen_capture', v_settings.allow_screen_capture,
                                   'store_event_screenshots', v_settings.store_event_screenshots,
                                   'thumbnail_interval_seconds', v_settings.thumbnail_interval_seconds),
    'server_now', now(),
    'roster', (select coalesce(jsonb_agg(jsonb_build_object(
        'student_id', u.id, 'name', u.full_name, 'guest', m.guest, 'avatar', p.avatar,
        'score', coalesce(p.total_score, 0), 'streak', coalesce(p.streak, 0),
        'presence', case when p.user_id is null then 'not_joined'
                         when p.left_at is not null or p.last_seen_at < now() - app.presence_window() then 'offline'
                         else p.status end,
        'last_seen_at', p.last_seen_at, 'current_slide', p.current_slide,
        'web', case when p.user_id is null then null else jsonb_build_object(
                 'sharing', p.screen_sharing and p.last_seen_at > now() - app.presence_window(),
                 'unsupported', p.share_unsupported, 'surface', p.screen_surface,
                 'visible', p.tab_visible, 'fullscreen', p.fullscreen,
                 'away_since', p.away_since, 'away_reason', p.away_reason) end,
        'device', (select jsonb_build_object('device_id', b.device_id, 'url', b.active_url, 'domain', b.active_domain,
                     'title', b.active_title, 'tab_count', b.tab_count, 'idle_state', b.idle_state,
                     'online', b.connection_lost_at is null and b.last_heartbeat_at > now() - interval '45 seconds',
                     'last_heartbeat_at', b.last_heartbeat_at, 'focus_locked', b.focus_locked,
                     'violation', b.violation_rule, 'violation_since', b.violation_since,
                     'snapshot_at', (select max(sn.captured_at) from public.screen_snapshots sn
                                     where sn.student_id = u.id and sn.class_session_id = p_session and sn.quality = 'thumbnail'))
                   from public.browser_sessions b where b.class_session_id = p_session and b.student_id = u.id
                   order by b.last_heartbeat_at desc limit 1),
        'open_alerts', (select count(*) from public.environment_events e where e.class_session_id = p_session
                        and e.student_id = u.id and e.status = 'open'),
        'hand_raised', exists (select 1 from public.raise_hands h where h.session_id = p_session and h.student_id = u.id and h.status = 'open'))
        order by u.full_name), '[]'::jsonb)
      from (select cm.user_id, false as guest from public.class_members cm where cm.class_id = v_s.class_id and cm.role = 'student'
            union all
            select g.user_id, g.is_guest from public.session_guests g where g.session_id = p_session and g.removed_at is null) m
      join public.users u on u.id = m.user_id
      left join public.session_participants p on p.session_id = p_session and p.user_id = u.id),
    'alerts', (select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'kind', e.kind, 'severity', e.severity, 'rule', e.rule,
                 'domain', e.domain, 'confidence', e.confidence, 'status', e.status, 'student_id', e.student_id,
                 'student', u.full_name, 'created_at', e.created_at, 'resolved_at', e.resolved_at,
                 'has_evidence', e.evidence_image is not null)
                 order by e.created_at desc), '[]'::jsonb)
               from (select * from public.environment_events where class_session_id = p_session
                     and (status = 'open' or created_at > now() - interval '10 minutes') order by created_at desc limit 50) e
               join public.users u on u.id = e.student_id),
    'hands', (select coalesce(jsonb_agg(jsonb_build_object('id', h.id, 'student_id', h.student_id, 'student', u.full_name,
                'message', h.message, 'created_at', h.created_at) order by h.created_at), '[]'::jsonb)
              from public.raise_hands h join public.users u on u.id = h.student_id
              where h.session_id = p_session and h.status = 'open'),
    'commands', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'kind', c.kind, 'status', c.status, 'error', c.error,
                   'student', u.full_name, 'created_at', c.created_at) order by c.created_at desc), '[]'::jsonb)
                 from (select * from public.teacher_commands where class_session_id = p_session order by created_at desc limit 20) c
                 join public.users u on u.id = c.student_id),
    'spotlight', (select jsonb_build_object('id', s.id, 'student_id', s.student_id, 'anonymized', s.anonymized,
                    'show_to_class', s.show_to_class, 'started_at', s.started_at)
                  from public.spotlights s where s.session_id = p_session and s.ended_at is null),
    'ranking', (select coalesce(jsonb_agg(jsonb_build_object('user_id', rk.user_id, 'name', rk.name, 'avatar', rk.avatar,
                   'score', rk.score, 'rank', rk.rank, 'streak', rk.streak) order by rk.rank, rk.name), '[]'::jsonb)
                from (select * from app.session_ranks(p_session) order by rank, name limit 10) rk),
    'activity', case when v_cur is null then null
                     else public.activity_results(v_cur, p_session) || jsonb_build_object(
                       'answered', (select count(distinct t.student_id) from public.quiz_attempts t
                                     where t.session_id = p_session and t.activity_id = v_cur
                                       and exists (select 1 from public.quiz_answers a where a.attempt_id = t.id)),
                       'joined', (select count(*) from public.session_participants sp where sp.session_id = p_session
                                   and sp.user_id <> v_s.teacher_id and sp.removed_at is null and sp.left_at is null),
                       'revealed', v_s.revealed_activity_id is not distinct from v_cur) end);
end$$;

create or replace function public.set_session_state(
  p_session uuid, p_slide int default null, p_activity uuid default null, p_clear_activity boolean default false,
  p_group_chat boolean default null, p_responses_visible boolean default null, p_mode text default null
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_s public.class_sessions := app.require_live_session(p_session); v_allow boolean;
begin
  if p_activity is not null and not exists (select 1 from public.activities where id = p_activity and tenant_id = v_s.tenant_id) then
    raise exception 'Activity not found.' using errcode = 'P0002';
  end if;
  if p_group_chat then
    select allow_group_chat into v_allow from public.tenant_settings where tenant_id = v_s.tenant_id;
    if not v_allow then raise exception 'Group chat is disabled by your school.' using errcode = 'P0001'; end if;
  end if;
  if p_mode is not null and p_mode not in ('live_participation','student_paced','front_of_class') then
    raise exception 'Unknown delivery mode.' using errcode = '22023';
  end if;
  update public.class_sessions set
    -- greatest(NULL, 0) is 0 in Postgres: without this, any change that didn't name a slide
    -- (sharing results, chat, mode) sent the whole class back to the first slide.
    current_slide = case when p_slide is null then current_slide else greatest(p_slide, 0) end,
    active_activity_id = case when p_clear_activity then null else coalesce(p_activity, active_activity_id) end,
    group_chat_enabled = coalesce(p_group_chat, group_chat_enabled),
    responses_visible = coalesce(p_responses_visible, responses_visible),
    mode = coalesce(p_mode, mode)
  where id = p_session returning * into v_s;
  if p_slide is not null and v_s.mode <> 'student_paced' then
    update public.session_participants set current_slide = v_s.current_slide where session_id = p_session;
  end if;
  if p_activity is not null then
    perform app.audit('activity.launched', 'activity', p_activity::text, jsonb_build_object('session_id', p_session));
  end if;
  return to_jsonb(v_s);
end$$;

create or replace function public.health() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('ok', true, 'db_time', now(), 'schema', '0900')
$$;
