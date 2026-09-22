-- =========================================================================
-- EduClass Fusion — game-play RPCs (v2)
-- Students must NEVER read answer keys; everything is graded server-side.
-- Apply AFTER 20260101000600_more_rpc.sql.
-- =========================================================================

-- Lobby lookup by join code (students joining a game).
create or replace function public.game_by_code(p_code text)
returns table (id uuid, state text, join_code text, class_id uuid)
language sql security definer stable
as $$
  select id, state, join_code, class_id
  from public.game_sessions
  where join_code = upper(p_code) and state <> 'ended'
  order by created_at desc limit 1;
$$;
grant execute on function public.game_by_code(text) to anon, authenticated;

-- Grade one answer: verify against the stored key, update player + leaderboard.
create or replace function public.game_grade_answer(
  p_game uuid, p_question uuid, p_value text, p_nickname text
) returns jsonb
language plpgsql security definer
as $$
declare
  v_q public.questions%rowtype;
  v_player public.game_players%rowtype;
  v_correct boolean;
  v_award int;
begin
  select * into v_q from public.questions q where q.id = p_question;
  if v_q.id is null then raise exception 'question not found'; end if;

  select * into v_player from public.game_players
  where game_id = p_game and nickname = p_nickname;
  if v_player.id is null then raise exception 'player not in game'; end if;

  v_correct := (v_q.answer_key->>'correct') = p_value;
  v_award := case when v_correct then v_q.points else 0 end;

  update public.game_players
  set score = v_player.score + v_award,
      streak = case when v_correct then v_player.streak + 1 else 0 end
  where id = v_player.id
  returning score, streak into v_player.score, v_player.streak;

  insert into public.leaderboard_entries (game_id, rank, player_id, score)
  values (p_game, 0, v_player.id, v_player.score);

  return jsonb_build_object('correct', v_correct, 'awarded', v_award,
                            'score', v_player.score, 'streak', v_player.streak);
end$$;
grant execute on function public.game_grade_answer(uuid, uuid, text, text) to authenticated;
