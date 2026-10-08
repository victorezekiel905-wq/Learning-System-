-- 0940: the game look's rules (docs/LIVE_ENGINE.md).
--
-- * A countdown on each activity in a teacher-paced live lesson (game setting
--   "timer", on unless the teacher turns it off). The time is the activity's
--   time limit, or per question: 20 s for choices, 45 s fill in the blank,
--   90 s written answers, 60 s anything else.
-- * The class shares one clock, from when the question appeared. Once it runs
--   out (plus 2 s for the network) the server refuses answers.
-- * Pausing stops the clock: resuming moves the question's start (and with it
--   the speed bonus) forward by the length of the pause.
-- * Student and teacher states carry the timer; "auto_reveal" is a new game
--   setting (the teacher's screen reveals answers when time is up).

alter table public.class_sessions add column if not exists paused_at timestamptz;

/** The countdown for the activity on screen, or null when there is none. */
create or replace function app.live_timer(p_s public.class_sessions) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_act public.activities; v_start timestamptz; v_secs int;
begin
  if p_s.status <> 'live' or p_s.phase is distinct from 'active' or p_s.mode = 'student_paced'
     or not coalesce((p_s.settings ->> 'timer')::boolean, true) then
    return null;
  end if;
  select a.* into v_act from public.activities a
   where a.id = coalesce(p_s.active_activity_id,
                         (select sl.activity_id from public.lesson_slides sl where sl.lesson_id = p_s.lesson_id and sl.position = p_s.current_slide));
  if v_act.id is null or v_act.kind = 'collab_board' or p_s.revealed_activity_id is not distinct from v_act.id then return null; end if;
  v_secs := nullif((v_act.settings ->> 'time_limit_seconds')::int, 0);
  if v_secs is null then
    select sum(case when q.kind in ('mcq', 'true_false', 'poll', 'multi_select') then 20 when q.kind = 'fill_blank' then 45
                    when q.kind in ('open', 'short') then 90 else 60 end)::int
      into v_secs from public.questions q where q.activity_id = v_act.id;
  end if;
  if coalesce(v_secs, 0) <= 0 then return null; end if;
  v_secs := least(v_secs, 3600);
  v_start := greatest(coalesce(p_s.slide_changed_at, p_s.started_at),
                      case when p_s.active_activity_id = v_act.id then p_s.activity_opened_at end);
  if v_start is null then return null; end if;
  return jsonb_build_object('activity_id', v_act.id, 'started_at', v_start, 'seconds', v_secs,
                            'ends_at', v_start + make_interval(secs => v_secs));
end$$;
revoke execute on function app.live_timer(public.class_sessions) from public, anon, authenticated;

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
      update public.class_sessions set phase = 'paused', paused_at = now() where id = p_session;
    when 'resume' then
      if v_s.phase <> 'paused' then raise exception 'The lesson isn''t paused.' using errcode = 'P0001'; end if;
      -- The question clock (and the speed bonus) stand still while paused.
      update public.class_sessions set phase = 'active', paused_at = null,
             slide_changed_at = slide_changed_at + (now() - coalesce(paused_at, now())),
             activity_opened_at = activity_opened_at + (now() - coalesce(paused_at, now()))
       where id = p_session;
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
       where k <> all (array['leaderboard', 'anonymous_names', 'late_join', 'speed_bonus', 'timer', 'auto_reveal'])
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
  v_timer   jsonb;
begin
  select * into v_s from public.class_sessions where id = p_attempt.session_id;
  if v_s.id is null then return null; end if;
  v_start := greatest(p_attempt.started_at, coalesce(v_s.slide_changed_at, v_s.started_at),
                      case when v_s.active_activity_id = p_activity.id then v_s.activity_opened_at end);
  v_elapsed := greatest(extract(epoch from now() - v_start), 0);
  -- Countdown (0940): once the class's time is up, no more answers (2 s grace for the network).
  v_timer := app.live_timer(v_s);
  if v_timer is not null and (v_timer ->> 'activity_id')::uuid = p_activity.id
     and now() > (v_timer ->> 'ends_at')::timestamptz + interval '2 seconds' then
    raise exception 'Time''s up for this question.' using errcode = 'P0001';
  end if;

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
    'server_now', now(),
    'timer', app.live_timer(v_s));
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
    'timer', app.live_timer(v_s),
    'activity', case when v_cur is null then null
                     else public.activity_results(v_cur, p_session) || jsonb_build_object(
                       'answered', (select count(distinct t.student_id) from public.quiz_attempts t
                                     where t.session_id = p_session and t.activity_id = v_cur
                                       and exists (select 1 from public.quiz_answers a where a.attempt_id = t.id)),
                       'joined', (select count(*) from public.session_participants sp where sp.session_id = p_session
                                   and sp.user_id <> v_s.teacher_id and sp.removed_at is null and sp.left_at is null),
                       'revealed', v_s.revealed_activity_id is not distinct from v_cur) end);
end$$;

create or replace function public.health() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('ok', true, 'db_time', now(), 'schema', '0940')
$$;
