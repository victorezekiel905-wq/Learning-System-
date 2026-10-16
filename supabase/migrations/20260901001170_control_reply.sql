-- The reply to every lesson button (Next, Reveal, Leaderboard, Pause…) carries the new
-- state the teacher's screens show, including the leaderboard, so Present and the control
-- room change at once even when the full lesson state is slow to load.
-- Same as 0940 otherwise.
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
  -- Everything the teacher's screens show after a button, so they needn't wait for a refresh (1170).
  return jsonb_build_object('phase', v_s.phase, 'slide', v_s.current_slide, 'settings', v_s.settings, 'v', v_s.state_version,
    'status', v_s.status, 'activity', v_s.active_activity_id, 'responses_visible', v_s.responses_visible,
    'revealed', v_s.revealed_activity_id, 'show_leaderboard', v_s.show_leaderboard,
    'leaderboard', case when v_s.show_leaderboard then v_s.leaderboard end);
end$$;

create or replace function public.health() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('ok', true, 'db_time', now(), 'schema', '1170')
$$;
