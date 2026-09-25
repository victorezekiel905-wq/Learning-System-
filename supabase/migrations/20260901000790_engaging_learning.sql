-- =============================================================================
-- SwiftCipher — 0790 engaging, student-centred learning
--
-- Differentiated learning: each student has a challenge level per class
--   (1 Support, 2 Core, 3 Extension). In a differentiated activity a student gets
--   the questions within ±1 of their level's difficulty band (untagged questions
--   go to everyone); the server enforces it.
-- Student-driven: students may choose their own level ("Choose your challenge")
--   when the teacher allows it; teachers see suggested levels from accuracy.
-- Critical thinking: a question can require "Explain your reasoning" plus a
--   confidence rating; questions carry a Bloom's level; teachers get a
--   misconception view (confident but wrong) with the students' reasoning.
-- Gamified across all learning: XP (harder questions and explained reasoning
--   earn more), levels, badges with notifications, an opt-in class leaderboard.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Schema
-- ---------------------------------------------------------------------------
alter table public.questions add column if not exists bloom_level text
  check (bloom_level is null or bloom_level in ('remember','understand','apply','analyze','evaluate','create'));

alter table public.class_members
  add column if not exists level smallint not null default 2 check (level between 1 and 3),
  add column if not exists level_set_by text not null default 'default' check (level_set_by in ('default','teacher','student'));

alter table public.classes
  add column if not exists leaderboard_enabled boolean not null default true,
  add column if not exists student_choice_enabled boolean not null default true;

alter table public.quiz_attempts add column if not exists level smallint check (level is null or level between 1 and 3);

create table if not exists public.xp_events (
  id         bigint generated always as identity primary key,
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  student_id uuid not null,
  class_id   uuid,
  source     text not null check (source in ('answer','reasoning','completion','perfect','game','teacher')),
  source_id  uuid not null,
  points     int not null check (points between 1 and 100),
  reason     text not null check (length(reason) <= 200),
  created_at timestamptz not null default now(),
  unique (student_id, source, source_id),
  foreign key (student_id, tenant_id) references public.users(id, tenant_id) on delete cascade
);
create index if not exists xp_events_student_idx on public.xp_events(student_id, created_at desc);
create index if not exists xp_events_class_time_idx on public.xp_events(class_id, created_at desc) where class_id is not null;
create index if not exists xp_events_tenant_time_idx on public.xp_events(tenant_id, created_at);

create table if not exists public.student_badges (
  student_id uuid not null,
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  badge      text not null check (badge in ('first_steps','rising_star','scholar','deep_thinker','perfectionist','challenger','shout_out','game_on')),
  earned_at  timestamptz not null default now(),
  primary key (student_id, badge),
  foreign key (student_id, tenant_id) references public.users(id, tenant_id) on delete cascade
);
create index if not exists student_badges_tenant_idx on public.student_badges(tenant_id);

alter table public.xp_events enable row level security;
alter table public.student_badges enable row level security;
revoke all on public.xp_events, public.student_badges from anon, authenticated;
grant select on public.xp_events, public.student_badges to authenticated;
drop policy if exists xp_events_read on public.xp_events;
create policy xp_events_read on public.xp_events for select to authenticated
  using (tenant_id = (select app.tenant_id())
         and (student_id = (select auth.uid()) or (select app.is_admin()) or app.teaches_student(student_id) or app.is_parent_of(student_id)));
drop policy if exists student_badges_read on public.student_badges;
create policy student_badges_read on public.student_badges for select to authenticated
  using (tenant_id = (select app.tenant_id())
         and (student_id = (select auth.uid()) or (select app.is_admin()) or app.teaches_student(student_id) or app.is_parent_of(student_id)));

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
-- Level n (1 Support, 2 Core, 3 Extension) covers difficulty n .. n+2; untagged questions go to everyone.
create or replace function app.question_in_level(p_difficulty smallint, p_level smallint) returns boolean
language sql immutable set search_path = '' as $$
  select p_level is null or p_difficulty is null or p_difficulty between p_level and p_level + 2
$$;

-- XP needed for level n is 50·n·(n−1): 0, 100, 300, 600, 1000, …
create or replace function app.xp_level(p_xp bigint) returns int
language sql immutable set search_path = '' as $$
  select greatest(1, floor((1 + sqrt(1 + 0.08 * greatest(p_xp, 0))) / 2))::int
$$;

create or replace function app.attempt_class(p_attempt public.quiz_attempts) returns uuid
language sql stable security definer set search_path = '' as $$
  select coalesce((select s.class_id from public.class_sessions s where s.id = p_attempt.session_id),
                  (select a.class_id from public.assignments a where a.id = p_attempt.assignment_id))
$$;

create or replace function app.give_xp(p_tenant uuid, p_student uuid, p_class uuid, p_source text, p_source_id uuid, p_points int, p_reason text)
returns void language sql volatile security definer set search_path = '' as $$
  insert into public.xp_events (tenant_id, student_id, class_id, source, source_id, points, reason)
    values (p_tenant, p_student, p_class, p_source, p_source_id, least(greatest(p_points, 1), 100), left(p_reason, 200))
    on conflict (student_id, source, source_id) do nothing
$$;

create or replace function app.give_badge(p_tenant uuid, p_student uuid, p_badge text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_new boolean;
begin
  insert into public.student_badges (student_id, tenant_id, badge) values (p_student, p_tenant, p_badge)
    on conflict do nothing returning true into v_new;
  if v_new then
    perform app.notify(p_student, 'badge', 'New badge: ' || case p_badge
        when 'first_steps' then 'First steps' when 'rising_star' then 'Rising star' when 'scholar' then 'Scholar'
        when 'deep_thinker' then 'Deep thinker' when 'perfectionist' then 'Perfectionist' when 'challenger' then 'Challenger'
        when 'shout_out' then 'Teacher shout-out' when 'game_on' then 'Game on' else p_badge end,
      null, '/student', 'info', jsonb_build_object('badge', p_badge));
  end if;
end$$;

-- After every XP event: award the badges it unlocks.
create or replace function app.on_xp_event() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_total bigint; v_reasoned int; v_games int;
begin
  select coalesce(sum(points), 0) into v_total from public.xp_events where student_id = new.student_id;
  perform app.give_badge(new.tenant_id, new.student_id, 'first_steps');
  if v_total >= 100 then perform app.give_badge(new.tenant_id, new.student_id, 'rising_star'); end if;
  if v_total >= 1000 then perform app.give_badge(new.tenant_id, new.student_id, 'scholar'); end if;
  if new.source = 'reasoning' then
    select count(*) into v_reasoned from public.xp_events where student_id = new.student_id and source = 'reasoning';
    if v_reasoned >= 10 then perform app.give_badge(new.tenant_id, new.student_id, 'deep_thinker'); end if;
  elsif new.source = 'perfect' then perform app.give_badge(new.tenant_id, new.student_id, 'perfectionist');
  elsif new.source = 'teacher' then perform app.give_badge(new.tenant_id, new.student_id, 'shout_out');
  elsif new.source = 'game' then
    select count(*) into v_games from public.xp_events where student_id = new.student_id and source = 'game';
    if v_games >= 3 then perform app.give_badge(new.tenant_id, new.student_id, 'game_on'); end if;
  end if;
  return null;
end$$;
drop trigger if exists xp_events_badges on public.xp_events;
create trigger xp_events_badges after insert on public.xp_events for each row execute function app.on_xp_event();

-- ---------------------------------------------------------------------------
-- Answers: level + reasoning rules (server-enforced), then XP
-- ---------------------------------------------------------------------------
create or replace function app.check_answer_rules() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_q public.questions; v_level smallint; v_conf text;
begin
  select * into v_q from public.questions where id = new.question_id;
  select level into v_level from public.quiz_attempts where id = new.attempt_id;
  if not app.question_in_level(v_q.difficulty, v_level) then
    raise exception 'This question is not part of your challenge level.' using errcode = '42501';
  end if;
  if coalesce((v_q.config ->> 'require_reasoning')::boolean, false)
     and v_q.kind in ('mcq','multi_select','true_false','short','fill_blank','ordering','matching','categorize')
     and length(btrim(coalesce(new.response ->> 'reasoning', ''))) < 15 then
    raise exception 'Explain your reasoning (at least one sentence) before submitting this answer.' using errcode = '22023';
  end if;
  v_conf := new.response ->> 'confidence';
  if v_conf is not null and v_conf !~ '^[1-5]$' then
    raise exception 'Confidence must be between 1 and 5.' using errcode = '22023';
  end if;
  if length(coalesce(new.response ->> 'reasoning', '')) > 2000 then
    raise exception 'Keep your reasoning under 2,000 characters.' using errcode = '22023';
  end if;
  return new;
end$$;
drop trigger if exists quiz_answers_rules on public.quiz_answers;
create trigger quiz_answers_rules before insert or update of response on public.quiz_answers
  for each row execute function app.check_answer_rules();

create or replace function app.answer_xp() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_att public.quiz_attempts; v_q public.questions; v_class uuid;
begin
  select * into v_att from public.quiz_attempts where id = new.attempt_id;
  select * into v_q from public.questions where id = new.question_id;
  v_class := app.attempt_class(v_att);
  if new.is_correct and (tg_op = 'INSERT' or old.is_correct is distinct from true) then
    perform app.give_xp(new.tenant_id, v_att.student_id, v_class, 'answer', new.id,
      10 + 5 * greatest(coalesce(v_q.difficulty, 3) - 3, 0),
      case when coalesce(v_q.difficulty, 3) >= 4 then 'Correct answer to a challenge question' else 'Correct answer' end);
  end if;
  -- Thinking is rewarded whether or not the answer was right.
  if length(btrim(coalesce(new.response ->> 'reasoning', ''))) >= 15 then
    perform app.give_xp(new.tenant_id, v_att.student_id, v_class, 'reasoning', new.id, 5, 'Explained your reasoning');
  end if;
  return null;
end$$;
drop trigger if exists quiz_answers_xp on public.quiz_answers;
create trigger quiz_answers_xp after insert or update on public.quiz_answers
  for each row execute function app.answer_xp();

create or replace function app.attempt_xp() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_class uuid; v_title text;
begin
  if new.status = 'in_progress' then return null; end if;
  v_class := app.attempt_class(new);
  select title into v_title from public.activities where id = new.activity_id;
  perform app.give_xp(new.tenant_id, new.student_id, v_class, 'completion', new.id, 20, 'Completed ' || coalesce(v_title, 'an activity'));
  if new.max_score > 0 and new.score >= new.max_score and new.status = 'graded' then
    perform app.give_xp(new.tenant_id, new.student_id, v_class, 'perfect', new.id, 20, 'Perfect score on ' || coalesce(v_title, 'an activity'));
  end if;
  return null;
end$$;
drop trigger if exists quiz_attempts_xp on public.quiz_attempts;
create trigger quiz_attempts_xp after update on public.quiz_attempts
  for each row when (new.status <> 'in_progress') execute function app.attempt_xp();

create or replace function app.game_xp() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_class uuid;
begin
  if new.user_id is null then return null; end if;
  select class_id into v_class from public.game_sessions where id = new.game_id;
  perform app.give_xp(new.tenant_id, new.user_id, v_class, 'game', new.game_id, 10, 'Played a class game');
  return null;
end$$;
drop trigger if exists game_players_xp on public.game_players;
create trigger game_players_xp after insert on public.game_players for each row execute function app.game_xp();

-- ---------------------------------------------------------------------------
-- Student-facing RPCs
-- ---------------------------------------------------------------------------
create or replace function public.my_progress() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_me public.users := app.me(); v_xp bigint; v_level int;
begin
  select coalesce(sum(points), 0) into v_xp from public.xp_events where student_id = v_me.id;
  v_level := app.xp_level(v_xp);
  return jsonb_build_object(
    'xp', v_xp, 'level', v_level,
    'level_floor', 50 * v_level * (v_level - 1), 'next_level_xp', 50 * (v_level + 1) * v_level,
    'week_xp', (select coalesce(sum(points), 0) from public.xp_events where student_id = v_me.id and created_at > now() - interval '7 days'),
    'badges', (select coalesce(jsonb_agg(jsonb_build_object('badge', b.badge, 'earned_at', b.earned_at) order by b.earned_at), '[]'::jsonb)
               from public.student_badges b where b.student_id = v_me.id),
    'recent', (select coalesce(jsonb_agg(jsonb_build_object('points', e.points, 'reason', e.reason, 'at', e.created_at) order by e.created_at desc), '[]'::jsonb)
               from (select * from public.xp_events where student_id = v_me.id order by created_at desc limit 8) e),
    'classes', (select coalesce(jsonb_agg(jsonb_build_object('class_id', c.id, 'name', c.name, 'level', m.level, 'level_set_by', m.level_set_by,
                  'choice_enabled', c.student_choice_enabled, 'leaderboard_enabled', c.leaderboard_enabled) order by c.name), '[]'::jsonb)
                from public.class_members m join public.classes c on c.id = m.class_id
                where m.user_id = v_me.id and m.role = 'student' and c.archived_at is null));
end$$;

-- Top of the class (this week or all time). Classmates see first name + initial; teachers see full names.
create or replace function public.class_leaderboard(p_class uuid, p_period text default 'week', p_limit int default 10) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_c public.classes; v_staff boolean;
begin
  select * into v_c from public.classes where id = p_class;
  v_staff := app.can_manage_class(p_class);
  if v_c.id is null or not (v_staff or app.in_class(p_class)) then raise exception 'Class not found.' using errcode = 'P0002'; end if;
  if not v_c.leaderboard_enabled and not v_staff then return jsonb_build_object('enabled', false, 'rows', '[]'::jsonb); end if;
  return jsonb_build_object('enabled', v_c.leaderboard_enabled, 'period', p_period, 'rows', (
    select coalesce(jsonb_agg(jsonb_build_object('rank', r.rank, 'xp', r.xp, 'me', r.student_id = auth.uid(),
             'name', case when v_staff or r.student_id = auth.uid() then u.full_name
                          else coalesce(nullif(u.nickname, ''), split_part(u.full_name, ' ', 1) || coalesce(' ' || left(nullif(split_part(u.full_name, ' ', 2), ''), 1) || '.', '')) end)
             order by r.rank), '[]'::jsonb)
    from (select student_id, sum(points) xp, rank() over (order by sum(points) desc) rank
          from public.xp_events
          where class_id = p_class and (p_period <> 'week' or created_at > now() - interval '7 days')
          group by student_id) r
    join public.users u on u.id = r.student_id
    where r.rank <= least(greatest(coalesce(p_limit, 10), 1), 100) or r.student_id = auth.uid()));
end$$;

-- "Choose your challenge": the student picks Support / Core / Extension (if the teacher allows).
create or replace function public.choose_level(p_class uuid, p_level smallint) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_c public.classes; v_me public.users := app.me();
begin
  if p_level not between 1 and 3 then raise exception 'Choose Support, Core or Extension.' using errcode = '22023'; end if;
  select * into v_c from public.classes where id = p_class;
  if v_c.id is null or not exists (select 1 from public.class_members where class_id = p_class and user_id = v_me.id and role = 'student') then
    raise exception 'Class not found.' using errcode = 'P0002';
  end if;
  if not v_c.student_choice_enabled then raise exception 'Your teacher sets the challenge level in this class.' using errcode = '42501'; end if;
  update public.class_members set level = p_level, level_set_by = 'student' where class_id = p_class and user_id = v_me.id;
  if p_level = 3 then perform app.give_badge(v_me.tenant_id, v_me.id, 'challenger'); end if;
end$$;

-- ---------------------------------------------------------------------------
-- Teacher-facing RPCs
-- ---------------------------------------------------------------------------
create or replace function public.set_student_level(p_class uuid, p_student uuid, p_level smallint) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not app.can_manage_class(p_class) then raise exception 'Not your class.' using errcode = '42501'; end if;
  if p_level not between 1 and 3 then raise exception 'Level must be 1, 2 or 3.' using errcode = '22023'; end if;
  update public.class_members set level = p_level, level_set_by = 'teacher'
   where class_id = p_class and user_id = p_student and role = 'student';
  if not found then raise exception 'Student not in this class.' using errcode = 'P0002'; end if;
end$$;

create or replace function public.set_class_engagement(p_class uuid, p_leaderboard boolean default null, p_student_choice boolean default null) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not app.can_manage_class(p_class) then raise exception 'Not your class.' using errcode = '42501'; end if;
  update public.classes set leaderboard_enabled = coalesce(p_leaderboard, leaderboard_enabled),
                            student_choice_enabled = coalesce(p_student_choice, student_choice_enabled)
   where id = p_class;
end$$;

-- Levels with a suggestion from the last 30 days: ≥85% accuracy → Extension, <50% → Support.
create or replace function public.class_levels(p_class uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.can_manage_class(p_class) then raise exception 'Not your class.' using errcode = '42501'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'student_id', u.id, 'name', u.full_name, 'level', m.level, 'level_set_by', m.level_set_by,
      'answered_30d', s.n, 'accuracy_30d', s.acc,
      'suggested', case when s.n < 5 then null when s.acc >= 0.85 then 3 when s.acc < 0.5 then 1 else 2 end,
      'xp_week', (select coalesce(sum(points), 0) from public.xp_events e where e.student_id = u.id and e.class_id = p_class
                  and e.created_at > now() - interval '7 days'))
      order by u.full_name), '[]'::jsonb)
    from public.class_members m join public.users u on u.id = m.user_id
    cross join lateral (
      select count(*) n, avg(case when a.is_correct then 1.0 else 0.0 end) acc
      from public.quiz_answers a join public.quiz_attempts t on t.id = a.attempt_id
      where t.student_id = u.id and a.is_correct is not null and a.answered_at > now() - interval '30 days') s
    where m.class_id = p_class and m.role = 'student');
end$$;

create or replace function public.award_xp(p_student uuid, p_points int, p_reason text, p_class uuid default null) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_tenant uuid;
begin
  if not (app.teaches_student(p_student) or app.is_admin()) then raise exception 'Not your student.' using errcode = '42501'; end if;
  if p_points not between 1 and 50 then raise exception 'Award between 1 and 50 XP.' using errcode = '22023'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'Say what it is for (the student sees it).' using errcode = '22023'; end if;
  select tenant_id into v_tenant from public.users where id = p_student;
  perform app.give_xp(v_tenant, p_student, p_class, 'teacher', gen_random_uuid(), p_points, btrim(p_reason));
  perform app.notify(p_student, 'xp', '+' || p_points || ' XP from your teacher', btrim(p_reason), '/student', 'info', '{}'::jsonb);
end$$;

-- Critical-thinking insight per question: confident-but-wrong (likely misconception),
-- unsure-but-right, and students' reasoning (newest 30 per question).
create or replace function public.question_insights(p_activity uuid, p_session uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_act public.activities;
begin
  select * into v_act from public.activities where id = p_activity and tenant_id = app.tenant_id();
  if v_act.id is null or not (app.is_teacher() or app.is_admin()) then raise exception 'Activity not found.' using errcode = 'P0002'; end if;
  if p_session is not null and not app.can_manage_session(p_session) then raise exception 'Not your session.' using errcode = '42501'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'question_id', q.id, 'prompt', q.prompt, 'bloom_level', q.bloom_level, 'difficulty', q.difficulty,
      'answers', x.n, 'correct', x.correct,
      'confident_wrong', x.confident_wrong, 'unsure_right', x.unsure_right,
      'reasoning', (select coalesce(jsonb_agg(jsonb_build_object('student', u.full_name, 'correct', a.is_correct,
                      'confidence', (a.response ->> 'confidence')::int, 'text', a.response ->> 'reasoning') order by a.answered_at desc), '[]'::jsonb)
                    from (select a2.* from public.quiz_answers a2 join public.quiz_attempts t2 on t2.id = a2.attempt_id
                          where a2.question_id = q.id and (p_session is null or t2.session_id = p_session)
                            and length(coalesce(a2.response ->> 'reasoning', '')) > 0
                          order by a2.answered_at desc limit 30) a
                    join public.quiz_attempts t on t.id = a.attempt_id join public.users u on u.id = t.student_id))
      order by q.position), '[]'::jsonb)
    from public.questions q
    cross join lateral (
      select count(*) n, count(*) filter (where a.is_correct) correct,
             count(*) filter (where a.is_correct = false and (a.response ->> 'confidence')::int >= 4) confident_wrong,
             count(*) filter (where a.is_correct and (a.response ->> 'confidence')::int <= 2) unsure_right
      from public.quiz_answers a join public.quiz_attempts t on t.id = a.attempt_id
      where a.question_id = q.id and (p_session is null or t.session_id = p_session)) x
    where q.activity_id = p_activity);
end$$;

-- ---------------------------------------------------------------------------
-- Differentiated attempts: start_attempt picks the student's level band
-- ---------------------------------------------------------------------------
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
  v_level    smallint;
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
    -- Differentiated activity: the student's challenge level in this class picks the question band.
    if coalesce((v_act.settings ->> 'differentiate')::boolean, false) then
      select coalesce(m.level, 2) into v_level from public.class_members m
       where m.user_id = v_me.id and m.role = 'student'
         and m.class_id = coalesce((select s.class_id from public.class_sessions s where s.id = p_session),
                                   (select a.class_id from public.assignments a where a.id = p_assignment));
      v_level := coalesce(v_level, 2);
      -- Never leave a student with nothing to do: no questions in the band means everyone gets all.
      if not exists (select 1 from public.questions q where q.activity_id = p_activity and app.question_in_level(q.difficulty, v_level)) then
        v_level := null;
      end if;
    end if;
    v_allowed := coalesce((v_act.settings ->> 'attempts_allowed')::int, 1);
    select coalesce(max(attempt_no), 0) into v_used from public.quiz_attempts
     where activity_id = p_activity and student_id = v_me.id
       and session_id is not distinct from p_session and assignment_id is not distinct from p_assignment;
    if v_allowed > 0 and v_used >= v_allowed then
      raise exception 'No attempts left for this activity.' using errcode = 'P0001';
    end if;
    v_limit := nullif((v_act.settings ->> 'time_limit_seconds')::int, 0);
    insert into public.quiz_attempts (tenant_id, activity_id, student_id, session_id, assignment_id,
                                      attempt_no, seed, deadline_at, max_score, level)
      values (v_me.tenant_id, p_activity, v_me.id, p_session, p_assignment, v_used + 1,
              (random() * 2147483646)::int,
              case when v_limit is null then null else now() + make_interval(secs => v_limit) end,
              (select coalesce(sum(points), 0) from public.questions
                where activity_id = p_activity and kind <> 'poll' and app.question_in_level(difficulty, v_level)),
              v_level)
      returning * into v_attempt;
  end if;

  v_shuffle_q := coalesce((v_act.settings ->> 'shuffle_questions')::boolean, false);
  v_shuffle_o := coalesce((v_act.settings ->> 'shuffle_options')::boolean, false);

  return jsonb_build_object(
    'attempt', jsonb_build_object('id', v_attempt.id, 'attempt_no', v_attempt.attempt_no,
                                  'deadline_at', v_attempt.deadline_at, 'status', v_attempt.status,
                                  'server_now', now(), 'level', v_attempt.level),
    'activity', jsonb_build_object('id', v_act.id, 'kind', v_act.kind, 'title', v_act.title,
                                   'instructions', v_act.instructions, 'settings', v_act.settings - 'rubric_id'),
    'questions', (select coalesce(jsonb_agg(app.sanitize_question(q, v_attempt.seed, v_shuffle_o)
                                   order by case when v_shuffle_q then app.shuffle_key(v_attempt.seed, q.id::text)
                                                 else lpad(q.position::text, 6, '0') || q.created_at::text end), '[]'::jsonb)
                  from public.questions q where q.activity_id = p_activity and app.question_in_level(q.difficulty, v_attempt.level)),
    'answers', (select coalesce(jsonb_object_agg(a.question_id, a.response), '{}'::jsonb)
                from public.quiz_answers a where a.attempt_id = v_attempt.id));
end$$;


-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
revoke execute on function public.my_progress(), public.class_leaderboard(uuid, text, int), public.choose_level(uuid, smallint),
                           public.set_student_level(uuid, uuid, smallint), public.set_class_engagement(uuid, boolean, boolean),
                           public.class_levels(uuid), public.award_xp(uuid, int, text, uuid), public.question_insights(uuid, uuid),
                           app.give_xp(uuid, uuid, uuid, text, uuid, int, text), app.give_badge(uuid, uuid, text)
  from public, anon;
grant execute on function public.my_progress(), public.class_leaderboard(uuid, text, int), public.choose_level(uuid, smallint),
                          public.set_student_level(uuid, uuid, smallint), public.set_class_engagement(uuid, boolean, boolean),
                          public.class_levels(uuid), public.award_xp(uuid, int, text, uuid), public.question_insights(uuid, uuid)
  to authenticated, service_role;
grant execute on function app.question_in_level(smallint, smallint), app.xp_level(bigint) to authenticated, service_role;

create or replace function public.health() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('ok', true, 'db_time', now(), 'schema', '0790')
$$;
