-- =============================================================================
-- SwiftCipher — 0300 live classroom (§3.4, §3.7) + game engine (§3.3, §13)
-- =============================================================================

create table public.class_sessions (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null,
  class_id             uuid not null,
  teacher_id           uuid not null,
  lesson_id            uuid,
  lesson_version       int,
  title                text not null,
  mode                 text not null default 'live_participation'
                         check (mode in ('live_participation','student_paced','front_of_class')),
  join_code            text not null unique check (join_code ~ '^[A-Z0-9]{6}$'),
  status               text not null default 'live' check (status in ('scheduled','live','ended')),
  current_slide        int  not null default 0 check (current_slide >= 0),
  active_activity_id   uuid,
  environment_id       uuid,        -- FK added in 0400
  environment_active   boolean not null default false,
  group_chat_enabled   boolean not null default false,
  responses_visible    boolean not null default false,  -- show anonymised live results to students
  scheduled_for        timestamptz,
  started_at           timestamptz,
  ended_at             timestamptz,
  created_at           timestamptz not null default now(),
  unique (id, tenant_id),
  foreign key (class_id, tenant_id) references public.classes(id, tenant_id) on delete cascade,
  foreign key (teacher_id, tenant_id) references public.users(id, tenant_id),
  foreign key (lesson_id, tenant_id) references public.lessons(id, tenant_id) on delete set null (lesson_id),
  foreign key (active_activity_id, tenant_id) references public.activities(id, tenant_id) on delete set null (active_activity_id)
);
create index class_sessions_class_idx on public.class_sessions(class_id, created_at desc);
create unique index class_sessions_one_live_per_class on public.class_sessions(class_id) where status = 'live';

alter table public.quiz_attempts
  add foreign key (session_id, tenant_id) references public.class_sessions(id, tenant_id) on delete set null (session_id);
alter table public.collab_boards
  add foreign key (session_id, tenant_id) references public.class_sessions(id, tenant_id) on delete cascade;

-- Web-app presence (§3.4 roster presence + lesson progress per student).
create table public.session_participants (
  session_id     uuid not null,
  user_id        uuid not null,
  tenant_id      uuid not null,
  current_slide  int  not null default 0,
  status         text not null default 'online' check (status in ('connecting','online','idle','offline')),
  joined_at      timestamptz not null default now(),
  last_seen_at   timestamptz not null default now(),
  left_at        timestamptz,
  primary key (session_id, user_id),
  foreign key (session_id, tenant_id) references public.class_sessions(id, tenant_id) on delete cascade,
  foreign key (user_id, tenant_id) references public.users(id, tenant_id) on delete cascade
);

-- Blueprint §7 "student_presence": derived, always consistent with the heartbeat clock.
create view public.student_presence with (security_invoker = true) as
  select sp.session_id, sp.user_id as student_id, sp.tenant_id, sp.current_slide,
         case
           when sp.left_at is not null then 'offline'
           when sp.last_seen_at < now() - interval '45 seconds' then 'offline'
           when sp.status = 'idle' then 'idle'
           else sp.status
         end as presence,
         sp.last_seen_at
  from public.session_participants sp;

create table public.announcements (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null,
  class_id    uuid not null,
  session_id  uuid,
  author_id   uuid not null,
  body        text not null check (length(btrim(body)) between 1 and 2000),
  created_at  timestamptz not null default now(),
  foreign key (class_id, tenant_id) references public.classes(id, tenant_id) on delete cascade,
  foreign key (session_id, tenant_id) references public.class_sessions(id, tenant_id) on delete cascade,
  foreign key (author_id, tenant_id) references public.users(id, tenant_id)
);
create index announcements_class_idx on public.announcements(class_id, created_at desc);

-- Private 1:1 threads and (policy-permitting) a class group thread.
create table public.chat_threads (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null,
  class_id    uuid not null,
  kind        text not null check (kind in ('direct','group')),
  student_id  uuid,
  teacher_id  uuid,
  session_id  uuid,
  created_at  timestamptz not null default now(),
  unique (id, tenant_id),
  foreign key (class_id, tenant_id) references public.classes(id, tenant_id) on delete cascade,
  foreign key (student_id, tenant_id) references public.users(id, tenant_id) on delete cascade,
  foreign key (teacher_id, tenant_id) references public.users(id, tenant_id) on delete cascade,
  foreign key (session_id, tenant_id) references public.class_sessions(id, tenant_id) on delete cascade,
  check ((kind = 'direct' and student_id is not null and teacher_id is not null)
      or (kind = 'group' and session_id is not null))
);
create unique index chat_threads_direct_uidx on public.chat_threads(class_id, student_id, teacher_id) where kind = 'direct';
create unique index chat_threads_group_uidx on public.chat_threads(session_id) where kind = 'group';

create table public.chat_messages (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null,
  thread_id   uuid not null,
  sender_id   uuid not null,
  body        text not null check (length(btrim(body)) between 1 and 2000),
  hidden      boolean not null default false,
  created_at  timestamptz not null default now(),
  foreign key (thread_id, tenant_id) references public.chat_threads(id, tenant_id) on delete cascade,
  foreign key (sender_id, tenant_id) references public.users(id, tenant_id) on delete cascade
);
create index chat_messages_thread_idx on public.chat_messages(thread_id, created_at);

create table public.raise_hands (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null,
  session_id  uuid not null,
  student_id  uuid not null,
  message     text not null default '' check (length(message) <= 500),
  status      text not null default 'open' check (status in ('open','resolved')),
  resolved_by uuid,
  created_at  timestamptz not null default now(),
  resolved_at timestamptz,
  foreign key (session_id, tenant_id) references public.class_sessions(id, tenant_id) on delete cascade,
  foreign key (student_id, tenant_id) references public.users(id, tenant_id) on delete cascade
);
create unique index raise_hands_one_open on public.raise_hands(session_id, student_id) where status = 'open';

-- §3.7 spotlight: one student's screen shown to the class/projector.
create table public.spotlights (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null,
  session_id     uuid not null,
  student_id     uuid not null,
  anonymized     boolean not null default false,
  show_to_class  boolean not null default false,
  started_by     uuid not null,
  started_at     timestamptz not null default now(),
  ended_at       timestamptz,
  foreign key (session_id, tenant_id) references public.class_sessions(id, tenant_id) on delete cascade,
  foreign key (student_id, tenant_id) references public.users(id, tenant_id) on delete cascade
);
create unique index spotlights_one_active on public.spotlights(session_id) where ended_at is null;

create table public.attendance (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null,
  class_id    uuid not null,
  session_id  uuid,
  student_id  uuid not null,
  date        date not null,
  status      text not null check (status in ('present','absent','late','excused')),
  source      text not null default 'manual' check (source in ('manual','session')),
  recorded_by uuid,
  created_at  timestamptz not null default now(),
  unique (class_id, student_id, date),
  foreign key (class_id, tenant_id) references public.classes(id, tenant_id) on delete cascade,
  foreign key (session_id, tenant_id) references public.class_sessions(id, tenant_id) on delete set null (session_id),
  foreign key (student_id, tenant_id) references public.users(id, tenant_id) on delete cascade
);

-- WebRTC signalling for teacher screen share / optional A/V (§3.4, §15).
create table public.rtc_rooms (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null,
  session_id  uuid not null,
  host_id     uuid not null,
  purpose     text not null default 'av' check (purpose in ('av','screen_share','spotlight')),
  status      text not null default 'open' check (status in ('open','closed')),
  created_at  timestamptz not null default now(),
  closed_at   timestamptz,
  unique (id, tenant_id),
  foreign key (session_id, tenant_id) references public.class_sessions(id, tenant_id) on delete cascade,
  foreign key (host_id, tenant_id) references public.users(id, tenant_id)
);

create table public.rtc_peers (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null,
  room_id     uuid not null,
  user_id     uuid not null,
  role        text not null check (role in ('host','participant')),
  joined_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  left_at     timestamptz,
  unique (id, tenant_id),
  unique (room_id, user_id),
  foreign key (room_id, tenant_id) references public.rtc_rooms(id, tenant_id) on delete cascade,
  foreign key (user_id, tenant_id) references public.users(id, tenant_id) on delete cascade
);

create table public.rtc_signals (
  id           bigint generated always as identity primary key,
  tenant_id    uuid not null,
  room_id      uuid not null,
  from_peer_id uuid not null,
  to_peer_id   uuid not null,
  kind         text not null check (kind in ('offer','answer','ice','bye')),
  payload      jsonb not null,
  created_at   timestamptz not null default now(),
  foreign key (room_id, tenant_id) references public.rtc_rooms(id, tenant_id) on delete cascade,
  foreign key (from_peer_id, tenant_id) references public.rtc_peers(id, tenant_id) on delete cascade,
  foreign key (to_peer_id, tenant_id) references public.rtc_peers(id, tenant_id) on delete cascade
);
create index rtc_signals_to_idx on public.rtc_signals(to_peer_id, id);

-- ---------------------------------------------------------------------------
-- Game engine (§3.3, §13)
-- ---------------------------------------------------------------------------
create table public.game_sessions (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null,
  class_id             uuid not null,
  host_id              uuid not null,
  activity_id          uuid not null,
  session_id           uuid,           -- optional: launched from a live lesson
  title                text not null,
  join_code            text not null unique check (join_code ~ '^[A-Z0-9]{6}$'),
  status               text not null default 'lobby' check (status in ('lobby','question','review','ended')),
  -- speed_bonus bool, streak_bonus bool, question_seconds int, rank_visibility
  -- ('after_each'|'end_only'|'hidden'), display_mode ('first_name_initial'|'nickname'|'anonymous'),
  -- team_mode bool, team_count int, shuffle_questions bool, shuffle_options bool, podium_size int
  settings             jsonb not null default '{}'::jsonb,
  question_order       uuid[] not null default '{}',
  current_index        int not null default -1,
  question_started_at  timestamptz,
  question_ends_at     timestamptz,
  created_at           timestamptz not null default now(),
  started_at           timestamptz,
  ended_at             timestamptz,
  unique (id, tenant_id),
  foreign key (class_id, tenant_id) references public.classes(id, tenant_id) on delete cascade,
  foreign key (host_id, tenant_id) references public.users(id, tenant_id),
  foreign key (activity_id, tenant_id) references public.activities(id, tenant_id) on delete cascade,
  foreign key (session_id, tenant_id) references public.class_sessions(id, tenant_id) on delete set null (session_id)
);

create table public.game_teams (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null,
  game_id     uuid not null,
  name        text not null,
  color       text not null,
  unique (id, tenant_id),
  foreign key (game_id, tenant_id) references public.game_sessions(id, tenant_id) on delete cascade
);

create table public.game_players (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null,
  game_id       uuid not null,
  user_id       uuid not null,
  display_name  text not null,
  team_id       uuid,
  score         int not null default 0,
  correct_count int not null default 0,
  streak        int not null default 0,
  best_streak   int not null default 0,
  badges        text[] not null default '{}',
  joined_at     timestamptz not null default now(),
  unique (id, tenant_id),
  unique (game_id, user_id),
  foreign key (game_id, tenant_id) references public.game_sessions(id, tenant_id) on delete cascade,
  foreign key (user_id, tenant_id) references public.users(id, tenant_id) on delete cascade,
  foreign key (team_id, tenant_id) references public.game_teams(id, tenant_id) on delete set null (team_id)
);

create table public.game_answers (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null,
  game_id           uuid not null,
  player_id         uuid not null,
  question_id       uuid not null,
  question_index    int  not null,
  choice            jsonb not null,
  is_correct        boolean not null,
  base_points       int not null default 0,
  speed_bonus       int not null default 0,
  streak_bonus      int not null default 0,
  server_elapsed_ms int not null,
  scored_elapsed_ms int not null,
  answered_at       timestamptz not null default now(),
  unique (player_id, question_index),        -- answer-window lock: one answer per question
  foreign key (game_id, tenant_id) references public.game_sessions(id, tenant_id) on delete cascade,
  foreign key (player_id, tenant_id) references public.game_players(id, tenant_id) on delete cascade,
  foreign key (question_id, tenant_id) references public.questions(id, tenant_id) on delete cascade
);
create index game_answers_game_q_idx on public.game_answers(game_id, question_index);

-- Leaderboard snapshot after each question (history analytics, §18).
create table public.leaderboard_entries (
  id              bigint generated always as identity primary key,
  tenant_id       uuid not null,
  game_id         uuid not null,
  player_id       uuid not null,
  question_index  int not null,
  rank            int not null,
  score           int not null,
  recorded_at     timestamptz not null default now(),
  unique (game_id, question_index, player_id),
  foreign key (game_id, tenant_id) references public.game_sessions(id, tenant_id) on delete cascade,
  foreign key (player_id, tenant_id) references public.game_players(id, tenant_id) on delete cascade
);

-- Suspicious-pattern log (§3.3 anti-cheat). Informational only.
create table public.game_flags (
  id          bigint generated always as identity primary key,
  tenant_id   uuid not null,
  game_id     uuid not null,
  player_id   uuid not null,
  kind        text not null,
  detail      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  foreign key (game_id, tenant_id) references public.game_sessions(id, tenant_id) on delete cascade,
  foreign key (player_id, tenant_id) references public.game_players(id, tenant_id) on delete cascade
);
