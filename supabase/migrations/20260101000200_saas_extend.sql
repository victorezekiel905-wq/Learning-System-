-- =========================================================================
-- EduClass Fusion — SaaS extension (v2)
-- Adds: activity responses, raise hands, screen snapshots, game question
-- state, tenant/roster bootstrap policies, class lookup helper.
-- Idempotent: safe to re-run. Apply AFTER 20260101000000_init.sql.
-- =========================================================================

-- ---------- New tables ----------
create table if not exists public.activity_responses (
  id            uuid primary key default gen_random_uuid(),
  activity_id   uuid not null references public.activities(id) on delete cascade,
  session_id    uuid references public.class_sessions(id) on delete set null,
  student_id    uuid not null references public.users(id) on delete cascade,
  response      jsonb not null default '{}'::jsonb,
  correct       boolean not null default false,
  awarded       int not null default 0,
  elapsed_ms    int not null default 0,
  submitted_at  timestamptz not null default now()
);
create index if not exists activity_responses_activity_idx on public.activity_responses(activity_id);
create index if not exists activity_responses_session_idx on public.activity_responses(session_id);

create table if not exists public.raise_hands (
  id            uuid primary key default gen_random_uuid(),
  session_id    uuid not null references public.class_sessions(id) on delete cascade,
  student_id    uuid not null references public.users(id) on delete cascade,
  message       text not null default '',
  resolved_at   timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists raise_hands_session_idx on public.raise_hands(session_id);

create table if not exists public.screen_snapshots (
  id            uuid primary key default gen_random_uuid(),
  device_id     uuid not null references public.devices(id) on delete cascade,
  session_id    uuid references public.class_sessions(id) on delete set null,
  data_url      text,          -- low-res thumbnail (data:image/jpeg;base64,...)
  url           text,
  title         text,
  captured_at   timestamptz not null default now()
);
create index if not exists screen_snapshots_device_idx on public.screen_snapshots(device_id, captured_at desc);

-- ---------- Device metadata (blueprint 3.5: device name / OS, minimal) ----------
alter table public.devices add column if not exists label text;
alter table public.devices add column if not exists os text;
alter table public.devices add column if not exists browser text;

-- ---------- Game question state (blueprint 3.3) ----------
alter table public.game_sessions add column if not exists current_question int not null default -1;
alter table public.game_sessions add column if not exists question_started_at timestamptz;

-- ---------- Class lookup helper (security definer, minimal leak) ----------
-- Lets a brand-new student (no users row yet, no tenant) find their class
-- by join code during signup.
create or replace function public.class_lookup_by_code(p_code text)
returns table (id uuid, tenant_id uuid, name text, teacher_id uuid)
language sql security definer stable
as $$
  select id, tenant_id, name, teacher_id
  from public.classes
  where upper(join_code) = upper(p_code)
  limit 1;
$$;
revoke all on function public.class_lookup_by_code(text) from public;
grant execute on function public.class_lookup_by_code(text) to anon, authenticated;

-- ---------- RLS: new tables ----------
alter table public.activity_responses enable row level security;
alter table public.raise_hands enable row level security;
alter table public.screen_snapshots enable row level security;

-- tenants: a teacher bootstraps their own tenant at signup
drop policy if exists tenants_insert on public.tenants;
create policy tenants_insert on public.tenants for insert with check (true);

-- users: a signed-in user may insert their own profile row (signup bootstrap)
drop policy if exists users_insert on public.users;
create policy users_insert on public.users for insert with check (id = auth.uid());

-- class_members: roster readable by tenant peers; enroll self or (teacher) others
drop policy if exists class_members_select on public.class_members;
create policy class_members_select on public.class_members for select using (
  user_id = auth.uid()
  or exists (
    select 1 from public.classes c
    where c.id = class_members.class_id
      and exists (select 1 from public.users u where u.id = auth.uid() and u.tenant_id = c.tenant_id)
  )
);
drop policy if exists class_members_insert on public.class_members;
create policy class_members_insert on public.class_members for insert with check (
  user_id = auth.uid()
  or exists (select 1 from public.classes c where c.id = class_members.class_id and c.teacher_id = auth.uid())
);

-- activity_responses: students write their own; teachers read their class's
drop policy if exists activity_responses_insert on public.activity_responses;
create policy activity_responses_insert on public.activity_responses for insert with check (student_id = auth.uid());
drop policy if exists activity_responses_select on public.activity_responses;
create policy activity_responses_select on public.activity_responses for select using (
  student_id = auth.uid()
  or exists (
    select 1 from public.class_sessions s join public.classes c on c.id = s.class_id
    where s.id = activity_responses.session_id and c.teacher_id = auth.uid()
  )
);
drop policy if exists activity_responses_update on public.activity_responses;
create policy activity_responses_update on public.activity_responses for update using (student_id = auth.uid());

-- raise_hands: student raises; teacher resolves
drop policy if exists raise_hands_insert on public.raise_hands;
create policy raise_hands_insert on public.raise_hands for insert with check (student_id = auth.uid());
drop policy if exists raise_hands_select on public.raise_hands;
create policy raise_hands_select on public.raise_hands for select using (
  student_id = auth.uid()
  or exists (
    select 1 from public.class_sessions s join public.classes c on c.id = s.class_id
    where s.id = raise_hands.session_id and c.teacher_id = auth.uid()
  )
);
drop policy if exists raise_hands_update on public.raise_hands;
create policy raise_hands_update on public.raise_hands for update using (
  exists (
    select 1 from public.class_sessions s join public.classes c on c.id = s.class_id
    where s.id = raise_hands.session_id and c.teacher_id = auth.uid()
  )
);

-- screen_snapshots: extension writes; teacher of the live class reads
drop policy if exists screen_snapshots_insert on public.screen_snapshots;
create policy screen_snapshots_insert on public.screen_snapshots for insert with check (true);
drop policy if exists screen_snapshots_select on public.screen_snapshots;
create policy screen_snapshots_select on public.screen_snapshots for select using (
  exists (
    select 1 from public.class_sessions s join public.classes c on c.id = s.class_id
    where s.id = screen_snapshots.session_id and c.teacher_id = auth.uid()
  )
);

-- environment_events: student sees their own alerts; teacher acknowledges
drop policy if exists env_events_student_select on public.environment_events;
create policy env_events_student_select on public.environment_events for select using (student_id = auth.uid());
drop policy if exists env_events_update on public.environment_events;
create policy env_events_update on public.environment_events for update using (
  exists (
    select 1 from public.class_sessions s join public.classes c on c.id = s.class_id
    where s.id = environment_events.session_id and c.teacher_id = auth.uid()
  )
);

-- notifications: owner may mark read
drop policy if exists notifications_update on public.notifications;
create policy notifications_update on public.notifications for update using (user_id = auth.uid());

-- ---------- Realtime publication for the new channels ----------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table
      public.raise_hands, public.activity_responses, public.screen_snapshots;
  end if;
end$$;
