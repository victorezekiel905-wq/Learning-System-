-- 0890: points and the leaderboard (docs/LIVE_ENGINE.md, increment 3).
--
-- Scoring is server-side, inside submit_answer, for answers given in a live lesson:
--   correct:       1000 (a second-chance correct: 500)
--                  + speed bonus up to +500, if the lesson's speed_bonus setting is on
--                    and it isn't student-paced: 500 x (1 - elapsed / window), where
--                    elapsed runs from when the question appeared (server clock) and the
--                    window is the activity's time limit, or 20 s
--                  + streak bonus: +100 for each correct answer in a row before this
--                    one, up to +500
--   wrong:         0, and the streak resets
--   poll, open, draw, file (no right answer): 100 for taking part
-- A changed answer replaces its points; totals live on session_participants and
-- are updated under the participant's row lock, so concurrent answers count once.
--
-- The leaderboard: the teacher shows it (session_control 'leaderboard'); the top 10
-- and each one's rank movement since it was last shown are frozen in a snapshot so
-- every screen sees the same board. Students see the top 5 and only their own rank;
-- lower ranks are never shown to the class.

alter table public.session_participants
  add column if not exists total_score   int not null default 0,
  add column if not exists streak        int not null default 0,
  add column if not exists best_streak   int not null default 0,
  add column if not exists correct_count int not null default 0,
  add column if not exists last_rank     int;

alter table public.quiz_answers
  add column if not exists points      int,
  add column if not exists response_ms int;

alter table public.class_sessions
  add column if not exists activity_opened_at timestamptz,
  add column if not exists slide_changed_at   timestamptz,
  add column if not exists show_leaderboard   boolean not null default false,
  add column if not exists leaderboard        jsonb;

create index if not exists session_participants_score_idx on public.session_participants(session_id, total_score desc);

-- When a question appears: the slide changes, an activity is opened, or the lesson starts.
create or replace function app.session_timing() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.current_slide is distinct from old.current_slide or (new.phase = 'active' and old.phase = 'lobby') then
    new.slide_changed_at := now();
  end if;
  if new.active_activity_id is not null and new.active_activity_id is distinct from old.active_activity_id then
    new.activity_opened_at := now();
  end if;
  return new;
end$$;
drop trigger if exists class_sessions_timing on public.class_sessions;
create trigger class_sessions_timing before update on public.class_sessions
  for each row execute function app.session_timing();

-- Points for one answer in a live lesson; updates the participant's totals. Returns the breakdown.
create or replace function app.score_live_answer(
  p_attempt public.quiz_attempts, p_question public.questions, p_activity public.activities,
  p_is_correct boolean, p_tries smallint, p_prev_points int
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_s       public.class_sessions;
  v_base    int := 0;
  v_speed   int := 0;
  v_bonus   int := 0;
  v_prior   int := 0;
  v_streak  int;
  v_start   timestamptz;
  v_window  numeric;
  v_elapsed numeric;
  v_points  int;
  v_p       public.session_participants;
begin
  select * into v_s from public.class_sessions where id = p_attempt.session_id;
  if v_s.id is null then return null; end if;
  v_start := greatest(p_attempt.started_at, coalesce(v_s.slide_changed_at, v_s.started_at),
                      case when v_s.active_activity_id = p_activity.id then v_s.activity_opened_at end);
  v_elapsed := greatest(extract(epoch from now() - v_start), 0);

  if p_question.kind in ('poll', 'open', 'draw', 'file') or p_is_correct is null then
    v_base := 100;
  elsif p_is_correct then
    v_base := case when p_tries = 2 then 500 else 1000 end;
    if p_tries = 1 and v_s.mode <> 'student_paced' and coalesce((v_s.settings ->> 'speed_bonus')::boolean, true) then
      v_window := coalesce(nullif((p_activity.settings ->> 'time_limit_seconds')::int, 0), 20);
      v_speed := round(500 * greatest(0, 1 - v_elapsed / v_window));
    end if;
    -- Correct answers in a row just before this one (questions with a right answer only).
    select count(*) into v_prior from (
      select a.is_correct, sum(case when a.is_correct then 0 else 1 end) over (order by a.answered_at desc) as broken
        from public.quiz_answers a join public.quiz_attempts t on t.id = a.attempt_id
        join public.questions q on q.id = a.question_id
       where t.session_id = v_s.id and t.student_id = p_attempt.student_id and a.question_id <> p_question.id
         and a.is_correct is not null and q.kind not in ('poll', 'open', 'draw', 'file')) x
     where broken = 0;
    if p_tries = 1 then v_bonus := least(100 * v_prior, 500); end if;
  end if;
  v_points := v_base + v_speed + v_bonus;
  v_streak := case when p_is_correct then v_prior + 1 when p_is_correct is false then 0 end;

  update public.session_participants set
      total_score   = total_score - coalesce(p_prev_points, 0) + v_points,
      streak        = coalesce(v_streak, streak),
      best_streak   = greatest(best_streak, coalesce(v_streak, 0)),
      correct_count = (select count(*) from public.quiz_answers a join public.quiz_attempts t on t.id = a.attempt_id
                        where t.session_id = v_s.id and t.student_id = p_attempt.student_id and a.is_correct
                          and a.question_id <> p_question.id) + case when p_is_correct then 1 else 0 end
   where session_id = v_s.id and user_id = p_attempt.student_id
   returning * into v_p;

  return jsonb_build_object('points', v_points, 'base', v_base, 'speed', v_speed, 'streak_bonus', v_bonus,
                            'streak', coalesce(v_p.streak, 0), 'total', coalesce(v_p.total_score, v_points),
                            'response_ms', round(v_elapsed * 1000));
end$$;
revoke execute on function app.score_live_answer(public.quiz_attempts, public.questions, public.activities, boolean, smallint, int) from public, anon, authenticated;

-- Ranks for a session: participants only (never the teacher or removed people).
create or replace function app.session_ranks(p_session uuid)
returns table (user_id uuid, name text, avatar text, score int, rank bigint, last_rank int, streak int)
language sql stable security definer set search_path = '' as $$
  select p.user_id,
         case when coalesce((s.settings ->> 'anonymous_names')::boolean, false)
              then 'Player ' || row_number() over (order by p.joined_at)
              else coalesce(g.display_name, u.full_name) end,
         p.avatar, p.total_score, rank() over (order by p.total_score desc), p.last_rank, p.streak
    from public.session_participants p
    join public.class_sessions s on s.id = p.session_id
    join public.users u on u.id = p.user_id
    left join public.session_guests g on g.session_id = p.session_id and g.user_id = p.user_id
   where p.session_id = p_session and p.user_id <> s.teacher_id and p.removed_at is null
$$;
revoke execute on function app.session_ranks(uuid) from public, anon, authenticated;

-- Freeze the current top 10 (with movement since the last board) for everyone to see.
create or replace function app.snapshot_leaderboard(p_session uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_board jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('name', r.name, 'avatar', r.avatar, 'score', r.score, 'rank', r.rank,
                                               'delta', coalesce(r.last_rank, r.rank) - r.rank) order by r.rank, r.name), '[]'::jsonb)
    into v_board
    from (select * from app.session_ranks(p_session) order by rank, name limit 10) r;
  update public.session_participants p set last_rank = r.rank
    from app.session_ranks(p_session) r where p.session_id = p_session and p.user_id = r.user_id;
  update public.class_sessions set show_leaderboard = true, leaderboard = jsonb_build_object('at', now(), 'top', v_board)
   where id = p_session;
  return v_board;
end$$;
revoke execute on function app.snapshot_leaderboard(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Existing functions, changed only where noted (scoring, leaderboard).
-- ---------------------------------------------------------------------------

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
                                  'max_score', v_attempt.max_score, 'submitted_at', v_attempt.submitted_at,
                                  'points', case when coalesce(v_act.settings ->> 'show_feedback', 'after_submit') = 'never' then null
                                                 else (select sum(points) from public.quiz_answers where attempt_id = p_attempt) end),
    'results', case when coalesce(v_act.settings ->> 'show_feedback', 'after_submit') = 'never' then null else (
       select coalesce(jsonb_agg(jsonb_build_object('question_id', a.question_id, 'is_correct', a.is_correct,
                        'score', coalesce(a.manual_score, a.auto_score), 'status', a.status, 'feedback', a.feedback)
                        || app.reveal_answer(q)), '[]'::jsonb)
       from public.quiz_answers a join public.questions q on q.id = a.question_id where a.attempt_id = p_attempt) end);
end$$;

create or replace function public.session_control(p_session uuid, p_action text, p_args jsonb default '{}'::jsonb)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_s      public.class_sessions := app.require_live_session(p_session);
  v_n      int;
  v_target int;
  v_user   uuid;
  v_bad    text;
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
    when 'end' then
      return public.end_session(p_session);
    else
      raise exception 'Unknown action: %.', p_action using errcode = '22023';
  end case;
  select * into v_s from public.class_sessions where id = p_session;
  return jsonb_build_object('phase', v_s.phase, 'slide', v_s.current_slide, 'settings', v_s.settings, 'v', v_s.state_version);
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

create or replace function public.teacher_session_state(p_session uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_s        public.class_sessions;
  v_settings public.tenant_settings;
  r          public.browser_sessions;
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
    'activity', case when v_s.active_activity_id is null then null
                     else public.activity_results(v_s.active_activity_id, p_session) end);
end$$;

create or replace function public.health() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('ok', true, 'db_time', now(), 'schema', '0890')
$$;
