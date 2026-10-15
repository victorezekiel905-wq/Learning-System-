-- The leaderboard shows the whole class: the snapshot keeps every player (up to 500,
-- was the top 10), and students see all of it (was the top 5 and their own place).
-- Same as 0890 and 0940 otherwise.
create or replace function app.snapshot_leaderboard(p_session uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_board jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('name', r.name, 'avatar', r.avatar, 'score', r.score, 'rank', r.rank,
                                               'delta', coalesce(r.last_rank, r.rank) - r.rank) order by r.rank, r.name), '[]'::jsonb)
    into v_board
    from (select * from app.session_ranks(p_session) order by rank, name limit 500) r;
  update public.session_participants p set last_rank = r.rank
    from app.session_ranks(p_session) r where p.session_id = p_session and p.user_id = r.user_id;
  update public.class_sessions set show_leaderboard = true, leaderboard = jsonb_build_object('at', now(), 'top', v_board)
   where id = p_session;
  return v_board;
end$$;
revoke execute on function app.snapshot_leaderboard(uuid) from public, anon, authenticated;

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
      (select coalesce(jsonb_agg(e order by (e ->> 'rank')::int), '[]'::jsonb) from jsonb_array_elements(v_s.leaderboard -> 'top') e) end,
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

create or replace function public.health() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('ok', true, 'db_time', now(), 'schema', '1160')
$$;
