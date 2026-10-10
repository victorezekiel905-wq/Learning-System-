-- 1090: word clouds, labelled diagrams, and teams in live lessons.
--
-- * word_cloud question: each student sends up to three words; no right answer,
--   participation points; session_word_cloud(activity, session) counts the words
--   for the projector (and for students once results are shared).
-- * label_diagram question: a picture with spots (config.spots, x/y in percent)
--   and labels (config.labels); answer_key.placements maps each spot to its label;
--   marked like sorting into groups, part marks per right spot.
-- * Teams: the teacher turns on 2-6 teams for a live lesson (set_session_teams);
--   everyone in it, and everyone who joins later, goes into the smallest team. Team
--   names follow the answer-tile shapes (Bolt, Star, Hexagon, Moon, Heart, Cloud);
--   session_team_scores totals the members' points.

alter table public.questions drop constraint if exists questions_kind_check;
alter table public.questions add constraint questions_kind_check check (kind in (
  'mcq','multi_select','true_false','poll','open','short','fill_blank',
  'matching','ordering','categorize','draw','file','code','word_cloud','label_diagram'));

-- Marking: the same as before (0610), plus the two new kinds.
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
  v_text     text;
begin
  if p_response is null or jsonb_typeof(p_response) <> 'object' then
    raise exception 'Response must be a JSON object.' using errcode = '22023';
  end if;

  case p_q.kind
  when 'word_cloud' then
    -- Up to three words; no right answer (participation points).
    v_text := regexp_replace(btrim(coalesce(p_response ->> 'text', '')), '\s+', ' ', 'g');
    if length(v_text) < 1 or length(v_text) > 60 then raise exception 'Type a word or two.' using errcode = '22023'; end if;
    if array_length(regexp_split_to_array(v_text, ' '), 1) > 3 then raise exception 'Use three words at most.' using errcode = '22023'; end if;
    return jsonb_build_object('is_correct', null, 'score', null, 'status', 'ungraded');

  when 'label_diagram' then
    -- key: { "placements": { "<spotId>": "<labelId>" } } ; response: { "placements": {...} }
    select count(*), count(*) filter (where p_response -> 'placements' ->> k.key = k.value)
      into v_total, v_hits
    from jsonb_each_text(coalesce(v_key -> 'placements', '{}'::jsonb)) k;
    if v_total = 0 then return jsonb_build_object('is_correct', null, 'score', null, 'status', 'pending_review'); end if;
    v_correct := v_hits = v_total;
    return jsonb_build_object('is_correct', v_correct, 'score', round(v_pts * v_hits / v_total, 2), 'status', 'auto_graded');

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

/**
 * The words for a word cloud: [{word, count}], most common first (lower case, top 60).
 * Teachers of the lesson always; people in it once the teacher shares results.
 */
create or replace function public.session_word_cloud(p_activity uuid, p_session uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_s public.class_sessions;
begin
  select * into v_s from public.class_sessions where id = p_session;
  if v_s.id is null or not (app.can_manage_session(p_session) or (app.in_session(p_session) and (v_s.responses_visible or coalesce(v_s.revealed_activity_id = p_activity, false)))) then
    raise exception 'Not available.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('word', w.word, 'count', w.n) order by w.n desc, w.word)
      from (select lower(regexp_replace(btrim(qa.response ->> 'text'), '\s+', ' ', 'g')) as word, count(*) as n
              from public.quiz_answers qa
              join public.quiz_attempts t on t.id = qa.attempt_id
              join public.questions q on q.id = qa.question_id
             where t.session_id = p_session and t.activity_id = p_activity and q.kind = 'word_cloud'
               and coalesce(btrim(qa.response ->> 'text'), '') <> ''
             group by 1 order by 2 desc, 1 limit 60) w), '[]'::jsonb);
end$$;

-- Teams --------------------------------------------------------------------------

alter table public.session_participants add column if not exists team smallint check (team between 1 and 6);

create or replace function app.team_name(p_team int) returns text
language sql immutable set search_path = '' as $$
  select 'Team ' || (array['Bolt','Star','Hexagon','Moon','Heart','Cloud'])[p_team]
$$;

/** The smallest team in a lesson with teams on (ties: the lower number). */
create or replace function app.next_team(p_session uuid, p_teams int) returns smallint
language sql stable security definer set search_path = '' as $$
  select t::smallint from generate_series(1, p_teams) t
   order by (select count(*) from public.session_participants p
              where p.session_id = p_session and p.team = t and p.removed_at is null), t
   limit 1
$$;

-- Newcomers join a team when the lesson has teams (the teacher never does).
create or replace function app.assign_team() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_s public.class_sessions; v_teams int;
begin
  if new.team is not null then return new; end if;
  select * into v_s from public.class_sessions where id = new.session_id;
  v_teams := coalesce((v_s.settings ->> 'teams')::int, 0);
  if v_teams >= 2 and new.user_id <> v_s.teacher_id then new.team := app.next_team(new.session_id, v_teams); end if;
  return new;
end$$;
drop trigger if exists session_participants_team on public.session_participants;
create trigger session_participants_team before insert on public.session_participants
  for each row execute function app.assign_team();

/** Teacher: teams on (2-6) or off (0). Turning them on shares everyone already in out evenly. */
create or replace function public.set_session_teams(p_session uuid, p_teams int) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_s public.class_sessions; r record; i int := 0;
begin
  if not app.can_manage_session(p_session) then raise exception 'Not your session.' using errcode = '42501'; end if;
  if p_teams is null or not (p_teams = 0 or p_teams between 2 and 6) then raise exception 'Choose 2 to 6 teams, or none.' using errcode = '22023'; end if;
  select * into v_s from public.class_sessions where id = p_session and status = 'live';
  if v_s.id is null then raise exception 'Session not found.' using errcode = 'P0002'; end if;
  update public.class_sessions set settings = settings || jsonb_build_object('teams', p_teams), state_version = state_version + 1 where id = p_session;
  update public.session_participants set team = null where session_id = p_session;
  if p_teams >= 2 then
    for r in select user_id from public.session_participants
              where session_id = p_session and user_id <> v_s.teacher_id and removed_at is null
              order by random() loop
      update public.session_participants set team = (i % p_teams) + 1 where session_id = p_session and user_id = r.user_id;
      i := i + 1;
    end loop;
  end if;
  perform app.audit('session.teams', 'class_session', p_session::text, jsonb_build_object('teams', p_teams));
  return public.session_team_scores(p_session);
end$$;

/** Team standings: [{team, name, score, members, mine}] by score; empty when teams are off. */
create or replace function public.session_team_scores(p_session uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_s public.class_sessions; v_teams int; v_mine smallint;
begin
  select * into v_s from public.class_sessions where id = p_session;
  if v_s.id is null or not (app.can_manage_session(p_session) or app.in_session(p_session)) then
    raise exception 'Session not found.' using errcode = 'P0002';
  end if;
  v_teams := coalesce((v_s.settings ->> 'teams')::int, 0);
  if v_teams < 2 then return '[]'::jsonb; end if;
  select team into v_mine from public.session_participants where session_id = p_session and user_id = auth.uid();
  return (select coalesce(jsonb_agg(jsonb_build_object('team', t, 'name', app.team_name(t), 'score', x.score, 'members', x.members, 'mine', t = v_mine)
                                     order by x.score desc, t), '[]'::jsonb)
            from generate_series(1, v_teams) t
            cross join lateral (select coalesce(sum(p.total_score), 0)::int as score, count(p.user_id)::int as members
                                  from public.session_participants p
                                 where p.session_id = p_session and p.team = t and p.removed_at is null) x);
end$$;

revoke execute on function public.session_word_cloud(uuid, uuid), public.set_session_teams(uuid, int), public.session_team_scores(uuid) from public, anon;
grant execute on function public.session_word_cloud(uuid, uuid), public.set_session_teams(uuid, int), public.session_team_scores(uuid) to authenticated;

-- Guests in a live lesson may also see the pictures of its labelled diagrams.
create or replace function app.guest_can_read_media(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.session_guests g
      join public.class_sessions s on s.id = g.session_id and s.status = 'live'
     where g.user_id = auth.uid() and g.removed_at is null and s.lesson_id is not null
       and (exists (select 1 from public.lesson_slides sl where sl.lesson_id = s.lesson_id
                    and (p_name in (sl.content ->> 'media_path', sl.content ->> 'captions_path', sl.content -> 'background' ->> 'media_path')
                         or sl.content @> jsonb_build_object('elements', jsonb_build_array(jsonb_build_object('media_path', p_name)))))
            or exists (select 1 from public.lesson_media lm where lm.lesson_id = s.lesson_id and lm.storage_path = p_name)
            or exists (select 1 from public.questions q join public.activities a on a.id = q.activity_id
                        where a.lesson_id = s.lesson_id and q.kind = 'label_diagram' and q.config ->> 'image_path' = p_name)))
$$;

create or replace function public.health() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('ok', true, 'db_time', now(), 'schema', '1090')
$$;
