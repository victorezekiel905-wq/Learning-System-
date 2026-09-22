-- =============================================================================
-- SwiftCipher — 0620 Challenge (game) RPCs (§3.3, §13)
--
-- Scoring (all server side):
--   base   = 1000 × question.points, if correct
--   speed  = up to +50% of base, linear in time remaining (optional)
--   streak = +100 per consecutive correct answer beyond the first, capped at +500 (optional)
-- Anti-lag normalisation: the client reports how long the question was on
-- screen; we accept it only within [server_elapsed − 1500 ms, server_elapsed],
-- so network delay never costs points but a client cannot claim to be faster
-- than 1.5 s better than the server observed.
-- =============================================================================

create or replace function app.game_points(
  p_correct boolean, p_points numeric, p_speed_enabled boolean, p_streak_enabled boolean,
  p_elapsed_ms int, p_duration_ms int, p_prev_streak int
) returns jsonb
language sql immutable set search_path = '' as $$
  select case when not p_correct then
    jsonb_build_object('base', 0, 'speed', 0, 'streak', 0)
  else jsonb_build_object(
    'base', round(1000 * p_points)::int,
    'speed', case when p_speed_enabled and p_duration_ms > 0
                  then round(1000 * p_points * 0.5 * greatest(0, 1 - least(p_elapsed_ms::numeric / p_duration_ms, 1)))::int
                  else 0 end,
    'streak', case when p_streak_enabled then least(greatest(p_prev_streak, 0), 5) * 100 else 0 end)
  end
$$;

create or replace function app.normalize_elapsed(p_server_ms int, p_client_ms int) returns int
language sql immutable set search_path = '' as $$
  select greatest(0, case when p_client_ms is null then greatest(p_server_ms - 250, 0)
                          else least(greatest(p_client_ms, p_server_ms - 1500), p_server_ms) end)
$$;

create or replace function app.game_settings(p jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'question_seconds', least(greatest(coalesce((p ->> 'question_seconds')::int, 20), 5), 240),
    'speed_bonus',      coalesce((p ->> 'speed_bonus')::boolean, true),
    'streak_bonus',     coalesce((p ->> 'streak_bonus')::boolean, true),
    'rank_visibility',  case when p ->> 'rank_visibility' in ('after_each','end_only','hidden') then p ->> 'rank_visibility' else 'after_each' end,
    'display_mode',     case when p ->> 'display_mode' in ('first_name_initial','nickname','anonymous') then p ->> 'display_mode' else 'first_name_initial' end,
    'team_mode',        coalesce((p ->> 'team_mode')::boolean, false),
    'team_count',       least(greatest(coalesce((p ->> 'team_count')::int, 2), 2), 6),
    'shuffle_questions', coalesce((p ->> 'shuffle_questions')::boolean, false),
    'shuffle_options',  coalesce((p ->> 'shuffle_options')::boolean, true),
    'podium_size',      least(greatest(coalesce((p ->> 'podium_size')::int, 3), 1), 10),
    'certificates',     coalesce((p ->> 'certificates')::boolean, true))
$$;

create or replace function public.create_game(
  p_class uuid, p_activity uuid, p_settings jsonb default '{}'::jsonb, p_session uuid default null, p_title text default null
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me    public.users := app.me();
  v_act   public.activities;
  v_set   jsonb := app.game_settings(p_settings);
  v_order uuid[];
  v_game  public.game_sessions;
  v_colors text[] := array['#ef4444','#3b82f6','#22c55e','#f59e0b','#a855f7','#14b8a6'];
  v_names  text[] := array['Red Rockets','Blue Comets','Green Geckos','Gold Falcons','Purple Owls','Teal Tigers'];
begin
  if not app.can_manage_class(p_class) then raise exception 'Not your class.' using errcode = '42501'; end if;
  if not app.feature(v_me.tenant_id, 'games') then raise exception 'Games are not included in your plan.' using errcode = 'P0001'; end if;
  select * into v_act from public.activities where id = p_activity and tenant_id = v_me.tenant_id;
  if v_act.id is null or not app.can_view_activity(p_activity) then raise exception 'Quiz not found.' using errcode = 'P0002'; end if;
  if p_session is not null and app.session_class(p_session) is distinct from p_class then
    raise exception 'That live session belongs to another class.' using errcode = '22023';
  end if;

  select array_agg(q.id order by case when (v_set ->> 'shuffle_questions')::boolean then md5(random()::text) else lpad(q.position::text, 6, '0') || q.created_at::text end)
    into v_order
  from public.questions q where q.activity_id = p_activity and q.kind in ('mcq','true_false','multi_select');
  if coalesce(array_length(v_order, 1), 0) = 0 then
    raise exception 'Games need at least one multiple-choice or true/false question.' using errcode = 'P0001';
  end if;

  insert into public.game_sessions (tenant_id, class_id, host_id, activity_id, session_id, title, join_code, settings, question_order)
    values (v_me.tenant_id, p_class, v_me.id, p_activity, p_session, coalesce(nullif(btrim(p_title), ''), v_act.title),
            app.unique_code(6, 'game_sessions'), v_set, v_order)
    returning * into v_game;

  if (v_set ->> 'team_mode')::boolean then
    insert into public.game_teams (tenant_id, game_id, name, color)
      select v_me.tenant_id, v_game.id, v_names[i], v_colors[i] from generate_series(1, (v_set ->> 'team_count')::int) i;
  end if;

  perform app.audit('game.created', 'game', v_game.id::text, jsonb_build_object('class_id', p_class, 'activity_id', p_activity));
  perform app.notify(m.user_id, 'game_created', 'A Challenge is open: ' || v_game.title, 'Join code ' || v_game.join_code,
                     '/student/game/' || v_game.id, 'info', jsonb_build_object('game_id', v_game.id))
  from public.class_members m where m.class_id = p_class and m.role = 'student';
  return to_jsonb(v_game);
end$$;

create or replace function public.join_game(p_code text, p_nickname text default null) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me     public.users := app.me();
  v_game   public.game_sessions;
  v_name   text;
  v_team   uuid;
  v_player public.game_players;
  v_n      int;
begin
  select * into v_game from public.game_sessions where join_code = upper(btrim(p_code)) and status <> 'ended';
  if v_game.id is null then raise exception 'No open game with that code.' using errcode = 'P0002'; end if;
  if not app.in_class(v_game.class_id) or v_me.role <> 'student' then
    raise exception 'This game is for students in another class.' using errcode = '42501';
  end if;

  select * into v_player from public.game_players where game_id = v_game.id and user_id = v_me.id;
  if v_player.id is not null then return jsonb_build_object('game_id', v_game.id, 'player_id', v_player.id, 'display_name', v_player.display_name); end if;

  case v_game.settings ->> 'display_mode'
    when 'nickname' then
      v_name := regexp_replace(btrim(coalesce(p_nickname, '')), '\s+', ' ', 'g');
      if v_name !~ '^[A-Za-z0-9][A-Za-z0-9 _-]{1,19}$' then
        raise exception 'Nicknames are 2-20 letters, numbers, spaces, - or _.' using errcode = '22023';
      end if;
      if exists (select 1 from public.game_players where game_id = v_game.id and lower(display_name) = lower(v_name)) then
        raise exception 'That nickname is taken in this game.' using errcode = 'P0001';
      end if;
    when 'anonymous' then
      select count(*) + 1 into v_n from public.game_players where game_id = v_game.id;
      v_name := 'Player ' || v_n;
    else
      v_name := app.display_name(v_me.full_name);
  end case;

  if (v_game.settings ->> 'team_mode')::boolean then
    select t.id into v_team from public.game_teams t
      left join public.game_players p on p.team_id = t.id
     where t.game_id = v_game.id group by t.id order by count(p.id), t.name limit 1;
  end if;

  insert into public.game_players (tenant_id, game_id, user_id, display_name, team_id)
    values (v_me.tenant_id, v_game.id, v_me.id, v_name, v_team) returning * into v_player;
  return jsonb_build_object('game_id', v_game.id, 'player_id', v_player.id, 'display_name', v_player.display_name);
end$$;

create or replace function app.require_game_host(p_game uuid) returns public.game_sessions
language plpgsql stable security definer set search_path = '' as $$
declare v public.game_sessions;
begin
  select * into v from public.game_sessions where id = p_game;
  if v.id is null then raise exception 'Game not found.' using errcode = 'P0002'; end if;
  if not app.can_manage_class(v.class_id) then raise exception 'Only the host can control this game.' using errcode = '42501'; end if;
  return v;
end$$;

-- Rank snapshot after a question closes (leaderboard history, §18).
create or replace function app.snapshot_leaderboard(p_game uuid, p_index int) returns void
language sql volatile security definer set search_path = '' as $$
  insert into public.leaderboard_entries (tenant_id, game_id, player_id, question_index, rank, score)
  select p.tenant_id, p.game_id, p.id, p_index,
         rank() over (order by p.score desc, p.correct_count desc), p.score
  from public.game_players p where p.game_id = p_game
  on conflict (game_id, question_index, player_id) do update set rank = excluded.rank, score = excluded.score
$$;

create or replace function app.open_question(p_game public.game_sessions, p_index int) returns void
language sql volatile security definer set search_path = '' as $$
  update public.game_sessions set status = 'question', current_index = p_index,
    question_started_at = now(),
    question_ends_at = now() + make_interval(secs => (p_game.settings ->> 'question_seconds')::int),
    started_at = coalesce(started_at, now())
  where id = p_game.id
$$;

create or replace function app.close_question(p_game uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v public.game_sessions;
begin
  update public.game_sessions set status = 'review', question_ends_at = least(question_ends_at, now())
   where id = p_game and status = 'question' returning * into v;
  if v.id is not null then perform app.snapshot_leaderboard(p_game, v.current_index); end if;
end$$;

create or replace function app.finish_game(p_game uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v public.game_sessions; v_total int; v_podium int;
begin
  select * into v from public.game_sessions where id = p_game;
  if v.status = 'ended' then return; end if;
  if v.status = 'question' then perform app.close_question(p_game); end if;
  update public.game_sessions set status = 'ended', ended_at = now() where id = p_game;
  v_total := coalesce(array_length(v.question_order, 1), 0);
  v_podium := (v.settings ->> 'podium_size')::int;

  with ranked as (
    select p.id, rank() over (order by p.score desc, p.correct_count desc) as rk, p.correct_count, p.best_streak,
           (select avg(a.scored_elapsed_ms) from public.game_answers a where a.player_id = p.id and a.is_correct) as avg_ms
    from public.game_players p where p.game_id = p_game),
  fastest as (select id from ranked where avg_ms is not null order by avg_ms limit 1)
  update public.game_players p set badges = array_remove(array[
      case when r.rk = 1 then 'gold' when r.rk = 2 then 'silver' when r.rk = 3 then 'bronze' end,
      case when r.rk <= v_podium then 'podium' end,
      case when v_total > 0 and r.correct_count = v_total then 'perfect' end,
      case when r.best_streak >= 5 then 'streak_5' end,
      case when r.id in (select id from fastest) then 'speedster' end], null)
  from ranked r where r.id = p.id;
end$$;

create or replace function public.game_control(p_game uuid, p_action text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v public.game_sessions := app.require_game_host(p_game); v_total int;
begin
  v_total := coalesce(array_length(v.question_order, 1), 0);
  case p_action
    when 'start' then
      if v.status <> 'lobby' then raise exception 'The game has already started.' using errcode = 'P0001'; end if;
      perform app.open_question(v, 0);
    when 'close' then
      perform app.close_question(p_game);
    when 'next' then
      if v.status = 'question' then perform app.close_question(p_game); end if;
      if v.current_index + 1 >= v_total then perform app.finish_game(p_game);
      else perform app.open_question(v, v.current_index + 1); end if;
    when 'end' then
      perform app.finish_game(p_game);
    else raise exception 'Unknown action.' using errcode = '22023';
  end case;
  perform app.audit('game.' || p_action, 'game', p_game::text);
  select * into v from public.game_sessions where id = p_game;
  return jsonb_build_object('status', v.status, 'current_index', v.current_index);
end$$;

create or replace function public.game_answer(p_game uuid, p_index int, p_choice jsonb, p_client_elapsed_ms int default null)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_game    public.game_sessions;
  v_player  public.game_players;
  v_q       public.questions;
  v_grade   jsonb;
  v_correct boolean;
  v_server  int;
  v_scored  int;
  v_dur     int;
  v_pts     jsonb;
begin
  select * into v_game from public.game_sessions where id = p_game;
  if v_game.id is null then raise exception 'Game not found.' using errcode = 'P0002'; end if;
  select * into v_player from public.game_players where game_id = p_game and user_id = auth.uid() for update;
  if v_player.id is null then raise exception 'Join the game first.' using errcode = '42501'; end if;
  if v_game.status <> 'question' or v_game.current_index <> p_index
     or now() > v_game.question_ends_at + interval '1500 milliseconds' then
    raise exception 'The answer window is closed.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.game_answers where player_id = v_player.id and question_index = p_index) then
    raise exception 'You already answered this question.' using errcode = 'P0001';
  end if;

  select * into v_q from public.questions where id = v_game.question_order[p_index + 1];
  v_grade := app.grade_response(v_q, p_choice);
  v_correct := coalesce((v_grade ->> 'is_correct')::boolean, false);
  v_server := greatest(0, (extract(epoch from (now() - v_game.question_started_at)) * 1000)::int);
  v_scored := app.normalize_elapsed(v_server, p_client_elapsed_ms);
  v_dur := (v_game.settings ->> 'question_seconds')::int * 1000;
  v_pts := app.game_points(v_correct, v_q.points, (v_game.settings ->> 'speed_bonus')::boolean,
                           (v_game.settings ->> 'streak_bonus')::boolean, v_scored, v_dur, v_player.streak);

  insert into public.game_answers (tenant_id, game_id, player_id, question_id, question_index, choice, is_correct,
                                   base_points, speed_bonus, streak_bonus, server_elapsed_ms, scored_elapsed_ms)
    values (v_game.tenant_id, p_game, v_player.id, v_q.id, p_index, p_choice, v_correct,
            (v_pts ->> 'base')::int, (v_pts ->> 'speed')::int, (v_pts ->> 'streak')::int, v_server, v_scored);

  update public.game_players set
    score = score + (v_pts ->> 'base')::int + (v_pts ->> 'speed')::int + (v_pts ->> 'streak')::int,
    correct_count = correct_count + case when v_correct then 1 else 0 end,
    streak = case when v_correct then streak + 1 else 0 end,
    best_streak = greatest(best_streak, case when v_correct then streak + 1 else 0 end)
  where id = v_player.id;

  -- Suspicious-pattern logging (never auto-penalised).
  if v_server < 400 then
    insert into public.game_flags (tenant_id, game_id, player_id, kind, detail)
      values (v_game.tenant_id, p_game, v_player.id, 'answer_too_fast', jsonb_build_object('index', p_index, 'server_ms', v_server));
  end if;
  if p_client_elapsed_ms is not null and abs(p_client_elapsed_ms - v_server) > 5000 then
    insert into public.game_flags (tenant_id, game_id, player_id, kind, detail)
      values (v_game.tenant_id, p_game, v_player.id, 'clock_mismatch',
              jsonb_build_object('index', p_index, 'server_ms', v_server, 'client_ms', p_client_elapsed_ms));
  end if;

  -- Everyone answered? close early.
  if (select count(*) from public.game_answers where game_id = p_game and question_index = p_index)
     >= (select count(*) from public.game_players where game_id = p_game) then
    perform app.close_question(p_game);
  end if;
  return jsonb_build_object('accepted', true);
end$$;

-- Ranking respecting the teacher's visibility rules (§13).
create or replace function public.game_leaderboard(p_game uuid, p_limit int default 10) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_game    public.game_sessions;
  v_host    boolean;
  v_vis     text;
  v_show    boolean;
  v_me      public.game_players;
begin
  select * into v_game from public.game_sessions where id = p_game;
  if v_game.id is null then raise exception 'Game not found.' using errcode = 'P0002'; end if;
  v_host := app.can_manage_class(v_game.class_id);
  if not v_host and not app.in_class(v_game.class_id) then raise exception 'Not your game.' using errcode = '42501'; end if;
  if v_game.status = 'question' and now() > v_game.question_ends_at then
    perform app.close_question(p_game);
    select * into v_game from public.game_sessions where id = p_game;
  end if;

  v_vis := v_game.settings ->> 'rank_visibility';
  v_show := v_host or (v_vis = 'after_each' and v_game.status in ('review','ended'))
                   or (v_vis = 'end_only' and v_game.status = 'ended');
  select * into v_me from public.game_players where game_id = p_game and user_id = auth.uid();

  return jsonb_build_object(
    'visible', v_show,
    'status', v_game.status,
    'players', (select count(*) from public.game_players where game_id = p_game),
    'top', case when v_show then (
      select coalesce(jsonb_agg(row order by (row ->> 'rank')::int, row ->> 'name'), '[]'::jsonb) from (
        select jsonb_build_object('rank', rank() over (order by p.score desc, p.correct_count desc),
               'player_id', p.id, 'name', case when v_host then p.display_name || case when v_game.settings ->> 'display_mode' <> 'first_name_initial'
                                                                                  then ' (' || u.full_name || ')' else '' end
                                               else p.display_name end,
               'score', p.score, 'correct', p.correct_count, 'streak', p.best_streak, 'badges', p.badges,
               'team_id', p.team_id) as row
        from public.game_players p join public.users u on u.id = p.user_id
        where p.game_id = p_game order by p.score desc, p.correct_count desc limit greatest(p_limit, 1)) s) else '[]'::jsonb end,
    'teams', case when (v_game.settings ->> 'team_mode')::boolean and v_show then (
      select coalesce(jsonb_agg(jsonb_build_object('team_id', t.id, 'name', t.name, 'color', t.color,
               'score', (select coalesce(sum(p.score), 0) from public.game_players p where p.team_id = t.id),
               'members', (select count(*) from public.game_players p where p.team_id = t.id))
             order by (select coalesce(sum(p.score), 0) from public.game_players p where p.team_id = t.id) desc), '[]'::jsonb)
      from public.game_teams t where t.game_id = p_game) end,
    -- Students always see their own position, even when the board is hidden.
    'me', case when v_me.id is null then null else jsonb_build_object(
      'player_id', v_me.id, 'name', v_me.display_name, 'score', v_me.score, 'streak', v_me.streak,
      'correct', v_me.correct_count, 'badges', v_me.badges,
      'rank', (select count(*) + 1 from public.game_players p where p.game_id = p_game
               and (p.score > v_me.score or (p.score = v_me.score and p.correct_count > v_me.correct_count)))) end);
end$$;

-- Everything a player or host screen needs, in one round trip.
create or replace function public.game_state(p_game uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_game   public.game_sessions;
  v_host   boolean;
  v_q      public.questions;
  v_player public.game_players;
  v_answer public.game_answers;
  v_out    jsonb;
begin
  select * into v_game from public.game_sessions where id = p_game;
  if v_game.id is null then raise exception 'Game not found.' using errcode = 'P0002'; end if;
  v_host := app.can_manage_class(v_game.class_id);
  if not v_host and not app.in_class(v_game.class_id) then raise exception 'Not your game.' using errcode = '42501'; end if;

  if v_game.status = 'question' and now() > v_game.question_ends_at then
    perform app.close_question(p_game);
    select * into v_game from public.game_sessions where id = p_game;
  end if;

  v_out := jsonb_build_object(
    'id', v_game.id, 'title', v_game.title, 'status', v_game.status, 'join_code', v_game.join_code,
    'current_index', v_game.current_index, 'total', coalesce(array_length(v_game.question_order, 1), 0),
    'question_started_at', v_game.question_started_at, 'question_ends_at', v_game.question_ends_at,
    'server_now', now(), 'settings', v_game.settings, 'is_host', v_host,
    'players', (select count(*) from public.game_players where game_id = p_game));

  if v_game.status in ('question','review') and v_game.current_index >= 0 then
    select * into v_q from public.questions where id = v_game.question_order[v_game.current_index + 1];
    v_out := v_out || jsonb_build_object('question',
      app.sanitize_question(v_q, ('x' || left(md5(v_game.id::text), 8))::bit(32)::int, (v_game.settings ->> 'shuffle_options')::boolean));
    v_out := v_out || jsonb_build_object('answered',
      (select count(*) from public.game_answers where game_id = p_game and question_index = v_game.current_index));
    if v_game.status = 'review' then
      -- Question review after each round (§3.3).
      v_out := v_out || jsonb_build_object('review', app.reveal_answer(v_q) || jsonb_build_object(
        'distribution', (select coalesce(jsonb_object_agg(o.id, (select count(*) from public.game_answers a
                           where a.game_id = p_game and a.question_index = v_game.current_index
                             and (a.choice ->> 'option_id' = o.id::text or a.choice -> 'option_ids' ? o.id::text))), '{}'::jsonb)
                         from public.question_options o where o.question_id = v_q.id)));
    end if;
  end if;

  if v_host then
    v_out := v_out || jsonb_build_object(
      'roster', (select coalesce(jsonb_agg(jsonb_build_object('player_id', p.id, 'name', p.display_name,
                   'full_name', u.full_name, 'team_id', p.team_id,
                   'answered', exists (select 1 from public.game_answers a where a.player_id = p.id and a.question_index = v_game.current_index))
                   order by p.joined_at), '[]'::jsonb)
                 from public.game_players p join public.users u on u.id = p.user_id where p.game_id = p_game),
      'flags', (select count(*) from public.game_flags where game_id = p_game));
  else
    select * into v_player from public.game_players where game_id = p_game and user_id = auth.uid();
    if v_player.id is not null then
      select * into v_answer from public.game_answers where player_id = v_player.id and question_index = v_game.current_index;
      v_out := v_out || jsonb_build_object('me', jsonb_build_object(
        'player_id', v_player.id, 'name', v_player.display_name, 'score', v_player.score, 'streak', v_player.streak,
        'answered', v_answer.id is not null,
        'last', case when v_answer.id is not null and v_game.status in ('review','ended') then jsonb_build_object(
                  'is_correct', v_answer.is_correct,
                  'points', v_answer.base_points + v_answer.speed_bonus + v_answer.streak_bonus) end));
    end if;
  end if;
  return v_out;
end$$;

create or replace function public.game_moderate_player(p_player uuid, p_action text, p_name text default null) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_p public.game_players;
begin
  select * into v_p from public.game_players where id = p_player;
  if v_p.id is null then raise exception 'Player not found.' using errcode = 'P0002'; end if;
  perform app.require_game_host(v_p.game_id);
  if p_action = 'rename' then
    if coalesce(btrim(p_name), '') !~ '^[A-Za-z0-9][A-Za-z0-9 _-]{1,19}$' then
      raise exception 'Nicknames are 2-20 letters, numbers, spaces, - or _.' using errcode = '22023';
    end if;
    update public.game_players set display_name = btrim(p_name) where id = p_player;
  elsif p_action = 'remove' then
    delete from public.game_players where id = p_player;
  else
    raise exception 'Unknown action.' using errcode = '22023';
  end if;
  perform app.audit('game.player_' || p_action, 'game_player', p_player::text);
end$$;
