-- =========================================================================
-- EduClass Fusion — schema bootstrap
-- Idempotent: safe to re-run; applicable in Supabase SQL editor or via
-- `supabase db push` once a service-role key is configured.
-- =========================================================================

create extension if not exists "pgcrypto";

-- ============== Identity & orgs ==============
create table if not exists public.tenants (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  slug          text unique not null,
  plan_id       uuid,
  created_at    timestamptz not null default now()
);

create table if not exists public.users (
  id            uuid primary key references auth.users(id) on delete cascade,
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  email         text not null,
  full_name     text not null,
  role          text not null check (role in ('student','teacher','school_admin','it_admin','parent','platform_admin')),
  created_at    timestamptz not null default now()
);

create table if not exists public.schools ( id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id), name text not null, created_at timestamptz not null default now() );
create table if not exists public.departments ( id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id), name text not null, created_at timestamptz not null default now() );

create table if not exists public.classes (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  name          text not null,
  join_code     text not null,
  teacher_id    uuid not null references public.users(id),
  created_at    timestamptz not null default now()
);
create unique index if not exists classes_join_code_unique on public.classes(join_code);

create table if not exists public.class_members (
  id            uuid primary key default gen_random_uuid(),
  class_id      uuid not null references public.classes(id) on delete cascade,
  user_id       uuid not null references public.users(id) on delete cascade,
  role          text not null check (role in ('student','teacher')),
  joined_at     timestamptz not null default now(),
  unique (class_id, user_id)
);

create table if not exists public.student_profiles ( user_id uuid primary key references public.users(id) on delete cascade, grade_level text, interests jsonb, created_at timestamptz not null default now() );
create table if not exists public.teacher_profiles ( user_id uuid primary key references public.users(id) on delete cascade, subject_area text, created_at timestamptz not null default now() );

-- ============== Content & learning ==============
create table if not exists public.lessons (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  owner_id      uuid not null references public.users(id),
  title         text not null,
  description   text,
  status        text not null default 'draft' check (status in ('draft','published')),
  mode          text not null default 'live_participation' check (mode in ('live_participation','student_paced','front_of_class')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create table if not exists public.lesson_versions ( id uuid primary key default gen_random_uuid(), lesson_id uuid not null references public.lessons(id) on delete cascade, version int not null, snapshot jsonb not null, created_at timestamptz not null default now() );
create table if not exists public.lesson_slides ( id uuid primary key default gen_random_uuid(), lesson_id uuid not null references public.lessons(id) on delete cascade, idx int not null, kind text not null, payload jsonb not null default '{}'::jsonb, created_at timestamptz not null default now() );
create table if not exists public.lesson_media ( id uuid primary key default gen_random_uuid(), lesson_id uuid not null references public.lessons(id) on delete cascade, url text not null, kind text not null, created_at timestamptz not null default now() );

create table if not exists public.activities (
  id            uuid primary key default gen_random_uuid(),
  lesson_id     uuid not null references public.lessons(id) on delete cascade,
  slide_id      uuid references public.lesson_slides(id) on delete set null,
  kind          text not null,
  title         text not null,
  config        jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);
create table if not exists public.questions (
  id            uuid primary key default gen_random_uuid(),
  activity_id   uuid not null references public.activities(id) on delete cascade,
  prompt        text not null,
  options       jsonb not null default '[]'::jsonb,
  answer_key    jsonb not null default '{}'::jsonb,
  points        int not null default 1,
  created_at    timestamptz not null default now()
);

-- ============== Assessment & gamification ==============
create table if not exists public.quizzes ( id uuid primary key default gen_random_uuid(), activity_id uuid not null references public.activities(id) on delete cascade, name text not null, created_at timestamptz not null default now() );
create table if not exists public.quiz_attempts ( id uuid primary key default gen_random_uuid(), quiz_id uuid not null references public.quizzes(id) on delete cascade, student_id uuid not null references public.users(id), score int not null default 0, started_at timestamptz not null default now(), submitted_at timestamptz );
create table if not exists public.quiz_answers ( id uuid primary key default gen_random_uuid(), attempt_id uuid not null references public.quiz_attempts(id) on delete cascade, question_id uuid not null references public.questions(id), response jsonb, correct boolean not null default false, awarded int not null default 0, submitted_at timestamptz not null default now() );

create table if not exists public.game_sessions (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  class_id      uuid not null references public.classes(id) on delete cascade,
  quiz_id       uuid not null,
  join_code     text not null unique,
  state         text not null default 'lobby' check (state in ('lobby','running','ended')),
  created_at    timestamptz not null default now()
);
create table if not exists public.game_players ( id uuid primary key default gen_random_uuid(), game_id uuid not null references public.game_sessions(id) on delete cascade, user_id uuid, nickname text not null, score int not null default 0, streak int not null default 0, joined_at timestamptz not null default now() );
create table if not exists public.leaderboard_entries ( id uuid primary key default gen_random_uuid(), game_id uuid not null references public.game_sessions(id) on delete cascade, rank int not null, player_id uuid not null references public.game_players(id) on delete cascade, score int not null, recorded_at timestamptz not null default now() );

-- Assignments / grading
create table if not exists public.assignments ( id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id) on delete cascade, class_id uuid references public.classes(id), title text not null, due_at timestamptz, created_at timestamptz not null default now() );
create table if not exists public.submissions ( id uuid primary key default gen_random_uuid(), assignment_id uuid not null references public.assignments(id) on delete cascade, student_id uuid not null references public.users(id), body jsonb, submitted_at timestamptz not null default now() );
create table if not exists public.grades ( id uuid primary key default gen_random_uuid(), submission_id uuid not null references public.submissions(id) on delete cascade, grader_id uuid references public.users(id), score numeric not null, comments text, graded_at timestamptz not null default now() );
create table if not exists public.rubrics ( id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id), name text not null, criteria jsonb not null, created_at timestamptz not null default now() );
create table if not exists public.attendance ( id uuid primary key default gen_random_uuid(), class_id uuid not null references public.classes(id) on delete cascade, student_id uuid not null references public.users(id), date date not null, status text not null check (status in ('present','absent','tardy','excused')) );

-- ============== Live classroom & device ==============
create table if not exists public.class_sessions (
  id            uuid primary key default gen_random_uuid(),
  class_id      uuid not null references public.classes(id) on delete cascade,
  lesson_id     uuid references public.lessons(id) on delete set null,
  mode          text not null default 'live_participation',
  join_code     text not null unique,
  state         text not null default 'scheduled' check (state in ('scheduled','live','ended')),
  started_at    timestamptz,
  ended_at      timestamptz,
  created_at    timestamptz not null default now()
);
create table if not exists public.session_participants ( id uuid primary key default gen_random_uuid(), session_id uuid not null references public.class_sessions(id) on delete cascade, user_id uuid not null references public.users(id), status text not null default 'online', joined_at timestamptz not null default now(), left_at timestamptz, unique(session_id, user_id) );
create table if not exists public.student_presence ( id uuid primary key default gen_random_uuid(), session_id uuid references public.class_sessions(id), student_id uuid not null references public.users(id), device_id uuid, ts timestamptz not null default now() );
create table if not exists public.devices ( id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id) on delete cascade, device_uid text not null unique, kind text not null check (kind in ('browser','agent')), owner_user_id uuid references public.users(id), status text not null default 'active', last_seen_at timestamptz, created_at timestamptz not null default now() );
create table if not exists public.device_enrollments ( id uuid primary key default gen_random_uuid(), device_id uuid not null references public.devices(id) on delete cascade, student_id uuid not null references public.users(id), class_id uuid references public.classes(id), enrolled_by uuid, enrolled_at timestamptz not null default now(), revoked_at timestamptz );
create table if not exists public.browser_events ( id uuid primary key default gen_random_uuid(), device_id uuid not null references public.devices(id) on delete cascade, session_id uuid references public.class_sessions(id), kind text not null, url text, title text, ts timestamptz not null default now() );
create table if not exists public.teacher_commands ( id uuid primary key default gen_random_uuid(), session_id uuid not null references public.class_sessions(id) on delete cascade, issued_by uuid not null references public.users(id), target_student_id uuid not null references public.users(id), kind text not null check (kind in ('open_tab','close_tab','redirect','focus','lock')), payload jsonb not null default '{}'::jsonb, state text not null default 'queued', created_at timestamptz not null default now(), delivered_at timestamptz, acked_at timestamptz );

-- Environment / scenes
create table if not exists public.environment_policies ( id uuid primary key default gen_random_uuid(), tenant_id uuid references public.tenants(id) on delete cascade, class_id uuid references public.classes(id), name text not null, allowlist text[] not null default '{}', blocklist text[] not null default '{}', required_urls text[] not null default '{}', mode text not null default 'monitor' check (mode in ('monitor','focus','lock')), created_at timestamptz not null default now() );
create table if not exists public.environment_events ( id uuid primary key default gen_random_uuid(), session_id uuid references public.class_sessions(id) on delete cascade, student_id uuid references public.users(id), policy_id uuid references public.environment_policies(id), kind text not null, url text, severity text not null default 'info' check (severity in ('info','warn','critical')), acknowledged boolean not null default false, acknowledged_by uuid, ts timestamptz not null default now() );
create table if not exists public.scenes ( id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id) on delete cascade, name text not null, policy_id uuid references public.environment_policies(id), created_at timestamptz not null default now() );
create table if not exists public.scene_rules ( id uuid primary key default gen_random_uuid(), scene_id uuid not null references public.scenes(id) on delete cascade, trigger text not null, action jsonb not null );

-- Communications
create table if not exists public.chat_threads ( id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id) on delete cascade, class_id uuid not null references public.classes(id) on delete cascade, student_id uuid not null references public.users(id), teacher_id uuid not null references public.users(id), created_at timestamptz not null default now() );
create table if not exists public.chat_messages ( id uuid primary key default gen_random_uuid(), thread_id uuid not null references public.chat_threads(id) on delete cascade, sender_id uuid not null references public.users(id), body text not null, created_at timestamptz not null default now() );
create table if not exists public.announcements ( id uuid primary key default gen_random_uuid(), session_id uuid not null references public.class_sessions(id) on delete cascade, user_id uuid not null references public.users(id), body text not null, created_at timestamptz not null default now() );

-- ============== System & admin ==============
create table if not exists public.notifications ( id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id) on delete cascade, user_id uuid not null references public.users(id), kind text not null, payload jsonb not null default '{}'::jsonb, read_at timestamptz, created_at timestamptz not null default now() );
create table if not exists public.reports ( id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id) on delete cascade, kind text not null, payload jsonb not null default '{}'::jsonb, generated_at timestamptz not null default now() );
create table if not exists public.audit_logs ( id uuid primary key default gen_random_uuid(), tenant_id uuid, actor_id uuid, action text not null, target text, meta jsonb not null default '{}'::jsonb, ts timestamptz not null default now() );
create table if not exists public.subscriptions ( id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id) on delete cascade, plan text not null, status text not null check (status in ('trial','active','past_due','canceled')), renews_at timestamptz, created_at timestamptz not null default now() );
create table if not exists public.plans ( id uuid primary key default gen_random_uuid(), name text not null, features jsonb not null default '{}'::jsonb, price_cents int not null default 0, created_at timestamptz not null default now() );
create table if not exists public.invoices ( id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id) on delete cascade, amount_cents int not null, status text not null, created_at timestamptz not null default now() );
create table if not exists public.feature_flags ( id uuid primary key default gen_random_uuid(), tenant_id uuid references public.tenants(id) on delete cascade, key text not null, enabled boolean not null default false, meta jsonb not null default '{}'::jsonb );

-- ============== Storage buckets ==============
insert into storage.buckets (id, name, public) values ('lesson-media','lesson-media', false) on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('submissions','submissions', false) on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('screenshots','screenshots', false) on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('profiles','profiles', false) on conflict (id) do nothing;

-- ============== Realtime publication ==============
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end$$;
alter publication supabase_realtime add table
  public.class_sessions, public.session_participants, public.chat_messages,
  public.announcements, public.teacher_commands, public.environment_events,
  public.game_players, public.leaderboard_entries, public.browser_events;

-- ============== RLS scaffolding ==============
alter table public.tenants enable row level security;
alter table public.users enable row level security;
alter table public.classes enable row level security;
alter table public.class_members enable row level security;
alter table public.lessons enable row level security;
alter table public.lesson_versions enable row level security;
alter table public.lesson_slides enable row level security;
alter table public.activities enable row level security;
alter table public.questions enable row level security;
alter table public.game_sessions enable row level security;
alter table public.game_players enable row level security;
alter table public.leaderboard_entries enable row level security;
alter table public.class_sessions enable row level security;
alter table public.session_participants enable row level security;
alter table public.devices enable row level security;
alter table public.device_enrollments enable row level security;
alter table public.browser_events enable row level security;
alter table public.teacher_commands enable row level security;
alter table public.environment_policies enable row level security;
alter table public.environment_events enable row level security;
alter table public.scenes enable row level security;
alter table public.scene_rules enable row level security;
alter table public.chat_threads enable row level security;
alter table public.chat_messages enable row level security;
alter table public.announcements enable row level security;
alter table public.notifications enable row level security;
alter table public.reports enable row level security;
alter table public.audit_logs enable row level security;
alter table public.subscriptions enable row level security;

-- Tenants: every signed-in user can read their own; only service role can write.
drop policy if exists tenants_select on public.tenants;
create policy tenants_select on public.tenants for select using (true);

-- Users: a row is readable only to people who share the same tenant.
drop policy if exists users_self_select on public.users;
create policy users_self_select on public.users for select using (
  exists (select 1 from public.users u2 where u2.id = auth.uid() and u2.tenant_id = users.tenant_id)
);
drop policy if exists users_self_update on public.users;
create policy users_self_update on public.users for update using (id = auth.uid());

-- Classes / lessons / class_sessions: permissive reads inside tenant, owner writes.
create policy classes_select on public.classes for select using (
  exists (select 1 from public.users u where u.id = auth.uid() and u.tenant_id = classes.tenant_id)
);
create policy classes_insert on public.classes for insert with check (teacher_id = auth.uid());
create policy classes_update on public.classes for update using (teacher_id = auth.uid());

create policy lessons_select on public.lessons for select using (
  exists (select 1 from public.users u where u.id = auth.uid() and u.tenant_id = lessons.tenant_id)
);
create policy lessons_insert on public.lessons for insert with check (owner_id = auth.uid());
create policy lessons_update on public.lessons for update using (owner_id = auth.uid());

create policy lesson_slides_all on public.lesson_slides for all using (
  exists (select 1 from public.lessons l where l.id = lesson_slides.lesson_id and l.owner_id = auth.uid())
) with check (
  exists (select 1 from public.lessons l where l.id = lesson_slides.lesson_id and l.owner_id = auth.uid())
);

create policy activities_all on public.activities for all using (
  exists (select 1 from public.lessons l where l.id = activities.lesson_id and l.owner_id = auth.uid())
) with check (
  exists (select 1 from public.lessons l where l.id = activities.lesson_id and l.owner_id = auth.uid())
);

create policy questions_all on public.questions for all using (
  exists (select 1 from public.activities a join public.lessons l on l.id = a.lesson_id where a.id = questions.activity_id and l.owner_id = auth.uid())
) with check (
  exists (select 1 from public.activities a join public.lessons l on l.id = a.lesson_id where a.id = questions.activity_id and l.owner_id = auth.uid())
);

create policy class_sessions_select on public.class_sessions for select using (
  exists (select 1 from public.classes c join public.users u on u.id = auth.uid() where c.id = class_sessions.class_id and (u.id = c.teacher_id or exists (select 1 from public.class_members m where m.class_id = c.id and m.user_id = auth.uid())))
);
create policy class_sessions_insert on public.class_sessions for insert with check (
  exists (select 1 from public.classes c where c.id = class_sessions.class_id and c.teacher_id = auth.uid())
);
create policy class_sessions_update on public.class_sessions for update using (
  exists (select 1 from public.classes c where c.id = class_sessions.class_id and c.teacher_id = auth.uid())
);

create policy session_participants_all on public.session_participants for all using (
  user_id = auth.uid() or exists (
    select 1 from public.class_sessions s join public.classes c on c.id = s.class_id
    where s.id = session_participants.session_id and c.teacher_id = auth.uid()
  )
) with check (user_id = auth.uid());

create policy game_sessions_select on public.game_sessions for select using (
  exists (select 1 from public.users u where u.id = auth.uid() and u.tenant_id = game_sessions.tenant_id)
);
create policy game_sessions_insert on public.game_sessions for insert with check (
  exists (select 1 from public.users u where u.id = auth.uid() and u.tenant_id = game_sessions.tenant_id)
);
create policy game_sessions_update on public.game_sessions for update using (
  exists (select 1 from public.classes c where c.id = game_sessions.class_id and c.teacher_id = auth.uid())
);

create policy game_players_all on public.game_players for all using (
  user_id = auth.uid() or user_id is null
) with check (user_id = auth.uid() or user_id is null);

create policy leaderboard_select on public.leaderboard_entries for select using (true);
create policy leaderboard_insert on public.leaderboard_entries for insert with check (true);

create policy devices_select on public.devices for select using (
  owner_user_id = auth.uid() or exists (select 1 from public.users u where u.id = auth.uid() and u.tenant_id = devices.tenant_id)
);
create policy devices_insert on public.devices for insert with check (true);
create policy devices_update on public.devices for update using (
  owner_user_id = auth.uid() or exists (select 1 from public.users u where u.id = auth.uid() and u.tenant_id = devices.tenant_id)
);

create policy browser_events_insert on public.browser_events for insert with check (true);
create policy browser_events_select on public.browser_events for select using (
  exists (select 1 from public.class_sessions s join public.classes c on c.id = s.class_id
    where s.id = browser_events.session_id and c.teacher_id = auth.uid())
);

create policy teacher_commands_select on public.teacher_commands for select using (
  issued_by = auth.uid() or target_student_id = auth.uid()
);
create policy teacher_commands_insert on public.teacher_commands for insert with check (issued_by = auth.uid());
create policy teacher_commands_update on public.teacher_commands for update using (issued_by = auth.uid() or target_student_id = auth.uid());

create policy env_policies_select on public.environment_policies for select using (
  exists (select 1 from public.users u where u.id = auth.uid() and u.tenant_id = environment_policies.tenant_id)
);
create policy env_policies_insert on public.environment_policies for insert with check (true);
create policy env_policies_update on public.environment_policies for update using (true);

create policy env_events_insert on public.environment_events for insert with check (true);
create policy env_events_select on public.environment_events for select using (
  exists (select 1 from public.class_sessions s join public.classes c on c.id = s.class_id
    where s.id = environment_events.session_id and c.teacher_id = auth.uid())
);

create policy chat_messages_all on public.chat_messages for all using (
  sender_id = auth.uid()
) with check (sender_id = auth.uid());

create policy announcements_insert on public.announcements for insert with check (true);
create policy announcements_select on public.announcements for select using (true);

create policy notifications_self on public.notifications for select using (user_id = auth.uid());
create policy notifications_insert on public.notifications for insert with check (user_id = auth.uid());

create policy audit_select on public.audit_logs for select using (true);
create policy audit_insert on public.audit_logs for insert with check (true);

create policy subscriptions_self on public.subscriptions for select using (
  exists (select 1 from public.users u where u.id = auth.uid() and u.tenant_id = subscriptions.tenant_id)
);
