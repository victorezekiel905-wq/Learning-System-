-- =============================================================================
-- SwiftCipher: complete database setup (generated; do not edit by hand)
--
-- HOW TO USE
--   1. Supabase dashboard -> SQL Editor -> New query.
--   2. Paste this whole file and click Run. It takes 10-30 seconds.
--   3. Run it ONCE, on an EMPTY project. It is not safe to re-run.
--
-- Generated from 26 files in supabase/migrations by
-- scripts/build-setup-sql.mjs. If you use the Supabase CLI instead, run
-- `supabase db push`; do not do both.
-- =============================================================================

-- >>>>>>>>>>>>>>>>>>>> 20260901000100_foundation.sql >>>>>>>>>>>>>>>>>>>>
-- =============================================================================
-- SwiftCipher — 0100 foundation: tenancy, identity, billing, audit, helpers
--
-- Isolation model (blueprint §4, §20):
--   * every tenant-owned row carries tenant_id;
--   * child rows reference parents through composite (id, tenant_id) foreign
--     keys, so a row can never point at another tenant's data;
--   * RLS policies call the app.* helpers below, which are SECURITY DEFINER so
--     they can read public.users without recursing through its own policy.
-- =============================================================================

create schema if not exists app;
grant usage on schema app to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Catalogues (global, read-only to clients)
-- ---------------------------------------------------------------------------
create table public.roles (
  code        text primary key,
  label       text not null,
  description text not null,
  rank        int  not null
);

insert into public.roles (code, label, description, rank) values
  ('student',        'Student',              'Own profile, enrolled sessions, own submissions, permitted leaderboards.', 10),
  ('parent',         'Parent / Guardian',    'Approved summaries for linked students only.',                              20),
  ('teacher',        'Teacher',              'Assigned classes, owned lessons, live sessions, authorised telemetry.',     30),
  ('it_admin',       'IT / Device Admin',    'Device enrolment and technical policy; no academic content by default.',    40),
  ('school_admin',   'School Administrator', 'Tenant-wide management, reporting and billing.',                            50),
  ('platform_admin', 'Platform Admin',       'Operational support; break-glass access is audit logged.',                  60);

create table public.plans (
  code        text primary key,
  name        text not null,
  price_cents int  not null default 0,
  currency    text not null default 'USD',
  interval    text not null default 'month' check (interval in ('month','year')),
  -- null limit = unlimited
  limits      jsonb not null default '{}'::jsonb,
  features    jsonb not null default '{}'::jsonb,
  sort        int  not null default 0
);

insert into public.plans (code, name, price_cents, limits, features, sort) values
  ('free_teacher', 'Free Teacher', 0,
    '{"teachers":1,"classes":3,"students_per_class":40,"storage_mb":500,"managed_devices":0}',
    '{"games":true,"device_control":false,"advanced_analytics":false,"parent_portal":false,"sso":false}', 10),
  ('teacher_pro', 'Teacher Pro', 999,
    '{"teachers":1,"classes":20,"students_per_class":60,"storage_mb":10240,"managed_devices":60}',
    '{"games":true,"device_control":true,"advanced_analytics":true,"parent_portal":false,"sso":false}', 20),
  ('school', 'School', 49900,
    '{"teachers":100,"classes":null,"students_per_class":null,"storage_mb":102400,"managed_devices":2000}',
    '{"games":true,"device_control":true,"advanced_analytics":true,"parent_portal":false,"sso":true}', 30),
  ('school_plus', 'School Plus', 89900,
    '{"teachers":250,"classes":null,"students_per_class":null,"storage_mb":512000,"managed_devices":5000}',
    '{"games":true,"device_control":true,"advanced_analytics":true,"parent_portal":true,"sso":true,"priority_support":true}', 40),
  ('enterprise', 'Enterprise / District', 0,
    '{"teachers":null,"classes":null,"students_per_class":null,"storage_mb":null,"managed_devices":null}',
    '{"games":true,"device_control":true,"advanced_analytics":true,"parent_portal":true,"sso":true,"priority_support":true,"custom_integrations":true}', 50);

-- ---------------------------------------------------------------------------
-- Tenancy
-- ---------------------------------------------------------------------------
create table public.tenants (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(btrim(name)) between 1 and 200),
  slug        text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  plan_code   text not null default 'free_teacher' references public.plans(code),
  country     text,
  timezone    text not null default 'UTC',
  created_at  timestamptz not null default now()
);

-- One row per tenant; every privacy/retention knob from §19/§20 lives here.
create table public.tenant_settings (
  tenant_id                   uuid primary key references public.tenants(id) on delete cascade,
  allow_spotlight             boolean not null default true,
  allow_group_chat            boolean not null default false,
  allow_screen_capture        boolean not null default true,
  store_event_screenshots     boolean not null default false,
  parent_portal_enabled       boolean not null default false,
  email_alerts_enabled        boolean not null default false,
  nickname_mode               text    not null default 'first_name_initial'
                                check (nickname_mode in ('first_name_initial','approved_nickname','anonymous')),
  learning_retention_days     int     not null default 730 check (learning_retention_days between 30 and 3650),
  telemetry_retention_days    int     not null default 30  check (telemetry_retention_days between 1 and 365),
  default_grace_seconds       int     not null default 15  check (default_grace_seconds between 0 and 600),
  default_idle_seconds        int     not null default 300 check (default_idle_seconds between 30 and 7200),
  thumbnail_interval_seconds  int     not null default 20  check (thumbnail_interval_seconds between 5 and 300),
  monitoring_notice           text    not null default
    'This browser is managed by your school. During an active class session your teacher can see the site you are on and a low-resolution picture of your screen. Nothing is monitored outside class sessions.',
  monitoring_notice_version   int     not null default 1,
  support_access_until        timestamptz,
  updated_at                  timestamptz not null default now()
);

create table public.schools (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  name        text not null check (length(btrim(name)) between 1 and 200),
  created_at  timestamptz not null default now(),
  unique (id, tenant_id)
);

create table public.departments (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  school_id   uuid,
  name        text not null,
  created_at  timestamptz not null default now(),
  unique (id, tenant_id),
  foreign key (school_id, tenant_id) references public.schools(id, tenant_id) on delete cascade
);

-- Application profile for every auth.users row that belongs to a tenant.
create table public.users (
  id            uuid primary key references auth.users(id) on delete cascade,
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  school_id     uuid,
  email         text not null,
  full_name     text not null check (length(btrim(full_name)) between 1 and 200),
  nickname      text check (nickname is null or length(nickname) between 1 and 40),
  role          text not null references public.roles(code),
  status        text not null default 'active' check (status in ('active','suspended')),
  last_seen_at  timestamptz,
  created_at    timestamptz not null default now(),
  unique (id, tenant_id),
  foreign key (school_id, tenant_id) references public.schools(id, tenant_id) on delete set null (school_id)
);
create index users_tenant_role_idx on public.users(tenant_id, role);
create index users_tenant_email_idx on public.users(tenant_id, lower(email));

create table public.student_profiles (
  user_id         uuid primary key,
  tenant_id       uuid not null,
  grade_level     text,
  student_number  text,
  created_at      timestamptz not null default now(),
  foreign key (user_id, tenant_id) references public.users(id, tenant_id) on delete cascade
);

create table public.teacher_profiles (
  user_id       uuid primary key,
  tenant_id     uuid not null,
  subject_area  text,
  department_id uuid,
  created_at    timestamptz not null default now(),
  foreign key (user_id, tenant_id) references public.users(id, tenant_id) on delete cascade,
  foreign key (department_id, tenant_id) references public.departments(id, tenant_id) on delete set null (department_id)
);

-- ---------------------------------------------------------------------------
-- Classes & rosters
-- ---------------------------------------------------------------------------
create table public.classes (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  school_id     uuid,
  department_id uuid,
  teacher_id    uuid not null,
  name          text not null check (length(btrim(name)) between 1 and 200),
  subject       text,
  grade_level   text,
  join_code     text not null unique check (join_code ~ '^[A-Z0-9]{6,8}$'),
  archived_at   timestamptz,
  created_at    timestamptz not null default now(),
  unique (id, tenant_id),
  foreign key (teacher_id, tenant_id) references public.users(id, tenant_id),
  foreign key (school_id, tenant_id) references public.schools(id, tenant_id) on delete set null (school_id),
  foreign key (department_id, tenant_id) references public.departments(id, tenant_id) on delete set null (department_id)
);
create index classes_tenant_idx on public.classes(tenant_id);
create index classes_teacher_idx on public.classes(teacher_id);

create table public.class_members (
  class_id    uuid not null,
  user_id     uuid not null,
  tenant_id   uuid not null,
  role        text not null check (role in ('teacher','student')),
  joined_at   timestamptz not null default now(),
  primary key (class_id, user_id),
  foreign key (class_id, tenant_id) references public.classes(id, tenant_id) on delete cascade,
  foreign key (user_id, tenant_id) references public.users(id, tenant_id) on delete cascade
);
create index class_members_user_idx on public.class_members(user_id);

-- §3.5 "Student groups" + §23 "auto-start environments".
create table public.student_groups (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null,
  class_id              uuid not null,
  name                  text not null,
  auto_start_policy_id  uuid,   -- FK added in 0400 once environment_policies exists
  created_at            timestamptz not null default now(),
  unique (id, tenant_id),
  foreign key (class_id, tenant_id) references public.classes(id, tenant_id) on delete cascade
);

create table public.student_group_members (
  group_id    uuid not null,
  user_id     uuid not null,
  tenant_id   uuid not null,
  primary key (group_id, user_id),
  foreign key (group_id, tenant_id) references public.student_groups(id, tenant_id) on delete cascade,
  foreign key (user_id, tenant_id) references public.users(id, tenant_id) on delete cascade
);

-- Invite codes bring staff, students and parents into an existing tenant.
create table public.invites (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  code        text not null unique check (code ~ '^[A-Z0-9]{8,12}$'),
  role        text not null references public.roles(code) check (role <> 'platform_admin'),
  email       text,
  class_id    uuid,
  student_id  uuid,  -- parent invites: the student the parent will be linked to
  created_by  uuid not null,
  max_uses    int  not null default 1 check (max_uses between 1 and 1000),
  uses        int  not null default 0,
  expires_at  timestamptz not null,
  revoked_at  timestamptz,
  created_at  timestamptz not null default now(),
  foreign key (class_id, tenant_id) references public.classes(id, tenant_id) on delete cascade,
  foreign key (student_id, tenant_id) references public.users(id, tenant_id) on delete cascade,
  foreign key (created_by, tenant_id) references public.users(id, tenant_id) on delete cascade,
  check (role <> 'parent' or student_id is not null)
);

create table public.parent_links (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null,
  parent_id   uuid not null,
  student_id  uuid not null,
  relation    text not null default 'guardian',
  created_at  timestamptz not null default now(),
  revoked_at  timestamptz,
  unique (parent_id, student_id),
  foreign key (parent_id, tenant_id) references public.users(id, tenant_id) on delete cascade,
  foreign key (student_id, tenant_id) references public.users(id, tenant_id) on delete cascade
);

-- ---------------------------------------------------------------------------
-- Billing (§25, §26)
-- ---------------------------------------------------------------------------
create table public.subscriptions (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id) on delete cascade,
  plan_code           text not null references public.plans(code),
  status              text not null check (status in ('trialing','active','past_due','canceled')),
  provider            text not null default 'none' check (provider in ('none','stripe','paystack','manual')),
  provider_ref        text,
  current_period_end  timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create unique index subscriptions_one_live_per_tenant
  on public.subscriptions(tenant_id) where status in ('trialing','active','past_due');

create table public.invoices (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  subscription_id uuid references public.subscriptions(id) on delete set null,
  amount_cents    int  not null check (amount_cents >= 0),
  currency        text not null default 'USD',
  status          text not null check (status in ('draft','open','paid','void','uncollectible')),
  provider_ref    text unique,
  issued_at       timestamptz not null default now(),
  paid_at         timestamptz
);

create table public.feature_flags (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid references public.tenants(id) on delete cascade,  -- null = platform default
  key         text not null check (key ~ '^[a-z0-9_.]{2,64}$'),
  enabled     boolean not null default false,
  updated_at  timestamptz not null default now(),
  unique nulls not distinct (tenant_id, key)
);

-- ---------------------------------------------------------------------------
-- Audit, notifications, consent (§17, §20)
-- ---------------------------------------------------------------------------
create table public.audit_logs (
  id           bigint generated always as identity primary key,
  tenant_id    uuid references public.tenants(id) on delete cascade,
  actor_id     uuid,
  action       text not null,
  target_type  text,
  target_id    text,
  meta         jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);
create index audit_logs_tenant_time_idx on public.audit_logs(tenant_id, created_at desc);

create table public.notifications (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null,
  user_id     uuid not null,
  kind        text not null,
  title       text not null,
  body        text,
  link        text,
  severity    text not null default 'info' check (severity in ('info','warning','critical')),
  payload     jsonb not null default '{}'::jsonb,
  read_at     timestamptz,
  created_at  timestamptz not null default now(),
  foreign key (user_id, tenant_id) references public.users(id, tenant_id) on delete cascade
);
create index notifications_user_idx on public.notifications(user_id, created_at desc);

create table public.consents (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null,
  user_id     uuid not null,
  kind        text not null check (kind in ('monitoring_notice','acceptable_use','privacy_notice')),
  version     int  not null,
  accepted_at timestamptz not null default now(),
  unique (user_id, kind, version),
  foreign key (user_id, tenant_id) references public.users(id, tenant_id) on delete cascade
);

-- =============================================================================
-- Helper functions used by RLS policies and RPCs.
-- All are SECURITY DEFINER with an empty search_path (no hijacking), STABLE
-- where possible so the planner can cache them per statement.
-- =============================================================================
create or replace function app.tenant_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select u.tenant_id from public.users u where u.id = auth.uid() and u.status = 'active'
$$;

create or replace function app.role() returns text
language sql stable security definer set search_path = '' as $$
  select u.role from public.users u where u.id = auth.uid() and u.status = 'active'
$$;

create or replace function app.is_staff() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(app.role() in ('teacher','school_admin','it_admin','platform_admin'), false)
$$;

-- Can author lessons/activities and run classes.
create or replace function app.is_teacher() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(app.role() in ('teacher','school_admin','platform_admin'), false)
$$;

create or replace function app.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(app.role() in ('school_admin','platform_admin'), false)
$$;

-- Device & technical-policy administration (IT admins have no academic access).
create or replace function app.is_it() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(app.role() in ('it_admin','school_admin','platform_admin'), false)
$$;

create or replace function app.can_manage_class(p_class uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.classes c
    where c.id = p_class
      and c.tenant_id = app.tenant_id()
      and (
        c.teacher_id = auth.uid()
        or app.is_admin()
        or exists (select 1 from public.class_members m
                   where m.class_id = c.id and m.user_id = auth.uid() and m.role = 'teacher')
      )
  )
$$;

create or replace function app.in_class(p_class uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.class_members m
    where m.class_id = p_class and m.user_id = auth.uid() and m.tenant_id = app.tenant_id()
  )
$$;

create or replace function app.is_parent_of(p_student uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.parent_links pl
    join public.tenant_settings ts on ts.tenant_id = pl.tenant_id
    where pl.parent_id = auth.uid() and pl.student_id = p_student
      and pl.revoked_at is null and ts.parent_portal_enabled
  )
$$;

-- Does the caller teach/administer a class this student belongs to?
create or replace function app.teaches_student(p_student uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.class_members m
    where m.user_id = p_student and m.role = 'student' and app.can_manage_class(m.class_id)
  )
$$;

-- Unambiguous, human-friendly codes (no 0/O/1/I/L).
create or replace function app.gen_code(p_len int) returns text
language plpgsql volatile set search_path = '' as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_bytes bytea := decode(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 'hex');
  v_out text := '';
begin
  for i in 0 .. p_len - 1 loop
    v_out := v_out || substr(v_alphabet, (get_byte(v_bytes, i) % length(v_alphabet)) + 1, 1);
  end loop;
  return v_out;
end$$;

-- 256-bit random secret, hex encoded. Only its sha256 is ever stored.
create or replace function app.gen_secret() returns text
language sql volatile set search_path = '' as $$
  select replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
$$;

create or replace function app.hash_secret(p_secret text) returns text
language sql immutable set search_path = '' as $$
  select encode(sha256(convert_to(coalesce(p_secret, ''), 'UTF8')), 'hex')
$$;

create or replace function app.audit(
  p_action text, p_target_type text default null, p_target_id text default null,
  p_meta jsonb default '{}'::jsonb, p_tenant uuid default null, p_actor uuid default null
) returns void
language sql volatile security definer set search_path = '' as $$
  insert into public.audit_logs (tenant_id, actor_id, action, target_type, target_id, meta)
  values (coalesce(p_tenant, app.tenant_id()), coalesce(p_actor, auth.uid()),
          p_action, p_target_type, p_target_id, coalesce(p_meta, '{}'::jsonb))
$$;

create or replace function app.notify(
  p_user uuid, p_kind text, p_title text, p_body text default null,
  p_link text default null, p_severity text default 'info', p_payload jsonb default '{}'::jsonb
) returns void
language sql volatile security definer set search_path = '' as $$
  insert into public.notifications (tenant_id, user_id, kind, title, body, link, severity, payload)
  select u.tenant_id, u.id, p_kind, p_title, p_body, p_link, p_severity, coalesce(p_payload, '{}'::jsonb)
  from public.users u where u.id = p_user
$$;

-- Plan limit check. Returns true when the tenant may add one more of p_key.
create or replace function app.within_limit(p_tenant uuid, p_key text, p_current bigint) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select case when p.limits -> p_key is null or jsonb_typeof(p.limits -> p_key) = 'null' then true
                 else p_current < (p.limits ->> p_key)::bigint end
     from public.tenants t join public.plans p on p.code = t.plan_code
     where t.id = p_tenant),
    false)
$$;

create or replace function app.feature(p_tenant uuid, p_key text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select ff.enabled from public.feature_flags ff where ff.tenant_id = p_tenant and ff.key = p_key),
    (select (p.features ->> p_key)::boolean from public.tenants t join public.plans p on p.code = t.plan_code
     where t.id = p_tenant),
    (select ff.enabled from public.feature_flags ff where ff.tenant_id is null and ff.key = p_key),
    false)
$$;

-- Generic updated_at trigger.
create or replace function app.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end$$;

create trigger tenant_settings_touch before update on public.tenant_settings
  for each row execute function app.touch_updated_at();
create trigger subscriptions_touch before update on public.subscriptions
  for each row execute function app.touch_updated_at();
create trigger feature_flags_touch before update on public.feature_flags
  for each row execute function app.touch_updated_at();

-- Role/tenant of a profile are immutable from the client; only definer RPCs
-- (which run as the table owner) may change them.
create or replace function app.guard_user_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user in ('authenticated', 'anon')
     and (new.role is distinct from old.role
          or new.tenant_id is distinct from old.tenant_id
          or new.status is distinct from old.status
          or new.email is distinct from old.email) then
    raise exception 'role, tenant, status and email can only be changed by an administrator'
      using errcode = '42501';
  end if;
  return new;
end$$;
create trigger users_guard before update on public.users
  for each row execute function app.guard_user_update();

-- >>>>>>>>>>>>>>>>>>>> 20260901000200_learning.sql >>>>>>>>>>>>>>>>>>>>
-- =============================================================================
-- SwiftCipher — 0200 learning engine: Studio (§3.1) + Assess (§3.2)
-- =============================================================================

create table public.lessons (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  owner_id        uuid not null,
  title           text not null check (length(btrim(title)) between 1 and 200),
  description     text,
  subject         text,
  grade_level     text,
  status          text not null default 'draft' check (status in ('draft','published','archived')),
  default_mode    text not null default 'live_participation'
                    check (default_mode in ('live_participation','student_paced','front_of_class')),
  is_template     boolean not null default false,
  current_version int not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (id, tenant_id),
  foreign key (owner_id, tenant_id) references public.users(id, tenant_id)
);
create index lessons_tenant_idx on public.lessons(tenant_id, updated_at desc);
create trigger lessons_touch before update on public.lessons
  for each row execute function app.touch_updated_at();

-- Immutable snapshot taken on every publish (§3.1 versioning).
create table public.lesson_versions (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null,
  lesson_id    uuid not null,
  version      int  not null,
  snapshot     jsonb not null,
  published_by uuid,
  created_at   timestamptz not null default now(),
  unique (lesson_id, version),
  foreign key (lesson_id, tenant_id) references public.lessons(id, tenant_id) on delete cascade
);

-- Activities can live inside a lesson or stand alone (question bank, games, assignments).
create table public.activities (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null,
  lesson_id     uuid,
  owner_id      uuid not null,
  kind          text not null check (kind in (
                  'multiple_choice','poll','open_ended','quiz','draw','fill_blank','matching',
                  'drag_drop','collab_board','file_upload','short_answer','code')),
  title         text not null check (length(btrim(title)) between 1 and 200),
  instructions  text,
  -- time_limit_seconds, attempts_allowed, shuffle_questions, shuffle_options,
  -- show_feedback ('immediately'|'after_submit'|'never'), rubric_id
  settings      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (id, tenant_id),
  foreign key (lesson_id, tenant_id) references public.lessons(id, tenant_id) on delete cascade,
  foreign key (owner_id, tenant_id) references public.users(id, tenant_id)
);
create index activities_lesson_idx on public.activities(lesson_id);
create trigger activities_touch before update on public.activities
  for each row execute function app.touch_updated_at();

-- Blueprint name for a competitive/multi-question assessment is "quiz".
create view public.quizzes with (security_invoker = true) as
  select * from public.activities where kind = 'quiz';

create table public.lesson_slides (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null,
  lesson_id   uuid not null,
  position    int  not null check (position >= 0),
  kind        text not null check (kind in (
                'title','text','image','video','audio','embed','link','attachment',
                'shapes','whiteboard','activity')),
  -- kind-specific content: heading, body (markdown), media_id, url, alt, captions_url,
  -- shapes[], strokes[] ... Validated in the API layer.
  content     jsonb not null default '{}'::jsonb,
  notes       text,
  activity_id uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (id, tenant_id),
  foreign key (lesson_id, tenant_id) references public.lessons(id, tenant_id) on delete cascade,
  foreign key (activity_id, tenant_id) references public.activities(id, tenant_id) on delete set null (activity_id),
  check (kind <> 'activity' or activity_id is not null)
);
create index lesson_slides_lesson_idx on public.lesson_slides(lesson_id, position);
create trigger lesson_slides_touch before update on public.lesson_slides
  for each row execute function app.touch_updated_at();

-- Media library (§3.1): folders, tags, search.
-- array_to_string is only STABLE, so wrap it for use in a generated column.
create or replace function app.media_search_doc(p_title text, p_alt text, p_tags text[]) returns tsvector
language sql immutable set search_path = '' as $$
  select to_tsvector('simple'::regconfig,
    coalesce(p_title, '') || ' ' || coalesce(p_alt, '') || ' ' || coalesce(array_to_string(p_tags, ' '), ''))
$$;

create table public.media_folders (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null,
  owner_id    uuid not null,
  parent_id   uuid,
  name        text not null check (length(btrim(name)) between 1 and 120),
  created_at  timestamptz not null default now(),
  unique (id, tenant_id),
  foreign key (owner_id, tenant_id) references public.users(id, tenant_id) on delete cascade,
  foreign key (parent_id, tenant_id) references public.media_folders(id, tenant_id) on delete cascade
);

create table public.lesson_media (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null,
  owner_id      uuid not null,
  folder_id     uuid,
  lesson_id     uuid,
  storage_path  text not null unique,          -- "<tenant_id>/<owner_id>/<uuid>-<name>" in bucket lesson-media
  kind          text not null check (kind in ('image','video','audio','document','other')),
  mime_type     text not null,
  bytes         bigint not null check (bytes >= 0),
  title         text not null,
  alt_text      text,
  captions_path text,
  tags          text[] not null default '{}',
  created_at    timestamptz not null default now(),
  search        tsvector generated always as (app.media_search_doc(title, alt_text, tags)) stored,
  unique (id, tenant_id),
  foreign key (owner_id, tenant_id) references public.users(id, tenant_id),
  foreign key (folder_id, tenant_id) references public.media_folders(id, tenant_id) on delete set null (folder_id),
  foreign key (lesson_id, tenant_id) references public.lessons(id, tenant_id) on delete set null (lesson_id),
  check (storage_path like tenant_id::text || '/%')
);
create index lesson_media_search_idx on public.lesson_media using gin(search);
create index lesson_media_tenant_idx on public.lesson_media(tenant_id, created_at desc);

-- Secure share code/link with expiry (§3.1).
create table public.lesson_shares (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null,
  lesson_id   uuid not null,
  class_id    uuid,
  code        text not null unique check (code ~ '^[A-Z0-9]{8}$'),
  mode        text not null default 'student_paced' check (mode in ('student_paced','front_of_class')),
  created_by  uuid not null,
  expires_at  timestamptz not null,
  revoked_at  timestamptz,
  created_at  timestamptz not null default now(),
  foreign key (lesson_id, tenant_id) references public.lessons(id, tenant_id) on delete cascade,
  foreign key (class_id, tenant_id) references public.classes(id, tenant_id) on delete cascade
);

-- ---------------------------------------------------------------------------
-- Questions. Students never SELECT this table (answer keys live here);
-- they receive sanitised copies through RPCs in 0600.
-- ---------------------------------------------------------------------------
create table public.questions (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null,
  activity_id  uuid,                 -- null = question-bank only
  owner_id     uuid not null,
  kind         text not null check (kind in (
                 'mcq','multi_select','true_false','poll','open','short','fill_blank',
                 'matching','ordering','categorize','draw','file','code')),
  prompt       text not null check (length(btrim(prompt)) between 1 and 4000),
  media        jsonb not null default '{}'::jsonb,
  -- Public, non-secret structure: blanks, left/right items, categories, items to
  -- order, language/starter code, visible test descriptions.
  config       jsonb not null default '{}'::jsonb,
  -- Secret: accepted answers, pairs, correct order, category map, hidden tests.
  answer_key   jsonb not null default '{}'::jsonb,
  explanation  text,
  points       numeric(8,2) not null default 1 check (points >= 0),
  position     int not null default 0,
  in_bank      boolean not null default false,
  tags         text[] not null default '{}',
  difficulty   smallint check (difficulty between 1 and 5),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (id, tenant_id),
  foreign key (activity_id, tenant_id) references public.activities(id, tenant_id) on delete cascade,
  foreign key (owner_id, tenant_id) references public.users(id, tenant_id)
);
create index questions_activity_idx on public.questions(activity_id, position);
create index questions_bank_idx on public.questions(tenant_id) where in_bank;
create trigger questions_touch before update on public.questions
  for each row execute function app.touch_updated_at();

create table public.question_options (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null,
  question_id  uuid not null,
  label        text not null check (length(label) between 1 and 1000),
  is_correct   boolean not null default false,
  feedback     text,
  position     int not null default 0,
  unique (id, tenant_id),
  foreign key (question_id, tenant_id) references public.questions(id, tenant_id) on delete cascade
);
create index question_options_question_idx on public.question_options(question_id, position);

-- ---------------------------------------------------------------------------
-- Assignments / rubrics / grading (§3.2, §23)
-- ---------------------------------------------------------------------------
create table public.rubrics (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null,
  owner_id    uuid not null,
  title       text not null,
  -- [{ "id": "c1", "title": "Accuracy", "levels": [{ "label": "Strong", "points": 4 }] }]
  criteria    jsonb not null check (jsonb_typeof(criteria) = 'array'),
  created_at  timestamptz not null default now(),
  unique (id, tenant_id),
  foreign key (owner_id, tenant_id) references public.users(id, tenant_id)
);

create table public.assignments (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null,
  class_id          uuid not null,
  activity_id       uuid,
  lesson_id         uuid,
  rubric_id         uuid,
  title             text not null check (length(btrim(title)) between 1 and 200),
  instructions      text,
  due_at            timestamptz,
  allow_late        boolean not null default true,
  max_resubmissions int not null default 0 check (max_resubmissions between 0 and 20),
  points_possible   numeric(8,2) not null default 100,
  status            text not null default 'published' check (status in ('draft','published','closed')),
  created_by        uuid not null,
  created_at        timestamptz not null default now(),
  unique (id, tenant_id),
  foreign key (class_id, tenant_id) references public.classes(id, tenant_id) on delete cascade,
  foreign key (activity_id, tenant_id) references public.activities(id, tenant_id) on delete set null (activity_id),
  foreign key (lesson_id, tenant_id) references public.lessons(id, tenant_id) on delete set null (lesson_id),
  foreign key (rubric_id, tenant_id) references public.rubrics(id, tenant_id) on delete set null (rubric_id),
  foreign key (created_by, tenant_id) references public.users(id, tenant_id)
);
create index assignments_class_idx on public.assignments(class_id, due_at);

-- An attempt at any activity: in a live session, from an assignment, or student-paced.
create table public.quiz_attempts (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null,
  activity_id   uuid not null,
  student_id    uuid not null,
  session_id    uuid,              -- FK added in 0300
  assignment_id uuid,
  attempt_no    int not null default 1 check (attempt_no >= 1),
  seed          int not null,      -- drives reproducible question/option shuffling
  status        text not null default 'in_progress' check (status in ('in_progress','submitted','graded')),
  started_at    timestamptz not null default now(),
  deadline_at   timestamptz,
  submitted_at  timestamptz,
  score         numeric(10,2),
  max_score     numeric(10,2),
  unique (id, tenant_id),
  foreign key (activity_id, tenant_id) references public.activities(id, tenant_id) on delete cascade,
  foreign key (student_id, tenant_id) references public.users(id, tenant_id) on delete cascade,
  foreign key (assignment_id, tenant_id) references public.assignments(id, tenant_id) on delete cascade
);
create unique index quiz_attempts_unique_no
  on public.quiz_attempts(activity_id, student_id, coalesce(session_id, '00000000-0000-0000-0000-000000000000'::uuid),
                          coalesce(assignment_id, '00000000-0000-0000-0000-000000000000'::uuid), attempt_no);
create index quiz_attempts_student_idx on public.quiz_attempts(student_id, started_at desc);

create table public.quiz_answers (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null,
  attempt_id    uuid not null,
  question_id   uuid not null,
  response      jsonb not null,
  is_correct    boolean,                 -- null for polls and manually graded work
  auto_score    numeric(8,2),
  manual_score  numeric(8,2),
  feedback      text,
  status        text not null check (status in ('auto_graded','ungraded','pending_review','reviewed')),
  elapsed_ms    int check (elapsed_ms >= 0),
  answered_at   timestamptz not null default now(),
  reviewed_by   uuid,
  reviewed_at   timestamptz,
  unique (attempt_id, question_id),
  foreign key (attempt_id, tenant_id) references public.quiz_attempts(id, tenant_id) on delete cascade,
  foreign key (question_id, tenant_id) references public.questions(id, tenant_id) on delete cascade
);
create index quiz_answers_question_idx on public.quiz_answers(question_id);
create index quiz_answers_review_idx on public.quiz_answers(tenant_id) where status = 'pending_review';

create table public.submissions (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null,
  assignment_id uuid not null,
  student_id    uuid not null,
  attempt_no    int not null default 1,
  body          text,
  files         jsonb not null default '[]'::jsonb,   -- [{ path, name, bytes }] in bucket "submissions"
  attempt_id    uuid,
  status        text not null default 'submitted' check (status in ('submitted','returned','graded')),
  is_late       boolean not null default false,
  submitted_at  timestamptz not null default now(),
  unique (id, tenant_id),
  unique (assignment_id, student_id, attempt_no),
  foreign key (assignment_id, tenant_id) references public.assignments(id, tenant_id) on delete cascade,
  foreign key (student_id, tenant_id) references public.users(id, tenant_id) on delete cascade,
  foreign key (attempt_id, tenant_id) references public.quiz_attempts(id, tenant_id) on delete set null (attempt_id)
);

create table public.grades (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null,
  submission_id  uuid not null unique,
  grader_id      uuid not null,
  score          numeric(8,2) not null check (score >= 0),
  rubric_scores  jsonb not null default '{}'::jsonb,
  feedback       text,
  released_at    timestamptz,
  graded_at      timestamptz not null default now(),
  foreign key (submission_id, tenant_id) references public.submissions(id, tenant_id) on delete cascade,
  foreign key (grader_id, tenant_id) references public.users(id, tenant_id)
);

-- Interactive video (§3.1): questions pinned to timestamps of a video slide.
create table public.video_checkpoints (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null,
  slide_id    uuid not null,
  question_id uuid not null,
  t_seconds   numeric(9,2) not null check (t_seconds >= 0),
  required    boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (slide_id, t_seconds),
  foreign key (slide_id, tenant_id) references public.lesson_slides(id, tenant_id) on delete cascade,
  foreign key (question_id, tenant_id) references public.questions(id, tenant_id) on delete cascade
);

-- Collaborative board (§3.2).
create table public.collab_boards (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null,
  activity_id uuid,
  session_id  uuid,                 -- FK added in 0300
  owner_id    uuid not null,
  title       text not null,
  locked      boolean not null default false,
  anonymous   boolean not null default false,
  created_at  timestamptz not null default now(),
  unique (id, tenant_id),
  foreign key (activity_id, tenant_id) references public.activities(id, tenant_id) on delete cascade,
  foreign key (owner_id, tenant_id) references public.users(id, tenant_id)
);

create table public.collab_posts (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null,
  board_id    uuid not null,
  author_id   uuid not null,
  body        text not null check (length(body) between 1 and 2000),
  color       text not null default 'yellow' check (color in ('yellow','blue','green','pink','purple')),
  x           int not null default 0,
  y           int not null default 0,
  hidden      boolean not null default false,
  created_at  timestamptz not null default now(),
  foreign key (board_id, tenant_id) references public.collab_boards(id, tenant_id) on delete cascade,
  foreign key (author_id, tenant_id) references public.users(id, tenant_id) on delete cascade
);
create index collab_posts_board_idx on public.collab_posts(board_id, created_at);

-- >>>>>>>>>>>>>>>>>>>> 20260901000300_classroom_games.sql >>>>>>>>>>>>>>>>>>>>
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

-- >>>>>>>>>>>>>>>>>>>> 20260901000400_guard.sql >>>>>>>>>>>>>>>>>>>>
-- =============================================================================
-- SwiftCipher — 0400 classroom control engine
-- Devices (§3.5, §21), environments (§3.6, §14), off-task (§3.8),
-- screen monitoring (§15), teacher commands, scenes.
--
-- Privacy boundary (§36): device telemetry is only accepted while the device's
-- student is in a LIVE class session. Outside a session the agent receives
-- "idle" directives and nothing is stored.
-- =============================================================================

create table public.environment_policies (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null,
  owner_id           uuid not null,
  name               text not null check (length(btrim(name)) between 1 and 120),
  description        text,
  allowed_domains    text[] not null default '{}',
  blocked_domains    text[] not null default '{}',
  blocked_categories text[] not null default '{}',
  required_urls      text[] not null default '{}',
  lesson_url         text,
  focus_mode         boolean not null default false,  -- anything outside allow/required is a violation
  lock_screen        boolean not null default false,
  tab_limit          int check (tab_limit is null or tab_limit between 1 and 50),
  grace_seconds      int not null default 15 check (grace_seconds between 0 and 600),
  idle_seconds       int not null default 300 check (idle_seconds between 30 and 7200),
  subject            text,                            -- off-task context (§3.8)
  notify             jsonb not null default '{"banner":true,"sound":false,"browser":false,"email":false}'::jsonb,
  is_template        boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (id, tenant_id),
  foreign key (owner_id, tenant_id) references public.users(id, tenant_id)
);
create trigger environment_policies_touch before update on public.environment_policies
  for each row execute function app.touch_updated_at();

alter table public.class_sessions
  add foreign key (environment_id, tenant_id) references public.environment_policies(id, tenant_id) on delete set null (environment_id);
alter table public.student_groups
  add foreign key (auto_start_policy_id, tenant_id) references public.environment_policies(id, tenant_id) on delete set null (auto_start_policy_id);

-- Scenes = named, reusable bundles of rules (§3.5, §19 templates).
create table public.scenes (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null,
  owner_id    uuid not null,
  name        text not null,
  description text,
  policy_id   uuid not null,
  created_at  timestamptz not null default now(),
  unique (id, tenant_id),
  foreign key (owner_id, tenant_id) references public.users(id, tenant_id),
  foreign key (policy_id, tenant_id) references public.environment_policies(id, tenant_id) on delete cascade
);

create table public.scene_rules (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null,
  scene_id    uuid not null,
  -- extra actions executed when a scene is applied to a running session
  rule_type   text not null check (rule_type in ('open_tab','focus','lock','close_other_tabs','message')),
  value       text,
  position    int not null default 0,
  foreign key (scene_id, tenant_id) references public.scenes(id, tenant_id) on delete cascade
);

-- Global domain → category map used by rule-based off-task detection.
create table public.domain_categories (
  domain    text primary key check (domain ~ '^[a-z0-9.-]+$'),
  category  text not null check (category in ('games','social','video','streaming','shopping','chat','adult','gambling','education','reference','productivity'))
);

insert into public.domain_categories (domain, category) values
  ('roblox.com','games'),('minecraft.net','games'),('coolmathgames.com','games'),('poki.com','games'),
  ('crazygames.com','games'),('miniclip.com','games'),('friv.com','games'),('epicgames.com','games'),
  ('steampowered.com','games'),('chess.com','games'),('slither.io','games'),('agar.io','games'),
  ('facebook.com','social'),('instagram.com','social'),('tiktok.com','social'),('snapchat.com','social'),
  ('x.com','social'),('twitter.com','social'),('reddit.com','social'),('pinterest.com','social'),
  ('threads.net','social'),('discord.com','chat'),('whatsapp.com','chat'),('telegram.org','chat'),
  ('youtube.com','video'),('twitch.tv','streaming'),('netflix.com','streaming'),('primevideo.com','streaming'),
  ('disneyplus.com','streaming'),('hulu.com','streaming'),('spotify.com','streaming'),
  ('amazon.com','shopping'),('ebay.com','shopping'),('aliexpress.com','shopping'),('jumia.com','shopping'),
  ('temu.com','shopping'),('shein.com','shopping'),('bet9ja.com','gambling'),('sportybet.com','gambling'),
  ('bet365.com','gambling'),
  ('wikipedia.org','reference'),('britannica.com','reference'),('khanacademy.org','education'),
  ('code.org','education'),('scratch.mit.edu','education'),('w3schools.com','education'),
  ('developer.mozilla.org','reference'),('docs.google.com','productivity'),('drive.google.com','productivity'),
  ('classroom.google.com','education'),('office.com','productivity'),('desmos.com','education'),
  ('geogebra.org','education');

-- ---------------------------------------------------------------------------
-- Devices (§3.5, §21)
-- ---------------------------------------------------------------------------
create table public.devices (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null,
  student_id     uuid,                  -- school-authorised mapping (§8)
  label          text not null check (length(btrim(label)) between 1 and 120),
  os             text,
  browser        text,
  agent_version  text,
  secret_hash    text not null,         -- sha256(secret); secret only ever shown to the agent once
  status         text not null default 'active' check (status in ('active','disabled','unenrolled')),
  enrolled_by    uuid,
  enrolled_at    timestamptz not null default now(),
  last_seen_at   timestamptz,
  unique (id, tenant_id),
  foreign key (student_id, tenant_id) references public.users(id, tenant_id) on delete set null (student_id)
);
create index devices_tenant_idx on public.devices(tenant_id, status);
create index devices_student_idx on public.devices(student_id) where status = 'active';

create table public.device_enrollments (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null,
  device_id    uuid not null,
  student_id   uuid,
  enrolled_by  uuid,
  method       text not null check (method in ('student_pairing','admin_pairing')),
  created_at   timestamptz not null default now(),
  revoked_at   timestamptz,
  revoked_by   uuid,
  foreign key (device_id, tenant_id) references public.devices(id, tenant_id) on delete cascade,
  foreign key (student_id, tenant_id) references public.users(id, tenant_id) on delete set null (student_id)
);

-- One-time pairing codes: a signed-in student (or IT admin on their behalf)
-- creates one; the extension exchanges it for device credentials.
create table public.device_pairing_codes (
  code        text primary key check (code ~ '^[A-Z0-9]{8}$'),
  tenant_id   uuid not null,
  student_id  uuid not null,
  created_by  uuid not null,
  method      text not null check (method in ('student_pairing','admin_pairing')),
  expires_at  timestamptz not null,
  used_at     timestamptz,
  device_id   uuid,
  created_at  timestamptz not null default now(),
  foreign key (student_id, tenant_id) references public.users(id, tenant_id) on delete cascade
);

-- Live per-device state inside one class session (blueprint "browser_sessions").
create table public.browser_sessions (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null,
  device_id           uuid not null,
  class_session_id    uuid not null,
  student_id          uuid not null,
  started_at          timestamptz not null default now(),
  last_heartbeat_at   timestamptz not null default now(),
  ended_at            timestamptz,
  active_url          text,
  active_domain       text,
  active_title        text,
  tab_count           int,
  idle_state          text not null default 'active' check (idle_state in ('active','idle','locked')),
  idle_since          timestamptz,
  -- Grace-period tracking (§3.6): a violation must persist before it fires.
  violation_kind      text,
  violation_rule      text,
  violation_url       text,
  violation_since     timestamptz,
  snapshot_requested_at timestamptz,
  focus_locked        boolean not null default false,
  connection_lost_at  timestamptz,
  unique (id, tenant_id),
  unique (device_id, class_session_id),
  foreign key (device_id, tenant_id) references public.devices(id, tenant_id) on delete cascade,
  foreign key (class_session_id, tenant_id) references public.class_sessions(id, tenant_id) on delete cascade,
  foreign key (student_id, tenant_id) references public.users(id, tenant_id) on delete cascade
);
create index browser_sessions_session_idx on public.browser_sessions(class_session_id);

-- Telemetry log (retention-limited, §18/§20).
create table public.browser_events (
  id                 bigint generated always as identity primary key,
  tenant_id          uuid not null,
  device_id          uuid not null,
  class_session_id   uuid not null,
  student_id         uuid not null,
  kind               text not null check (kind in ('tab_changed','navigation','idle','active','locked','tab_count')),
  url                text,
  domain             text,
  title              text,
  created_at         timestamptz not null default now(),
  foreign key (device_id, tenant_id) references public.devices(id, tenant_id) on delete cascade,
  foreign key (class_session_id, tenant_id) references public.class_sessions(id, tenant_id) on delete cascade
);
create index browser_events_session_idx on public.browser_events(class_session_id, created_at desc);
create index browser_events_tenant_time_idx on public.browser_events(tenant_id, created_at);

-- Only the LATEST thumbnail per device+session is kept, unless the school has
-- enabled event screenshots (§15: never store continuous recordings).
create table public.screen_snapshots (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null,
  device_id         uuid not null,
  class_session_id  uuid not null,
  student_id        uuid not null,
  image_data        text not null check (image_data like 'data:image/%' and length(image_data) <= 400000),
  width             int,
  height            int,
  quality           text not null default 'thumbnail' check (quality in ('thumbnail','spotlight','event')),
  url               text,
  captured_at       timestamptz not null default now(),
  foreign key (device_id, tenant_id) references public.devices(id, tenant_id) on delete cascade,
  foreign key (class_session_id, tenant_id) references public.class_sessions(id, tenant_id) on delete cascade
);
create unique index screen_snapshots_latest_uidx
  on public.screen_snapshots(device_id, class_session_id, quality) where quality <> 'event';
create index screen_snapshots_session_idx on public.screen_snapshots(class_session_id, captured_at desc);

create table public.environment_events (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null,
  class_session_id  uuid not null,
  class_id          uuid not null,
  student_id        uuid not null,
  device_id         uuid,
  policy_id         uuid,
  kind              text not null check (kind in (
                      'environment_left','domain_blocked','off_task','idle','connection_lost','tab_limit')),
  severity          text not null check (severity in ('info','warning','critical')),
  rule              text not null,          -- human-readable rule that fired
  url               text,
  domain            text,
  confidence        numeric(4,3) check (confidence is null or confidence between 0 and 1),
  status            text not null default 'open'
                      check (status in ('open','acknowledged','dismissed','confirmed','resolved')),
  handled_by        uuid,
  handled_at        timestamptz,
  resolved_at       timestamptz,
  created_at        timestamptz not null default now(),
  unique (id, tenant_id),
  foreign key (class_session_id, tenant_id) references public.class_sessions(id, tenant_id) on delete cascade,
  foreign key (class_id, tenant_id) references public.classes(id, tenant_id) on delete cascade,
  foreign key (student_id, tenant_id) references public.users(id, tenant_id) on delete cascade,
  foreign key (device_id, tenant_id) references public.devices(id, tenant_id) on delete set null (device_id),
  foreign key (policy_id, tenant_id) references public.environment_policies(id, tenant_id) on delete set null (policy_id)
);
-- Deduplication (§3.6): at most one unresolved event per student+kind per session.
create unique index environment_events_dedup
  on public.environment_events(class_session_id, student_id, kind) where resolved_at is null;
create index environment_events_session_idx on public.environment_events(class_session_id, created_at desc);
create index environment_events_tenant_time_idx on public.environment_events(tenant_id, created_at);

-- Teacher feedback loop for off-task alerts (§3.8).
create table public.off_task_feedback (
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  domain        text not null,
  dismissals    int not null default 0,
  confirmations int not null default 0,
  updated_at    timestamptz not null default now(),
  primary key (tenant_id, domain)
);

create table public.off_task_mutes (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null,
  class_session_id  uuid not null,
  student_id        uuid,            -- null = everyone in the session
  domain            text not null,
  muted_by          uuid not null,
  created_at        timestamptz not null default now(),
  foreign key (class_session_id, tenant_id) references public.class_sessions(id, tenant_id) on delete cascade
);

create table public.teacher_commands (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null,
  class_session_id  uuid not null,
  student_id        uuid not null,
  device_id         uuid not null,
  issued_by         uuid not null,
  kind              text not null check (kind in (
                      'open_tab','close_tab','redirect','focus','unfocus','lock','unlock',
                      'close_other_tabs','message','screenshot')),
  payload           jsonb not null default '{}'::jsonb,
  status            text not null default 'queued' check (status in ('queued','delivered','acked','failed','expired')),
  error             text,
  created_at        timestamptz not null default now(),
  delivered_at      timestamptz,
  acked_at          timestamptz,
  expires_at        timestamptz not null default now() + interval '2 minutes',
  foreign key (class_session_id, tenant_id) references public.class_sessions(id, tenant_id) on delete cascade,
  foreign key (student_id, tenant_id) references public.users(id, tenant_id) on delete cascade,
  foreign key (device_id, tenant_id) references public.devices(id, tenant_id) on delete cascade,
  foreign key (issued_by, tenant_id) references public.users(id, tenant_id)
);
create index teacher_commands_device_queue_idx on public.teacher_commands(device_id, created_at) where status = 'queued';
create index teacher_commands_session_idx on public.teacher_commands(class_session_id, created_at desc);

-- >>>>>>>>>>>>>>>>>>>> 20260901000500_rls.sql >>>>>>>>>>>>>>>>>>>>
-- =============================================================================
-- SwiftCipher — 0500 row-level security
--
-- Rules of thumb:
--   * anon can read nothing but public catalogues; every anon action is an RPC.
--   * Writes that need invariants (codes, limits, grading, audit) are RPC-only:
--     those tables simply have no INSERT/UPDATE policy for clients.
--   * Helper calls are wrapped in (select ...) so Postgres evaluates them once
--     per statement instead of once per row.
-- =============================================================================

-- ---------- Extra helpers that depend on learning/classroom tables ----------
create or replace function app.can_edit_lesson(p_lesson uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.lessons l
                 where l.id = p_lesson and l.tenant_id = app.tenant_id()
                   and (l.owner_id = auth.uid() or app.is_admin()))
$$;

create or replace function app.can_view_lesson(p_lesson uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.lessons l
                 where l.id = p_lesson and l.tenant_id = app.tenant_id()
                   and (l.owner_id = auth.uid() or app.is_admin()
                        or (app.is_teacher() and (l.status = 'published' or l.is_template))))
$$;

create or replace function app.can_edit_activity(p_activity uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.activities a
                 where a.id = p_activity and a.tenant_id = app.tenant_id()
                   and (a.owner_id = auth.uid() or app.is_admin()
                        or (a.lesson_id is not null and app.can_edit_lesson(a.lesson_id))))
$$;

create or replace function app.can_view_activity(p_activity uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.activities a
                 where a.id = p_activity and a.tenant_id = app.tenant_id()
                   and (a.owner_id = auth.uid() or app.is_admin()
                        or (a.lesson_id is not null and app.can_view_lesson(a.lesson_id))
                        or (a.lesson_id is null and app.is_teacher())))
$$;

create or replace function app.session_class(p_session uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select s.class_id from public.class_sessions s where s.id = p_session
$$;

create or replace function app.can_manage_session(p_session uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.can_manage_class(app.session_class(p_session))
$$;

create or replace function app.in_session(p_session uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.in_class(app.session_class(p_session))
$$;

-- ---------- Baseline privileges ----------
-- Supabase grants ALL on public tables to anon/authenticated by default; pull
-- anon back to nothing and give authenticated only what policies can gate.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke insert, update, delete, truncate, references, trigger on all tables in schema public from authenticated;
grant select on public.roles, public.plans to anon;

-- Enable RLS everywhere.
do $$
declare r record;
begin
  for r in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'r'
  loop
    execute format('alter table public.%I enable row level security', r.relname);
  end loop;
end$$;

-- ---------- Catalogues ----------
create policy roles_read on public.roles for select using (true);
create policy plans_read on public.plans for select using (true);
create policy domain_categories_read on public.domain_categories for select to authenticated using (true);

-- ---------- Tenancy ----------
create policy tenants_read on public.tenants for select to authenticated
  using (id = (select app.tenant_id()));
grant update (name, country, timezone) on public.tenants to authenticated;
create policy tenants_admin_update on public.tenants for update to authenticated
  using (id = (select app.tenant_id()) and (select app.is_admin()))
  with check (id = (select app.tenant_id()));

create policy tenant_settings_read on public.tenant_settings for select to authenticated
  using (tenant_id = (select app.tenant_id()));
grant update (allow_spotlight, allow_group_chat, allow_screen_capture, store_event_screenshots,
              parent_portal_enabled, email_alerts_enabled, nickname_mode, learning_retention_days,
              telemetry_retention_days, default_grace_seconds, default_idle_seconds,
              thumbnail_interval_seconds, monitoring_notice, support_access_until)
  on public.tenant_settings to authenticated;
create policy tenant_settings_admin_update on public.tenant_settings for update to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.is_admin()))
  with check (tenant_id = (select app.tenant_id()));

create policy schools_read on public.schools for select to authenticated
  using (tenant_id = (select app.tenant_id()));
grant insert, update, delete on public.schools, public.departments to authenticated;
create policy schools_admin_write on public.schools for all to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.is_admin()))
  with check (tenant_id = (select app.tenant_id()) and (select app.is_admin()));
create policy departments_read on public.departments for select to authenticated
  using (tenant_id = (select app.tenant_id()));
create policy departments_admin_write on public.departments for all to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.is_admin()))
  with check (tenant_id = (select app.tenant_id()) and (select app.is_admin()));

-- Users: staff see the tenant directory; students/parents see themselves,
-- staff (to message teachers) and — for parents — their linked students.
create policy users_read on public.users for select to authenticated
  using (tenant_id = (select app.tenant_id())
         and ((select app.is_staff())
              or id = (select auth.uid())
              or role in ('teacher','school_admin')
              or app.is_parent_of(id)));
grant update (full_name, nickname, last_seen_at) on public.users to authenticated;
create policy users_self_update on public.users for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy student_profiles_read on public.student_profiles for select to authenticated
  using (tenant_id = (select app.tenant_id())
         and (user_id = (select auth.uid()) or (select app.is_staff()) or app.is_parent_of(user_id)));
grant insert, update on public.student_profiles, public.teacher_profiles to authenticated;
create policy student_profiles_staff_write on public.student_profiles for all to authenticated
  using (tenant_id = (select app.tenant_id()) and ((select app.is_admin()) or app.teaches_student(user_id)))
  with check (tenant_id = (select app.tenant_id()) and ((select app.is_admin()) or app.teaches_student(user_id)));
create policy teacher_profiles_read on public.teacher_profiles for select to authenticated
  using (tenant_id = (select app.tenant_id()));
create policy teacher_profiles_write on public.teacher_profiles for all to authenticated
  using (tenant_id = (select app.tenant_id()) and (user_id = (select auth.uid()) or (select app.is_admin())))
  with check (tenant_id = (select app.tenant_id()) and (user_id = (select auth.uid()) or (select app.is_admin())));

-- ---------- Classes ----------
create policy classes_read on public.classes for select to authenticated
  using (tenant_id = (select app.tenant_id())
         and ((select app.is_admin()) or (select app.is_it())
              or teacher_id = (select auth.uid()) or app.in_class(id)));
grant update (name, subject, grade_level, archived_at, school_id, department_id) on public.classes to authenticated;
create policy classes_manage_update on public.classes for update to authenticated
  using (app.can_manage_class(id)) with check (tenant_id = (select app.tenant_id()));

create policy class_members_read on public.class_members for select to authenticated
  using (tenant_id = (select app.tenant_id())
         and (user_id = (select auth.uid()) or app.can_manage_class(class_id) or (select app.is_it())
              or (role = 'teacher' and app.in_class(class_id))));
grant insert, delete on public.class_members to authenticated;
create policy class_members_manage_insert on public.class_members for insert to authenticated
  with check (tenant_id = (select app.tenant_id()) and app.can_manage_class(class_id)
              and (role = 'student' or (select app.is_admin())
                   or exists (select 1 from public.classes c where c.id = class_id and c.teacher_id = (select auth.uid()))));
create policy class_members_manage_delete on public.class_members for delete to authenticated
  using (app.can_manage_class(class_id));

create policy student_groups_read on public.student_groups for select to authenticated
  using (app.can_manage_class(class_id) or (tenant_id = (select app.tenant_id()) and (select app.is_it())));
grant insert, update, delete on public.student_groups, public.student_group_members to authenticated;
create policy student_groups_write on public.student_groups for all to authenticated
  using (app.can_manage_class(class_id))
  with check (tenant_id = (select app.tenant_id()) and app.can_manage_class(class_id));
create policy student_group_members_read on public.student_group_members for select to authenticated
  using (exists (select 1 from public.student_groups g where g.id = group_id));
create policy student_group_members_write on public.student_group_members for all to authenticated
  using (exists (select 1 from public.student_groups g where g.id = group_id and app.can_manage_class(g.class_id)))
  with check (tenant_id = (select app.tenant_id())
              and exists (select 1 from public.student_groups g where g.id = group_id and app.can_manage_class(g.class_id))
              and exists (select 1 from public.class_members m join public.student_groups g on g.class_id = m.class_id
                          where g.id = group_id and m.user_id = student_group_members.user_id));

create policy invites_read on public.invites for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (created_by = (select auth.uid()) or (select app.is_admin())));
grant update (revoked_at) on public.invites to authenticated;
create policy invites_revoke on public.invites for update to authenticated
  using (tenant_id = (select app.tenant_id()) and (created_by = (select auth.uid()) or (select app.is_admin())));

create policy parent_links_read on public.parent_links for select to authenticated
  using (tenant_id = (select app.tenant_id())
         and (parent_id = (select auth.uid()) or student_id = (select auth.uid())
              or (select app.is_admin()) or app.teaches_student(student_id)));
grant update (revoked_at) on public.parent_links to authenticated;
create policy parent_links_admin_revoke on public.parent_links for update to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.is_admin()));

-- ---------- Billing / flags / audit / notifications / consents ----------
create policy subscriptions_admin_read on public.subscriptions for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.is_admin()));
create policy invoices_admin_read on public.invoices for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.is_admin()));

create policy feature_flags_read on public.feature_flags for select to authenticated
  using (tenant_id is null or tenant_id = (select app.tenant_id()));
grant insert, update, delete on public.feature_flags to authenticated;
create policy feature_flags_admin_write on public.feature_flags for all to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.is_admin()))
  with check (tenant_id = (select app.tenant_id()) and (select app.is_admin()));

create policy audit_logs_admin_read on public.audit_logs for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.is_admin()));

create policy notifications_own_read on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));
grant update (read_at) on public.notifications to authenticated;
grant delete on public.notifications to authenticated;
create policy notifications_own_update on public.notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy notifications_own_delete on public.notifications for delete to authenticated
  using (user_id = (select auth.uid()));

create policy consents_read on public.consents for select to authenticated
  using (user_id = (select auth.uid()) or (tenant_id = (select app.tenant_id()) and (select app.is_admin())));
grant insert on public.consents to authenticated;
create policy consents_own_insert on public.consents for insert to authenticated
  with check (user_id = (select auth.uid()) and tenant_id = (select app.tenant_id()));

-- ---------- Studio ----------
-- Row-column checks (not app.can_view_lesson(id)) so INSERT ... RETURNING can
-- see the row it just wrote; helper lookups use the pre-statement snapshot.
create policy lessons_read on public.lessons for select to authenticated
  using (tenant_id = (select app.tenant_id())
         and (owner_id = (select auth.uid()) or (select app.is_admin())
              or ((select app.is_teacher()) and (status = 'published' or is_template))));
grant insert, update, delete on public.lessons to authenticated;
create policy lessons_insert on public.lessons for insert to authenticated
  with check (tenant_id = (select app.tenant_id()) and owner_id = (select auth.uid()) and (select app.is_teacher()));
create policy lessons_update on public.lessons for update to authenticated
  using (app.can_edit_lesson(id)) with check (tenant_id = (select app.tenant_id()));
create policy lessons_delete on public.lessons for delete to authenticated
  using (app.can_edit_lesson(id));

create policy lesson_versions_read on public.lesson_versions for select to authenticated
  using (app.can_view_lesson(lesson_id));

create policy lesson_slides_read on public.lesson_slides for select to authenticated
  using (app.can_view_lesson(lesson_id));
grant insert, update, delete on public.lesson_slides to authenticated;
create policy lesson_slides_write on public.lesson_slides for all to authenticated
  using (app.can_edit_lesson(lesson_id))
  with check (tenant_id = (select app.tenant_id()) and app.can_edit_lesson(lesson_id));

create policy media_folders_read on public.media_folders for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.is_teacher()));
grant insert, update, delete on public.media_folders, public.lesson_media to authenticated;
create policy media_folders_write on public.media_folders for all to authenticated
  using (tenant_id = (select app.tenant_id()) and (owner_id = (select auth.uid()) or (select app.is_admin())))
  with check (tenant_id = (select app.tenant_id()) and owner_id = (select auth.uid()) and (select app.is_teacher()));

create policy lesson_media_read on public.lesson_media for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.is_teacher()));
create policy lesson_media_write on public.lesson_media for all to authenticated
  using (tenant_id = (select app.tenant_id()) and (owner_id = (select auth.uid()) or (select app.is_admin())))
  with check (tenant_id = (select app.tenant_id()) and owner_id = (select auth.uid()) and (select app.is_teacher())
              and storage_path like (select app.tenant_id())::text || '/' || (select auth.uid())::text || '/%');

create policy lesson_shares_read on public.lesson_shares for select to authenticated
  using (app.can_edit_lesson(lesson_id));
grant update (revoked_at) on public.lesson_shares to authenticated;
create policy lesson_shares_revoke on public.lesson_shares for update to authenticated
  using (app.can_edit_lesson(lesson_id));

create policy activities_read on public.activities for select to authenticated
  using (tenant_id = (select app.tenant_id())
         and (owner_id = (select auth.uid()) or (select app.is_admin())
              or (lesson_id is not null and app.can_view_lesson(lesson_id))
              or (lesson_id is null and (select app.is_teacher()))));
grant insert, update, delete on public.activities to authenticated;
create policy activities_insert on public.activities for insert to authenticated
  with check (tenant_id = (select app.tenant_id()) and owner_id = (select auth.uid()) and (select app.is_teacher())
              and (lesson_id is null or app.can_edit_lesson(lesson_id)));
create policy activities_update on public.activities for update to authenticated
  using (app.can_edit_activity(id))
  with check (tenant_id = (select app.tenant_id()) and (lesson_id is null or app.can_edit_lesson(lesson_id)));
create policy activities_delete on public.activities for delete to authenticated
  using (app.can_edit_activity(id));

-- Questions/options carry answer keys: staff only. Students use RPCs.
create policy questions_read on public.questions for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.is_teacher())
         and (owner_id = (select auth.uid()) or in_bank
              or (activity_id is not null and app.can_view_activity(activity_id))));
grant insert, update, delete on public.questions, public.question_options to authenticated;
create policy questions_write on public.questions for all to authenticated
  using (tenant_id = (select app.tenant_id())
         and (owner_id = (select auth.uid()) or (activity_id is not null and app.can_edit_activity(activity_id))))
  with check (tenant_id = (select app.tenant_id()) and (select app.is_teacher())
              and (activity_id is null or app.can_edit_activity(activity_id)));

create policy question_options_read on public.question_options for select to authenticated
  using (exists (select 1 from public.questions q where q.id = question_id));
create policy question_options_write on public.question_options for all to authenticated
  using (exists (select 1 from public.questions q where q.id = question_id
                 and (q.owner_id = (select auth.uid()) or (q.activity_id is not null and app.can_edit_activity(q.activity_id)))))
  with check (tenant_id = (select app.tenant_id())
              and exists (select 1 from public.questions q where q.id = question_id
                          and (q.owner_id = (select auth.uid()) or (q.activity_id is not null and app.can_edit_activity(q.activity_id)))));

create policy video_checkpoints_read on public.video_checkpoints for select to authenticated
  using (exists (select 1 from public.lesson_slides s where s.id = slide_id));
grant insert, update, delete on public.video_checkpoints to authenticated;
create policy video_checkpoints_write on public.video_checkpoints for all to authenticated
  using (exists (select 1 from public.lesson_slides s where s.id = slide_id and app.can_edit_lesson(s.lesson_id)))
  with check (tenant_id = (select app.tenant_id())
              and exists (select 1 from public.lesson_slides s where s.id = slide_id and app.can_edit_lesson(s.lesson_id)));

-- ---------- Assessment ----------
create policy rubrics_read on public.rubrics for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.is_teacher()));
grant insert, update, delete on public.rubrics to authenticated;
create policy rubrics_write on public.rubrics for all to authenticated
  using (tenant_id = (select app.tenant_id()) and (owner_id = (select auth.uid()) or (select app.is_admin())))
  with check (tenant_id = (select app.tenant_id()) and owner_id = (select auth.uid()) and (select app.is_teacher()));

create policy assignments_read on public.assignments for select to authenticated
  using (app.can_manage_class(class_id) or (status <> 'draft' and app.in_class(class_id)));
grant insert, update, delete on public.assignments to authenticated;
create policy assignments_write on public.assignments for all to authenticated
  using (app.can_manage_class(class_id))
  with check (tenant_id = (select app.tenant_id()) and app.can_manage_class(class_id) and created_by = (select auth.uid()));

create policy quiz_attempts_read on public.quiz_attempts for select to authenticated
  using (student_id = (select auth.uid())
         or (tenant_id = (select app.tenant_id()) and ((select app.is_admin()) or app.teaches_student(student_id))));

create policy quiz_answers_read on public.quiz_answers for select to authenticated
  using (exists (select 1 from public.quiz_attempts a where a.id = attempt_id));

create policy submissions_read on public.submissions for select to authenticated
  using (student_id = (select auth.uid())
         or exists (select 1 from public.assignments a where a.id = assignment_id and app.can_manage_class(a.class_id)));

create policy grades_read on public.grades for select to authenticated
  using (exists (select 1 from public.submissions s join public.assignments a on a.id = s.assignment_id
                 where s.id = submission_id
                   and (app.can_manage_class(a.class_id) or (s.student_id = (select auth.uid()) and released_at is not null))));

create policy collab_boards_read on public.collab_boards for select to authenticated
  using (tenant_id = (select app.tenant_id())
         and (owner_id = (select auth.uid())
              or (session_id is not null and (app.can_manage_session(session_id) or app.in_session(session_id)))
              or (session_id is null and (select app.is_teacher()))));
grant insert, update, delete on public.collab_boards to authenticated;
create policy collab_boards_write on public.collab_boards for all to authenticated
  using (owner_id = (select auth.uid()) or (session_id is not null and app.can_manage_session(session_id)))
  with check (tenant_id = (select app.tenant_id()) and (select app.is_teacher())
              and (session_id is null or app.can_manage_session(session_id)));

create policy collab_posts_read on public.collab_posts for select to authenticated
  using (exists (select 1 from public.collab_boards b where b.id = board_id
                 and (not hidden or author_id = (select auth.uid()) or b.owner_id = (select auth.uid())
                      or (b.session_id is not null and app.can_manage_session(b.session_id)))));
grant insert, update, delete on public.collab_posts to authenticated;
create policy collab_posts_insert on public.collab_posts for insert to authenticated
  with check (author_id = (select auth.uid()) and tenant_id = (select app.tenant_id()) and not hidden
              and exists (select 1 from public.collab_boards b where b.id = board_id and not b.locked));
create policy collab_posts_update on public.collab_posts for update to authenticated
  using (author_id = (select auth.uid())
         or exists (select 1 from public.collab_boards b where b.id = board_id
                    and (b.owner_id = (select auth.uid()) or (b.session_id is not null and app.can_manage_session(b.session_id)))))
  with check (tenant_id = (select app.tenant_id()));
create policy collab_posts_delete on public.collab_posts for delete to authenticated
  using (author_id = (select auth.uid())
         or exists (select 1 from public.collab_boards b where b.id = board_id
                    and (b.owner_id = (select auth.uid()) or (b.session_id is not null and app.can_manage_session(b.session_id)))));

-- ---------- Live classroom ----------
create policy class_sessions_read on public.class_sessions for select to authenticated
  using (tenant_id = (select app.tenant_id())
         and (app.can_manage_class(class_id) or app.in_class(class_id) or (select app.is_it())));

create policy session_participants_read on public.session_participants for select to authenticated
  using (user_id = (select auth.uid()) or app.can_manage_session(session_id));

create policy announcements_read on public.announcements for select to authenticated
  using (app.can_manage_class(class_id) or app.in_class(class_id));
grant insert on public.announcements to authenticated;
create policy announcements_insert on public.announcements for insert to authenticated
  with check (tenant_id = (select app.tenant_id()) and author_id = (select auth.uid()) and app.can_manage_class(class_id)
              and (session_id is null or app.session_class(session_id) = class_id));

create policy chat_threads_read on public.chat_threads for select to authenticated
  using (tenant_id = (select app.tenant_id())
         and ((kind = 'direct' and (student_id = (select auth.uid()) or teacher_id = (select auth.uid())))
              or (kind = 'group' and (app.can_manage_class(class_id) or app.in_class(class_id)))));

create policy chat_messages_read on public.chat_messages for select to authenticated
  using (exists (select 1 from public.chat_threads t where t.id = thread_id)
         and (not hidden or sender_id = (select auth.uid())
              or exists (select 1 from public.chat_threads t where t.id = thread_id and app.can_manage_class(t.class_id))));

create policy raise_hands_read on public.raise_hands for select to authenticated
  using (student_id = (select auth.uid()) or app.can_manage_session(session_id));
grant insert on public.raise_hands to authenticated;
create policy raise_hands_insert on public.raise_hands for insert to authenticated
  with check (student_id = (select auth.uid()) and tenant_id = (select app.tenant_id())
              and status = 'open' and app.in_session(session_id)
              and exists (select 1 from public.class_sessions s where s.id = session_id and s.status = 'live'));

create policy spotlights_read on public.spotlights for select to authenticated
  using (app.can_manage_session(session_id) or student_id = (select auth.uid())
         or (show_to_class and ended_at is null and app.in_session(session_id)));

create policy attendance_read on public.attendance for select to authenticated
  using (student_id = (select auth.uid()) or app.can_manage_class(class_id) or app.is_parent_of(student_id));
grant insert, update on public.attendance to authenticated;
create policy attendance_write on public.attendance for all to authenticated
  using (app.can_manage_class(class_id))
  with check (tenant_id = (select app.tenant_id()) and app.can_manage_class(class_id)
              and exists (select 1 from public.class_members m where m.class_id = attendance.class_id
                          and m.user_id = attendance.student_id and m.role = 'student'));

create policy rtc_rooms_read on public.rtc_rooms for select to authenticated
  using (app.can_manage_session(session_id) or app.in_session(session_id));
create policy rtc_peers_read on public.rtc_peers for select to authenticated
  using (exists (select 1 from public.rtc_rooms r where r.id = room_id));
create policy rtc_signals_read on public.rtc_signals for select to authenticated
  using (exists (select 1 from public.rtc_peers p where p.id = to_peer_id and p.user_id = (select auth.uid())));

-- ---------- Games ----------
create policy game_sessions_read on public.game_sessions for select to authenticated
  using (app.can_manage_class(class_id) or app.in_class(class_id));
create policy game_teams_read on public.game_teams for select to authenticated
  using (exists (select 1 from public.game_sessions g where g.id = game_id));
-- Students only see their own player row; rankings go through game_leaderboard()
-- so the teacher's visibility settings (§13) are enforced.
create policy game_players_read on public.game_players for select to authenticated
  using (user_id = (select auth.uid())
         or exists (select 1 from public.game_sessions g where g.id = game_id and app.can_manage_class(g.class_id)));
create policy game_answers_read on public.game_answers for select to authenticated
  using (exists (select 1 from public.game_players p where p.id = player_id and p.user_id = (select auth.uid()))
         or exists (select 1 from public.game_sessions g where g.id = game_id and app.can_manage_class(g.class_id)));
create policy leaderboard_entries_read on public.leaderboard_entries for select to authenticated
  using (exists (select 1 from public.game_sessions g where g.id = game_id and app.can_manage_class(g.class_id)));
create policy game_flags_read on public.game_flags for select to authenticated
  using (exists (select 1 from public.game_sessions g where g.id = game_id and app.can_manage_class(g.class_id)));

-- ---------- Guard ----------
create policy environment_policies_read on public.environment_policies for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.is_staff()));
grant insert, update, delete on public.environment_policies to authenticated;
create policy environment_policies_insert on public.environment_policies for insert to authenticated
  with check (tenant_id = (select app.tenant_id()) and owner_id = (select auth.uid()) and (select app.is_staff()));
create policy environment_policies_update on public.environment_policies for update to authenticated
  using (tenant_id = (select app.tenant_id()) and (owner_id = (select auth.uid()) or (select app.is_it())))
  with check (tenant_id = (select app.tenant_id()));
create policy environment_policies_delete on public.environment_policies for delete to authenticated
  using (tenant_id = (select app.tenant_id()) and (owner_id = (select auth.uid()) or (select app.is_it())));

create policy scenes_read on public.scenes for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.is_staff()));
grant insert, update, delete on public.scenes, public.scene_rules to authenticated;
create policy scenes_write on public.scenes for all to authenticated
  using (tenant_id = (select app.tenant_id()) and (owner_id = (select auth.uid()) or (select app.is_it())))
  with check (tenant_id = (select app.tenant_id()) and (select app.is_staff())
              and exists (select 1 from public.environment_policies p where p.id = policy_id));
create policy scene_rules_read on public.scene_rules for select to authenticated
  using (exists (select 1 from public.scenes s where s.id = scene_id));
create policy scene_rules_write on public.scene_rules for all to authenticated
  using (exists (select 1 from public.scenes s where s.id = scene_id
                 and (s.owner_id = (select auth.uid()) or (select app.is_it()))))
  with check (tenant_id = (select app.tenant_id())
              and exists (select 1 from public.scenes s where s.id = scene_id
                          and (s.owner_id = (select auth.uid()) or (select app.is_it()))));

-- Devices: the secret hash is never selectable, even by admins.
revoke select on public.devices from authenticated;
grant select (id, tenant_id, student_id, label, os, browser, agent_version, status,
              enrolled_by, enrolled_at, last_seen_at) on public.devices to authenticated;
create policy devices_read on public.devices for select to authenticated
  using (tenant_id = (select app.tenant_id())
         and ((select app.is_it()) or student_id = (select auth.uid())
              or (student_id is not null and app.teaches_student(student_id))));
grant update (label) on public.devices to authenticated;
create policy devices_it_update on public.devices for update to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.is_it()))
  with check (tenant_id = (select app.tenant_id()));

create policy device_enrollments_read on public.device_enrollments for select to authenticated
  using (tenant_id = (select app.tenant_id()) and ((select app.is_it()) or student_id = (select auth.uid())));
create policy device_pairing_codes_read on public.device_pairing_codes for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (created_by = (select auth.uid()) or (select app.is_it())));

create policy browser_sessions_read on public.browser_sessions for select to authenticated
  using (student_id = (select auth.uid()) or app.can_manage_session(class_session_id));
create policy browser_events_read on public.browser_events for select to authenticated
  using (student_id = (select auth.uid()) or app.can_manage_session(class_session_id)
         or (tenant_id = (select app.tenant_id()) and (select app.is_it())));
create policy screen_snapshots_read on public.screen_snapshots for select to authenticated
  using (student_id = (select auth.uid()) or app.can_manage_session(class_session_id));
create policy environment_events_read on public.environment_events for select to authenticated
  using (student_id = (select auth.uid()) or app.can_manage_session(class_session_id));
create policy off_task_feedback_read on public.off_task_feedback for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.is_staff()));
create policy off_task_mutes_read on public.off_task_mutes for select to authenticated
  using (app.can_manage_session(class_session_id));
create policy teacher_commands_read on public.teacher_commands for select to authenticated
  using (app.can_manage_session(class_session_id)
         or (tenant_id = (select app.tenant_id()) and (select app.is_admin())));

-- ---------- Views run with the caller's rights ----------
grant select on public.quizzes, public.student_presence to authenticated;

-- >>>>>>>>>>>>>>>>>>>> 20260901000600_rpc_accounts.sql >>>>>>>>>>>>>>>>>>>>
-- =============================================================================
-- SwiftCipher — 0600 account, tenant and class RPCs
-- Error codes (mapped to HTTP in src/lib/api.ts):
--   42501 forbidden · P0002 not found · 22023 invalid input · P0001 conflict/rule
-- =============================================================================

create or replace function app.me() returns public.users
language plpgsql stable security definer set search_path = '' as $$
declare v public.users;
begin
  select * into v from public.users where id = auth.uid() and status = 'active';
  if v.id is null then
    raise exception 'You need an active SwiftCipher profile for this action.' using errcode = '42501';
  end if;
  return v;
end$$;

create or replace function app.slugify(p text) returns text
language sql immutable set search_path = '' as $$
  select left(trim(both '-' from regexp_replace(lower(coalesce(p, '')), '[^a-z0-9]+', '-', 'g')), 40)
$$;

create or replace function app.display_name(p_full_name text) returns text
language sql immutable set search_path = '' as $$
  -- "Ada Lovelace" -> "Ada L."  (§13 default privacy display)
  select case
    when position(' ' in btrim(p_full_name)) = 0 then btrim(p_full_name)
    else split_part(btrim(p_full_name), ' ', 1) || ' ' ||
         upper(left(regexp_replace(btrim(p_full_name), '^.*\s', ''), 1)) || '.'
  end
$$;

-- ---------------------------------------------------------------------------
-- Profile / context for the signed-in user (drives the app shell).
-- ---------------------------------------------------------------------------
create or replace function public.me() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_user public.users;
  v_out  jsonb;
begin
  if auth.uid() is null then return null; end if;
  select * into v_user from public.users where id = auth.uid();
  if v_user.id is null then
    return jsonb_build_object('profile', null,
      'email', (select email from auth.users where id = auth.uid()));
  end if;
  select jsonb_build_object(
    'profile', jsonb_build_object('id', v_user.id, 'tenant_id', v_user.tenant_id, 'email', v_user.email,
                                  'full_name', v_user.full_name, 'nickname', v_user.nickname,
                                  'role', v_user.role, 'status', v_user.status),
    'tenant', jsonb_build_object('id', t.id, 'name', t.name, 'slug', t.slug, 'plan_code', t.plan_code,
                                 'timezone', t.timezone),
    'plan', jsonb_build_object('code', p.code, 'name', p.name, 'limits', p.limits, 'features', p.features),
    'settings', to_jsonb(ts) - 'tenant_id',
    'monitoring_consent', exists (select 1 from public.consents c where c.user_id = v_user.id
                                  and c.kind = 'monitoring_notice' and c.version = ts.monitoring_notice_version),
    'unread_notifications', (select count(*) from public.notifications n
                             where n.user_id = v_user.id and n.read_at is null)
  ) into v_out
  from public.tenants t
  join public.plans p on p.code = t.plan_code
  join public.tenant_settings ts on ts.tenant_id = t.id
  where t.id = v_user.tenant_id;
  return v_out;
end$$;

-- ---------------------------------------------------------------------------
-- Sign-up path 1: create a new school workspace (caller becomes school_admin).
-- ---------------------------------------------------------------------------
create or replace function public.bootstrap_school(p_school_name text, p_full_name text, p_country text default null)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid    uuid := auth.uid();
  v_email  text;
  v_tenant uuid;
  v_school uuid;
  v_slug   text;
begin
  if v_uid is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  if exists (select 1 from public.users where id = v_uid) then
    raise exception 'This account already belongs to a school.' using errcode = 'P0001';
  end if;
  if length(btrim(coalesce(p_school_name, ''))) = 0 or length(btrim(coalesce(p_full_name, ''))) = 0 then
    raise exception 'School name and your name are required.' using errcode = '22023';
  end if;
  select email into v_email from auth.users where id = v_uid;

  v_slug := coalesce(nullif(app.slugify(p_school_name), ''), 'school');
  if length(v_slug) < 2 then v_slug := 'school'; end if;
  v_slug := v_slug || '-' || lower(app.gen_code(5));

  insert into public.tenants (name, slug, country) values (btrim(p_school_name), v_slug, p_country)
    returning id into v_tenant;
  insert into public.tenant_settings (tenant_id) values (v_tenant);
  insert into public.schools (tenant_id, name) values (v_tenant, btrim(p_school_name)) returning id into v_school;
  insert into public.users (id, tenant_id, school_id, email, full_name, role)
    values (v_uid, v_tenant, v_school, coalesce(v_email, ''), btrim(p_full_name), 'school_admin');
  insert into public.teacher_profiles (user_id, tenant_id) values (v_uid, v_tenant);
  insert into public.subscriptions (tenant_id, plan_code, status, provider)
    values (v_tenant, 'free_teacher', 'active', 'none');

  perform app.audit('tenant.created', 'tenant', v_tenant::text, jsonb_build_object('name', p_school_name), v_tenant, v_uid);
  return jsonb_build_object('tenant_id', v_tenant, 'role', 'school_admin');
end$$;

-- ---------------------------------------------------------------------------
-- Sign-up path 2 (and "join another class"): redeem a class join code or an
-- invite code. New accounts get a profile; existing accounts get the extra
-- membership/link the code grants, within their own tenant only.
-- ---------------------------------------------------------------------------
create or replace function public.redeem_code(p_code text, p_full_name text default null)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid     uuid := auth.uid();
  v_code    text := upper(btrim(coalesce(p_code, '')));
  v_email   text;
  v_meta    jsonb;
  v_user    public.users;
  v_class   public.classes;
  v_invite  public.invites;
  v_name    text;
  v_count   bigint;
begin
  if v_uid is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  if v_code !~ '^[A-Z0-9]{6,12}$' then raise exception 'That code is not valid.' using errcode = '22023'; end if;

  select email, raw_user_meta_data into v_email, v_meta from auth.users where id = v_uid;
  select * into v_user from public.users where id = v_uid;
  v_name := coalesce(nullif(btrim(p_full_name), ''), nullif(btrim(v_meta ->> 'full_name'), ''),
                     split_part(coalesce(v_email, 'user'), '@', 1));

  -- Invite codes take precedence (8-12 chars); class codes are 6-8.
  select * into v_invite from public.invites
   where code = v_code and revoked_at is null and expires_at > now() and uses < max_uses
   for update;

  if v_invite.id is not null then
    if v_invite.email is not null and lower(v_invite.email) <> lower(coalesce(v_email, '')) then
      raise exception 'This invite was issued for a different email address.' using errcode = '42501';
    end if;

    if v_user.id is null then
      insert into public.users (id, tenant_id, email, full_name, role)
        values (v_uid, v_invite.tenant_id, coalesce(v_email, ''), v_name, v_invite.role)
        returning * into v_user;
      if v_invite.role = 'student' then
        insert into public.student_profiles (user_id, tenant_id) values (v_uid, v_invite.tenant_id);
      elsif v_invite.role in ('teacher','school_admin','it_admin') then
        insert into public.teacher_profiles (user_id, tenant_id) values (v_uid, v_invite.tenant_id);
      end if;
    elsif v_user.tenant_id <> v_invite.tenant_id then
      raise exception 'This code belongs to a different school.' using errcode = '42501';
    elsif v_user.role <> v_invite.role then
      raise exception 'This invite is for a % account.', v_invite.role using errcode = 'P0001';
    end if;

    if v_invite.class_id is not null then
      insert into public.class_members (class_id, user_id, tenant_id, role)
        values (v_invite.class_id, v_uid, v_invite.tenant_id,
                case when v_invite.role = 'student' then 'student' else 'teacher' end)
        on conflict (class_id, user_id) do nothing;
    end if;
    if v_invite.role = 'parent' then
      insert into public.parent_links (tenant_id, parent_id, student_id)
        values (v_invite.tenant_id, v_uid, v_invite.student_id)
        on conflict (parent_id, student_id) do update set revoked_at = null;
    end if;

    update public.invites set uses = uses + 1 where id = v_invite.id;
    perform app.audit('invite.redeemed', 'invite', v_invite.id::text,
                      jsonb_build_object('role', v_invite.role), v_invite.tenant_id, v_uid);
    return jsonb_build_object('tenant_id', v_invite.tenant_id, 'role', v_user.role,
                              'class_id', v_invite.class_id, 'kind', 'invite');
  end if;

  select * into v_class from public.classes where join_code = v_code and archived_at is null;
  if v_class.id is null then
    raise exception 'No class or invite matches that code.' using errcode = 'P0002';
  end if;

  if v_user.id is null then
    insert into public.users (id, tenant_id, email, full_name, role)
      values (v_uid, v_class.tenant_id, coalesce(v_email, ''), v_name, 'student')
      returning * into v_user;
    insert into public.student_profiles (user_id, tenant_id) values (v_uid, v_class.tenant_id);
  elsif v_user.tenant_id <> v_class.tenant_id then
    raise exception 'This class belongs to a different school.' using errcode = '42501';
  elsif v_user.role <> 'student' then
    raise exception 'Class codes are for students. Ask an administrator to add you as a teacher.' using errcode = 'P0001';
  end if;

  if not exists (select 1 from public.class_members where class_id = v_class.id and user_id = v_uid) then
    select count(*) into v_count from public.class_members where class_id = v_class.id and role = 'student';
    if not app.within_limit(v_class.tenant_id, 'students_per_class', v_count) then
      raise exception 'This class is full on the current plan.' using errcode = 'P0001';
    end if;
    insert into public.class_members (class_id, user_id, tenant_id, role)
      values (v_class.id, v_uid, v_class.tenant_id, 'student');
    perform app.notify(v_class.teacher_id, 'student_joined', v_name || ' joined ' || v_class.name,
                       null, '/teacher/classes/' || v_class.id, 'info',
                       jsonb_build_object('class_id', v_class.id, 'student_id', v_uid));
  end if;

  return jsonb_build_object('tenant_id', v_class.tenant_id, 'role', 'student',
                            'class_id', v_class.id, 'class_name', v_class.name, 'kind', 'class');
end$$;

-- ---------------------------------------------------------------------------
-- Classes
-- ---------------------------------------------------------------------------
create or replace function app.unique_code(p_len int, p_table text) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare v text; v_taken boolean;
begin
  for i in 1 .. 20 loop
    v := app.gen_code(p_len);
    execute format('select exists (select 1 from public.%I where %I = $1)', p_table,
                   case when p_table = 'device_pairing_codes' then 'code'
                        when p_table in ('invites','lesson_shares') then 'code'
                        else 'join_code' end)
      into v_taken using v;
    if not v_taken then return v; end if;
  end loop;
  raise exception 'Could not allocate a unique code; try again.' using errcode = 'P0001';
end$$;

create or replace function public.create_class(
  p_name text, p_subject text default null, p_grade_level text default null
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me    public.users := app.me();
  v_count bigint;
  v_class public.classes;
begin
  if not app.is_teacher() then raise exception 'Only teachers can create classes.' using errcode = '42501'; end if;
  select count(*) into v_count from public.classes where tenant_id = v_me.tenant_id and archived_at is null;
  if not app.within_limit(v_me.tenant_id, 'classes', v_count) then
    raise exception 'Your plan''s class limit has been reached. Upgrade to add more classes.' using errcode = 'P0001';
  end if;
  insert into public.classes (tenant_id, school_id, teacher_id, name, subject, grade_level, join_code)
    values (v_me.tenant_id, v_me.school_id, v_me.id, btrim(p_name), nullif(btrim(p_subject), ''),
            nullif(btrim(p_grade_level), ''), app.unique_code(6, 'classes'))
    returning * into v_class;
  insert into public.class_members (class_id, user_id, tenant_id, role)
    values (v_class.id, v_me.id, v_me.tenant_id, 'teacher');
  perform app.audit('class.created', 'class', v_class.id::text, jsonb_build_object('name', v_class.name));
  return to_jsonb(v_class);
end$$;

create or replace function public.regenerate_class_code(p_class uuid) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare v_code text;
begin
  if not app.can_manage_class(p_class) then raise exception 'Not your class.' using errcode = '42501'; end if;
  v_code := app.unique_code(6, 'classes');
  update public.classes set join_code = v_code where id = p_class;
  perform app.audit('class.code_regenerated', 'class', p_class::text);
  return v_code;
end$$;

create or replace function public.transfer_class(p_class uuid, p_teacher uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_me public.users := app.me();
begin
  if not app.is_admin() then raise exception 'Only administrators can transfer classes.' using errcode = '42501'; end if;
  if not exists (select 1 from public.users where id = p_teacher and tenant_id = v_me.tenant_id
                 and role in ('teacher','school_admin') and status = 'active') then
    raise exception 'Choose an active teacher in your school.' using errcode = '22023';
  end if;
  update public.classes set teacher_id = p_teacher where id = p_class and tenant_id = v_me.tenant_id;
  if not found then raise exception 'Class not found.' using errcode = 'P0002'; end if;
  insert into public.class_members (class_id, user_id, tenant_id, role)
    values (p_class, p_teacher, v_me.tenant_id, 'teacher') on conflict (class_id, user_id) do update set role = 'teacher';
  perform app.audit('class.transferred', 'class', p_class::text, jsonb_build_object('teacher_id', p_teacher));
end$$;

-- ---------------------------------------------------------------------------
-- Invites
-- ---------------------------------------------------------------------------
create or replace function public.create_invite(
  p_role text, p_email text default null, p_class uuid default null, p_student uuid default null,
  p_days int default 14, p_max_uses int default 1
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me     public.users := app.me();
  v_invite public.invites;
begin
  if p_role not in ('student','teacher','it_admin','school_admin','parent') then
    raise exception 'Unknown role.' using errcode = '22023';
  end if;
  if p_days not between 1 and 90 or p_max_uses not between 1 and 1000 then
    raise exception 'Invites last 1-90 days and allow 1-1000 uses.' using errcode = '22023';
  end if;

  if p_role in ('teacher','it_admin','school_admin') then
    if not app.is_admin() then raise exception 'Only administrators can invite staff.' using errcode = '42501'; end if;
    if p_role in ('teacher','school_admin') and not app.within_limit(v_me.tenant_id, 'teachers',
         (select count(*) from public.users where tenant_id = v_me.tenant_id and role in ('teacher','school_admin'))) then
      raise exception 'Your plan''s teacher limit has been reached.' using errcode = 'P0001';
    end if;
  elsif p_role = 'student' then
    if p_class is null then raise exception 'Student invites need a class.' using errcode = '22023'; end if;
    if not app.can_manage_class(p_class) then raise exception 'Not your class.' using errcode = '42501'; end if;
  elsif p_role = 'parent' then
    if p_student is null then raise exception 'Parent invites need a student.' using errcode = '22023'; end if;
    if not (app.is_admin() or app.teaches_student(p_student)) then
      raise exception 'You can only invite parents of your own students.' using errcode = '42501';
    end if;
    if not exists (select 1 from public.users where id = p_student and tenant_id = v_me.tenant_id and role = 'student') then
      raise exception 'Student not found.' using errcode = 'P0002';
    end if;
  end if;

  if p_class is not null and not exists (select 1 from public.classes where id = p_class and tenant_id = v_me.tenant_id) then
    raise exception 'Class not found.' using errcode = 'P0002';
  end if;

  insert into public.invites (tenant_id, code, role, email, class_id, student_id, created_by, max_uses, expires_at)
    values (v_me.tenant_id, app.unique_code(10, 'invites'), p_role, nullif(lower(btrim(p_email)), ''),
            p_class, p_student, v_me.id, p_max_uses, now() + make_interval(days => p_days))
    returning * into v_invite;
  perform app.audit('invite.created', 'invite', v_invite.id::text,
                    jsonb_build_object('role', p_role, 'class_id', p_class, 'student_id', p_student));
  return to_jsonb(v_invite);
end$$;

-- ---------------------------------------------------------------------------
-- Administration (§19)
-- ---------------------------------------------------------------------------
create or replace function public.admin_set_user_role(p_user uuid, p_role text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_me public.users := app.me(); v_target public.users;
begin
  if not app.is_admin() then raise exception 'Administrators only.' using errcode = '42501'; end if;
  if p_role not in ('student','teacher','it_admin','school_admin','parent') then
    raise exception 'Unknown role.' using errcode = '22023';
  end if;
  select * into v_target from public.users where id = p_user and tenant_id = v_me.tenant_id;
  if v_target.id is null then raise exception 'User not found.' using errcode = 'P0002'; end if;
  if v_target.role = 'school_admin' and p_role <> 'school_admin'
     and (select count(*) from public.users where tenant_id = v_me.tenant_id and role = 'school_admin' and status = 'active') <= 1 then
    raise exception 'A school needs at least one administrator.' using errcode = 'P0001';
  end if;
  update public.users set role = p_role where id = p_user;
  perform app.audit('user.role_changed', 'user', p_user::text, jsonb_build_object('from', v_target.role, 'to', p_role));
end$$;

create or replace function public.admin_set_user_status(p_user uuid, p_status text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_me public.users := app.me();
begin
  if not app.is_admin() then raise exception 'Administrators only.' using errcode = '42501'; end if;
  if p_status not in ('active','suspended') then raise exception 'Unknown status.' using errcode = '22023'; end if;
  if p_user = v_me.id then raise exception 'You cannot suspend yourself.' using errcode = 'P0001'; end if;
  update public.users set status = p_status where id = p_user and tenant_id = v_me.tenant_id;
  if not found then raise exception 'User not found.' using errcode = 'P0002'; end if;
  perform app.audit('user.status_changed', 'user', p_user::text, jsonb_build_object('status', p_status));
end$$;

-- Record consent to the monitoring/acceptable-use notice (§20).
create or replace function public.accept_notice(p_kind text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_me public.users := app.me(); v_version int;
begin
  if p_kind not in ('monitoring_notice','acceptable_use','privacy_notice') then
    raise exception 'Unknown notice.' using errcode = '22023';
  end if;
  select monitoring_notice_version into v_version from public.tenant_settings where tenant_id = v_me.tenant_id;
  insert into public.consents (tenant_id, user_id, kind, version)
    values (v_me.tenant_id, v_me.id, p_kind, coalesce(v_version, 1))
    on conflict (user_id, kind, version) do nothing;
end$$;

-- Bumping the notice text forces everyone to re-acknowledge it.
create or replace function app.bump_notice_version() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.monitoring_notice is distinct from old.monitoring_notice then
    new.monitoring_notice_version := old.monitoring_notice_version + 1;
  end if;
  return new;
end$$;
create trigger tenant_settings_notice_version before update on public.tenant_settings
  for each row execute function app.bump_notice_version();

-- Audit every settings change (§20 "audit logs for policy changes").
create or replace function app.audit_settings_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform app.audit('settings.updated', 'tenant_settings', new.tenant_id::text,
                    (to_jsonb(new) - 'updated_at') - coalesce(
                      (select array_agg(k) from jsonb_object_keys(to_jsonb(old)) k
                       where to_jsonb(old) -> k = to_jsonb(new) -> k), '{}'::text[]),
                    new.tenant_id);
  return new;
end$$;
create trigger tenant_settings_audit after update on public.tenant_settings
  for each row execute function app.audit_settings_change();

-- >>>>>>>>>>>>>>>>>>>> 20260901000610_rpc_learning.sql >>>>>>>>>>>>>>>>>>>>
-- =============================================================================
-- SwiftCipher — 0610 Studio + Assess RPCs
-- Students never read public.questions / question_options. Everything they
-- see passes through app.sanitize_question(); everything they submit is graded
-- here by app.grade_response().
-- =============================================================================

-- Deterministic shuffle key: same seed -> same order (reproducible attempts).
create or replace function app.shuffle_key(p_seed bigint, p_id text) returns text
language sql immutable set search_path = '' as $$
  select md5(p_seed::text || ':' || p_id)
$$;

create or replace function app.normalize_text(p text, p_case_sensitive boolean default false) returns text
language sql immutable set search_path = '' as $$
  select case when p_case_sensitive then regexp_replace(btrim(coalesce(p, '')), '\s+', ' ', 'g')
              else lower(regexp_replace(btrim(coalesce(p, '')), '\s+', ' ', 'g')) end
$$;

-- Public view of a question. Secret parts (answer_key, option.is_correct,
-- hidden tests) are dropped; order-revealing lists are always shuffled.
create or replace function app.sanitize_question(p_q public.questions, p_seed bigint, p_shuffle_options boolean)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_cfg     jsonb := coalesce(p_q.config, '{}'::jsonb);
  v_options jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'label', o.label)
                  order by case when p_shuffle_options and p_q.kind in ('mcq','multi_select','poll')
                                then app.shuffle_key(p_seed, o.id::text) else lpad(o.position::text, 6, '0') end), '[]'::jsonb)
    into v_options
  from public.question_options o where o.question_id = p_q.id;

  -- Lists whose stored order IS the answer must never leave in stored order.
  if p_q.kind = 'ordering' and v_cfg ? 'items' then
    v_cfg := jsonb_set(v_cfg, '{items}', (select coalesce(jsonb_agg(e order by app.shuffle_key(p_seed + 7, e ->> 'id')), '[]'::jsonb)
                                           from jsonb_array_elements(v_cfg -> 'items') e));
  end if;
  if p_q.kind = 'matching' and v_cfg ? 'right' then
    v_cfg := jsonb_set(v_cfg, '{right}', (select coalesce(jsonb_agg(e order by app.shuffle_key(p_seed + 11, e ->> 'id')), '[]'::jsonb)
                                           from jsonb_array_elements(v_cfg -> 'right') e));
  end if;
  if p_q.kind = 'categorize' and v_cfg ? 'items' then
    v_cfg := jsonb_set(v_cfg, '{items}', (select coalesce(jsonb_agg(e order by app.shuffle_key(p_seed + 13, e ->> 'id')), '[]'::jsonb)
                                           from jsonb_array_elements(v_cfg -> 'items') e));
  end if;
  v_cfg := v_cfg - 'hidden_tests';

  return jsonb_build_object(
    'id', p_q.id, 'kind', p_q.kind, 'prompt', p_q.prompt, 'media', p_q.media,
    'config', v_cfg, 'options', v_options, 'points', p_q.points);
end$$;

-- ---------------------------------------------------------------------------
-- Grading. Returns { is_correct, score, status }.
--   status: auto_graded | ungraded (polls, zero-point prompts) | pending_review
-- ---------------------------------------------------------------------------
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
begin
  if p_response is null or jsonb_typeof(p_response) <> 'object' then
    raise exception 'Response must be a JSON object.' using errcode = '22023';
  end if;

  case p_q.kind
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

-- Correct answer, revealed only when the activity's feedback setting allows.
create or replace function app.reveal_answer(p_q public.questions) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'correct_option_ids', (select coalesce(jsonb_agg(o.id), '[]'::jsonb) from public.question_options o
                           where o.question_id = p_q.id and o.is_correct),
    'answer_key', case when p_q.kind in ('fill_blank','matching','ordering','categorize') then p_q.answer_key else null end,
    'explanation', p_q.explanation)
$$;

-- ---------------------------------------------------------------------------
-- Lesson payload for a learner (no keys). Used by live sessions and shares.
-- ---------------------------------------------------------------------------
create or replace function app.lesson_payload(p_lesson uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'lesson', jsonb_build_object('id', l.id, 'title', l.title, 'description', l.description,
                                 'subject', l.subject, 'version', l.current_version),
    'slides', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', s.id, 'position', s.position, 'kind', s.kind, 'content', s.content,
               'activity', case when a.id is null then null else jsonb_build_object(
                  'id', a.id, 'kind', a.kind, 'title', a.title, 'instructions', a.instructions,
                  'settings', a.settings - 'rubric_id') end,
               'checkpoints', (select coalesce(jsonb_agg(jsonb_build_object(
                                  'id', vc.id, 't_seconds', vc.t_seconds, 'required', vc.required,
                                  'question_id', vc.question_id, 'activity_id', q.activity_id)
                                  order by vc.t_seconds), '[]'::jsonb)
                               from public.video_checkpoints vc join public.questions q on q.id = vc.question_id
                               where vc.slide_id = s.id))
             order by s.position)
      from public.lesson_slides s left join public.activities a on a.id = s.activity_id
      where s.lesson_id = l.id), '[]'::jsonb))
  from public.lessons l where l.id = p_lesson
$$;

create or replace function public.publish_lesson(p_lesson uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_lesson public.lessons; v_snapshot jsonb;
begin
  if not app.can_edit_lesson(p_lesson) then raise exception 'You cannot publish this lesson.' using errcode = '42501'; end if;
  if not exists (select 1 from public.lesson_slides where lesson_id = p_lesson) then
    raise exception 'Add at least one slide before publishing.' using errcode = 'P0001';
  end if;
  update public.lessons set status = 'published', current_version = current_version + 1
   where id = p_lesson returning * into v_lesson;
  v_snapshot := app.lesson_payload(p_lesson) || jsonb_build_object(
    'questions', (select coalesce(jsonb_agg(to_jsonb(q) || jsonb_build_object('options',
                    (select coalesce(jsonb_agg(to_jsonb(o) order by o.position), '[]'::jsonb)
                     from public.question_options o where o.question_id = q.id))), '[]'::jsonb)
                  from public.questions q join public.activities a on a.id = q.activity_id
                  where a.lesson_id = p_lesson));
  insert into public.lesson_versions (tenant_id, lesson_id, version, snapshot, published_by)
    values (v_lesson.tenant_id, p_lesson, v_lesson.current_version, v_snapshot, auth.uid());
  perform app.audit('lesson.published', 'lesson', p_lesson::text, jsonb_build_object('version', v_lesson.current_version));
  return jsonb_build_object('id', p_lesson, 'version', v_lesson.current_version);
end$$;

create or replace function public.duplicate_lesson(p_lesson uuid, p_title text default null, p_as_template boolean default false)
returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me     public.users := app.me();
  v_src    public.lessons;
  v_new    uuid;
  v_map_a  jsonb := '{}'::jsonb;   -- old activity id -> new
  v_map_q  jsonb := '{}'::jsonb;   -- old question id -> new
  v_map_s  jsonb := '{}'::jsonb;   -- old slide id -> new
  r        record;
  v_id     uuid;
begin
  if not app.is_teacher() or not app.can_view_lesson(p_lesson) then
    raise exception 'You cannot copy this lesson.' using errcode = '42501';
  end if;
  select * into v_src from public.lessons where id = p_lesson;
  insert into public.lessons (tenant_id, owner_id, title, description, subject, grade_level, default_mode, is_template)
    values (v_me.tenant_id, v_me.id, coalesce(nullif(btrim(p_title), ''), left(v_src.title || ' (copy)', 200)),
            v_src.description, v_src.subject, v_src.grade_level, v_src.default_mode, p_as_template)
    returning id into v_new;

  for r in select * from public.activities where lesson_id = p_lesson loop
    insert into public.activities (tenant_id, lesson_id, owner_id, kind, title, instructions, settings)
      values (v_me.tenant_id, v_new, v_me.id, r.kind, r.title, r.instructions, r.settings) returning id into v_id;
    v_map_a := v_map_a || jsonb_build_object(r.id::text, v_id);
  end loop;

  for r in select q.* from public.questions q join public.activities a on a.id = q.activity_id where a.lesson_id = p_lesson loop
    insert into public.questions (tenant_id, activity_id, owner_id, kind, prompt, media, config, answer_key,
                                  explanation, points, position, tags, difficulty)
      values (v_me.tenant_id, (v_map_a ->> r.activity_id::text)::uuid, v_me.id, r.kind, r.prompt, r.media, r.config,
              r.answer_key, r.explanation, r.points, r.position, r.tags, r.difficulty)
      returning id into v_id;
    v_map_q := v_map_q || jsonb_build_object(r.id::text, v_id);
    insert into public.question_options (tenant_id, question_id, label, is_correct, feedback, position)
      select v_me.tenant_id, v_id, o.label, o.is_correct, o.feedback, o.position
      from public.question_options o where o.question_id = r.id;
  end loop;

  for r in select * from public.lesson_slides where lesson_id = p_lesson order by position loop
    insert into public.lesson_slides (tenant_id, lesson_id, position, kind, content, notes, activity_id)
      values (v_me.tenant_id, v_new, r.position, r.kind, r.content, r.notes, (v_map_a ->> r.activity_id::text)::uuid)
      returning id into v_id;
    v_map_s := v_map_s || jsonb_build_object(r.id::text, v_id);
  end loop;

  insert into public.video_checkpoints (tenant_id, slide_id, question_id, t_seconds, required)
    select v_me.tenant_id, (v_map_s ->> vc.slide_id::text)::uuid, (v_map_q ->> vc.question_id::text)::uuid,
           vc.t_seconds, vc.required
    from public.video_checkpoints vc join public.lesson_slides s on s.id = vc.slide_id
    where s.lesson_id = p_lesson and v_map_q ? vc.question_id::text;

  perform app.audit('lesson.duplicated', 'lesson', v_new::text, jsonb_build_object('source', p_lesson));
  return v_new;
end$$;

create or replace function public.create_lesson_share(
  p_lesson uuid, p_mode text default 'student_paced', p_hours int default 168, p_class uuid default null
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_me public.users := app.me(); v_share public.lesson_shares;
begin
  if not app.can_edit_lesson(p_lesson) then raise exception 'You cannot share this lesson.' using errcode = '42501'; end if;
  if p_hours not between 1 and 2160 then raise exception 'Links last between 1 hour and 90 days.' using errcode = '22023'; end if;
  if p_class is not null and not app.can_manage_class(p_class) then raise exception 'Not your class.' using errcode = '42501'; end if;
  if (select status from public.lessons where id = p_lesson) <> 'published' then
    raise exception 'Publish the lesson before sharing it.' using errcode = 'P0001';
  end if;
  insert into public.lesson_shares (tenant_id, lesson_id, class_id, code, mode, created_by, expires_at)
    values (v_me.tenant_id, p_lesson, p_class, app.unique_code(8, 'lesson_shares'), p_mode, v_me.id,
            now() + make_interval(hours => p_hours))
    returning * into v_share;
  perform app.audit('lesson.shared', 'lesson', p_lesson::text, jsonb_build_object('code', v_share.code, 'hours', p_hours));
  return to_jsonb(v_share);
end$$;

create or replace function app.valid_share(p_code text) returns public.lesson_shares
language plpgsql stable security definer set search_path = '' as $$
declare v public.lesson_shares; v_me public.users := app.me();
begin
  select * into v from public.lesson_shares
   where code = upper(btrim(p_code)) and revoked_at is null and expires_at > now() and tenant_id = v_me.tenant_id;
  if v.id is null then raise exception 'This lesson link is invalid or has expired.' using errcode = 'P0002'; end if;
  if v.class_id is not null and not (app.in_class(v.class_id) or app.can_manage_class(v.class_id)) then
    raise exception 'This lesson link is for a different class.' using errcode = '42501';
  end if;
  return v;
end$$;

create or replace function public.open_lesson_share(p_code text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v public.lesson_shares := app.valid_share(p_code);
begin
  return app.lesson_payload(v.lesson_id) || jsonb_build_object('share', jsonb_build_object(
    'code', v.code, 'mode', v.mode, 'expires_at', v.expires_at));
end$$;

-- ---------------------------------------------------------------------------
-- Attempts
-- ---------------------------------------------------------------------------
create or replace function app.attempt_context_ok(
  p_activity public.activities, p_session uuid, p_assignment uuid, p_share text
) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v_s public.class_sessions; v_a public.assignments;
begin
  if p_session is not null then
    select * into v_s from public.class_sessions where id = p_session;
    -- coalesce: a NULL active_activity_id must mean "no", never "unknown".
    return coalesce(v_s.id is not null and v_s.status = 'live' and app.in_class(v_s.class_id)
       and (v_s.active_activity_id = p_activity.id
            or (p_activity.lesson_id is not null and p_activity.lesson_id = v_s.lesson_id
                and (v_s.mode = 'student_paced'
                     or exists (select 1 from public.lesson_slides sl where sl.lesson_id = v_s.lesson_id
                                and sl.activity_id = p_activity.id and sl.position = v_s.current_slide)
                     or exists (select 1 from public.video_checkpoints vc
                                join public.questions q on q.id = vc.question_id
                                join public.lesson_slides sl on sl.id = vc.slide_id
                                where q.activity_id = p_activity.id and sl.lesson_id = v_s.lesson_id)))), false);
  elsif p_assignment is not null then
    select * into v_a from public.assignments where id = p_assignment;
    return coalesce(v_a.id is not null and v_a.status = 'published' and v_a.activity_id = p_activity.id
       and app.in_class(v_a.class_id)
       and (v_a.due_at is null or v_a.due_at > now() or v_a.allow_late), false);
  elsif p_share is not null then
    return coalesce(p_activity.lesson_id = (app.valid_share(p_share)).lesson_id, false);
  end if;
  return false;
end$$;

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
    v_allowed := coalesce((v_act.settings ->> 'attempts_allowed')::int, 1);
    select coalesce(max(attempt_no), 0) into v_used from public.quiz_attempts
     where activity_id = p_activity and student_id = v_me.id
       and session_id is not distinct from p_session and assignment_id is not distinct from p_assignment;
    if v_allowed > 0 and v_used >= v_allowed then
      raise exception 'No attempts left for this activity.' using errcode = 'P0001';
    end if;
    v_limit := nullif((v_act.settings ->> 'time_limit_seconds')::int, 0);
    insert into public.quiz_attempts (tenant_id, activity_id, student_id, session_id, assignment_id,
                                      attempt_no, seed, deadline_at, max_score)
      values (v_me.tenant_id, p_activity, v_me.id, p_session, p_assignment, v_used + 1,
              (random() * 2147483646)::int,
              case when v_limit is null then null else now() + make_interval(secs => v_limit) end,
              (select coalesce(sum(points), 0) from public.questions where activity_id = p_activity and kind <> 'poll'))
      returning * into v_attempt;
  end if;

  v_shuffle_q := coalesce((v_act.settings ->> 'shuffle_questions')::boolean, false);
  v_shuffle_o := coalesce((v_act.settings ->> 'shuffle_options')::boolean, false);

  return jsonb_build_object(
    'attempt', jsonb_build_object('id', v_attempt.id, 'attempt_no', v_attempt.attempt_no,
                                  'deadline_at', v_attempt.deadline_at, 'status', v_attempt.status,
                                  'server_now', now()),
    'activity', jsonb_build_object('id', v_act.id, 'kind', v_act.kind, 'title', v_act.title,
                                   'instructions', v_act.instructions, 'settings', v_act.settings - 'rubric_id'),
    'questions', (select coalesce(jsonb_agg(app.sanitize_question(q, v_attempt.seed, v_shuffle_o)
                                   order by case when v_shuffle_q then app.shuffle_key(v_attempt.seed, q.id::text)
                                                 else lpad(q.position::text, 6, '0') || q.created_at::text end), '[]'::jsonb)
                  from public.questions q where q.activity_id = p_activity),
    'answers', (select coalesce(jsonb_object_agg(a.question_id, a.response), '{}'::jsonb)
                from public.quiz_answers a where a.attempt_id = v_attempt.id));
end$$;

create or replace function app.recompute_attempt(p_attempt uuid) returns void
language sql volatile security definer set search_path = '' as $$
  update public.quiz_attempts qa set
    score = (select coalesce(sum(coalesce(a.manual_score, a.auto_score, 0)), 0) from public.quiz_answers a where a.attempt_id = qa.id),
    status = case when qa.status = 'in_progress' then 'in_progress'
                  when exists (select 1 from public.quiz_answers a where a.attempt_id = qa.id and a.status = 'pending_review')
                    then 'submitted'
                  else 'graded' end
  where qa.id = p_attempt
$$;

create or replace function public.submit_answer(
  p_attempt uuid, p_question uuid, p_response jsonb, p_elapsed_ms int default null
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me      public.users := app.me();
  v_attempt public.quiz_attempts;
  v_act     public.activities;
  v_q       public.questions;
  v_grade   jsonb;
  v_feedback text;
begin
  select * into v_attempt from public.quiz_attempts where id = p_attempt and student_id = v_me.id for update;
  if v_attempt.id is null then raise exception 'Attempt not found.' using errcode = 'P0002'; end if;
  if v_attempt.status <> 'in_progress' then raise exception 'This attempt has already been submitted.' using errcode = 'P0001'; end if;
  if v_attempt.deadline_at is not null and now() > v_attempt.deadline_at + interval '5 seconds' then
    perform public.finish_attempt(p_attempt);
    raise exception 'Time is up — your attempt was submitted.' using errcode = 'P0001';
  end if;
  if length(p_response::text) > 200000 then raise exception 'Response is too large.' using errcode = '22023'; end if;

  select * into v_q from public.questions where id = p_question and activity_id = v_attempt.activity_id;
  if v_q.id is null then raise exception 'Question not in this activity.' using errcode = 'P0002'; end if;
  select * into v_act from public.activities where id = v_attempt.activity_id;

  v_grade := app.grade_response(v_q, p_response);
  insert into public.quiz_answers (tenant_id, attempt_id, question_id, response, is_correct, auto_score, status, elapsed_ms)
    values (v_me.tenant_id, p_attempt, p_question, p_response, (v_grade ->> 'is_correct')::boolean,
            (v_grade ->> 'score')::numeric, v_grade ->> 'status', greatest(coalesce(p_elapsed_ms, 0), 0))
    on conflict (attempt_id, question_id) do update
      set response = excluded.response, is_correct = excluded.is_correct, auto_score = excluded.auto_score,
          status = excluded.status, elapsed_ms = excluded.elapsed_ms, answered_at = now();

  v_feedback := coalesce(v_act.settings ->> 'show_feedback', 'after_submit');
  if v_feedback = 'immediately' and v_grade ->> 'status' = 'auto_graded' then
    return jsonb_build_object('saved', true, 'status', v_grade ->> 'status',
                              'is_correct', (v_grade ->> 'is_correct')::boolean, 'score', (v_grade ->> 'score')::numeric)
           || app.reveal_answer(v_q);
  end if;
  return jsonb_build_object('saved', true, 'status', v_grade ->> 'status');
end$$;

create or replace function public.finish_attempt(p_attempt uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_attempt public.quiz_attempts;
  v_act     public.activities;
  v_asg     public.assignments;
  v_no      int;
begin
  select * into v_attempt from public.quiz_attempts where id = p_attempt and student_id = auth.uid() for update;
  if v_attempt.id is null then raise exception 'Attempt not found.' using errcode = 'P0002'; end if;
  if v_attempt.status = 'in_progress' then
    update public.quiz_attempts set status = 'submitted', submitted_at = now() where id = p_attempt;
    perform app.recompute_attempt(p_attempt);
    if v_attempt.assignment_id is not null then
      select * into v_asg from public.assignments where id = v_attempt.assignment_id;
      select coalesce(max(attempt_no), 0) + 1 into v_no from public.submissions
       where assignment_id = v_asg.id and student_id = v_attempt.student_id;
      insert into public.submissions (tenant_id, assignment_id, student_id, attempt_no, attempt_id, is_late)
        values (v_attempt.tenant_id, v_asg.id, v_attempt.student_id, v_no, p_attempt,
                v_asg.due_at is not null and now() > v_asg.due_at);
    end if;
  end if;
  select * into v_attempt from public.quiz_attempts where id = p_attempt;
  select * into v_act from public.activities where id = v_attempt.activity_id;

  return jsonb_build_object(
    'attempt', jsonb_build_object('id', v_attempt.id, 'status', v_attempt.status, 'score', v_attempt.score,
                                  'max_score', v_attempt.max_score, 'submitted_at', v_attempt.submitted_at),
    'results', case when coalesce(v_act.settings ->> 'show_feedback', 'after_submit') = 'never' then null else (
       select coalesce(jsonb_agg(jsonb_build_object('question_id', a.question_id, 'is_correct', a.is_correct,
                        'score', coalesce(a.manual_score, a.auto_score), 'status', a.status, 'feedback', a.feedback)
                        || app.reveal_answer(q)), '[]'::jsonb)
       from public.quiz_answers a join public.questions q on q.id = a.question_id where a.attempt_id = p_attempt) end);
end$$;

-- Teacher preview of an activity exactly as students will see it.
create or replace function public.preview_activity(p_activity uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.can_view_activity(p_activity) then raise exception 'Not visible to you.' using errcode = '42501'; end if;
  return jsonb_build_object('questions',
    (select coalesce(jsonb_agg(app.sanitize_question(q, 42, false) order by q.position, q.created_at), '[]'::jsonb)
     from public.questions q where q.activity_id = p_activity));
end$$;

-- ---------------------------------------------------------------------------
-- Review queue & live results
-- ---------------------------------------------------------------------------
create or replace function public.review_queue(p_class uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.is_teacher() then raise exception 'Teachers only.' using errcode = '42501'; end if;
  return (select coalesce(jsonb_agg(row order by row ->> 'answered_at'), '[]'::jsonb) from (
    select jsonb_build_object(
      'answer_id', a.id, 'answered_at', a.answered_at, 'response', a.response, 'status', a.status,
      'question', jsonb_build_object('id', q.id, 'kind', q.kind, 'prompt', q.prompt, 'points', q.points, 'config', q.config),
      'activity', jsonb_build_object('id', act.id, 'title', act.title, 'rubric_id', act.settings ->> 'rubric_id'),
      'student', jsonb_build_object('id', u.id, 'name', u.full_name)) as row
    from public.quiz_answers a
    join public.quiz_attempts t on t.id = a.attempt_id
    join public.questions q on q.id = a.question_id
    join public.activities act on act.id = t.activity_id
    join public.users u on u.id = t.student_id
    where a.status = 'pending_review' and a.tenant_id = app.tenant_id()
      and (app.is_admin() or app.teaches_student(t.student_id))
      and (p_class is null or exists (select 1 from public.class_members m where m.class_id = p_class and m.user_id = t.student_id))
    limit 500) s);
end$$;

create or replace function public.review_answer(p_answer uuid, p_score numeric, p_feedback text default null) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_a public.quiz_answers; v_t public.quiz_attempts; v_q public.questions;
begin
  select * into v_a from public.quiz_answers where id = p_answer;
  if v_a.id is null then raise exception 'Answer not found.' using errcode = 'P0002'; end if;
  select * into v_t from public.quiz_attempts where id = v_a.attempt_id;
  if not (app.is_admin() or app.teaches_student(v_t.student_id)) or v_t.tenant_id <> app.tenant_id() then
    raise exception 'Not your student.' using errcode = '42501';
  end if;
  select * into v_q from public.questions where id = v_a.question_id;
  if p_score < 0 or p_score > v_q.points then
    raise exception 'Score must be between 0 and %.', v_q.points using errcode = '22023';
  end if;
  update public.quiz_answers set manual_score = p_score, feedback = nullif(btrim(p_feedback), ''),
         status = 'reviewed', is_correct = (p_score >= v_q.points), reviewed_by = auth.uid(), reviewed_at = now()
   where id = p_answer;
  perform app.recompute_attempt(v_t.id);
  perform app.notify(v_t.student_id, 'grade_updated', 'Your work was reviewed', null, '/student', 'info',
                     jsonb_build_object('attempt_id', v_t.id));
end$$;

-- Live response panel (§3.4) and question analytics (§18).
create or replace function public.activity_results(p_activity uuid, p_session uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_act public.activities;
begin
  select * into v_act from public.activities where id = p_activity;
  if v_act.id is null then raise exception 'Activity not found.' using errcode = 'P0002'; end if;
  if p_session is not null then
    if not app.can_manage_session(p_session) then
      -- Students may see anonymised aggregates when the teacher shares results.
      if not (app.in_session(p_session) and exists (select 1 from public.class_sessions s
              where s.id = p_session and s.responses_visible)) then
        raise exception 'Not your session.' using errcode = '42501';
      end if;
      return (select jsonb_build_object('questions', coalesce(jsonb_agg(jsonb_build_object(
                'question_id', q.id, 'prompt', q.prompt, 'kind', q.kind,
                'options', (select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'label', o.label,
                              'count', (select count(*) from public.quiz_answers a join public.quiz_attempts t on t.id = a.attempt_id
                                        where a.question_id = q.id and t.session_id = p_session and a.response ->> 'option_id' = o.id::text))
                              order by o.position), '[]'::jsonb) from public.question_options o where o.question_id = q.id))
              order by q.position), '[]'::jsonb))
              from public.questions q where q.activity_id = p_activity);
    end if;
  elsif not app.can_view_activity(p_activity) then
    raise exception 'Not visible to you.' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'activity', jsonb_build_object('id', v_act.id, 'title', v_act.title, 'kind', v_act.kind),
    'attempts', (select count(*) from public.quiz_attempts t where t.activity_id = p_activity
                 and (p_session is null or t.session_id = p_session)),
    'submitted', (select count(*) from public.quiz_attempts t where t.activity_id = p_activity and t.status <> 'in_progress'
                  and (p_session is null or t.session_id = p_session)),
    'questions', (select coalesce(jsonb_agg(jsonb_build_object(
        'question_id', q.id, 'prompt', q.prompt, 'kind', q.kind, 'points', q.points,
        'responses', (select count(*) from public.quiz_answers a join public.quiz_attempts t on t.id = a.attempt_id
                      where a.question_id = q.id and (p_session is null or t.session_id = p_session)),
        'correct', (select count(*) from public.quiz_answers a join public.quiz_attempts t on t.id = a.attempt_id
                    where a.question_id = q.id and a.is_correct and (p_session is null or t.session_id = p_session)),
        'avg_elapsed_ms', (select round(avg(a.elapsed_ms)) from public.quiz_answers a join public.quiz_attempts t on t.id = a.attempt_id
                           where a.question_id = q.id and (p_session is null or t.session_id = p_session)),
        'options', (select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'label', o.label, 'is_correct', o.is_correct,
                      'count', (select count(*) from public.quiz_answers a join public.quiz_attempts t on t.id = a.attempt_id
                                where a.question_id = q.id and (p_session is null or t.session_id = p_session)
                                  and (a.response ->> 'option_id' = o.id::text or a.response -> 'option_ids' ? o.id::text)))
                      order by o.position), '[]'::jsonb) from public.question_options o where o.question_id = q.id),
        'text_responses', (select coalesce(jsonb_agg(jsonb_build_object('student', u.full_name, 'response', a.response,
                             'status', a.status, 'answer_id', a.id) order by a.answered_at), '[]'::jsonb)
                           from public.quiz_answers a join public.quiz_attempts t on t.id = a.attempt_id
                           join public.users u on u.id = t.student_id
                           where a.question_id = q.id and q.kind in ('open','short','fill_blank','draw','code','file')
                             and (p_session is null or t.session_id = p_session)))
        order by q.position, q.created_at), '[]'::jsonb)
      from public.questions q where q.activity_id = p_activity));
end$$;

-- ---------------------------------------------------------------------------
-- Assignments (§23 assignment/rubric engine)
-- ---------------------------------------------------------------------------
create or replace function public.submit_assignment(p_assignment uuid, p_body text default null, p_files jsonb default '[]'::jsonb)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me  public.users := app.me();
  v_a   public.assignments;
  v_no  int;
  v_sub public.submissions;
  f     jsonb;
begin
  select * into v_a from public.assignments where id = p_assignment and tenant_id = v_me.tenant_id;
  if v_a.id is null or v_a.status <> 'published' or not app.in_class(v_a.class_id) then
    raise exception 'Assignment not available.' using errcode = 'P0002';
  end if;
  if v_a.due_at is not null and now() > v_a.due_at and not v_a.allow_late then
    raise exception 'The due date has passed and late work is not accepted.' using errcode = 'P0001';
  end if;
  if coalesce(btrim(p_body), '') = '' and coalesce(jsonb_array_length(p_files), 0) = 0 then
    raise exception 'Add text or attach a file.' using errcode = '22023';
  end if;
  for f in select * from jsonb_array_elements(coalesce(p_files, '[]'::jsonb)) loop
    if (f ->> 'path') not like v_me.tenant_id::text || '/' || v_me.id::text || '/' || p_assignment::text || '/%' then
      raise exception 'Invalid attachment path.' using errcode = '22023';
    end if;
  end loop;
  select coalesce(max(attempt_no), 0) + 1 into v_no from public.submissions where assignment_id = p_assignment and student_id = v_me.id;
  if v_no > v_a.max_resubmissions + 1 then
    raise exception 'No resubmissions left for this assignment.' using errcode = 'P0001';
  end if;
  insert into public.submissions (tenant_id, assignment_id, student_id, attempt_no, body, files, is_late)
    values (v_me.tenant_id, p_assignment, v_me.id, v_no, nullif(btrim(p_body), ''), coalesce(p_files, '[]'::jsonb),
            v_a.due_at is not null and now() > v_a.due_at)
    returning * into v_sub;
  perform app.notify(v_a.created_by, 'submission', v_me.full_name || ' submitted ' || v_a.title,
                     case when v_sub.is_late then 'Late submission' end,
                     '/teacher/assignments/' || v_a.id, 'info', jsonb_build_object('submission_id', v_sub.id));
  return to_jsonb(v_sub);
end$$;

create or replace function public.grade_submission(
  p_submission uuid, p_score numeric, p_rubric_scores jsonb default '{}'::jsonb,
  p_feedback text default null, p_release boolean default false, p_return boolean default false
) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_s public.submissions; v_a public.assignments;
begin
  select * into v_s from public.submissions where id = p_submission;
  if v_s.id is null then raise exception 'Submission not found.' using errcode = 'P0002'; end if;
  select * into v_a from public.assignments where id = v_s.assignment_id;
  if not app.can_manage_class(v_a.class_id) then raise exception 'Not your class.' using errcode = '42501'; end if;
  if p_score < 0 or p_score > v_a.points_possible then
    raise exception 'Score must be between 0 and %.', v_a.points_possible using errcode = '22023';
  end if;
  insert into public.grades (tenant_id, submission_id, grader_id, score, rubric_scores, feedback, released_at)
    values (v_s.tenant_id, p_submission, auth.uid(), p_score, coalesce(p_rubric_scores, '{}'::jsonb),
            nullif(btrim(p_feedback), ''), case when p_release then now() end)
    on conflict (submission_id) do update set score = excluded.score, rubric_scores = excluded.rubric_scores,
      feedback = excluded.feedback, grader_id = excluded.grader_id, graded_at = now(),
      released_at = coalesce(public.grades.released_at, excluded.released_at);
  update public.submissions set status = case when p_return then 'returned' else 'graded' end where id = p_submission;
  if p_release then
    perform app.notify(v_s.student_id, 'grade_released', 'Grade released: ' || v_a.title, null, '/student', 'info',
                       jsonb_build_object('assignment_id', v_a.id));
  end if;
  perform app.audit('grade.saved', 'submission', p_submission::text, jsonb_build_object('score', p_score, 'released', p_release));
end$$;

create or replace function public.release_grades(p_assignment uuid) returns int
language plpgsql volatile security definer set search_path = '' as $$
declare v_a public.assignments; v_n int := 0; r record;
begin
  select * into v_a from public.assignments where id = p_assignment;
  if v_a.id is null or not app.can_manage_class(v_a.class_id) then raise exception 'Not your class.' using errcode = '42501'; end if;
  for r in with released as (
             update public.grades g set released_at = now()
             from public.submissions s where s.id = g.submission_id and s.assignment_id = p_assignment and g.released_at is null
             returning s.student_id)
           select distinct student_id from released loop
    v_n := v_n + 1;
    perform app.notify(r.student_id, 'grade_released', 'Grade released: ' || v_a.title, null, '/student', 'info',
                       jsonb_build_object('assignment_id', v_a.id));
  end loop;
  perform app.audit('grades.released', 'assignment', p_assignment::text);
  return v_n;
end$$;

-- >>>>>>>>>>>>>>>>>>>> 20260901000620_rpc_games.sql >>>>>>>>>>>>>>>>>>>>
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

-- >>>>>>>>>>>>>>>>>>>> 20260901000630_rpc_guard.sql >>>>>>>>>>>>>>>>>>>>
-- =============================================================================
-- SwiftCipher — 0630 Guard RPCs: policy engine (§14), device agent (§21),
-- leave detection (§3.6, §16), off-task (§3.8), commands, screens (§15).
--
-- The agent authenticates every call with (device_id, secret); the secret is
-- compared against its sha256. The extension never holds a user JWT.
-- =============================================================================

-- ---------- URL helpers (pure, unit-tested) ----------
-- Lower-case host without scheme, credentials, port or leading "www.".
-- Returns null for non-web pages (new tab, settings, extensions, files).
create or replace function app.url_host(p_url text) returns text
language sql immutable set search_path = '' as $$
  select nullif(regexp_replace(
           lower(substring(btrim(coalesce(p_url, '')) from '^[hH][tT][tT][pP][sS]?://(?:[^@/?#]*@)?([^/:?#]+)')),
           '^www\.', ''), '')
$$;

-- Normalises a policy entry ("https://www.Example.com/path", "*.example.com") to a bare domain.
create or replace function app.normalize_domain(p text) returns text
language sql immutable set search_path = '' as $$
  select nullif(regexp_replace(regexp_replace(regexp_replace(lower(btrim(coalesce(p, ''))),
           '^[a-z]+://', ''), '^(\*\.|www\.)', ''), '[/:?#].*$', ''), '')
$$;

-- Label-boundary match: "example.com" matches example.com and a.example.com,
-- never badexample.com.
create or replace function app.domain_matches(p_host text, p_pattern text) returns boolean
language sql immutable set search_path = '' as $$
  select p_host is not null and app.normalize_domain(p_pattern) is not null
     and (p_host = app.normalize_domain(p_pattern) or right(p_host, length(app.normalize_domain(p_pattern)) + 1) = '.' || app.normalize_domain(p_pattern))
$$;

create or replace function app.domain_in(p_host text, p_list text[]) returns text
language sql immutable set search_path = '' as $$
  select x from unnest(coalesce(p_list, '{}'::text[])) x where app.domain_matches(p_host, x) limit 1
$$;

-- Longest-suffix category lookup.
create or replace function app.domain_category(p_host text) returns text
language sql stable set search_path = '' as $$
  select dc.category from public.domain_categories dc
  where app.domain_matches(p_host, dc.domain)
  order by length(dc.domain) desc limit 1
$$;

-- ---------------------------------------------------------------------------
-- Deterministic policy evaluation (§14). Returns:
--   { verdict: allowed|neutral|warning|violation|off_task, kind, severity, rule, domain, category }
-- verdict semantics (§16): allowed → nothing; warning → soft notice to the
-- student only; violation → ENVIRONMENT_LEFT event after the grace period;
-- off_task → assistive teacher alert with a confidence score (§3.8).
-- ---------------------------------------------------------------------------
create or replace function app.evaluate_url(
  p_policy public.environment_policies, p_url text, p_tab_count int, p_app_host text
) returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  v_host text := app.url_host(p_url);
  v_cat  text;
  v_hit  text;
begin
  if v_host is null then
    return jsonb_build_object('verdict', 'neutral', 'rule', 'Browser page', 'domain', null);
  end if;
  v_cat := app.domain_category(v_host);
  if p_app_host is not null and app.domain_matches(v_host, p_app_host) then
    return jsonb_build_object('verdict', 'allowed', 'rule', 'SwiftCipher', 'domain', v_host, 'category', v_cat);
  end if;
  if p_policy.id is null then
    return jsonb_build_object('verdict', 'allowed', 'rule', 'No environment active', 'domain', v_host, 'category', v_cat);
  end if;

  v_hit := app.domain_in(v_host, p_policy.blocked_domains);
  if v_hit is not null then
    return jsonb_build_object('verdict', 'violation', 'kind', 'domain_blocked', 'severity', 'critical',
                              'rule', 'Blocked domain: ' || app.normalize_domain(v_hit), 'domain', v_host, 'category', v_cat);
  end if;
  if v_cat is not null and v_cat = any (p_policy.blocked_categories) then
    return jsonb_build_object('verdict', 'violation', 'kind', 'domain_blocked', 'severity', 'warning',
                              'rule', 'Blocked category: ' || v_cat, 'domain', v_host, 'category', v_cat);
  end if;

  if app.domain_in(v_host, p_policy.allowed_domains) is not null
     or app.domain_in(v_host, p_policy.required_urls) is not null
     or (p_policy.lesson_url is not null and app.domain_matches(v_host, p_policy.lesson_url)) then
    if p_policy.tab_limit is not null and coalesce(p_tab_count, 0) > p_policy.tab_limit then
      return jsonb_build_object('verdict', 'warning', 'kind', 'tab_limit', 'severity', 'info',
                                'rule', 'More than ' || p_policy.tab_limit || ' tabs open', 'domain', v_host, 'category', v_cat);
    end if;
    return jsonb_build_object('verdict', 'allowed', 'rule', 'Allowed domain', 'domain', v_host, 'category', v_cat);
  end if;

  if p_policy.focus_mode or p_policy.lock_screen then
    return jsonb_build_object('verdict', 'violation', 'kind', 'environment_left', 'severity', 'warning',
                              'rule', 'Outside the class environment', 'domain', v_host, 'category', v_cat);
  end if;

  if v_cat in ('games','social','video','streaming','shopping','chat','gambling','adult') then
    return jsonb_build_object('verdict', 'off_task', 'kind', 'off_task', 'severity', 'info',
                              'rule', 'Looks unrelated to ' || coalesce(nullif(p_policy.subject, ''), 'the lesson') || ' (' || v_cat || ')',
                              'domain', v_host, 'category', v_cat);
  end if;

  if coalesce(array_length(p_policy.allowed_domains, 1), 0) + coalesce(array_length(p_policy.required_urls, 1), 0) > 0 then
    return jsonb_build_object('verdict', 'warning', 'kind', 'environment_left', 'severity', 'info',
                              'rule', 'Not on the class resource list', 'domain', v_host, 'category', v_cat);
  end if;
  if p_policy.tab_limit is not null and coalesce(p_tab_count, 0) > p_policy.tab_limit then
    return jsonb_build_object('verdict', 'warning', 'kind', 'tab_limit', 'severity', 'info',
                              'rule', 'More than ' || p_policy.tab_limit || ' tabs open', 'domain', v_host, 'category', v_cat);
  end if;
  return jsonb_build_object('verdict', 'allowed', 'rule', 'No rule matched', 'domain', v_host, 'category', v_cat);
end$$;

-- Session-level environment first; a student's group auto-start policy
-- (§23 "student groups and auto-start environments") overrides it.
create or replace function app.effective_policy(p_session public.class_sessions, p_student uuid)
returns public.environment_policies
language plpgsql stable security definer set search_path = '' as $$
declare v public.environment_policies;
begin
  select ep.* into v
  from public.student_group_members gm
  join public.student_groups g on g.id = gm.group_id
  join public.environment_policies ep on ep.id = g.auto_start_policy_id
  where gm.user_id = p_student and g.class_id = p_session.class_id
  order by g.created_at limit 1;
  if v.id is null and p_session.environment_active then
    select * into v from public.environment_policies where id = p_session.environment_id;
  end if;
  return v;
end$$;

-- ---------------------------------------------------------------------------
-- Pairing & enrolment (§21 secure extension enrolment)
-- ---------------------------------------------------------------------------
create or replace function public.create_pairing_code(p_student uuid default null) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me      public.users := app.me();
  v_student uuid := coalesce(p_student, v_me.id);
  v_method  text;
  v_code    text;
  v_exp     timestamptz := now() + interval '15 minutes';
begin
  if v_student = v_me.id then
    if v_me.role <> 'student' then raise exception 'Only student devices are paired.' using errcode = '22023'; end if;
    v_method := 'student_pairing';
  else
    if not (app.is_it() or app.teaches_student(v_student)) then
      raise exception 'You cannot enrol devices for this student.' using errcode = '42501';
    end if;
    if not exists (select 1 from public.users where id = v_student and tenant_id = v_me.tenant_id and role = 'student') then
      raise exception 'Student not found.' using errcode = 'P0002';
    end if;
    v_method := 'admin_pairing';
  end if;
  if (select count(*) from public.device_pairing_codes where student_id = v_student and used_at is null and expires_at > now()) >= 5 then
    raise exception 'Too many unused pairing codes; wait for them to expire.' using errcode = 'P0001';
  end if;
  v_code := app.unique_code(8, 'device_pairing_codes');
  insert into public.device_pairing_codes (code, tenant_id, student_id, created_by, method, expires_at)
    values (v_code, v_me.tenant_id, v_student, v_me.id, v_method, v_exp);
  perform app.audit('device.pairing_code_created', 'user', v_student::text, jsonb_build_object('method', v_method));
  return jsonb_build_object('code', v_code, 'expires_at', v_exp);
end$$;

create or replace function public.device_pair(
  p_code text, p_label text, p_os text default null, p_browser text default null, p_version text default null
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_pc     public.device_pairing_codes;
  v_secret text := app.gen_secret();
  v_device uuid;
  v_count  bigint;
  v_name   text;
  v_notice text;
begin
  select * into v_pc from public.device_pairing_codes
   where code = upper(btrim(coalesce(p_code, ''))) and used_at is null and expires_at > now() for update;
  if v_pc.code is null then raise exception 'Pairing code is invalid or expired.' using errcode = 'P0002'; end if;
  if not app.feature(v_pc.tenant_id, 'device_control') then
    raise exception 'Device monitoring is not included in this school''s plan.' using errcode = 'P0001';
  end if;
  select count(*) into v_count from public.devices where tenant_id = v_pc.tenant_id and status = 'active';
  if not app.within_limit(v_pc.tenant_id, 'managed_devices', v_count) then
    raise exception 'This school has reached its managed-device limit.' using errcode = 'P0001';
  end if;

  insert into public.devices (tenant_id, student_id, label, os, browser, agent_version, secret_hash, enrolled_by)
    values (v_pc.tenant_id, v_pc.student_id, left(coalesce(nullif(btrim(p_label), ''), 'Browser'), 120),
            left(p_os, 60), left(p_browser, 60), left(p_version, 20), app.hash_secret(v_secret), v_pc.created_by)
    returning id into v_device;
  insert into public.device_enrollments (tenant_id, device_id, student_id, enrolled_by, method)
    values (v_pc.tenant_id, v_device, v_pc.student_id, v_pc.created_by, v_pc.method);
  update public.device_pairing_codes set used_at = now(), device_id = v_device where code = v_pc.code;

  select full_name into v_name from public.users where id = v_pc.student_id;
  select monitoring_notice into v_notice from public.tenant_settings where tenant_id = v_pc.tenant_id;
  perform app.audit('device.enrolled', 'device', v_device::text, jsonb_build_object('method', v_pc.method),
                    v_pc.tenant_id, v_pc.created_by);
  return jsonb_build_object('device_id', v_device, 'secret', v_secret, 'student_name', v_name, 'notice', v_notice);
end$$;

create or replace function app.device_auth(p_device uuid, p_secret text) returns public.devices
language plpgsql volatile security definer set search_path = '' as $$
declare v public.devices;
begin
  select * into v from public.devices where id = p_device;
  if v.id is null or v.secret_hash <> app.hash_secret(p_secret) then
    raise exception 'Invalid device credentials.' using errcode = '28000';
  end if;
  if v.status <> 'active' then
    raise exception 'This device has been %.', v.status using errcode = '28000';
  end if;
  return v;
end$$;

-- The live session a device belongs to right now (privacy gate, §36).
create or replace function app.device_live_session(p_student uuid) returns public.class_sessions
language sql stable security definer set search_path = '' as $$
  select s.* from public.class_sessions s
  join public.class_members m on m.class_id = s.class_id and m.user_id = p_student and m.role = 'student'
  where s.status = 'live'
  order by s.started_at desc nulls last limit 1
$$;

-- Open or refresh an environment event; notifies the teacher only when new.
create or replace function app.raise_event(
  p_bs public.browser_sessions, p_session public.class_sessions, p_policy uuid,
  p_kind text, p_severity text, p_rule text, p_url text, p_domain text, p_confidence numeric default null
) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare v_id uuid; v_name text; v_notify jsonb;
begin
  insert into public.environment_events (tenant_id, class_session_id, class_id, student_id, device_id, policy_id,
                                         kind, severity, rule, url, domain, confidence)
    values (p_bs.tenant_id, p_session.id, p_session.class_id, p_bs.student_id, p_bs.device_id, p_policy,
            p_kind, p_severity, p_rule, left(p_url, 2000), p_domain, p_confidence)
    on conflict (class_session_id, student_id, kind) where resolved_at is null do nothing
    returning id into v_id;
  if v_id is null then return false; end if;
  select full_name into v_name from public.users where id = p_bs.student_id;
  perform app.notify(p_session.teacher_id, p_kind,
    v_name || case p_kind when 'environment_left' then ' left the class environment'
                          when 'domain_blocked' then ' opened a blocked site'
                          when 'off_task' then ' may be off-task'
                          when 'idle' then ' has been idle'
                          when 'connection_lost' then '''s device lost connection'
                          else ' triggered ' || p_kind end,
    p_rule, '/teacher/live/' || p_session.id, p_severity,
    jsonb_build_object('event_id', v_id, 'session_id', p_session.id, 'student_id', p_bs.student_id));
  return true;
end$$;

create or replace function app.resolve_events(p_session uuid, p_student uuid, p_kinds text[]) returns int
language plpgsql volatile security definer set search_path = '' as $$
declare v_n int;
begin
  update public.environment_events set resolved_at = now()
   where class_session_id = p_session and student_id = p_student and resolved_at is null and kind = any (p_kinds);
  get diagnostics v_n = row_count;
  return v_n;
end$$;

-- ---------------------------------------------------------------------------
-- The agent's single "tick": heartbeat + telemetry + evaluation + directives.
-- ---------------------------------------------------------------------------
create or replace function app.device_tick(
  p_device public.devices, p_kind text, p_url text, p_title text, p_tab_count int,
  p_idle_state text, p_version text, p_app_host text
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_session  public.class_sessions;
  v_settings public.tenant_settings;
  v_bs       public.browser_sessions;
  v_policy   public.environment_policies;
  v_eval     jsonb;
  v_verdict  text;
  v_grace    int;
  v_idle_s   int;
  v_host     text := app.url_host(p_url);
  v_idle     text := case when p_idle_state in ('active','idle','locked') then p_idle_state else 'active' end;
  v_prev_url text;
  v_prev_idle text;
  v_fb       public.off_task_feedback;
  v_conf     numeric;
  v_cmds     jsonb;
  v_notice   text;
  v_spot     boolean;
  v_returned int;
begin
  update public.devices set last_seen_at = now(), agent_version = coalesce(left(p_version, 20), agent_version)
   where id = p_device.id;
  select * into v_settings from public.tenant_settings where tenant_id = p_device.tenant_id;

  if p_device.student_id is null then
    return jsonb_build_object('state', 'unassigned', 'poll_seconds', 120);
  end if;
  v_session := app.device_live_session(p_device.student_id);
  if v_session.id is null then
    -- Outside class: nothing is recorded.
    return jsonb_build_object('state', 'idle', 'poll_seconds', 60,
                              'notice_version', v_settings.monitoring_notice_version);
  end if;

  select * into v_bs from public.browser_sessions where device_id = p_device.id and class_session_id = v_session.id for update;
  if v_bs.id is null then
    insert into public.browser_sessions (tenant_id, device_id, class_session_id, student_id)
      values (p_device.tenant_id, p_device.id, v_session.id, p_device.student_id) returning * into v_bs;
  end if;
  v_prev_url := v_bs.active_url;
  v_prev_idle := v_bs.idle_state;

  -- Reconnected after a connection loss (§17 "Student returned").
  if v_bs.connection_lost_at is not null then
    perform app.resolve_events(v_session.id, p_device.student_id, array['connection_lost']);
  end if;

  update public.browser_sessions set
    last_heartbeat_at = now(), ended_at = null, connection_lost_at = null,
    active_url = coalesce(left(p_url, 2000), active_url), active_domain = coalesce(v_host, case when p_url is not null then null else active_domain end),
    active_title = coalesce(left(p_title, 300), active_title),
    tab_count = coalesce(p_tab_count, tab_count), idle_state = v_idle,
    idle_since = case when v_idle = 'active' then null else coalesce(idle_since, now()) end
  where id = v_bs.id returning * into v_bs;

  if p_url is not null and p_url is distinct from v_prev_url then
    insert into public.browser_events (tenant_id, device_id, class_session_id, student_id, kind, url, domain, title)
      values (p_device.tenant_id, p_device.id, v_session.id, p_device.student_id,
              case when p_kind = 'navigation' then 'navigation' else 'tab_changed' end,
              left(p_url, 2000), v_host, left(p_title, 300));
  end if;
  if v_idle is distinct from v_prev_idle then
    insert into public.browser_events (tenant_id, device_id, class_session_id, student_id, kind)
      values (p_device.tenant_id, p_device.id, v_session.id, p_device.student_id, v_idle);
  end if;

  v_policy := app.effective_policy(v_session, p_device.student_id);
  v_eval := app.evaluate_url(v_policy, v_bs.active_url, v_bs.tab_count, p_app_host);
  v_verdict := v_eval ->> 'verdict';
  v_grace := coalesce(v_policy.grace_seconds, v_settings.default_grace_seconds);
  v_idle_s := coalesce(v_policy.idle_seconds, v_settings.default_idle_seconds);

  -- Violations must persist for the grace period before an event fires.
  if v_verdict = 'violation' then
    if v_bs.violation_since is null or v_bs.violation_kind is distinct from v_eval ->> 'kind'
       or v_bs.violation_url is distinct from v_eval ->> 'domain' then
      update public.browser_sessions set violation_since = now(), violation_kind = v_eval ->> 'kind',
             violation_rule = v_eval ->> 'rule', violation_url = v_eval ->> 'domain'
       where id = v_bs.id returning * into v_bs;
    end if;
    if now() - v_bs.violation_since >= make_interval(secs => v_grace) then
      perform app.raise_event(v_bs, v_session, v_policy.id, v_eval ->> 'kind', v_eval ->> 'severity',
                              v_eval ->> 'rule', v_bs.active_url, v_eval ->> 'domain');
    end if;
    v_notice := 'Your class session requires you to return to the lesson.';
  else
    if v_bs.violation_since is not null then
      update public.browser_sessions set violation_since = null, violation_kind = null, violation_rule = null, violation_url = null
       where id = v_bs.id;
    end if;
    v_returned := app.resolve_events(v_session.id, p_device.student_id, array['environment_left','domain_blocked']);
    if v_returned > 0 then
      perform app.notify(v_session.teacher_id, 'student_returned',
        (select full_name from public.users where id = p_device.student_id) || ' returned to the class environment',
        null, '/teacher/live/' || v_session.id, 'info', jsonb_build_object('student_id', p_device.student_id));
    end if;
    if v_verdict = 'warning' then
      v_notice := 'Please stay on your class resources.';
    end if;
  end if;

  -- Off-task: assistive, confidence-scored, suppressed by teacher feedback/mutes.
  if v_verdict = 'off_task' then
    if not exists (select 1 from public.off_task_mutes m where m.class_session_id = v_session.id
                   and (m.student_id is null or m.student_id = p_device.student_id)
                   and app.domain_matches(v_eval ->> 'domain', m.domain)) then
      select * into v_fb from public.off_task_feedback where tenant_id = p_device.tenant_id and domain = v_eval ->> 'domain';
      v_conf := least(0.95, greatest(0.05, 0.7 - 0.1 * coalesce(v_fb.dismissals, 0) + 0.05 * coalesce(v_fb.confirmations, 0)));
      if v_conf >= 0.4 and now() - coalesce(v_bs.violation_since, now()) >= interval '0 seconds' then
        perform app.raise_event(v_bs, v_session, v_policy.id, 'off_task', 'info', v_eval ->> 'rule',
                                v_bs.active_url, v_eval ->> 'domain', round(v_conf, 3));
      end if;
    end if;
  else
    perform app.resolve_events(v_session.id, p_device.student_id, array['off_task']);
  end if;

  -- Idle beyond the teacher's threshold.
  if v_bs.idle_since is not null and now() - v_bs.idle_since >= make_interval(secs => v_idle_s) then
    perform app.raise_event(v_bs, v_session, v_policy.id, 'idle', 'info',
                            'Idle for more than ' || (v_idle_s / 60) || ' min', null, null);
  elsif v_bs.idle_since is null then
    perform app.resolve_events(v_session.id, p_device.student_id, array['idle']);
  end if;

  -- Deliver queued commands (expired ones are marked, never executed late).
  update public.teacher_commands set status = 'expired'
   where device_id = p_device.id and status in ('queued','delivered') and expires_at < now();
  with next as (
    select id from public.teacher_commands
     where device_id = p_device.id and status = 'queued' order by created_at limit 10 for update skip locked)
  update public.teacher_commands c set status = 'delivered', delivered_at = now()
    from next where c.id = next.id;
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'kind', c.kind, 'payload', c.payload) order by c.created_at), '[]'::jsonb)
    into v_cmds
  from public.teacher_commands c where c.device_id = p_device.id and c.status = 'delivered' and c.delivered_at > now() - interval '5 seconds';

  v_spot := exists (select 1 from public.spotlights s where s.session_id = v_session.id
                    and s.student_id = p_device.student_id and s.ended_at is null);

  return jsonb_build_object(
    'state', 'active',
    'session', jsonb_build_object('id', v_session.id, 'title', v_session.title,
                                  'teacher', (select full_name from public.users where id = v_session.teacher_id)),
    'poll_seconds', 10,
    'verdict', v_verdict,
    'rule', v_eval ->> 'rule',
    'notice', v_notice,
    'policy', case when v_policy.id is null then null else jsonb_build_object(
      'focus_mode', v_policy.focus_mode, 'lock_screen', v_policy.lock_screen,
      'allowed_domains', v_policy.allowed_domains, 'blocked_domains', v_policy.blocked_domains,
      'required_urls', v_policy.required_urls, 'lesson_url', v_policy.lesson_url, 'tab_limit', v_policy.tab_limit) end,
    'capture', jsonb_build_object(
      'enabled', v_settings.allow_screen_capture,
      'interval_seconds', v_settings.thumbnail_interval_seconds,
      'high_quality', v_spot or (v_bs.snapshot_requested_at is not null and v_bs.snapshot_requested_at > now() - interval '30 seconds')),
    'spotlight', v_spot,
    'focus_locked', v_bs.focus_locked,
    'commands', v_cmds,
    'notice_version', v_settings.monitoring_notice_version);
end$$;

create or replace function public.device_heartbeat(
  p_device uuid, p_secret text, p_url text default null, p_title text default null, p_tab_count int default null,
  p_idle_state text default 'active', p_version text default null, p_app_host text default null
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
begin
  return app.device_tick(app.device_auth(p_device, p_secret), 'heartbeat', p_url, p_title, p_tab_count,
                         p_idle_state, p_version, p_app_host);
end$$;

create or replace function public.device_event(
  p_device uuid, p_secret text, p_kind text, p_url text default null, p_title text default null,
  p_tab_count int default null, p_idle_state text default 'active', p_app_host text default null
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
begin
  if p_kind not in ('tab_changed','navigation','idle','active','locked','tab_count') then
    raise exception 'Unknown event kind.' using errcode = '22023';
  end if;
  return app.device_tick(app.device_auth(p_device, p_secret), p_kind, p_url, p_title, p_tab_count,
                         p_idle_state, null, p_app_host);
end$$;

create or replace function public.device_snapshot(
  p_device uuid, p_secret text, p_image text, p_width int default null, p_height int default null,
  p_quality text default 'thumbnail', p_url text default null
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_dev      public.devices := app.device_auth(p_device, p_secret);
  v_session  public.class_sessions;
  v_settings public.tenant_settings;
  v_last     timestamptz;
  v_min_gap  interval;
begin
  if p_quality not in ('thumbnail','spotlight') then raise exception 'Unknown quality.' using errcode = '22023'; end if;
  if p_image is null or p_image not like 'data:image/%' or length(p_image) > 400000 then
    raise exception 'Snapshot must be a data:image URL under 400 KB.' using errcode = '22023';
  end if;
  select * into v_settings from public.tenant_settings where tenant_id = v_dev.tenant_id;
  if not v_settings.allow_screen_capture then
    return jsonb_build_object('stored', false, 'reason', 'screen capture disabled by school');
  end if;
  v_session := app.device_live_session(v_dev.student_id);
  if v_session.id is null then return jsonb_build_object('stored', false, 'reason', 'no live session'); end if;

  -- Rate limit (§15): thumbnails at most every half interval; spotlight frames every 2 s.
  v_min_gap := case when p_quality = 'thumbnail'
                    then make_interval(secs => greatest(v_settings.thumbnail_interval_seconds / 2, 2))
                    else interval '2 seconds' end;
  select captured_at into v_last from public.screen_snapshots
   where device_id = v_dev.id and class_session_id = v_session.id and quality = p_quality;
  if v_last is not null and now() - v_last < v_min_gap then
    return jsonb_build_object('stored', false, 'reason', 'rate limited');
  end if;

  insert into public.screen_snapshots (tenant_id, device_id, class_session_id, student_id, image_data, width, height, quality, url)
    values (v_dev.tenant_id, v_dev.id, v_session.id, v_dev.student_id, p_image, p_width, p_height, p_quality, left(p_url, 2000))
    on conflict (device_id, class_session_id, quality) where quality <> 'event'
    do update set image_data = excluded.image_data, width = excluded.width, height = excluded.height,
                  url = excluded.url, captured_at = now();

  -- Event screenshots only when the school explicitly enabled them (§15).
  if v_settings.store_event_screenshots and exists (
       select 1 from public.environment_events e where e.class_session_id = v_session.id and e.student_id = v_dev.student_id
       and e.resolved_at is null and e.kind in ('environment_left','domain_blocked') and e.created_at > now() - interval '60 seconds')
     and not exists (select 1 from public.screen_snapshots s where s.device_id = v_dev.id and s.class_session_id = v_session.id
                     and s.quality = 'event' and s.captured_at > now() - interval '60 seconds') then
    insert into public.screen_snapshots (tenant_id, device_id, class_session_id, student_id, image_data, width, height, quality, url)
      values (v_dev.tenant_id, v_dev.id, v_session.id, v_dev.student_id, p_image, p_width, p_height, 'event', left(p_url, 2000));
  end if;

  if p_quality = 'spotlight' then
    update public.browser_sessions set snapshot_requested_at = null where device_id = v_dev.id and class_session_id = v_session.id;
  end if;
  return jsonb_build_object('stored', true);
end$$;

create or replace function public.device_command_ack(
  p_device uuid, p_secret text, p_command uuid, p_ok boolean, p_error text default null
) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_dev public.devices := app.device_auth(p_device, p_secret); v_cmd public.teacher_commands;
begin
  update public.teacher_commands set status = case when p_ok then 'acked' else 'failed' end,
         acked_at = now(), error = case when p_ok then null else left(coalesce(p_error, 'failed'), 300) end
   where id = p_command and device_id = v_dev.id and status in ('queued','delivered')
   returning * into v_cmd;
  if v_cmd.id is not null and p_ok and v_cmd.kind in ('focus','lock','unfocus','unlock') then
    update public.browser_sessions set focus_locked = v_cmd.kind in ('focus','lock')
     where device_id = v_dev.id and class_session_id = v_cmd.class_session_id;
  end if;
end$$;

-- Agent-side status check (popup): who is this device for, is it enabled.
create or replace function public.device_status(p_device uuid, p_secret text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_dev public.devices := app.device_auth(p_device, p_secret);
begin
  return jsonb_build_object(
    'device_id', v_dev.id, 'label', v_dev.label, 'status', v_dev.status,
    'student_name', (select full_name from public.users where id = v_dev.student_id),
    'school', (select name from public.tenants where id = v_dev.tenant_id),
    'notice', (select monitoring_notice from public.tenant_settings where tenant_id = v_dev.tenant_id),
    'session', (select jsonb_build_object('id', s.id, 'title', s.title) from app.device_live_session(v_dev.student_id) s where s.id is not null));
end$$;

-- ---------------------------------------------------------------------------
-- IT administration (§3.5, §19, §21 remote disable/unenrol)
-- ---------------------------------------------------------------------------
create or replace function public.device_set_status(p_device uuid, p_status text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_me public.users := app.me();
begin
  if not app.is_it() then raise exception 'IT administrators only.' using errcode = '42501'; end if;
  if p_status not in ('active','disabled','unenrolled') then raise exception 'Unknown status.' using errcode = '22023'; end if;
  update public.devices set status = p_status where id = p_device and tenant_id = v_me.tenant_id;
  if not found then raise exception 'Device not found.' using errcode = 'P0002'; end if;
  if p_status = 'unenrolled' then
    update public.device_enrollments set revoked_at = now(), revoked_by = v_me.id
     where device_id = p_device and revoked_at is null;
  end if;
  perform app.audit('device.' || p_status, 'device', p_device::text);
end$$;

create or replace function public.device_assign(p_device uuid, p_student uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_me public.users := app.me();
begin
  if not app.is_it() then raise exception 'IT administrators only.' using errcode = '42501'; end if;
  if not exists (select 1 from public.users where id = p_student and tenant_id = v_me.tenant_id and role = 'student') then
    raise exception 'Student not found.' using errcode = 'P0002';
  end if;
  update public.devices set student_id = p_student where id = p_device and tenant_id = v_me.tenant_id;
  if not found then raise exception 'Device not found.' using errcode = 'P0002'; end if;
  update public.device_enrollments set revoked_at = now(), revoked_by = v_me.id where device_id = p_device and revoked_at is null;
  insert into public.device_enrollments (tenant_id, device_id, student_id, enrolled_by, method)
    values (v_me.tenant_id, p_device, p_student, v_me.id, 'admin_pairing');
  perform app.audit('device.assigned', 'device', p_device::text, jsonb_build_object('student_id', p_student));
end$$;

-- Connection diagnostics (§3.5).
create or replace function public.device_diagnostics(p_device uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v public.devices;
begin
  select * into v from public.devices where id = p_device and tenant_id = app.tenant_id();
  if v.id is null or not (app.is_it() or app.teaches_student(v.student_id)) then
    raise exception 'Device not found.' using errcode = 'P0002';
  end if;
  return jsonb_build_object(
    'device', jsonb_build_object('id', v.id, 'label', v.label, 'os', v.os, 'browser', v.browser,
                                 'agent_version', v.agent_version, 'status', v.status, 'last_seen_at', v.last_seen_at),
    'online', v.last_seen_at > now() - interval '45 seconds',
    'seconds_since_seen', case when v.last_seen_at is null then null else extract(epoch from now() - v.last_seen_at)::int end,
    'student_in_live_session', (app.device_live_session(v.student_id)).id is not null,
    'recent_commands', (select coalesce(jsonb_agg(jsonb_build_object('kind', c.kind, 'status', c.status, 'error', c.error,
                           'created_at', c.created_at, 'acked_at', c.acked_at) order by c.created_at desc), '[]'::jsonb)
                        from (select * from public.teacher_commands where device_id = v.id order by created_at desc limit 10) c),
    'enrollments', (select coalesce(jsonb_agg(jsonb_build_object('student', u.full_name, 'method', e.method,
                       'created_at', e.created_at, 'revoked_at', e.revoked_at) order by e.created_at desc), '[]'::jsonb)
                    from public.device_enrollments e left join public.users u on u.id = e.student_id where e.device_id = v.id));
end$$;

-- ---------------------------------------------------------------------------
-- Teacher controls
-- ---------------------------------------------------------------------------
create or replace function app.require_live_session(p_session uuid) returns public.class_sessions
language plpgsql stable security definer set search_path = '' as $$
declare v public.class_sessions;
begin
  select * into v from public.class_sessions where id = p_session;
  if v.id is null then raise exception 'Session not found.' using errcode = 'P0002'; end if;
  if not app.can_manage_class(v.class_id) then raise exception 'Not your session.' using errcode = '42501'; end if;
  if v.status <> 'live' then raise exception 'The session is not live.' using errcode = 'P0001'; end if;
  return v;
end$$;

create or replace function public.issue_command(
  p_session uuid, p_students uuid[], p_kind text, p_payload jsonb default '{}'::jsonb
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_s       public.class_sessions := app.require_live_session(p_session);
  v_url     text := p_payload ->> 'url';
  v_student uuid;
  v_queued  int := 0;
  v_results jsonb := '[]'::jsonb;
  v_devices int;
begin
  if p_kind not in ('open_tab','close_tab','redirect','focus','unfocus','lock','unlock','close_other_tabs','message','screenshot') then
    raise exception 'Unknown command.' using errcode = '22023';
  end if;
  if p_kind in ('open_tab','redirect','focus') and v_url is not null and app.url_host(v_url) is null then
    raise exception 'Commands can only open http(s) links.' using errcode = '22023';
  end if;
  if p_kind in ('open_tab','redirect') and v_url is null then
    raise exception 'A URL is required.' using errcode = '22023';
  end if;
  if p_kind = 'message' and length(btrim(coalesce(p_payload ->> 'text', ''))) not between 1 and 200 then
    raise exception 'Messages are 1-200 characters.' using errcode = '22023';
  end if;
  if coalesce(array_length(p_students, 1), 0) = 0 or array_length(p_students, 1) > 200 then
    raise exception 'Choose between 1 and 200 students.' using errcode = '22023';
  end if;
  if (select count(*) from public.teacher_commands where issued_by = auth.uid() and created_at > now() - interval '1 minute') > 300 then
    raise exception 'Too many commands; slow down.' using errcode = 'P0001';
  end if;

  foreach v_student in array p_students loop
    if not exists (select 1 from public.class_members m where m.class_id = v_s.class_id and m.user_id = v_student and m.role = 'student') then
      v_results := v_results || jsonb_build_object('student_id', v_student, 'result', 'not_in_class');
      continue;
    end if;
    insert into public.teacher_commands (tenant_id, class_session_id, student_id, device_id, issued_by, kind, payload)
      select v_s.tenant_id, p_session, v_student, d.id, auth.uid(), p_kind, coalesce(p_payload, '{}'::jsonb)
      from public.devices d where d.student_id = v_student and d.status = 'active'
        and d.last_seen_at > now() - interval '10 minutes';
    get diagnostics v_devices = row_count;
    v_queued := v_queued + v_devices;
    v_results := v_results || jsonb_build_object('student_id', v_student,
                                                 'result', case when v_devices > 0 then 'queued' else 'no_device' end);
  end loop;

  perform app.audit('command.' || p_kind, 'class_session', p_session::text,
                    jsonb_build_object('students', p_students, 'payload', p_payload, 'queued', v_queued));
  return jsonb_build_object('queued', v_queued, 'results', v_results);
end$$;

create or replace function public.retry_command(p_command uuid) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare v public.teacher_commands; v_new uuid;
begin
  select * into v from public.teacher_commands where id = p_command;
  if v.id is null then raise exception 'Command not found.' using errcode = 'P0002'; end if;
  perform app.require_live_session(v.class_session_id);
  if v.status not in ('failed','expired') then raise exception 'Only failed or expired commands can be retried.' using errcode = 'P0001'; end if;
  insert into public.teacher_commands (tenant_id, class_session_id, student_id, device_id, issued_by, kind, payload)
    values (v.tenant_id, v.class_session_id, v.student_id, v.device_id, auth.uid(), v.kind, v.payload)
    returning id into v_new;
  perform app.audit('command.retry', 'teacher_command', p_command::text);
  return v_new;
end$$;

create or replace function public.start_environment(p_session uuid, p_policy uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_s public.class_sessions := app.require_live_session(p_session);
begin
  if not exists (select 1 from public.environment_policies where id = p_policy and tenant_id = v_s.tenant_id) then
    raise exception 'Environment not found.' using errcode = 'P0002';
  end if;
  update public.class_sessions set environment_id = p_policy, environment_active = true where id = p_session;
  update public.browser_sessions set violation_since = null, violation_kind = null, violation_rule = null, violation_url = null
   where class_session_id = p_session;
  perform app.audit('environment.started', 'class_session', p_session::text, jsonb_build_object('policy_id', p_policy));
end$$;

create or replace function public.stop_environment(p_session uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_s public.class_sessions := app.require_live_session(p_session);
begin
  update public.class_sessions set environment_active = false where id = p_session;
  update public.environment_events set resolved_at = now()
   where class_session_id = p_session and resolved_at is null and kind in ('environment_left','domain_blocked','off_task','tab_limit');
  update public.browser_sessions set violation_since = null, violation_kind = null, violation_rule = null, violation_url = null
   where class_session_id = p_session;
  perform app.audit('environment.stopped', 'class_session', p_session::text);
end$$;

-- Scenes: switch the session's policy and run the scene's actions.
create or replace function public.apply_scene(p_session uuid, p_scene uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_s      public.class_sessions := app.require_live_session(p_session);
  v_scene  public.scenes;
  v_all    uuid[];
  r        record;
  v_sent   int := 0;
begin
  select * into v_scene from public.scenes where id = p_scene and tenant_id = v_s.tenant_id;
  if v_scene.id is null then raise exception 'Scene not found.' using errcode = 'P0002'; end if;
  perform public.start_environment(p_session, v_scene.policy_id);
  select array_agg(user_id) into v_all from public.class_members where class_id = v_s.class_id and role = 'student';
  if v_all is not null then
    for r in select * from public.scene_rules where scene_id = p_scene order by position loop
      perform public.issue_command(p_session, v_all,
        case r.rule_type when 'open_tab' then 'open_tab' when 'focus' then 'focus' when 'lock' then 'lock'
                         when 'close_other_tabs' then 'close_other_tabs' else 'message' end,
        case r.rule_type when 'open_tab' then jsonb_build_object('url', r.value)
                         when 'focus' then jsonb_build_object('url', r.value)
                         when 'message' then jsonb_build_object('text', r.value) else '{}'::jsonb end);
      v_sent := v_sent + 1;
    end loop;
  end if;
  perform app.audit('scene.applied', 'class_session', p_session::text, jsonb_build_object('scene_id', p_scene));
  return jsonb_build_object('policy_id', v_scene.policy_id, 'actions', v_sent);
end$$;

-- Teacher acknowledges / dismisses / confirms / mutes an alert (§3.8, §16).
create or replace function public.handle_environment_event(p_event uuid, p_action text, p_scope text default 'student')
returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v public.environment_events;
begin
  select * into v from public.environment_events where id = p_event;
  if v.id is null then raise exception 'Alert not found.' using errcode = 'P0002'; end if;
  if not app.can_manage_session(v.class_session_id) then raise exception 'Not your session.' using errcode = '42501'; end if;
  if p_action not in ('acknowledge','dismiss','confirm','mute') then raise exception 'Unknown action.' using errcode = '22023'; end if;

  update public.environment_events set
    status = case p_action when 'acknowledge' then 'acknowledged' when 'confirm' then 'confirmed' else 'dismissed' end,
    handled_by = auth.uid(), handled_at = now(),
    resolved_at = case when p_action in ('dismiss','mute') then coalesce(resolved_at, now()) else resolved_at end
  where id = p_event;

  if v.kind = 'off_task' and v.domain is not null and p_action in ('dismiss','confirm','mute') then
    insert into public.off_task_feedback (tenant_id, domain, dismissals, confirmations)
      values (v.tenant_id, v.domain, case when p_action in ('dismiss','mute') then 1 else 0 end,
              case when p_action = 'confirm' then 1 else 0 end)
      on conflict (tenant_id, domain) do update set
        dismissals = public.off_task_feedback.dismissals + excluded.dismissals,
        confirmations = public.off_task_feedback.confirmations + excluded.confirmations, updated_at = now();
  end if;
  if p_action = 'mute' and v.domain is not null then
    insert into public.off_task_mutes (tenant_id, class_session_id, student_id, domain, muted_by)
      values (v.tenant_id, v.class_session_id, case when p_scope = 'session' then null else v.student_id end, v.domain, auth.uid());
  end if;
  perform app.audit('alert.' || p_action, 'environment_event', p_event::text, jsonb_build_object('kind', v.kind));
end$$;

create or replace function public.request_screenshot(p_session uuid, p_student uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_s public.class_sessions := app.require_live_session(p_session);
begin
  if not (select allow_screen_capture from public.tenant_settings where tenant_id = v_s.tenant_id) then
    raise exception 'Screen capture is disabled by your school.' using errcode = 'P0001';
  end if;
  update public.browser_sessions set snapshot_requested_at = now()
   where class_session_id = p_session and student_id = p_student
     and (snapshot_requested_at is null or snapshot_requested_at < now() - interval '3 seconds');
  perform app.audit('screen.requested', 'user', p_student::text, jsonb_build_object('session_id', p_session));
end$$;

-- >>>>>>>>>>>>>>>>>>>> 20260901000640_rpc_classroom.sql >>>>>>>>>>>>>>>>>>>>
-- =============================================================================
-- SwiftCipher — 0640 live classroom RPCs (§3.4, §3.7, §16, §30)
-- =============================================================================

create or replace function public.start_session(
  p_class uuid, p_lesson uuid default null, p_mode text default 'live_participation',
  p_title text default null, p_environment uuid default null
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me    public.users := app.me();
  v_class public.classes;
  v_s     public.class_sessions;
begin
  if not app.can_manage_class(p_class) then raise exception 'Not your class.' using errcode = '42501'; end if;
  select * into v_class from public.classes where id = p_class;
  if p_mode not in ('live_participation','student_paced','front_of_class') then
    raise exception 'Unknown delivery mode.' using errcode = '22023';
  end if;
  if p_lesson is not null and not app.can_view_lesson(p_lesson) then
    raise exception 'Lesson not found.' using errcode = 'P0002';
  end if;
  if p_environment is not null and not exists (select 1 from public.environment_policies
                                               where id = p_environment and tenant_id = v_me.tenant_id) then
    raise exception 'Environment not found.' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.class_sessions where class_id = p_class and status = 'live') then
    raise exception 'This class already has a live session. End it first.' using errcode = 'P0001';
  end if;

  insert into public.class_sessions (tenant_id, class_id, teacher_id, lesson_id, lesson_version, title, mode, join_code,
                                     status, environment_id, environment_active, started_at)
    values (v_me.tenant_id, p_class, v_me.id, p_lesson,
            (select current_version from public.lessons where id = p_lesson),
            coalesce(nullif(btrim(p_title), ''), (select title from public.lessons where id = p_lesson), v_class.name || ' live'),
            p_mode, app.unique_code(6, 'class_sessions'), 'live', p_environment, p_environment is not null, now())
    returning * into v_s;

  insert into public.session_participants (session_id, user_id, tenant_id, status)
    values (v_s.id, v_me.id, v_me.tenant_id, 'online');
  perform app.audit('session.started', 'class_session', v_s.id::text,
                    jsonb_build_object('class_id', p_class, 'lesson_id', p_lesson, 'environment_id', p_environment));
  perform app.notify(m.user_id, 'session_started', 'Live class started: ' || v_s.title, 'Join code ' || v_s.join_code,
                     '/student/live/' || v_s.id, 'info', jsonb_build_object('session_id', v_s.id))
  from public.class_members m where m.class_id = p_class and m.role = 'student';
  return to_jsonb(v_s);
end$$;

create or replace function public.end_session(p_session uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_s      public.class_sessions := app.require_live_session(p_session);
  v_report uuid;
begin
  update public.class_sessions set status = 'ended', ended_at = now(), environment_active = false where id = p_session;
  update public.session_participants set left_at = coalesce(left_at, now()), status = 'offline' where session_id = p_session;
  update public.browser_sessions set ended_at = now() where class_session_id = p_session and ended_at is null;
  update public.environment_events set resolved_at = now() where class_session_id = p_session and resolved_at is null;
  update public.spotlights set ended_at = now() where session_id = p_session and ended_at is null;
  update public.teacher_commands set status = 'expired' where class_session_id = p_session and status in ('queued','delivered');
  update public.raise_hands set status = 'resolved', resolved_at = now() where session_id = p_session and status = 'open';
  update public.rtc_rooms set status = 'closed', closed_at = now() where session_id = p_session and status = 'open';
  update public.quiz_attempts set status = 'submitted', submitted_at = now() where session_id = p_session and status = 'in_progress';
  perform app.recompute_attempt(id) from public.quiz_attempts where session_id = p_session;

  -- Attendance from participation; manual entries always win.
  insert into public.attendance (tenant_id, class_id, session_id, student_id, date, status, source, recorded_by)
    select v_s.tenant_id, v_s.class_id, p_session, m.user_id, (v_s.started_at at time zone 'UTC')::date,
           case when exists (select 1 from public.session_participants p where p.session_id = p_session and p.user_id = m.user_id)
                then 'present' else 'absent' end,
           'session', auth.uid()
    from public.class_members m where m.class_id = v_s.class_id and m.role = 'student'
    on conflict (class_id, student_id, date) do update
      set status = case when public.attendance.source = 'session' and excluded.status = 'present' then 'present'
                        else public.attendance.status end;

  insert into public.reports (tenant_id, kind, title, scope_type, scope_id, payload, created_by)
    values (v_s.tenant_id, 'session_summary', 'Session report: ' || v_s.title, 'class_session', p_session,
            public.session_report(p_session), auth.uid())
    returning id into v_report;
  perform app.audit('session.ended', 'class_session', p_session::text, jsonb_build_object('report_id', v_report));
  return jsonb_build_object('ended', true, 'report_id', v_report);
end$$;

create or replace function public.join_session(p_code text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_me public.users := app.me(); v_s public.class_sessions;
begin
  select * into v_s from public.class_sessions where join_code = upper(btrim(coalesce(p_code, ''))) and status = 'live';
  if v_s.id is null then raise exception 'No live class with that code.' using errcode = 'P0002'; end if;
  if not app.in_class(v_s.class_id) then raise exception 'This live class is for another class roster.' using errcode = '42501'; end if;
  insert into public.session_participants (session_id, user_id, tenant_id, status, current_slide)
    values (v_s.id, v_me.id, v_me.tenant_id, 'online', v_s.current_slide)
    on conflict (session_id, user_id) do update set status = 'online', left_at = null, last_seen_at = now();
  return jsonb_build_object('session_id', v_s.id, 'title', v_s.title);
end$$;

-- Student view of a session; also joins/refreshes presence (§30 reconnect restores state).
create or replace function public.session_student_state(p_session uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me    public.users := app.me();
  v_s     public.class_sessions;
  v_p     public.session_participants;
  v_spot  public.spotlights;
  v_act   public.activities;
begin
  select * into v_s from public.class_sessions where id = p_session;
  if v_s.id is null or not app.in_class(v_s.class_id) then raise exception 'Session not found.' using errcode = 'P0002'; end if;
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
    'session', jsonb_build_object('id', v_s.id, 'title', v_s.title, 'status', v_s.status, 'mode', v_s.mode,
                                  'current_slide', v_s.current_slide, 'group_chat_enabled', v_s.group_chat_enabled,
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
    'server_now', now());
end$$;

create or replace function public.session_lesson(p_session uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_s public.class_sessions;
begin
  select * into v_s from public.class_sessions where id = p_session;
  if v_s.id is null or not (app.in_class(v_s.class_id) or app.can_manage_class(v_s.class_id)) then
    raise exception 'Session not found.' using errcode = 'P0002';
  end if;
  if v_s.lesson_id is null then return jsonb_build_object('lesson', null, 'slides', '[]'::jsonb); end if;
  return app.lesson_payload(v_s.lesson_id);
end$$;

-- Web-client presence heartbeat (§3.4). Students control their slide only in student-paced mode.
create or replace function public.session_heartbeat(p_session uuid, p_slide int default null, p_status text default 'online')
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_s public.class_sessions;
begin
  select * into v_s from public.class_sessions where id = p_session;
  if v_s.id is null or not app.in_class(v_s.class_id) then raise exception 'Session not found.' using errcode = 'P0002'; end if;
  if v_s.status <> 'live' then return jsonb_build_object('status', v_s.status); end if;
  update public.session_participants set last_seen_at = now(), left_at = null,
    status = case when p_status in ('online','idle') then p_status else 'online' end,
    current_slide = case when v_s.mode = 'student_paced' and p_slide is not null and p_slide >= 0 then p_slide
                         else v_s.current_slide end
  where session_id = p_session and user_id = auth.uid();
  if not found then
    insert into public.session_participants (session_id, user_id, tenant_id, status, current_slide)
      values (p_session, auth.uid(), v_s.tenant_id, 'online', v_s.current_slide);
  end if;
  return jsonb_build_object('status', v_s.status, 'current_slide', v_s.current_slide,
                            'active_activity_id', v_s.active_activity_id);
end$$;

create or replace function public.leave_session(p_session uuid) returns void
language sql volatile security definer set search_path = '' as $$
  update public.session_participants set left_at = now(), status = 'offline'
  where session_id = p_session and user_id = auth.uid()
$$;

create or replace function public.set_session_state(
  p_session uuid, p_slide int default null, p_activity uuid default null, p_clear_activity boolean default false,
  p_group_chat boolean default null, p_responses_visible boolean default null, p_mode text default null
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_s public.class_sessions := app.require_live_session(p_session); v_allow boolean;
begin
  if p_activity is not null and not exists (select 1 from public.activities where id = p_activity and tenant_id = v_s.tenant_id) then
    raise exception 'Activity not found.' using errcode = 'P0002';
  end if;
  if p_group_chat then
    select allow_group_chat into v_allow from public.tenant_settings where tenant_id = v_s.tenant_id;
    if not v_allow then raise exception 'Group chat is disabled by your school.' using errcode = 'P0001'; end if;
  end if;
  if p_mode is not null and p_mode not in ('live_participation','student_paced','front_of_class') then
    raise exception 'Unknown delivery mode.' using errcode = '22023';
  end if;
  update public.class_sessions set
    current_slide = coalesce(greatest(p_slide, 0), current_slide),
    active_activity_id = case when p_clear_activity then null else coalesce(p_activity, active_activity_id) end,
    group_chat_enabled = coalesce(p_group_chat, group_chat_enabled),
    responses_visible = coalesce(p_responses_visible, responses_visible),
    mode = coalesce(p_mode, mode)
  where id = p_session returning * into v_s;
  if p_slide is not null and v_s.mode <> 'student_paced' then
    update public.session_participants set current_slide = v_s.current_slide where session_id = p_session;
  end if;
  if p_activity is not null then
    perform app.audit('activity.launched', 'activity', p_activity::text, jsonb_build_object('session_id', p_session));
  end if;
  return to_jsonb(v_s);
end$$;

-- Everything the teacher's live dashboard needs (§11). Also performs the lazy
-- housekeeping that turns silent devices into "connection lost" (never a
-- violation, §3.6/§30) and expires stale commands.
create or replace function public.teacher_session_state(p_session uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_s        public.class_sessions;
  v_settings public.tenant_settings;
  r          public.browser_sessions;
begin
  select * into v_s from public.class_sessions where id = p_session;
  if v_s.id is null or not app.can_manage_class(v_s.class_id) then raise exception 'Session not found.' using errcode = 'P0002'; end if;
  select * into v_settings from public.tenant_settings where tenant_id = v_s.tenant_id;

  if v_s.status = 'live' then
    for r in update public.browser_sessions set connection_lost_at = now()
             where class_session_id = p_session and ended_at is null and connection_lost_at is null
               and last_heartbeat_at < now() - interval '45 seconds'
             returning * loop
      perform app.raise_event(r, v_s, v_s.environment_id, 'connection_lost', 'info',
                              'Extension stopped reporting — connection lost, not a rule violation', null, null);
    end loop;
    update public.teacher_commands set status = 'expired'
     where class_session_id = p_session and status in ('queued','delivered') and expires_at < now();
  end if;

  return jsonb_build_object(
    'session', to_jsonb(v_s) || jsonb_build_object(
      'class_name', (select name from public.classes where id = v_s.class_id),
      'lesson_title', (select title from public.lessons where id = v_s.lesson_id),
      'environment_name', (select name from public.environment_policies where id = v_s.environment_id)),
    'settings', jsonb_build_object('allow_spotlight', v_settings.allow_spotlight, 'allow_group_chat', v_settings.allow_group_chat,
                                   'allow_screen_capture', v_settings.allow_screen_capture,
                                   'thumbnail_interval_seconds', v_settings.thumbnail_interval_seconds),
    'server_now', now(),
    'roster', (select coalesce(jsonb_agg(jsonb_build_object(
        'student_id', u.id, 'name', u.full_name,
        'presence', case when p.user_id is null then 'not_joined'
                         when p.left_at is not null or p.last_seen_at < now() - interval '45 seconds' then 'offline'
                         else p.status end,
        'last_seen_at', p.last_seen_at, 'current_slide', p.current_slide,
        'device', (select jsonb_build_object('device_id', b.device_id, 'url', b.active_url, 'domain', b.active_domain,
                     'title', b.active_title, 'tab_count', b.tab_count, 'idle_state', b.idle_state,
                     'online', b.connection_lost_at is null and b.last_heartbeat_at > now() - interval '45 seconds',
                     'last_heartbeat_at', b.last_heartbeat_at, 'focus_locked', b.focus_locked,
                     'violation', b.violation_rule, 'violation_since', b.violation_since,
                     'snapshot_at', (select max(sn.captured_at) from public.screen_snapshots sn
                                     where sn.device_id = b.device_id and sn.class_session_id = p_session and sn.quality = 'thumbnail'))
                   from public.browser_sessions b where b.class_session_id = p_session and b.student_id = u.id
                   order by b.last_heartbeat_at desc limit 1),
        'open_alerts', (select count(*) from public.environment_events e where e.class_session_id = p_session
                        and e.student_id = u.id and e.status = 'open'),
        'hand_raised', exists (select 1 from public.raise_hands h where h.session_id = p_session and h.student_id = u.id and h.status = 'open'))
        order by u.full_name), '[]'::jsonb)
      from public.class_members m join public.users u on u.id = m.user_id
      left join public.session_participants p on p.session_id = p_session and p.user_id = u.id
      where m.class_id = v_s.class_id and m.role = 'student'),
    'alerts', (select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'kind', e.kind, 'severity', e.severity, 'rule', e.rule,
                 'domain', e.domain, 'confidence', e.confidence, 'status', e.status, 'student_id', e.student_id,
                 'student', u.full_name, 'created_at', e.created_at, 'resolved_at', e.resolved_at)
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
    'activity', case when v_s.active_activity_id is null then null
                     else public.activity_results(v_s.active_activity_id, p_session) end);
end$$;

-- Thumbnails for the screen wall; stale frames are flagged, never shown as live (§30).
create or replace function public.session_screens(p_session uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_s public.class_sessions; v_interval int;
begin
  select * into v_s from public.class_sessions where id = p_session;
  if v_s.id is null or not app.can_manage_class(v_s.class_id) then raise exception 'Session not found.' using errcode = 'P0002'; end if;
  select thumbnail_interval_seconds into v_interval from public.tenant_settings where tenant_id = v_s.tenant_id;
  return (select coalesce(jsonb_agg(jsonb_build_object('student_id', sn.student_id, 'device_id', sn.device_id,
            'image', sn.image_data, 'captured_at', sn.captured_at, 'url', sn.url,
            'stale', sn.captured_at < now() - make_interval(secs => v_interval * 3))), '[]'::jsonb)
          from public.screen_snapshots sn where sn.class_session_id = p_session and sn.quality = 'thumbnail');
end$$;

-- ---------------------------------------------------------------------------
-- Spotlight (§3.7)
-- ---------------------------------------------------------------------------
create or replace function public.spotlight_start(
  p_session uuid, p_student uuid, p_anonymized boolean default false, p_show_to_class boolean default false
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_s public.class_sessions := app.require_live_session(p_session); v_id uuid;
begin
  if not (select allow_spotlight and allow_screen_capture from public.tenant_settings where tenant_id = v_s.tenant_id) then
    raise exception 'Student screen spotlighting is disabled by your school.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.class_members where class_id = v_s.class_id and user_id = p_student and role = 'student') then
    raise exception 'Student is not in this class.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.browser_sessions where class_session_id = p_session and student_id = p_student
                 and last_heartbeat_at > now() - interval '45 seconds') then
    raise exception 'That student''s device is not connected.' using errcode = 'P0001';
  end if;
  update public.spotlights set ended_at = now() where session_id = p_session and ended_at is null;
  insert into public.spotlights (tenant_id, session_id, student_id, anonymized, show_to_class, started_by)
    values (v_s.tenant_id, p_session, p_student, p_anonymized, p_show_to_class, auth.uid()) returning id into v_id;
  update public.browser_sessions set snapshot_requested_at = now() where class_session_id = p_session and student_id = p_student;
  perform app.notify(p_student, 'spotlight', 'Your teacher is sharing your screen with the class',
                     case when p_anonymized then 'Your name is hidden.' end, '/student/live/' || p_session, 'info',
                     jsonb_build_object('session_id', p_session));
  perform app.audit('spotlight.started', 'user', p_student::text,
                    jsonb_build_object('session_id', p_session, 'anonymized', p_anonymized, 'show_to_class', p_show_to_class));
  return jsonb_build_object('id', v_id);
end$$;

create or replace function public.spotlight_stop(p_session uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_s public.class_sessions := app.require_live_session(p_session);
begin
  update public.spotlights set ended_at = now() where session_id = p_session and ended_at is null;
  perform app.audit('spotlight.stopped', 'class_session', p_session::text);
end$$;

-- The spotlighted frame, for the teacher/projector or (when shared) the class.
create or replace function public.spotlight_view(p_session uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_spot public.spotlights; v_img record; v_manager boolean;
begin
  select * into v_spot from public.spotlights where session_id = p_session and ended_at is null;
  if v_spot.id is null then return null; end if;
  v_manager := app.can_manage_session(p_session);
  if not (v_manager or (v_spot.show_to_class and app.in_session(p_session)) or v_spot.student_id = auth.uid()) then
    raise exception 'Not available.' using errcode = '42501';
  end if;
  select image_data, captured_at, quality into v_img from public.screen_snapshots
   where class_session_id = p_session and student_id = v_spot.student_id and quality in ('spotlight','thumbnail')
   order by case quality when 'spotlight' then 0 else 1 end, captured_at desc limit 1;
  return jsonb_build_object(
    'student', case when v_spot.anonymized and not v_manager then 'A classmate'
                    when v_spot.anonymized then 'A classmate (' || (select full_name from public.users where id = v_spot.student_id) || ')'
                    else (select full_name from public.users where id = v_spot.student_id) end,
    'image', v_img.image_data, 'captured_at', v_img.captured_at,
    'stale', v_img.captured_at is null or v_img.captured_at < now() - interval '20 seconds',
    'show_to_class', v_spot.show_to_class);
end$$;

-- ---------------------------------------------------------------------------
-- Help queue, chat (§3.4)
-- ---------------------------------------------------------------------------
create or replace function public.resolve_hand(p_hand uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v public.raise_hands;
begin
  select * into v from public.raise_hands where id = p_hand;
  if v.id is null or not app.can_manage_session(v.session_id) then raise exception 'Not found.' using errcode = 'P0002'; end if;
  update public.raise_hands set status = 'resolved', resolved_at = now(), resolved_by = auth.uid() where id = p_hand;
end$$;

create or replace function public.lower_hand(p_session uuid) returns void
language sql volatile security definer set search_path = '' as $$
  update public.raise_hands set status = 'resolved', resolved_at = now(), resolved_by = auth.uid()
  where session_id = p_session and student_id = auth.uid() and status = 'open'
$$;

create or replace function public.open_direct_thread(p_class uuid, p_student uuid default null) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare v_me public.users := app.me(); v_teacher uuid; v_student uuid; v_id uuid;
begin
  if app.can_manage_class(p_class) and v_me.role <> 'student' then
    v_teacher := v_me.id; v_student := p_student;
    if not exists (select 1 from public.class_members where class_id = p_class and user_id = p_student and role = 'student') then
      raise exception 'Student is not in this class.' using errcode = '22023';
    end if;
  elsif app.in_class(p_class) then
    v_student := v_me.id;
    select teacher_id into v_teacher from public.classes where id = p_class;
  else
    raise exception 'Not your class.' using errcode = '42501';
  end if;
  select id into v_id from public.chat_threads
   where class_id = p_class and kind = 'direct' and student_id = v_student and teacher_id = v_teacher;
  if v_id is null then
    insert into public.chat_threads (tenant_id, class_id, kind, student_id, teacher_id)
      values (v_me.tenant_id, p_class, 'direct', v_student, v_teacher) returning id into v_id;
  end if;
  return v_id;
end$$;

create or replace function public.open_group_thread(p_session uuid) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare v_s public.class_sessions; v_id uuid;
begin
  select * into v_s from public.class_sessions where id = p_session;
  if v_s.id is null or not (app.in_class(v_s.class_id) or app.can_manage_class(v_s.class_id)) then
    raise exception 'Session not found.' using errcode = 'P0002';
  end if;
  if not v_s.group_chat_enabled then raise exception 'Group chat is off for this session.' using errcode = 'P0001'; end if;
  select id into v_id from public.chat_threads where session_id = p_session and kind = 'group';
  if v_id is null then
    insert into public.chat_threads (tenant_id, class_id, kind, session_id)
      values (v_s.tenant_id, v_s.class_id, 'group', p_session) returning id into v_id;
  end if;
  return v_id;
end$$;

create or replace function public.send_message(p_thread uuid, p_body text) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare v_me public.users := app.me(); v_t public.chat_threads; v_id uuid; v_to uuid;
begin
  select * into v_t from public.chat_threads where id = p_thread and tenant_id = v_me.tenant_id;
  if v_t.id is null then raise exception 'Conversation not found.' using errcode = 'P0002'; end if;
  if length(btrim(coalesce(p_body, ''))) not between 1 and 2000 then raise exception 'Messages are 1-2000 characters.' using errcode = '22023'; end if;
  if v_t.kind = 'direct' then
    if v_me.id not in (v_t.student_id, v_t.teacher_id) then raise exception 'Not your conversation.' using errcode = '42501'; end if;
    v_to := case when v_me.id = v_t.student_id then v_t.teacher_id else v_t.student_id end;
  else
    if not (app.can_manage_class(v_t.class_id)
            or (app.in_class(v_t.class_id) and exists (select 1 from public.class_sessions s where s.id = v_t.session_id
                                                       and s.status = 'live' and s.group_chat_enabled))) then
      raise exception 'Group chat is off for this session.' using errcode = 'P0001';
    end if;
  end if;
  insert into public.chat_messages (tenant_id, thread_id, sender_id, body)
    values (v_me.tenant_id, p_thread, v_me.id, btrim(p_body)) returning id into v_id;
  if v_to is not null then
    perform app.notify(v_to, 'chat_message', 'New message from ' || v_me.full_name, left(btrim(p_body), 140),
                       case when v_me.role = 'student' then '/messages?thread=' else '/messages?thread=' end || p_thread,
                       'info', jsonb_build_object('thread_id', p_thread));
  end if;
  return v_id;
end$$;

create or replace function public.hide_message(p_message uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_class uuid;
begin
  select t.class_id into v_class from public.chat_messages m join public.chat_threads t on t.id = m.thread_id where m.id = p_message;
  if v_class is null or not app.can_manage_class(v_class) then raise exception 'Not found.' using errcode = 'P0002'; end if;
  update public.chat_messages set hidden = true where id = p_message;
  perform app.audit('chat.message_hidden', 'chat_message', p_message::text);
end$$;

-- ---------------------------------------------------------------------------
-- WebRTC signalling (teacher screen share / optional A/V)
-- ---------------------------------------------------------------------------
create or replace function public.rtc_open_room(p_session uuid, p_purpose text default 'av') returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare v_s public.class_sessions := app.require_live_session(p_session); v_id uuid;
begin
  if p_purpose not in ('av','screen_share','spotlight') then raise exception 'Unknown purpose.' using errcode = '22023'; end if;
  select id into v_id from public.rtc_rooms where session_id = p_session and purpose = p_purpose and status = 'open';
  if v_id is null then
    insert into public.rtc_rooms (tenant_id, session_id, host_id, purpose) values (v_s.tenant_id, p_session, auth.uid(), p_purpose)
      returning id into v_id;
    perform app.audit('rtc.room_opened', 'class_session', p_session::text, jsonb_build_object('purpose', p_purpose));
  end if;
  return v_id;
end$$;

create or replace function public.rtc_join(p_room uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_r public.rtc_rooms; v_peer uuid; v_host boolean;
begin
  select * into v_r from public.rtc_rooms where id = p_room and status = 'open';
  if v_r.id is null then raise exception 'Room is closed.' using errcode = 'P0002'; end if;
  v_host := app.can_manage_session(v_r.session_id);
  if not v_host and not app.in_session(v_r.session_id) then raise exception 'Not your class.' using errcode = '42501'; end if;
  insert into public.rtc_peers (tenant_id, room_id, user_id, role)
    values (v_r.tenant_id, p_room, auth.uid(), case when v_host then 'host' else 'participant' end)
    on conflict (room_id, user_id) do update set left_at = null, last_seen_at = now()
    returning id into v_peer;
  return jsonb_build_object('peer_id', v_peer, 'role', case when v_host then 'host' else 'participant' end,
    'peers', (select coalesce(jsonb_agg(jsonb_build_object('peer_id', p.id, 'user_id', p.user_id, 'role', p.role,
                'name', u.full_name)), '[]'::jsonb)
              from public.rtc_peers p join public.users u on u.id = p.user_id
              where p.room_id = p_room and p.left_at is null and p.id <> v_peer and p.last_seen_at > now() - interval '60 seconds'));
end$$;

create or replace function public.rtc_signal(p_room uuid, p_to_peer uuid, p_kind text, p_payload jsonb) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_from uuid; v_tenant uuid;
begin
  select id, tenant_id into v_from, v_tenant from public.rtc_peers where room_id = p_room and user_id = auth.uid() and left_at is null;
  if v_from is null then raise exception 'Join the room first.' using errcode = '42501'; end if;
  if not exists (select 1 from public.rtc_peers where id = p_to_peer and room_id = p_room) then
    raise exception 'Peer not in room.' using errcode = 'P0002';
  end if;
  if length(p_payload::text) > 65536 then raise exception 'Signal too large.' using errcode = '22023'; end if;
  insert into public.rtc_signals (tenant_id, room_id, from_peer_id, to_peer_id, kind, payload)
    values (v_tenant, p_room, v_from, p_to_peer, p_kind, p_payload);
end$$;

create or replace function public.rtc_poll(p_room uuid, p_after bigint default 0) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_me uuid;
begin
  update public.rtc_peers set last_seen_at = now() where room_id = p_room and user_id = auth.uid() and left_at is null
    returning id into v_me;
  if v_me is null then raise exception 'Join the room first.' using errcode = '42501'; end if;
  return jsonb_build_object(
    'signals', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'from', s.from_peer_id, 'kind', s.kind,
                  'payload', s.payload) order by s.id), '[]'::jsonb)
                from public.rtc_signals s where s.to_peer_id = v_me and s.id > coalesce(p_after, 0)),
    'peers', (select coalesce(jsonb_agg(jsonb_build_object('peer_id', p.id, 'user_id', p.user_id, 'role', p.role,
                'name', u.full_name)), '[]'::jsonb)
              from public.rtc_peers p join public.users u on u.id = p.user_id
              where p.room_id = p_room and p.left_at is null and p.id <> v_me and p.last_seen_at > now() - interval '60 seconds'),
    'open', exists (select 1 from public.rtc_rooms where id = p_room and status = 'open'));
end$$;

create or replace function public.rtc_leave(p_room uuid) returns void
language sql volatile security definer set search_path = '' as $$
  update public.rtc_peers set left_at = now() where room_id = p_room and user_id = auth.uid()
$$;

create or replace function public.rtc_close(p_room uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_r public.rtc_rooms;
begin
  select * into v_r from public.rtc_rooms where id = p_room;
  if v_r.id is null or not app.can_manage_session(v_r.session_id) then raise exception 'Not found.' using errcode = 'P0002'; end if;
  update public.rtc_rooms set status = 'closed', closed_at = now() where id = p_room;
end$$;

-- >>>>>>>>>>>>>>>>>>>> 20260901000650_rpc_insights_admin.sql >>>>>>>>>>>>>>>>>>>>
-- =============================================================================
-- SwiftCipher — 0650 Insights (§18), reports, parent portal, retention &
-- privacy workflows (§20), billing metrics (§26), function privileges.
-- =============================================================================

create table public.reports (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  kind        text not null check (kind in ('session_summary','class_analytics','tenant_overview','attendance','custom')),
  title       text not null,
  scope_type  text,
  scope_id    uuid,
  payload     jsonb not null,
  created_by  uuid,
  created_at  timestamptz not null default now()
);
create index reports_tenant_idx on public.reports(tenant_id, created_at desc);
alter table public.reports enable row level security;
revoke all on public.reports from anon;
revoke insert, update, delete on public.reports from authenticated;
create policy reports_read on public.reports for select to authenticated
  using (tenant_id = (select app.tenant_id())
         and ((select app.is_admin())
              or created_by = (select auth.uid())
              or (scope_type = 'class_session' and app.can_manage_session(scope_id))
              or (scope_type = 'class' and app.can_manage_class(scope_id))));

-- ---------------------------------------------------------------------------
create or replace function public.session_report(p_session uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_s public.class_sessions;
begin
  select * into v_s from public.class_sessions where id = p_session;
  if v_s.id is null or not app.can_manage_class(v_s.class_id) then raise exception 'Session not found.' using errcode = 'P0002'; end if;
  return jsonb_build_object(
    'session', jsonb_build_object('id', v_s.id, 'title', v_s.title, 'mode', v_s.mode, 'started_at', v_s.started_at,
                                  'ended_at', v_s.ended_at,
                                  'minutes', round(extract(epoch from coalesce(v_s.ended_at, now()) - coalesce(v_s.started_at, v_s.created_at)) / 60)),
    'class', (select jsonb_build_object('id', c.id, 'name', c.name) from public.classes c where c.id = v_s.class_id),
    'enrolled', (select count(*) from public.class_members where class_id = v_s.class_id and role = 'student'),
    'joined', (select count(*) from public.session_participants p join public.class_members m
               on m.class_id = v_s.class_id and m.user_id = p.user_id and m.role = 'student' where p.session_id = p_session),
    'activities', (select coalesce(jsonb_agg(jsonb_build_object('activity_id', a.id, 'title', a.title, 'kind', a.kind,
                     'attempts', (select count(*) from public.quiz_attempts t where t.activity_id = a.id and t.session_id = p_session),
                     'avg_percent', (select round(avg(100.0 * t.score / nullif(t.max_score, 0))) from public.quiz_attempts t
                                     where t.activity_id = a.id and t.session_id = p_session and t.status <> 'in_progress'))), '[]'::jsonb)
                   from public.activities a where exists (select 1 from public.quiz_attempts t where t.activity_id = a.id and t.session_id = p_session)),
    'alerts', (select coalesce(jsonb_object_agg(kind, n), '{}'::jsonb) from
                (select kind, count(*) n from public.environment_events where class_session_id = p_session group by kind) x),
    'commands', (select count(*) from public.teacher_commands where class_session_id = p_session),
    'hands', (select count(*) from public.raise_hands where session_id = p_session),
    'students', (select coalesce(jsonb_agg(jsonb_build_object(
        'student_id', u.id, 'name', u.full_name,
        'joined', exists (select 1 from public.session_participants p where p.session_id = p_session and p.user_id = u.id),
        'answers', (select count(*) from public.quiz_answers qa join public.quiz_attempts t on t.id = qa.attempt_id
                    where t.session_id = p_session and t.student_id = u.id),
        'correct', (select count(*) from public.quiz_answers qa join public.quiz_attempts t on t.id = qa.attempt_id
                    where t.session_id = p_session and t.student_id = u.id and qa.is_correct),
        'alerts', (select count(*) from public.environment_events e where e.class_session_id = p_session and e.student_id = u.id
                   and e.kind <> 'connection_lost'))
        order by u.full_name), '[]'::jsonb)
      from public.class_members m join public.users u on u.id = m.user_id
      where m.class_id = v_s.class_id and m.role = 'student'));
end$$;

create or replace function public.class_analytics(p_class uuid, p_days int default 30) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_from     timestamptz := now() - make_interval(days => least(greatest(coalesce(p_days, 30), 1), 365));
  v_students bigint;
  v_sessions bigint;
begin
  if not app.can_manage_class(p_class) then raise exception 'Not your class.' using errcode = '42501'; end if;
  select count(*) into v_students from public.class_members where class_id = p_class and role = 'student';
  select count(*) into v_sessions from public.class_sessions where class_id = p_class and created_at >= v_from;

  return jsonb_build_object(
    'range_days', p_days, 'students', v_students, 'sessions', v_sessions,
    -- Learning analytics
    'participation_rate', (select round(100.0 * count(*) / nullif(v_students * v_sessions, 0), 1)
                           from public.session_participants p join public.class_sessions s on s.id = p.session_id
                           join public.class_members m on m.class_id = s.class_id and m.user_id = p.user_id and m.role = 'student'
                           where s.class_id = p_class and s.created_at >= v_from),
    'question_accuracy', (select round(100.0 * count(*) filter (where qa.is_correct) / nullif(count(*) filter (where qa.is_correct is not null), 0), 1)
                          from public.quiz_answers qa join public.quiz_attempts t on t.id = qa.attempt_id
                          join public.class_members m on m.user_id = t.student_id and m.class_id = p_class
                          where qa.answered_at >= v_from),
    'avg_response_ms', (select round(avg(qa.elapsed_ms)) from public.quiz_answers qa join public.quiz_attempts t on t.id = qa.attempt_id
                        join public.class_members m on m.user_id = t.student_id and m.class_id = p_class
                        where qa.answered_at >= v_from and qa.elapsed_ms > 0),
    'hardest_questions', (select coalesce(jsonb_agg(x order by (x ->> 'accuracy')::numeric), '[]'::jsonb) from (
        select jsonb_build_object('question_id', q.id, 'prompt', left(q.prompt, 140), 'responses', count(*),
               'accuracy', round(100.0 * count(*) filter (where qa.is_correct) / nullif(count(*), 0), 1)) x
        from public.quiz_answers qa join public.questions q on q.id = qa.question_id
        join public.quiz_attempts t on t.id = qa.attempt_id
        join public.class_members m on m.user_id = t.student_id and m.class_id = p_class
        where qa.answered_at >= v_from and qa.is_correct is not null
        group by q.id having count(*) >= 3 order by 100.0 * count(*) filter (where qa.is_correct) / count(*) limit 5) h),
    'score_distribution', (select coalesce(jsonb_object_agg(bucket, n), '{}'::jsonb) from (
        select (least(floor(100.0 * t.score / t.max_score / 20), 4) * 20)::int::text || '%' as bucket, count(*) n
        from public.quiz_attempts t join public.class_members m on m.user_id = t.student_id and m.class_id = p_class
        where t.submitted_at >= v_from and t.max_score > 0 and t.score is not null group by 1) d),
    'assignment_completion', (select round(100.0 * count(distinct (s.assignment_id, s.student_id)) /
                                nullif(v_students * (select count(*) from public.assignments a where a.class_id = p_class
                                                     and a.status <> 'draft' and a.created_at >= v_from), 0), 1)
                              from public.submissions s join public.assignments a on a.id = s.assignment_id
                              where a.class_id = p_class and a.created_at >= v_from),
    'games', (select coalesce(jsonb_agg(jsonb_build_object('game_id', g.id, 'title', g.title, 'ended_at', g.ended_at,
                'players', (select count(*) from public.game_players p where p.game_id = g.id),
                'winner', (select p.display_name from public.game_players p where p.game_id = g.id order by p.score desc limit 1))
                order by g.created_at desc), '[]'::jsonb)
              from (select * from public.game_sessions where class_id = p_class and created_at >= v_from order by created_at desc limit 10) g),
    -- Classroom-focus signals, reported separately from learning (§18)
    'environment_leave_rate', (select round(count(*)::numeric / nullif(v_sessions, 0), 2) from public.environment_events e
                               join public.class_sessions s on s.id = e.class_session_id
                               where s.class_id = p_class and s.created_at >= v_from and e.kind in ('environment_left','domain_blocked')),
    'off_task_rate', (select round(count(*)::numeric / nullif(v_sessions, 0), 2) from public.environment_events e
                      join public.class_sessions s on s.id = e.class_session_id
                      where s.class_id = p_class and s.created_at >= v_from and e.kind = 'off_task'),
    'device_connectivity_rate', (select round(100.0 * count(*) filter (where not exists (
                                    select 1 from public.environment_events e where e.class_session_id = b.class_session_id
                                    and e.student_id = b.student_id and e.kind = 'connection_lost')) / nullif(count(*), 0), 1)
                                 from public.browser_sessions b join public.class_sessions s on s.id = b.class_session_id
                                 where s.class_id = p_class and s.created_at >= v_from),
    'interventions_per_session', (select round((count(distinct c.id) + count(distinct e.id))::numeric / nullif(v_sessions, 0), 2)
                                  from public.class_sessions s
                                  left join public.teacher_commands c on c.class_session_id = s.id
                                  left join public.environment_events e on e.class_session_id = s.id and e.handled_by is not null
                                  where s.class_id = p_class and s.created_at >= v_from),
    'per_student', (select coalesce(jsonb_agg(jsonb_build_object(
        'student_id', u.id, 'name', u.full_name,
        'sessions_joined', (select count(*) from public.session_participants p join public.class_sessions s on s.id = p.session_id
                            where p.user_id = u.id and s.class_id = p_class and s.created_at >= v_from),
        'accuracy', (select round(100.0 * count(*) filter (where qa.is_correct) / nullif(count(*) filter (where qa.is_correct is not null), 0), 1)
                     from public.quiz_answers qa join public.quiz_attempts t on t.id = qa.attempt_id
                     where t.student_id = u.id and qa.answered_at >= v_from),
        'submissions', (select count(*) from public.submissions s join public.assignments a on a.id = s.assignment_id
                        where s.student_id = u.id and a.class_id = p_class),
        'alerts', (select count(*) from public.environment_events e join public.class_sessions s on s.id = e.class_session_id
                   where e.student_id = u.id and s.class_id = p_class and s.created_at >= v_from and e.kind <> 'connection_lost'))
        order by u.full_name), '[]'::jsonb)
      from public.class_members m join public.users u on u.id = m.user_id where m.class_id = p_class and m.role = 'student'));
end$$;

create or replace function public.tenant_overview() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_t uuid := app.tenant_id();
begin
  if not app.is_admin() then raise exception 'Administrators only.' using errcode = '42501'; end if;
  return jsonb_build_object(
    'teachers', (select count(*) from public.users where tenant_id = v_t and role in ('teacher','school_admin') and status = 'active'),
    'students', (select count(*) from public.users where tenant_id = v_t and role = 'student' and status = 'active'),
    'parents', (select count(*) from public.users where tenant_id = v_t and role = 'parent'),
    'classes', (select count(*) from public.classes where tenant_id = v_t and archived_at is null),
    'lessons', (select count(*) from public.lessons where tenant_id = v_t),
    'devices_active', (select count(*) from public.devices where tenant_id = v_t and status = 'active'),
    'devices_online', (select count(*) from public.devices where tenant_id = v_t and status = 'active' and last_seen_at > now() - interval '45 seconds'),
    'weekly', (select coalesce(jsonb_agg(jsonb_build_object('week', to_char(w.wk, 'YYYY-MM-DD'), 'sessions', w.sessions,
                 'participants', w.participants,
                 'answers', (select count(*) from public.quiz_answers qa where qa.tenant_id = v_t
                             and date_trunc('week', qa.answered_at) = w.wk)) order by w.wk), '[]'::jsonb) from (
        select date_trunc('week', s.created_at) wk, count(distinct s.id) sessions,
               count(distinct (p.session_id, p.user_id)) participants
        from public.class_sessions s left join public.session_participants p on p.session_id = s.id
        where s.tenant_id = v_t and s.created_at > now() - interval '12 weeks' group by 1) w));
end$$;

-- Billing metrics (§26).
create or replace function public.usage_metrics() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_t uuid := app.tenant_id();
begin
  if not app.is_admin() then raise exception 'Administrators only.' using errcode = '42501'; end if;
  return jsonb_build_object(
    'active_teachers_30d', (select count(distinct s.teacher_id) from public.class_sessions s where s.tenant_id = v_t and s.created_at > now() - interval '30 days'),
    'active_students_30d', (select count(distinct p.user_id) from public.session_participants p where p.tenant_id = v_t and p.joined_at > now() - interval '30 days'),
    'max_students_per_class', (select coalesce(max(n), 0) from (select count(*) n from public.class_members m join public.classes c on c.id = m.class_id
                                                              where c.tenant_id = v_t and m.role = 'student' group by m.class_id) x),
    'classes', (select count(*) from public.classes where tenant_id = v_t and archived_at is null),
    'storage_mb', (select round(coalesce(sum(bytes), 0) / 1048576.0, 1) from public.lesson_media where tenant_id = v_t),
    'managed_devices', (select count(*) from public.devices where tenant_id = v_t and status = 'active'),
    'monitoring_minutes_30d', (select round(coalesce(sum(extract(epoch from coalesce(b.ended_at, b.last_heartbeat_at) - b.started_at)), 0) / 60)
                               from public.browser_sessions b where b.tenant_id = v_t and b.started_at > now() - interval '30 days'),
    'retention', (select jsonb_build_object('learning_days', learning_retention_days, 'telemetry_days', telemetry_retention_days)
                  from public.tenant_settings where tenant_id = v_t),
    'plan', (select jsonb_build_object('code', p.code, 'name', p.name, 'limits', p.limits, 'features', p.features)
             from public.tenants t join public.plans p on p.code = t.plan_code where t.id = v_t));
end$$;

-- Student summary for the student, their teachers, admins and linked parents.
create or replace function public.student_summary(p_student uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_parent boolean; v_u public.users;
begin
  select * into v_u from public.users where id = p_student and role = 'student' and tenant_id = app.tenant_id();
  if v_u.id is null then raise exception 'Student not found.' using errcode = 'P0002'; end if;
  v_parent := app.is_parent_of(p_student);
  if not (p_student = auth.uid() or app.is_admin() or app.teaches_student(p_student) or v_parent) then
    raise exception 'Not available.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'student', jsonb_build_object('id', v_u.id, 'name', v_u.full_name),
    'classes', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'subject', c.subject)), '[]'::jsonb)
                from public.class_members m join public.classes c on c.id = m.class_id where m.user_id = p_student and m.role = 'student'),
    'attendance', (select jsonb_build_object('present', count(*) filter (where status = 'present'),
                     'late', count(*) filter (where status = 'late'), 'absent', count(*) filter (where status = 'absent'),
                     'excused', count(*) filter (where status = 'excused'),
                     'recent', (select coalesce(jsonb_agg(jsonb_build_object('date', a2.date, 'status', a2.status,
                                  'class', (select name from public.classes where id = a2.class_id)) order by a2.date desc), '[]'::jsonb)
                                from (select * from public.attendance where student_id = p_student order by date desc limit 10) a2))
                   from public.attendance where student_id = p_student and date > now() - interval '90 days'),
    'learning', jsonb_build_object(
      'accuracy_30d', (select round(100.0 * count(*) filter (where qa.is_correct) / nullif(count(*) filter (where qa.is_correct is not null), 0), 1)
                       from public.quiz_answers qa join public.quiz_attempts t on t.id = qa.attempt_id
                       where t.student_id = p_student and qa.answered_at > now() - interval '30 days'),
      'activities_completed_30d', (select count(*) from public.quiz_attempts where student_id = p_student and status <> 'in_progress'
                                   and submitted_at > now() - interval '30 days'),
      'sessions_joined_30d', (select count(*) from public.session_participants where user_id = p_student and joined_at > now() - interval '30 days'),
      'released_grades', (select coalesce(jsonb_agg(jsonb_build_object('assignment', a.title, 'score', g.score,
                             'out_of', a.points_possible, 'feedback', g.feedback, 'released_at', g.released_at)
                             order by g.released_at desc), '[]'::jsonb)
                          from public.grades g join public.submissions s on s.id = g.submission_id
                          join public.assignments a on a.id = s.assignment_id
                          where s.student_id = p_student and g.released_at is not null)),
    -- Screen-time summary: minutes inside managed class sessions only (§2 parent portal).
    'screen_time', jsonb_build_object(
      'managed_minutes_30d', (select round(coalesce(sum(extract(epoch from coalesce(b.ended_at, b.last_heartbeat_at) - b.started_at)), 0) / 60)
                              from public.browser_sessions b where b.student_id = p_student and b.started_at > now() - interval '30 days'),
      'focus_alerts_30d', (select count(*) from public.environment_events e where e.student_id = p_student
                           and e.kind in ('environment_left','domain_blocked','off_task') and e.created_at > now() - interval '30 days')));
end$$;

create or replace function public.parent_children() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'name', u.full_name, 'relation', pl.relation) order by u.full_name), '[]'::jsonb)
  from public.parent_links pl join public.users u on u.id = pl.student_id
  where pl.parent_id = auth.uid() and pl.revoked_at is null and app.is_parent_of(pl.student_id)
$$;

-- ---------------------------------------------------------------------------
-- Retention (§18/§20): learning data and device telemetry have separate clocks.
-- ---------------------------------------------------------------------------
create or replace function app.apply_retention(p_tenant uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_set    public.tenant_settings;
  v_tel    timestamptz;
  v_learn  timestamptz;
  v_counts jsonb := '{}'::jsonb;
  v_n      int;
begin
  select * into v_set from public.tenant_settings where tenant_id = p_tenant;
  if v_set.tenant_id is null then return null; end if;
  v_tel := now() - make_interval(days => v_set.telemetry_retention_days);
  v_learn := now() - make_interval(days => v_set.learning_retention_days);

  delete from public.browser_events where tenant_id = p_tenant and created_at < v_tel; get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('browser_events', v_n);
  delete from public.screen_snapshots where tenant_id = p_tenant and captured_at < v_tel; get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('screen_snapshots', v_n);
  -- Live thumbnails are not kept after the session at all.
  delete from public.screen_snapshots sn using public.class_sessions s
   where sn.class_session_id = s.id and sn.tenant_id = p_tenant and s.status = 'ended' and sn.quality <> 'event';
  delete from public.environment_events where tenant_id = p_tenant and created_at < v_tel; get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('environment_events', v_n);
  delete from public.browser_sessions where tenant_id = p_tenant and started_at < v_tel; get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('browser_sessions', v_n);
  delete from public.teacher_commands where tenant_id = p_tenant and created_at < v_tel;
  delete from public.rtc_signals where tenant_id = p_tenant and created_at < now() - interval '1 day';
  delete from public.device_pairing_codes where tenant_id = p_tenant and expires_at < now() - interval '1 day';

  delete from public.quiz_attempts where tenant_id = p_tenant and started_at < v_learn; get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('quiz_attempts', v_n);
  delete from public.game_sessions where tenant_id = p_tenant and created_at < v_learn;
  delete from public.chat_messages where tenant_id = p_tenant and created_at < v_learn;
  delete from public.notifications where tenant_id = p_tenant and created_at < now() - interval '90 days';

  perform app.audit('retention.applied', 'tenant', p_tenant::text, v_counts, p_tenant, null);
  return v_counts;
end$$;

create or replace function public.apply_retention() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not app.is_admin() then raise exception 'Administrators only.' using errcode = '42501'; end if;
  return app.apply_retention(app.tenant_id());
end$$;

create or replace function app.apply_retention_all() returns void
language plpgsql volatile security definer set search_path = '' as $$
declare r record;
begin
  for r in select tenant_id from public.tenant_settings loop perform app.apply_retention(r.tenant_id); end loop;
end$$;

-- Data export (§20) — everything the school holds about one person.
create or replace function public.export_user_data(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_u public.users;
begin
  select * into v_u from public.users where id = p_user and tenant_id = app.tenant_id();
  if v_u.id is null then raise exception 'User not found.' using errcode = 'P0002'; end if;
  if not (app.is_admin() or p_user = auth.uid()) then raise exception 'Administrators only.' using errcode = '42501'; end if;
  perform app.audit('privacy.export', 'user', p_user::text);
  return jsonb_build_object(
    'exported_at', now(),
    'profile', to_jsonb(v_u),
    'classes', (select coalesce(jsonb_agg(to_jsonb(m)), '[]'::jsonb) from public.class_members m where m.user_id = p_user),
    'attempts', (select coalesce(jsonb_agg(to_jsonb(t) || jsonb_build_object('answers',
                  (select coalesce(jsonb_agg(to_jsonb(a) - 'tenant_id'), '[]'::jsonb) from public.quiz_answers a where a.attempt_id = t.id))), '[]'::jsonb)
                 from public.quiz_attempts t where t.student_id = p_user),
    'submissions', (select coalesce(jsonb_agg(to_jsonb(s) || jsonb_build_object('grade',
                      (select to_jsonb(g) from public.grades g where g.submission_id = s.id and g.released_at is not null))), '[]'::jsonb)
                    from public.submissions s where s.student_id = p_user),
    'attendance', (select coalesce(jsonb_agg(to_jsonb(a)), '[]'::jsonb) from public.attendance a where a.student_id = p_user),
    'games', (select coalesce(jsonb_agg(to_jsonb(p)), '[]'::jsonb) from public.game_players p where p.user_id = p_user),
    'messages', (select coalesce(jsonb_agg(to_jsonb(m)), '[]'::jsonb) from public.chat_messages m where m.sender_id = p_user),
    'devices', (select coalesce(jsonb_agg(to_jsonb(d) - 'secret_hash'), '[]'::jsonb) from public.devices d where d.student_id = p_user),
    'environment_events', (select coalesce(jsonb_agg(to_jsonb(e)), '[]'::jsonb) from public.environment_events e where e.student_id = p_user),
    'browser_events', (select coalesce(jsonb_agg(to_jsonb(b)), '[]'::jsonb) from public.browser_events b where b.student_id = p_user),
    'consents', (select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) from public.consents c where c.user_id = p_user),
    'notifications', (select coalesce(jsonb_agg(to_jsonb(n)), '[]'::jsonb) from public.notifications n where n.user_id = p_user));
end$$;

-- Deletion (§20): removes the tenant profile and cascades. The auth account is
-- deleted by the server route with the service-role key afterwards.
create or replace function public.delete_user_data(p_user uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_u public.users;
begin
  if not app.is_admin() then raise exception 'Administrators only.' using errcode = '42501'; end if;
  select * into v_u from public.users where id = p_user and tenant_id = app.tenant_id();
  if v_u.id is null then raise exception 'User not found.' using errcode = 'P0002'; end if;
  if p_user = auth.uid() then raise exception 'You cannot delete your own account here.' using errcode = 'P0001'; end if;
  if exists (select 1 from public.classes where teacher_id = p_user) then
    raise exception 'Transfer this teacher''s classes before deleting them.' using errcode = 'P0001';
  end if;
  perform app.audit('privacy.delete', 'user', p_user::text, jsonb_build_object('role', v_u.role, 'email', v_u.email));
  update public.devices set student_id = null, status = 'unenrolled' where student_id = p_user;
  delete from public.game_players where user_id = p_user;
  delete from public.chat_messages where sender_id = p_user;
  delete from public.chat_threads where student_id = p_user or teacher_id = p_user;
  delete from public.environment_events where student_id = p_user;
  delete from public.browser_events where student_id = p_user;
  delete from public.browser_sessions where student_id = p_user;
  delete from public.screen_snapshots where student_id = p_user;
  delete from public.teacher_commands where student_id = p_user;
  delete from public.quiz_attempts where student_id = p_user;
  delete from public.submissions where student_id = p_user;
  delete from public.users where id = p_user;
end$$;

-- ---------------------------------------------------------------------------
-- Billing (service role only: called from the verified webhook handler).
-- ---------------------------------------------------------------------------
create or replace function public.billing_apply_subscription(
  p_tenant uuid, p_plan text, p_status text, p_provider text, p_ref text, p_period_end timestamptz
) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.plans where code = p_plan) then raise exception 'Unknown plan.' using errcode = '22023'; end if;
  update public.subscriptions set status = 'canceled'
   where tenant_id = p_tenant and status in ('trialing','active','past_due') and coalesce(provider_ref, '') <> coalesce(p_ref, '');
  insert into public.subscriptions (tenant_id, plan_code, status, provider, provider_ref, current_period_end)
    select p_tenant, p_plan, p_status, p_provider, p_ref, p_period_end
    where not exists (select 1 from public.subscriptions where tenant_id = p_tenant and provider_ref = p_ref);
  update public.subscriptions set plan_code = p_plan, status = p_status, current_period_end = p_period_end
   where tenant_id = p_tenant and provider_ref = p_ref;
  update public.tenants set plan_code = case when p_status in ('active','trialing','past_due') then p_plan else 'free_teacher' end
   where id = p_tenant;
  perform app.audit('billing.subscription', 'tenant', p_tenant::text,
                    jsonb_build_object('plan', p_plan, 'status', p_status, 'provider', p_provider), p_tenant, null);
end$$;

create or replace function public.billing_record_invoice(
  p_tenant uuid, p_amount_cents int, p_currency text, p_status text, p_ref text, p_paid_at timestamptz
) returns void
language sql volatile security definer set search_path = '' as $$
  insert into public.invoices (tenant_id, subscription_id, amount_cents, currency, status, provider_ref, paid_at)
  values (p_tenant, (select id from public.subscriptions where tenant_id = p_tenant and status in ('trialing','active','past_due') limit 1),
          p_amount_cents, upper(p_currency), p_status, p_ref, p_paid_at)
  on conflict (provider_ref) do update set status = excluded.status, paid_at = excluded.paid_at
$$;

-- ---------------------------------------------------------------------------
-- Scheduled retention via pg_cron when the project has it (optional).
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    begin
      create extension if not exists pg_cron;
      perform cron.schedule('swiftcipher-retention', '17 3 * * *', 'select app.apply_retention_all()');
    exception when others then
      raise notice 'pg_cron not enabled (%); run app.apply_retention_all() from a scheduler instead.', sqlerrm;
    end;
  end if;
end$$;

-- ---------------------------------------------------------------------------
-- Function privileges: nothing is callable by anon except the device agent
-- entry points; billing mutators are service-role only.
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema app from public, anon;
grant execute on all functions in schema public to authenticated, service_role;
grant execute on all functions in schema app to authenticated, service_role;
grant execute on function public.device_pair(text, text, text, text, text) to anon;
grant execute on function public.device_heartbeat(uuid, text, text, text, int, text, text, text) to anon;
grant execute on function public.device_event(uuid, text, text, text, text, int, text, text) to anon;
grant execute on function public.device_snapshot(uuid, text, text, int, int, text, text) to anon;
grant execute on function public.device_command_ack(uuid, text, uuid, boolean, text) to anon;
grant execute on function public.device_status(uuid, text) to anon;
revoke execute on function public.billing_apply_subscription(uuid, text, text, text, text, timestamptz) from authenticated;
revoke execute on function public.billing_record_invoice(uuid, int, text, text, text, timestamptz) from authenticated;
revoke execute on function app.apply_retention(uuid) from authenticated;
revoke execute on function app.apply_retention_all() from authenticated;
-- Future functions follow the same default.
alter default privileges in schema public revoke execute on functions from public, anon;

-- >>>>>>>>>>>>>>>>>>>> 20260901000660_ui_support.sql >>>>>>>>>>>>>>>>>>>>
-- =============================================================================
-- SwiftCipher — 0660 small read helpers used by the web UI
-- =============================================================================

create or replace function public.class_access(p_class uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('manage', app.can_manage_class(p_class), 'member', app.in_class(p_class))
$$;

-- Classes the caller can teach (for pickers), with student counts.
create or replace function public.my_teaching_classes() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'subject', c.subject,
           'students', (select count(*) from public.class_members m where m.class_id = c.id and m.role = 'student'))
         order by c.name), '[]'::jsonb)
  from public.classes c where c.archived_at is null and app.can_manage_class(c.id)
$$;

-- Student home: classes, live sessions, open games, assignments, feedback.
create or replace function public.student_home() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_me public.users := app.me();
begin
  return jsonb_build_object(
    'classes', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'subject', c.subject,
                  'teacher', (select full_name from public.users where id = c.teacher_id), 'teacher_id', c.teacher_id)
                  order by c.name), '[]'::jsonb)
                from public.class_members m join public.classes c on c.id = m.class_id
                where m.user_id = v_me.id and m.role = 'student' and c.archived_at is null),
    'live', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'title', s.title, 'class', c.name,
               'environment_active', s.environment_active, 'started_at', s.started_at)), '[]'::jsonb)
             from public.class_sessions s join public.classes c on c.id = s.class_id
             where s.status = 'live' and app.in_class(s.class_id)),
    'games', (select coalesce(jsonb_agg(jsonb_build_object('id', g.id, 'title', g.title, 'join_code', g.join_code,
               'status', g.status, 'class', c.name)), '[]'::jsonb)
              from public.game_sessions g join public.classes c on c.id = g.class_id
              where g.status <> 'ended' and app.in_class(g.class_id)),
    'assignments', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'title', a.title, 'due_at', a.due_at,
                      'class', c.name, 'activity_id', a.activity_id, 'points_possible', a.points_possible,
                      'submitted', exists (select 1 from public.submissions s where s.assignment_id = a.id and s.student_id = v_me.id),
                      'late_allowed', a.allow_late) order by a.due_at nulls last), '[]'::jsonb)
                    from public.assignments a join public.classes c on c.id = a.class_id
                    where a.status = 'published' and app.in_class(a.class_id)),
    'feedback', (select coalesce(jsonb_agg(x order by x ->> 'at' desc), '[]'::jsonb) from (
        select jsonb_build_object('kind', 'grade', 'title', a.title, 'score', g.score, 'out_of', a.points_possible,
               'feedback', g.feedback, 'at', g.released_at) x
        from public.grades g join public.submissions s on s.id = g.submission_id join public.assignments a on a.id = s.assignment_id
        where s.student_id = v_me.id and g.released_at is not null
        union all
        select jsonb_build_object('kind', 'review', 'title', act.title, 'score', qa.manual_score, 'out_of', q.points,
               'feedback', qa.feedback, 'at', qa.reviewed_at)
        from public.quiz_answers qa join public.quiz_attempts t on t.id = qa.attempt_id
        join public.activities act on act.id = t.activity_id join public.questions q on q.id = qa.question_id
        where t.student_id = v_me.id and qa.status = 'reviewed'
        limit 20) f),
    'scores', (select coalesce(jsonb_agg(jsonb_build_object('activity', act.title, 'score', t.score, 'max', t.max_score,
                 'status', t.status, 'at', t.submitted_at) order by t.submitted_at desc), '[]'::jsonb)
               from (select * from public.quiz_attempts where student_id = v_me.id and status <> 'in_progress'
                     order by submitted_at desc limit 10) t join public.activities act on act.id = t.activity_id),
    'devices', (select count(*) from public.devices where student_id = v_me.id and status = 'active'));
end$$;

revoke execute on function public.class_access(uuid), public.my_teaching_classes(), public.student_home() from public, anon;
grant execute on function public.class_access(uuid), public.my_teaching_classes(), public.student_home() to authenticated;

-- >>>>>>>>>>>>>>>>>>>> 20260901000670_realtime_auth.sql >>>>>>>>>>>>>>>>>>>>
-- =============================================================================
-- SwiftCipher — 0670 private Realtime broadcast channels
-- Topic "annot:<session_id>": the session's teacher may send; anyone in the
-- class may listen. Skipped where the realtime schema is absent (tests).
-- =============================================================================
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'realtime' and table_name = 'messages') then
    execute $p$
      create policy "session annotations: class can listen" on realtime.messages for select to authenticated
      using (
        realtime.topic() like 'annot:%'
        and (app.in_session(nullif(split_part(realtime.topic(), ':', 2), '')::uuid)
             or app.can_manage_session(nullif(split_part(realtime.topic(), ':', 2), '')::uuid))
      )$p$;
    execute $p$
      create policy "session annotations: teacher can send" on realtime.messages for insert to authenticated
      with check (
        realtime.topic() like 'annot:%'
        and app.can_manage_session(nullif(split_part(realtime.topic(), ':', 2), '')::uuid)
      )$p$;
  end if;
end$$;

-- >>>>>>>>>>>>>>>>>>>> 20260901000680_audit_triggers.sql >>>>>>>>>>>>>>>>>>>>
-- =============================================================================
-- SwiftCipher — 0680 audit triggers for tables edited directly under RLS
-- (§20: audit logs for policy changes; §19 feature flags; roster changes).
-- =============================================================================

create or replace function app.audit_row_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_row  jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  v_meta jsonb;
begin
  v_meta := jsonb_build_object('op', lower(tg_op));
  if tg_op = 'UPDATE' then
    v_meta := v_meta || jsonb_build_object('changed',
      (select coalesce(jsonb_object_agg(k, to_jsonb(new) -> k), '{}'::jsonb)
       from jsonb_object_keys(to_jsonb(new)) k
       where k not in ('updated_at') and to_jsonb(old) -> k is distinct from to_jsonb(new) -> k));
  elsif tg_op = 'INSERT' then
    v_meta := v_meta || jsonb_build_object('row', v_row - 'secret_hash');
  end if;
  perform app.audit(tg_table_name || '.' || lower(tg_op), tg_table_name,
                    coalesce(v_row ->> 'id', v_row ->> 'user_id'), v_meta,
                    (v_row ->> 'tenant_id')::uuid, auth.uid());
  return null;
end$$;

create trigger environment_policies_audit after insert or update or delete on public.environment_policies
  for each row execute function app.audit_row_change();
create trigger scenes_audit after insert or update or delete on public.scenes
  for each row execute function app.audit_row_change();
create trigger feature_flags_audit after insert or update or delete on public.feature_flags
  for each row execute function app.audit_row_change();
create trigger class_members_audit after insert or delete on public.class_members
  for each row execute function app.audit_row_change();
create trigger parent_links_audit after insert or update on public.parent_links
  for each row execute function app.audit_row_change();

-- >>>>>>>>>>>>>>>>>>>> 20260901000700_realtime_storage.sql >>>>>>>>>>>>>>>>>>>>
-- =============================================================================
-- SwiftCipher — 0700 realtime channels + storage buckets
-- Realtime postgres_changes respects RLS, so subscribers only receive rows
-- they are allowed to select.
-- =============================================================================

do $$
declare t text;
begin
  foreach t in array array[
    'class_sessions','session_participants','announcements','chat_messages','raise_hands',
    'environment_events','spotlights','browser_sessions','teacher_commands','notifications',
    'game_sessions','game_players','collab_posts','quiz_answers','rtc_signals']
  loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
                   and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end$$;

-- ---------- Buckets ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('lesson-media', 'lesson-media', false, 524288000,
    array['image/png','image/jpeg','image/gif','image/webp','image/svg+xml','video/mp4','video/webm',
          'audio/mpeg','audio/ogg','audio/wav','audio/webm','application/pdf','text/vtt',
          'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document']),
  ('submissions', 'submissions', false, 52428800, null)
on conflict (id) do nothing;

-- lesson-media/<tenant_id>/<owner_id>/<file>: tenant members read, staff write their own folder.
create policy "lesson media read" on storage.objects for select to authenticated
  using (bucket_id = 'lesson-media' and (storage.foldername(name))[1] = (select app.tenant_id())::text);
create policy "lesson media write" on storage.objects for insert to authenticated
  with check (bucket_id = 'lesson-media' and (select app.is_teacher())
              and (storage.foldername(name))[1] = (select app.tenant_id())::text
              and (storage.foldername(name))[2] = (select auth.uid())::text);
create policy "lesson media delete" on storage.objects for delete to authenticated
  using (bucket_id = 'lesson-media' and (storage.foldername(name))[1] = (select app.tenant_id())::text
         and ((storage.foldername(name))[2] = (select auth.uid())::text or (select app.is_admin())));

-- submissions/<tenant_id>/<student_id>/<assignment_id | attempt_id>/<file>
create policy "submission read" on storage.objects for select to authenticated
  using (bucket_id = 'submissions' and (storage.foldername(name))[1] = (select app.tenant_id())::text
         and ((storage.foldername(name))[2] = (select auth.uid())::text
              or app.teaches_student(((storage.foldername(name))[2])::uuid)
              or (select app.is_admin())));
create policy "submission write" on storage.objects for insert to authenticated
  with check (bucket_id = 'submissions' and (storage.foldername(name))[1] = (select app.tenant_id())::text
              and (storage.foldername(name))[2] = (select auth.uid())::text
              and (exists (select 1 from public.assignments a where a.id::text = (storage.foldername(name))[3]
                           and app.in_class(a.class_id))
                   or exists (select 1 from public.quiz_attempts t where t.id::text = (storage.foldername(name))[3]
                              and t.student_id = (select auth.uid()) and t.status = 'in_progress')));

-- >>>>>>>>>>>>>>>>>>>> 20260901000710_super_admin.sql >>>>>>>>>>>>>>>>>>>>
-- =============================================================================
-- SwiftCipher — 0710 platform super admin + tenant suspension
--
-- * Exactly ONE super admin may exist (singleton table). It can only be
--   assigned with the service role / SQL editor — no RPC grants it, and no
--   tenant user can read who it is.
-- * The super admin manages every tenant: create, rename, change plan,
--   suspend/restore, delete; and every user: role, suspend/restore, delete.
-- * Tenants see platform actions in their audit log as "platform.*" without
--   the operator's identity; the full trail is in platform_audit (super admin only).
-- =============================================================================

-- ---------- Tenant status ----------
alter table public.tenants add column if not exists status text not null default 'active'
  check (status in ('active','suspended'));
alter table public.tenants add column if not exists suspended_at timestamptz;
alter table public.tenants add column if not exists suspended_reason text;

-- A suspended tenant behaves as if nobody in it is signed in.
create or replace function app.tenant_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select u.tenant_id from public.users u join public.tenants t on t.id = u.tenant_id
  where u.id = auth.uid() and u.status = 'active' and t.status = 'active'
$$;

create or replace function app.role() returns text
language sql stable security definer set search_path = '' as $$
  select u.role from public.users u join public.tenants t on t.id = u.tenant_id
  where u.id = auth.uid() and u.status = 'active' and t.status = 'active'
$$;

create or replace function app.me() returns public.users
language plpgsql stable security definer set search_path = '' as $$
declare v public.users; v_tstatus text;
begin
  select u.* into v from public.users u where u.id = auth.uid() and u.status = 'active';
  if v.id is null then
    raise exception 'You need an active SwiftCipher profile for this action.' using errcode = '42501';
  end if;
  select status into v_tstatus from public.tenants where id = v.tenant_id;
  if v_tstatus <> 'active' then
    raise exception 'Your school''s SwiftCipher account is suspended. Contact SwiftCipher support.' using errcode = '42501';
  end if;
  return v;
end$$;

-- Devices of a suspended school stop working too.
create or replace function app.device_auth(p_device uuid, p_secret text) returns public.devices
language plpgsql volatile security definer set search_path = '' as $$
declare v public.devices;
begin
  select * into v from public.devices where id = p_device;
  if v.id is null or v.secret_hash <> app.hash_secret(p_secret) then
    raise exception 'Invalid device credentials.' using errcode = '28000';
  end if;
  if v.status <> 'active' then
    raise exception 'This device has been %.', v.status using errcode = '28000';
  end if;
  if (select status from public.tenants where id = v.tenant_id) <> 'active' then
    raise exception 'This school is suspended.' using errcode = '28000';
  end if;
  return v;
end$$;

-- ---------- The super admin (singleton) ----------
create table if not exists public.platform_admins (
  singleton   boolean primary key default true check (singleton),
  user_id     uuid not null unique references auth.users(id) on delete cascade,
  assigned_at timestamptz not null default now()
);
alter table public.platform_admins enable row level security;
revoke all on public.platform_admins from anon, authenticated;
-- No policies: invisible to every client role. Only the service role (or the
-- SQL editor) can assign it:  insert into public.platform_admins (user_id) values ('<auth user id>');

create table if not exists public.platform_audit (
  id          bigint generated always as identity primary key,
  actor_id    uuid,
  action      text not null,
  tenant_id   uuid,
  target_type text,
  target_id   text,
  meta        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
alter table public.platform_audit enable row level security;
revoke all on public.platform_audit from anon, authenticated;

create or replace function app.is_super_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (select 1 from public.platform_admins where user_id = auth.uid())
$$;

-- Only ever answers about the caller.
create or replace function public.am_super_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select app.is_super_admin()
$$;

create or replace function app.sa_require() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.is_super_admin() then raise exception 'Not found.' using errcode = 'P0002'; end if;
end$$;

create or replace function app.sa_log(p_action text, p_tenant uuid, p_target_type text, p_target_id text, p_meta jsonb default '{}'::jsonb)
returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  insert into public.platform_audit (actor_id, action, tenant_id, target_type, target_id, meta)
    values (auth.uid(), p_action, p_tenant, p_target_type, p_target_id, coalesce(p_meta, '{}'::jsonb));
  if p_tenant is not null and exists (select 1 from public.tenants where id = p_tenant) then
    insert into public.audit_logs (tenant_id, actor_id, action, target_type, target_id, meta)
      values (p_tenant, null, 'platform.' || p_action, p_target_type, p_target_id, coalesce(p_meta, '{}'::jsonb));
  end if;
end$$;

-- Invites created by the platform have no tenant-side author.
alter table public.invites alter column created_by drop not null;

-- ---------- Shared user purge (used by tenant admins and the super admin) ----------
create or replace function app.purge_user(p_user uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  if exists (select 1 from public.classes where teacher_id = p_user) then
    raise exception 'Transfer this teacher''s classes before deleting them.' using errcode = 'P0001';
  end if;
  update public.devices set student_id = null, status = 'unenrolled' where student_id = p_user;
  delete from public.game_players where user_id = p_user;
  delete from public.chat_messages where sender_id = p_user;
  delete from public.chat_threads where student_id = p_user or teacher_id = p_user;
  delete from public.environment_events where student_id = p_user;
  delete from public.browser_events where student_id = p_user;
  delete from public.browser_sessions where student_id = p_user;
  delete from public.screen_snapshots where student_id = p_user;
  delete from public.teacher_commands where student_id = p_user;
  delete from public.quiz_attempts where student_id = p_user;
  delete from public.submissions where student_id = p_user;
  delete from public.users where id = p_user;
end$$;

create or replace function public.delete_user_data(p_user uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_u public.users;
begin
  if not app.is_admin() then raise exception 'Administrators only.' using errcode = '42501'; end if;
  select * into v_u from public.users where id = p_user and tenant_id = app.tenant_id();
  if v_u.id is null then raise exception 'User not found.' using errcode = 'P0002'; end if;
  if p_user = auth.uid() then raise exception 'You cannot delete your own account here.' using errcode = 'P0001'; end if;
  perform app.audit('privacy.delete', 'user', p_user::text, jsonb_build_object('role', v_u.role, 'email', v_u.email));
  perform app.purge_user(p_user);
end$$;

-- ---------- me(): adds super-admin flag (self only) and tenant status ----------
create or replace function public.me() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_user public.users;
  v_out  jsonb;
begin
  if auth.uid() is null then return null; end if;
  select * into v_user from public.users where id = auth.uid();
  if v_user.id is null then
    return jsonb_build_object('profile', null, 'super_admin', app.is_super_admin(),
      'email', (select email from auth.users where id = auth.uid()));
  end if;
  select jsonb_build_object(
    'profile', jsonb_build_object('id', v_user.id, 'tenant_id', v_user.tenant_id, 'email', v_user.email,
                                  'full_name', v_user.full_name, 'nickname', v_user.nickname,
                                  'role', v_user.role, 'status', v_user.status),
    'tenant', jsonb_build_object('id', t.id, 'name', t.name, 'slug', t.slug, 'plan_code', t.plan_code,
                                 'timezone', t.timezone, 'status', t.status),
    'plan', jsonb_build_object('code', p.code, 'name', p.name, 'limits', p.limits, 'features', p.features),
    'settings', to_jsonb(ts) - 'tenant_id',
    'monitoring_consent', exists (select 1 from public.consents c where c.user_id = v_user.id
                                  and c.kind = 'monitoring_notice' and c.version = ts.monitoring_notice_version),
    'unread_notifications', (select count(*) from public.notifications n
                             where n.user_id = v_user.id and n.read_at is null),
    'super_admin', app.is_super_admin()
  ) into v_out
  from public.tenants t
  join public.plans p on p.code = t.plan_code
  join public.tenant_settings ts on ts.tenant_id = t.id
  where t.id = v_user.tenant_id;
  return v_out;
end$$;

-- ---------- Super admin RPCs ----------
create or replace function public.sa_overview() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.sa_require();
  return jsonb_build_object(
    'tenants', (select count(*) from public.tenants),
    'tenants_suspended', (select count(*) from public.tenants where status = 'suspended'),
    'users', (select count(*) from public.users),
    'users_suspended', (select count(*) from public.users where status = 'suspended'),
    'by_role', (select coalesce(jsonb_object_agg(role, n), '{}'::jsonb) from (select role, count(*) n from public.users group by role) r),
    'devices', (select count(*) from public.devices where status = 'active'),
    'devices_online', (select count(*) from public.devices where status = 'active' and last_seen_at > now() - interval '45 seconds'),
    'live_sessions', (select count(*) from public.class_sessions where status = 'live'),
    'sessions_30d', (select count(*) from public.class_sessions where created_at > now() - interval '30 days'),
    'by_plan', (select coalesce(jsonb_object_agg(plan_code, n), '{}'::jsonb) from (select plan_code, count(*) n from public.tenants group by plan_code) p));
end$$;

create or replace function public.sa_list_tenants(p_search text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.sa_require();
  return (select coalesce(jsonb_agg(row order by row ->> 'created_at' desc), '[]'::jsonb) from (
    select jsonb_build_object(
      'id', t.id, 'name', t.name, 'slug', t.slug, 'plan_code', t.plan_code, 'status', t.status, 'country', t.country,
      'created_at', t.created_at, 'suspended_at', t.suspended_at, 'suspended_reason', t.suspended_reason,
      'users', (select count(*) from public.users u where u.tenant_id = t.id),
      'students', (select count(*) from public.users u where u.tenant_id = t.id and u.role = 'student'),
      'staff', (select count(*) from public.users u where u.tenant_id = t.id and u.role in ('teacher','school_admin','it_admin')),
      'classes', (select count(*) from public.classes c where c.tenant_id = t.id),
      'devices', (select count(*) from public.devices d where d.tenant_id = t.id and d.status = 'active'),
      'last_session_at', (select max(s.created_at) from public.class_sessions s where s.tenant_id = t.id)) as row
    from public.tenants t
    where p_search is null or t.name ilike '%' || p_search || '%' or t.slug ilike '%' || p_search || '%'
    limit 500) x);
end$$;

create or replace function public.sa_tenant_detail(p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v public.tenants;
begin
  perform app.sa_require();
  select * into v from public.tenants where id = p_tenant;
  if v.id is null then raise exception 'School not found.' using errcode = 'P0002'; end if;
  return jsonb_build_object(
    'tenant', to_jsonb(v),
    'settings', (select to_jsonb(ts) - 'tenant_id' from public.tenant_settings ts where ts.tenant_id = p_tenant),
    'subscription', (select to_jsonb(s) from public.subscriptions s where s.tenant_id = p_tenant order by s.created_at desc limit 1),
    'usage', jsonb_build_object(
      'classes', (select count(*) from public.classes where tenant_id = p_tenant),
      'lessons', (select count(*) from public.lessons where tenant_id = p_tenant),
      'devices', (select count(*) from public.devices where tenant_id = p_tenant and status = 'active'),
      'sessions_30d', (select count(*) from public.class_sessions where tenant_id = p_tenant and created_at > now() - interval '30 days')),
    'users', (select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'full_name', u.full_name, 'email', u.email, 'role', u.role,
                'status', u.status, 'created_at', u.created_at) order by u.role, u.full_name), '[]'::jsonb)
              from public.users u where u.tenant_id = p_tenant),
    'invites', (select coalesce(jsonb_agg(jsonb_build_object('code', i.code, 'role', i.role, 'email', i.email, 'uses', i.uses,
                  'max_uses', i.max_uses, 'expires_at', i.expires_at, 'revoked_at', i.revoked_at) order by i.created_at desc), '[]'::jsonb)
                from public.invites i where i.tenant_id = p_tenant and i.role in ('school_admin','teacher','it_admin')));
end$$;

create or replace function public.sa_create_tenant(
  p_name text, p_plan text default 'free_teacher', p_country text default null, p_admin_email text default null
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_tenant uuid; v_slug text; v_code text;
begin
  perform app.sa_require();
  if length(btrim(coalesce(p_name, ''))) = 0 then raise exception 'School name is required.' using errcode = '22023'; end if;
  if not exists (select 1 from public.plans where code = p_plan) then raise exception 'Unknown plan.' using errcode = '22023'; end if;
  v_slug := coalesce(nullif(app.slugify(p_name), ''), 'school');
  if length(v_slug) < 2 then v_slug := 'school'; end if;
  v_slug := v_slug || '-' || lower(app.gen_code(5));
  insert into public.tenants (name, slug, country, plan_code) values (btrim(p_name), v_slug, p_country, p_plan) returning id into v_tenant;
  insert into public.tenant_settings (tenant_id) values (v_tenant);
  insert into public.schools (tenant_id, name) values (v_tenant, btrim(p_name));
  insert into public.subscriptions (tenant_id, plan_code, status, provider) values (v_tenant, p_plan, 'active', 'manual');
  if nullif(btrim(p_admin_email), '') is not null then
    v_code := app.unique_code(10, 'invites');
    insert into public.invites (tenant_id, code, role, email, created_by, max_uses, expires_at)
      values (v_tenant, v_code, 'school_admin', lower(btrim(p_admin_email)), null, 1, now() + interval '30 days');
  end if;
  perform app.sa_log('tenant.created', v_tenant, 'tenant', v_tenant::text, jsonb_build_object('name', p_name, 'plan', p_plan));
  return jsonb_build_object('tenant_id', v_tenant, 'slug', v_slug, 'admin_invite_code', v_code);
end$$;

create or replace function public.sa_update_tenant(
  p_tenant uuid, p_name text default null, p_plan text default null, p_country text default null
) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v public.tenants;
begin
  perform app.sa_require();
  select * into v from public.tenants where id = p_tenant;
  if v.id is null then raise exception 'School not found.' using errcode = 'P0002'; end if;
  if p_plan is not null and not exists (select 1 from public.plans where code = p_plan) then raise exception 'Unknown plan.' using errcode = '22023'; end if;
  update public.tenants set name = coalesce(nullif(btrim(p_name), ''), name), country = coalesce(p_country, country),
                            plan_code = coalesce(p_plan, plan_code)
   where id = p_tenant;
  if p_plan is not null and p_plan <> v.plan_code then
    update public.subscriptions set status = 'canceled' where tenant_id = p_tenant and status in ('trialing','active','past_due');
    insert into public.subscriptions (tenant_id, plan_code, status, provider) values (p_tenant, p_plan, 'active', 'manual');
  end if;
  perform app.sa_log('tenant.updated', p_tenant, 'tenant', p_tenant::text,
                     jsonb_build_object('name', p_name, 'plan', p_plan, 'country', p_country));
end$$;

create or replace function public.sa_set_tenant_status(p_tenant uuid, p_status text, p_reason text default null) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform app.sa_require();
  if p_status not in ('active','suspended') then raise exception 'Unknown status.' using errcode = '22023'; end if;
  update public.tenants set status = p_status,
    suspended_at = case when p_status = 'suspended' then now() end,
    suspended_reason = case when p_status = 'suspended' then nullif(btrim(p_reason), '') end
  where id = p_tenant;
  if not found then raise exception 'School not found.' using errcode = 'P0002'; end if;
  if p_status = 'suspended' then
    update public.class_sessions set status = 'ended', ended_at = now() where tenant_id = p_tenant and status = 'live';
  end if;
  perform app.sa_log(case when p_status = 'suspended' then 'tenant.suspended' else 'tenant.restored' end,
                     p_tenant, 'tenant', p_tenant::text, jsonb_build_object('reason', p_reason));
end$$;

-- Returns the auth user ids so the server can remove the login accounts too.
create or replace function public.sa_delete_tenant(p_tenant uuid, p_confirm_name text) returns uuid[]
language plpgsql volatile security definer set search_path = '' as $$
declare v public.tenants; v_users uuid[];
begin
  perform app.sa_require();
  select * into v from public.tenants where id = p_tenant;
  if v.id is null then raise exception 'School not found.' using errcode = 'P0002'; end if;
  if p_confirm_name is distinct from v.name then raise exception 'Type the school name exactly to confirm.' using errcode = '22023'; end if;
  select coalesce(array_agg(id), '{}') into v_users from public.users where tenant_id = p_tenant and id <> auth.uid();
  perform app.sa_log('tenant.deleted', null, 'tenant', p_tenant::text, jsonb_build_object('name', v.name, 'users', coalesce(array_length(v_users, 1), 0)));
  delete from public.tenants where id = p_tenant;
  return v_users;
end$$;

create or replace function public.sa_list_users(p_search text default null, p_tenant uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.sa_require();
  return (select coalesce(jsonb_agg(row), '[]'::jsonb) from (
    select jsonb_build_object('id', u.id, 'full_name', u.full_name, 'email', u.email, 'role', u.role, 'status', u.status,
             'created_at', u.created_at, 'tenant_id', t.id, 'tenant', t.name, 'tenant_status', t.status) as row
    from public.users u join public.tenants t on t.id = u.tenant_id
    where (p_tenant is null or u.tenant_id = p_tenant)
      and (p_search is null or u.full_name ilike '%' || p_search || '%' or u.email ilike '%' || p_search || '%')
    order by u.created_at desc limit 500) x);
end$$;

create or replace function public.sa_set_user_status(p_user uuid, p_status text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_tenant uuid;
begin
  perform app.sa_require();
  if p_status not in ('active','suspended') then raise exception 'Unknown status.' using errcode = '22023'; end if;
  if p_user = auth.uid() then raise exception 'You cannot suspend yourself.' using errcode = 'P0001'; end if;
  update public.users set status = p_status where id = p_user returning tenant_id into v_tenant;
  if v_tenant is null then raise exception 'User not found.' using errcode = 'P0002'; end if;
  perform app.sa_log(case when p_status = 'suspended' then 'user.suspended' else 'user.restored' end, v_tenant, 'user', p_user::text);
end$$;

create or replace function public.sa_set_user_role(p_user uuid, p_role text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_tenant uuid; v_old text;
begin
  perform app.sa_require();
  if p_role not in ('student','teacher','it_admin','school_admin','parent') then raise exception 'Unknown role.' using errcode = '22023'; end if;
  select tenant_id, role into v_tenant, v_old from public.users where id = p_user;
  if v_tenant is null then raise exception 'User not found.' using errcode = 'P0002'; end if;
  update public.users set role = p_role where id = p_user;
  perform app.sa_log('user.role_changed', v_tenant, 'user', p_user::text, jsonb_build_object('from', v_old, 'to', p_role));
end$$;

create or replace function public.sa_delete_user(p_user uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v public.users;
begin
  perform app.sa_require();
  if p_user = auth.uid() then raise exception 'You cannot delete yourself.' using errcode = 'P0001'; end if;
  select * into v from public.users where id = p_user;
  if v.id is null then raise exception 'User not found.' using errcode = 'P0002'; end if;
  perform app.sa_log('user.deleted', v.tenant_id, 'user', p_user::text, jsonb_build_object('role', v.role));
  perform app.purge_user(p_user);
end$$;

create or replace function public.sa_invite_admin(p_tenant uuid, p_email text, p_role text default 'school_admin') returns text
language plpgsql volatile security definer set search_path = '' as $$
declare v_code text;
begin
  perform app.sa_require();
  if p_role not in ('school_admin','teacher','it_admin') then raise exception 'Unknown role.' using errcode = '22023'; end if;
  if not exists (select 1 from public.tenants where id = p_tenant) then raise exception 'School not found.' using errcode = 'P0002'; end if;
  v_code := app.unique_code(10, 'invites');
  insert into public.invites (tenant_id, code, role, email, created_by, max_uses, expires_at)
    values (p_tenant, v_code, p_role, nullif(lower(btrim(p_email)), ''), null, 1, now() + interval '30 days');
  perform app.sa_log('invite.created', p_tenant, 'invite', v_code, jsonb_build_object('role', p_role));
  return v_code;
end$$;

create or replace function public.sa_audit(p_limit int default 200) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.sa_require();
  return (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'action', a.action, 'tenant', t.name, 'tenant_id', a.tenant_id,
            'target_type', a.target_type, 'target_id', a.target_id, 'meta', a.meta, 'created_at', a.created_at) order by a.id desc), '[]'::jsonb)
          from (select * from public.platform_audit order by id desc limit least(greatest(p_limit, 1), 1000)) a
          left join public.tenants t on t.id = a.tenant_id);
end$$;

-- ---------- Teacher-only focused screen view ----------
-- The best recent frame for ONE student, for the teacher's own screen only
-- (does not spotlight or change anything students see).
create or replace function public.session_screen(p_session uuid, p_student uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_s public.class_sessions; v_interval int;
begin
  select * into v_s from public.class_sessions where id = p_session;
  if v_s.id is null or not app.can_manage_class(v_s.class_id) then raise exception 'Session not found.' using errcode = 'P0002'; end if;
  select thumbnail_interval_seconds into v_interval from public.tenant_settings where tenant_id = v_s.tenant_id;
  return (select jsonb_build_object('image', sn.image_data, 'captured_at', sn.captured_at, 'url', sn.url, 'quality', sn.quality,
                   'stale', sn.captured_at < now() - make_interval(secs => greatest(v_interval * 3, 60)))
          from public.screen_snapshots sn
          where sn.class_session_id = p_session and sn.student_id = p_student and sn.quality in ('spotlight','thumbnail')
          order by sn.captured_at desc limit 1);
end$$;

-- Audit a teacher's screen request at most once a minute per student.
create or replace function public.request_screenshot(p_session uuid, p_student uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_s public.class_sessions := app.require_live_session(p_session); v_prev timestamptz;
begin
  if not (select allow_screen_capture from public.tenant_settings where tenant_id = v_s.tenant_id) then
    raise exception 'Screen capture is disabled by your school.' using errcode = 'P0001';
  end if;
  select max(snapshot_requested_at) into v_prev from public.browser_sessions where class_session_id = p_session and student_id = p_student;
  update public.browser_sessions set snapshot_requested_at = now()
   where class_session_id = p_session and student_id = p_student
     and (snapshot_requested_at is null or snapshot_requested_at < now() - interval '3 seconds');
  if v_prev is null or v_prev < now() - interval '60 seconds' then
    perform app.audit('screen.viewed', 'user', p_student::text, jsonb_build_object('session_id', p_session));
  end if;
end$$;

-- ---------- Privileges ----------
revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema app from public, anon;
grant execute on all functions in schema public to authenticated, service_role;
grant execute on all functions in schema app to authenticated, service_role;
grant execute on function public.device_pair(text, text, text, text, text) to anon;
grant execute on function public.device_heartbeat(uuid, text, text, text, int, text, text, text) to anon;
grant execute on function public.device_event(uuid, text, text, text, text, int, text, text) to anon;
grant execute on function public.device_snapshot(uuid, text, text, int, int, text, text) to anon;
grant execute on function public.device_command_ack(uuid, text, uuid, boolean, text) to anon;
grant execute on function public.device_status(uuid, text) to anon;
revoke execute on function public.billing_apply_subscription(uuid, text, text, text, text, timestamptz) from authenticated;
revoke execute on function public.billing_record_invoice(uuid, int, text, text, text, timestamptz) from authenticated;
revoke execute on function app.apply_retention(uuid) from authenticated;
revoke execute on function app.apply_retention_all() from authenticated;

-- >>>>>>>>>>>>>>>>>>>> 20260901000720_branding.sql >>>>>>>>>>>>>>>>>>>>
-- =============================================================================
-- SwiftCipher — 0720 per-school branding (tenant admins customise their pages)
-- =============================================================================
alter table public.tenant_settings
  add column if not exists brand_name      text check (brand_name is null or length(btrim(brand_name)) between 1 and 80),
  add column if not exists brand_logo_path text check (brand_logo_path is null or length(brand_logo_path) <= 400),
  add column if not exists brand_primary   text check (brand_primary is null or brand_primary ~ '^#[0-9a-fA-F]{6}$'),
  add column if not exists brand_accent    text check (brand_accent is null or brand_accent ~ '^#[0-9a-fA-F]{6}$'),
  add column if not exists welcome_message text check (welcome_message is null or length(welcome_message) <= 500);

-- The logo must live in this tenant's own media folder.
alter table public.tenant_settings add constraint tenant_settings_logo_in_tenant
  check (brand_logo_path is null or brand_logo_path like tenant_id::text || '/%');

grant update (brand_name, brand_logo_path, brand_primary, brand_accent, welcome_message)
  on public.tenant_settings to authenticated;

-- >>>>>>>>>>>>>>>>>>>> 20260901000730_deferred_fks.sql >>>>>>>>>>>>>>>>>>>>
-- =============================================================================
-- SwiftCipher — 0730 make "no action" foreign keys deferred
--
-- Deleting a school cascades to its users AND (via lessons) to activities etc.
-- Postgres checks NO ACTION references while the cascades are still running,
-- so e.g. activities.owner_id -> users failed even though the activity was
-- about to be deleted too. Checking these at commit time fixes the ordering;
-- integrity is unchanged (a dangling reference still aborts the transaction).
-- =============================================================================
-- Every tenant-owned table gets a direct ON DELETE CASCADE link to its school,
-- so deleting a school can never leave orphaned rows (e.g. environment
-- policies were only linked through their owner). platform_audit keeps its
-- history on purpose.
do $$
declare r record;
begin
  for r in
    select c.table_name
    from information_schema.columns c
    join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
    where c.table_schema = 'public' and c.column_name = 'tenant_id'
      and c.table_name not in ('tenants', 'platform_audit')
      and not exists (
        select 1 from pg_constraint k
        where k.conrelid = format('public.%I', c.table_name)::regclass and k.contype = 'f'
          and k.confrelid = 'public.tenants'::regclass
          and k.conkey = array[(select attnum from pg_attribute where attrelid = format('public.%I', c.table_name)::regclass and attname = 'tenant_id')]::smallint[])
  loop
    execute format('alter table public.%I add constraint %I foreign key (tenant_id) references public.tenants(id) on delete cascade',
                   r.table_name, r.table_name || '_tenant_cascade_fkey');
  end loop;
end$$;

do $$
declare r record;
begin
  for r in
    select c.conname, c.conrelid::regclass as tbl
    from pg_constraint c
    join pg_namespace n on n.oid = c.connamespace
    where n.nspname = 'public' and c.contype = 'f'
      and c.confdeltype = 'a'            -- ON DELETE NO ACTION
      and not c.condeferrable
  loop
    execute format('alter table %s alter constraint %I deferrable initially deferred', r.tbl, r.conname);
  end loop;
end$$;

-- While a school is being deleted, its rows' delete triggers must not try to
-- write audit entries for that (already removed) school.
create or replace function app.audit(
  p_action text, p_target_type text default null, p_target_id text default null,
  p_meta jsonb default '{}'::jsonb, p_tenant uuid default null, p_actor uuid default null
) returns void
language sql volatile security definer set search_path = '' as $$
  insert into public.audit_logs (tenant_id, actor_id, action, target_type, target_id, meta)
  select t.tenant_id, coalesce(p_actor, auth.uid()), p_action, p_target_type, p_target_id, coalesce(p_meta, '{}'::jsonb)
  from (select coalesce(p_tenant, app.tenant_id()) as tenant_id) t
  where t.tenant_id is null or exists (select 1 from public.tenants x where x.id = t.tenant_id)
$$;

create or replace function app.audit_row_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_row  jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  v_meta jsonb;
begin
  if not exists (select 1 from public.tenants where id = (v_row ->> 'tenant_id')::uuid) then
    return null;  -- the whole school is being deleted
  end if;
  v_meta := jsonb_build_object('op', lower(tg_op));
  if tg_op = 'UPDATE' then
    v_meta := v_meta || jsonb_build_object('changed',
      (select coalesce(jsonb_object_agg(k, to_jsonb(new) -> k), '{}'::jsonb)
       from jsonb_object_keys(to_jsonb(new)) k
       where k not in ('updated_at') and to_jsonb(old) -> k is distinct from to_jsonb(new) -> k));
  elsif tg_op = 'INSERT' then
    v_meta := v_meta || jsonb_build_object('row', v_row - 'secret_hash');
  end if;
  perform app.audit(tg_table_name || '.' || lower(tg_op), tg_table_name,
                    coalesce(v_row ->> 'id', v_row ->> 'user_id'), v_meta,
                    (v_row ->> 'tenant_id')::uuid, auth.uid());
  return null;
end$$;

-- >>>>>>>>>>>>>>>>>>>> 20260901000740_web_screens.sql >>>>>>>>>>>>>>>>>>>>
-- =============================================================================
-- SwiftCipher — 0740 screens and leave detection from the website itself
--
-- Without the extension, a student's lesson page can (with the student's
-- permission, which browsers always require) share their entire screen and
-- report when they leave the lesson: switching tab or app, minimising,
-- leaving full screen, or stopping the share. Under "lockdown" (on by
-- default) that counts as leaving the class: after the grace period the
-- teacher is notified, and the alert carries the student's screen.
-- =============================================================================

-- ---------- Schema ----------
alter table public.screen_snapshots alter column device_id drop not null;
alter table public.screen_snapshots add column if not exists source text not null default 'extension'
  check (source in ('extension','web'));
drop index if exists public.screen_snapshots_latest_uidx;
-- Keep only the newest latest-frame row per student before tightening the key.
delete from public.screen_snapshots a using public.screen_snapshots b
 where a.quality <> 'event' and b.quality = a.quality and b.class_session_id = a.class_session_id
   and b.student_id = a.student_id and b.source = a.source
   and (b.captured_at, b.id) > (a.captured_at, a.id);
create unique index screen_snapshots_latest_uidx
  on public.screen_snapshots(class_session_id, student_id, quality, source) where quality <> 'event';

alter table public.environment_events add column if not exists evidence_image text
  check (evidence_image is null or (evidence_image like 'data:image/%' and length(evidence_image) <= 400000));

alter table public.session_participants
  add column if not exists tab_visible       boolean not null default true,
  add column if not exists fullscreen        boolean not null default false,
  add column if not exists screen_sharing    boolean not null default false,
  add column if not exists share_unsupported boolean not null default false,
  add column if not exists screen_surface    text,
  add column if not exists away_since        timestamptz,
  add column if not exists away_reason       text,
  add column if not exists hq_requested_at   timestamptz,
  -- first moment the student was fully "in class" (sharing + full screen + lesson in front)
  add column if not exists ready_at          timestamptz;

alter table public.class_sessions add column if not exists lockdown boolean not null default true;

-- ---------- Helpers ----------
create or replace function app.raise_web_event(
  p_s public.class_sessions, p_student uuid, p_rule text, p_evidence text default null
) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare v_id uuid; v_name text;
begin
  insert into public.environment_events (tenant_id, class_session_id, class_id, student_id, device_id, policy_id,
                                         kind, severity, rule, evidence_image)
    values (p_s.tenant_id, p_s.id, p_s.class_id, p_student, null, p_s.environment_id,
            'environment_left', 'warning', p_rule, p_evidence)
    on conflict (class_session_id, student_id, kind) where resolved_at is null do nothing
    returning id into v_id;
  if v_id is null then return false; end if;
  select full_name into v_name from public.users where id = p_student;
  perform app.notify(p_s.teacher_id, 'environment_left', v_name || ' left the class', p_rule,
                     '/teacher/live/' || p_s.id, 'warning',
                     jsonb_build_object('event_id', v_id, 'session_id', p_s.id, 'student_id', p_student));
  return true;
end$$;

-- Raise events for students who have been away longer than the grace period.
-- Away = the lesson page reported it (tab/app switch, left full screen,
-- stopped sharing), the page was closed, or it stopped reporting entirely.
create or replace function app.web_leave_check(p_s public.class_sessions) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare r record; v_grace int; v_default int; v_keep boolean; v_img text;
begin
  if p_s.status <> 'live' or not p_s.lockdown then return; end if;
  select default_grace_seconds, store_event_screenshots into v_default, v_keep
    from public.tenant_settings where tenant_id = p_s.tenant_id;
  for r in select p.user_id,
                  case when p.away_since is not null then p.away_since
                       when p.left_at is not null then p.left_at
                       else p.last_seen_at + interval '30 seconds' end as since,
                  coalesce(p.away_reason, case when p.left_at is not null then 'Closed the lesson'
                                               else 'Lesson page stopped responding (closed or lost connection)' end) as why
           from public.session_participants p
           where p.session_id = p_s.id
             and (p.away_since is not null or p.left_at is not null or p.last_seen_at < now() - interval '30 seconds')
             -- a student still setting up (first 2 minutes, never fully in class) hasn't left
             and (p.ready_at is not null or p.joined_at < now() - interval '2 minutes')
             -- students monitored by the extension are covered by its own leave rules
             and not exists (select 1 from public.browser_sessions b where b.class_session_id = p_s.id
                             and b.student_id = p.user_id and b.last_heartbeat_at > now() - interval '45 seconds') loop
    v_grace := coalesce((app.effective_policy(p_s, r.user_id)).grace_seconds, v_default, 15);
    if now() - r.since >= make_interval(secs => v_grace) then
      v_img := case when v_keep then (select image_data from public.screen_snapshots
                     where class_session_id = p_s.id and student_id = r.user_id and quality in ('thumbnail','spotlight')
                     order by captured_at desc limit 1) end;
      perform app.raise_web_event(p_s, r.user_id, r.why, v_img);
    end if;
  end loop;
end$$;

-- ---------- Student side ----------
-- Called by the lesson page every few seconds and whenever focus changes.
create or replace function public.student_report(
  p_session uuid, p_visible boolean, p_fullscreen boolean, p_sharing boolean,
  p_surface text default null, p_unsupported boolean default false
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_s        public.class_sessions;
  v_p        public.session_participants;
  v_set      public.tenant_settings;
  v_reason   text;
  v_setup    boolean := false;
  v_returned int;
begin
  select * into v_s from public.class_sessions where id = p_session;
  if v_s.id is null or not app.in_class(v_s.class_id) then raise exception 'Session not found.' using errcode = 'P0002'; end if;
  if v_s.status <> 'live' then return jsonb_build_object('status', v_s.status); end if;
  select * into v_set from public.tenant_settings where tenant_id = v_s.tenant_id;

  -- Why is the student away (if at all)? Only counts under lockdown.
  v_reason := case
    when not v_s.lockdown then null
    when not coalesce(p_visible, true) then 'Left the lesson (switched tab, app or window)'
    when not coalesce(p_fullscreen, false) and not p_unsupported then 'Left full-screen mode'
    when v_set.allow_screen_capture and not coalesce(p_sharing, false) and not p_unsupported then 'Stopped sharing their screen'
  end;

  insert into public.session_participants (session_id, user_id, tenant_id, status)
    values (p_session, auth.uid(), v_s.tenant_id, 'online')
    on conflict (session_id, user_id) do nothing;
  select * into v_p from public.session_participants where session_id = p_session and user_id = auth.uid();

  -- A student who has never been fully in class is still setting up: give them
  -- two minutes to share and go full screen before that counts as not attending.
  if v_reason is not null and v_p.ready_at is null then
    if v_p.joined_at > now() - interval '2 minutes' then
      v_reason := null; v_setup := true;
    else
      v_reason := 'Did not start the lesson (screen share and full screen are required)';
    end if;
  end if;

  update public.session_participants set
    last_seen_at = now(), left_at = null,
    status = case when status = 'offline' then 'online' else status end,
    tab_visible = coalesce(p_visible, true), fullscreen = coalesce(p_fullscreen, false),
    screen_sharing = coalesce(p_sharing, false), share_unsupported = coalesce(p_unsupported, false),
    screen_surface = left(p_surface, 20),
    ready_at = case when v_reason is null and not v_setup then coalesce(ready_at, now()) else ready_at end,
    away_since = case when v_reason is null then null else coalesce(away_since, now()) end,
    away_reason = v_reason
  where session_id = p_session and user_id = auth.uid()
  returning * into v_p;

  if v_setup then
    null; -- nothing to resolve or raise yet
  elsif v_reason is null then
    update public.environment_events set resolved_at = now()
     where class_session_id = p_session and student_id = auth.uid() and resolved_at is null
       and kind = 'environment_left' and device_id is null;
    get diagnostics v_returned = row_count;
    if v_returned > 0 then
      perform app.notify(v_s.teacher_id, 'student_returned',
        (select full_name from public.users where id = auth.uid()) || ' returned to the class', null,
        '/teacher/live/' || p_session, 'info', jsonb_build_object('student_id', auth.uid()));
    end if;
  else
    perform app.web_leave_check(v_s);
  end if;

  return jsonb_build_object(
    'status', v_s.status,
    'lockdown', v_s.lockdown,
    'away', v_reason is not null,
    'reason', v_reason,
    'setting_up', v_setup,
    'capture', jsonb_build_object(
      'enabled', v_set.allow_screen_capture,
      'interval_seconds', least(v_set.thumbnail_interval_seconds, 5),
      'high_quality', v_p.hq_requested_at is not null and v_p.hq_requested_at > now() - interval '30 seconds'
                      or exists (select 1 from public.spotlights sp where sp.session_id = p_session
                                 and sp.student_id = auth.uid() and sp.ended_at is null)));
end$$;

-- A frame from the student's shared screen (the student chose to share it).
create or replace function public.student_screen_frame(
  p_session uuid, p_image text, p_width int default null, p_height int default null, p_quality text default 'thumbnail'
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_s public.class_sessions; v_set public.tenant_settings; v_last timestamptz;
begin
  if p_quality not in ('thumbnail','spotlight') then raise exception 'Unknown quality.' using errcode = '22023'; end if;
  if p_image is null or p_image not like 'data:image/%' or length(p_image) > 400000 then
    raise exception 'Frame must be a data:image URL under 400 KB.' using errcode = '22023';
  end if;
  select * into v_s from public.class_sessions where id = p_session;
  if v_s.id is null or not app.in_class(v_s.class_id) or v_s.status <> 'live' then
    return jsonb_build_object('stored', false, 'reason', 'no live session');
  end if;
  select * into v_set from public.tenant_settings where tenant_id = v_s.tenant_id;
  if not v_set.allow_screen_capture then return jsonb_build_object('stored', false, 'reason', 'screen capture disabled by school'); end if;

  select captured_at into v_last from public.screen_snapshots
   where class_session_id = p_session and student_id = auth.uid() and quality = p_quality and source = 'web';
  if v_last is not null and now() - v_last < interval '1500 milliseconds' then
    return jsonb_build_object('stored', false, 'reason', 'rate limited');
  end if;

  insert into public.screen_snapshots (tenant_id, device_id, class_session_id, student_id, image_data, width, height, quality, source)
    values (v_s.tenant_id, null, p_session, auth.uid(), p_image, p_width, p_height, p_quality, 'web')
    on conflict (class_session_id, student_id, quality, source) where quality <> 'event'
    do update set image_data = excluded.image_data, width = excluded.width, height = excluded.height, captured_at = now();

  -- Attach "what they switched to" to a fresh leave alert (school setting).
  if v_set.store_event_screenshots then
    update public.environment_events set evidence_image = p_image
     where class_session_id = p_session and student_id = auth.uid() and resolved_at is null
       and kind = 'environment_left' and device_id is null
       and created_at > now() - interval '60 seconds';
  end if;
  if p_quality = 'spotlight' then
    update public.session_participants set hq_requested_at = null where session_id = p_session and user_id = auth.uid();
  end if;
  return jsonb_build_object('stored', true);
end$$;

-- ---------- Teacher side ----------
create or replace function public.set_session_lockdown(p_session uuid, p_on boolean) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_s public.class_sessions := app.require_live_session(p_session);
begin
  update public.class_sessions set lockdown = p_on where id = p_session;
  if not p_on then
    update public.session_participants set away_since = null, away_reason = null where session_id = p_session;
    update public.environment_events set resolved_at = now()
     where class_session_id = p_session and resolved_at is null and kind = 'environment_left' and device_id is null;
  end if;
  perform app.audit('session.lockdown_' || case when p_on then 'on' else 'off' end, 'class_session', p_session::text);
end$$;

create or replace function public.event_evidence(p_event uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v public.environment_events;
begin
  select * into v from public.environment_events where id = p_event;
  if v.id is null or not app.can_manage_session(v.class_session_id) then raise exception 'Alert not found.' using errcode = 'P0002'; end if;
  return jsonb_build_object('image', v.evidence_image, 'rule', v.rule, 'created_at', v.created_at);
end$$;

create or replace function public.request_screenshot(p_session uuid, p_student uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_s public.class_sessions := app.require_live_session(p_session); v_prev timestamptz;
begin
  if not (select allow_screen_capture from public.tenant_settings where tenant_id = v_s.tenant_id) then
    raise exception 'Screen capture is disabled by your school.' using errcode = 'P0001';
  end if;
  select greatest(max(b.snapshot_requested_at), max(p.hq_requested_at)) into v_prev
  from public.session_participants p
  left join public.browser_sessions b on b.class_session_id = p.session_id and b.student_id = p.user_id
  where p.session_id = p_session and p.user_id = p_student;
  update public.browser_sessions set snapshot_requested_at = now()
   where class_session_id = p_session and student_id = p_student
     and (snapshot_requested_at is null or snapshot_requested_at < now() - interval '3 seconds');
  update public.session_participants set hq_requested_at = now() where session_id = p_session and user_id = p_student;
  if v_prev is null or v_prev < now() - interval '60 seconds' then
    perform app.audit('screen.viewed', 'user', p_student::text, jsonb_build_object('session_id', p_session));
  end if;
end$$;

create or replace function public.spotlight_start(
  p_session uuid, p_student uuid, p_anonymized boolean default false, p_show_to_class boolean default false
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_s public.class_sessions := app.require_live_session(p_session); v_id uuid;
begin
  if not (select allow_spotlight and allow_screen_capture from public.tenant_settings where tenant_id = v_s.tenant_id) then
    raise exception 'Student screen spotlighting is disabled by your school.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.class_members where class_id = v_s.class_id and user_id = p_student and role = 'student') then
    raise exception 'Student is not in this class.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.browser_sessions where class_session_id = p_session and student_id = p_student
                 and last_heartbeat_at > now() - interval '45 seconds')
     and not exists (select 1 from public.session_participants where session_id = p_session and user_id = p_student
                     and screen_sharing and last_seen_at > now() - interval '45 seconds') then
    raise exception 'That student isn''t sharing their screen right now.' using errcode = 'P0001';
  end if;
  update public.spotlights set ended_at = now() where session_id = p_session and ended_at is null;
  insert into public.spotlights (tenant_id, session_id, student_id, anonymized, show_to_class, started_by)
    values (v_s.tenant_id, p_session, p_student, p_anonymized, p_show_to_class, auth.uid()) returning id into v_id;
  update public.browser_sessions set snapshot_requested_at = now() where class_session_id = p_session and student_id = p_student;
  update public.session_participants set hq_requested_at = now() where session_id = p_session and user_id = p_student;
  perform app.notify(p_student, 'spotlight', 'Your teacher is sharing your screen with the class',
                     case when p_anonymized then 'Your name is hidden.' end, '/student/live/' || p_session, 'info',
                     jsonb_build_object('session_id', p_session));
  perform app.audit('spotlight.started', 'user', p_student::text,
                    jsonb_build_object('session_id', p_session, 'anonymized', p_anonymized, 'show_to_class', p_show_to_class));
  return jsonb_build_object('id', v_id);
end$$;

-- Same as 0630, with the new latest-frame key (session, student, quality, source).
create or replace function public.device_snapshot(
  p_device uuid, p_secret text, p_image text, p_width int default null, p_height int default null,
  p_quality text default 'thumbnail', p_url text default null
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_dev      public.devices := app.device_auth(p_device, p_secret);
  v_session  public.class_sessions;
  v_settings public.tenant_settings;
  v_last     timestamptz;
  v_min_gap  interval;
begin
  if p_quality not in ('thumbnail','spotlight') then raise exception 'Unknown quality.' using errcode = '22023'; end if;
  if p_image is null or p_image not like 'data:image/%' or length(p_image) > 400000 then
    raise exception 'Snapshot must be a data:image URL under 400 KB.' using errcode = '22023';
  end if;
  select * into v_settings from public.tenant_settings where tenant_id = v_dev.tenant_id;
  if not v_settings.allow_screen_capture then
    return jsonb_build_object('stored', false, 'reason', 'screen capture disabled by school');
  end if;
  v_session := app.device_live_session(v_dev.student_id);
  if v_session.id is null then return jsonb_build_object('stored', false, 'reason', 'no live session'); end if;

  v_min_gap := case when p_quality = 'thumbnail'
                    then make_interval(secs => greatest(v_settings.thumbnail_interval_seconds / 2, 2))
                    else interval '2 seconds' end;
  select captured_at into v_last from public.screen_snapshots
   where class_session_id = v_session.id and student_id = v_dev.student_id and quality = p_quality and source = 'extension';
  if v_last is not null and now() - v_last < v_min_gap then
    return jsonb_build_object('stored', false, 'reason', 'rate limited');
  end if;

  insert into public.screen_snapshots (tenant_id, device_id, class_session_id, student_id, image_data, width, height, quality, url, source)
    values (v_dev.tenant_id, v_dev.id, v_session.id, v_dev.student_id, p_image, p_width, p_height, p_quality, left(p_url, 2000), 'extension')
    on conflict (class_session_id, student_id, quality, source) where quality <> 'event'
    do update set image_data = excluded.image_data, width = excluded.width, height = excluded.height,
                  url = excluded.url, captured_at = now(), device_id = excluded.device_id;

  if v_settings.store_event_screenshots and exists (
       select 1 from public.environment_events e where e.class_session_id = v_session.id and e.student_id = v_dev.student_id
       and e.resolved_at is null and e.kind in ('environment_left','domain_blocked') and e.created_at > now() - interval '60 seconds')
     and not exists (select 1 from public.screen_snapshots s where s.student_id = v_dev.student_id and s.class_session_id = v_session.id
                     and s.quality = 'event' and s.captured_at > now() - interval '60 seconds') then
    insert into public.screen_snapshots (tenant_id, device_id, class_session_id, student_id, image_data, width, height, quality, url, source)
      values (v_dev.tenant_id, v_dev.id, v_session.id, v_dev.student_id, p_image, p_width, p_height, 'event', left(p_url, 2000), 'extension');
    update public.environment_events set evidence_image = coalesce(evidence_image, p_image)
     where class_session_id = v_session.id and student_id = v_dev.student_id and resolved_at is null
       and kind in ('environment_left','domain_blocked') and created_at > now() - interval '60 seconds';
  end if;

  if p_quality = 'spotlight' then
    update public.browser_sessions set snapshot_requested_at = null where device_id = v_dev.id and class_session_id = v_session.id;
  end if;
  return jsonb_build_object('stored', true);
end$$;

-- Same as 0640 plus: web leave detection, the 'web' roster block, lockdown,
-- and whether an alert has a screenshot attached.
create or replace function public.teacher_session_state(p_session uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_s        public.class_sessions;
  v_settings public.tenant_settings;
  r          public.browser_sessions;
begin
  select * into v_s from public.class_sessions where id = p_session;
  if v_s.id is null or not app.can_manage_class(v_s.class_id) then raise exception 'Session not found.' using errcode = 'P0002'; end if;
  select * into v_settings from public.tenant_settings where tenant_id = v_s.tenant_id;

  if v_s.status = 'live' then
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

  return jsonb_build_object(
    'session', to_jsonb(v_s) || jsonb_build_object(
      'class_name', (select name from public.classes where id = v_s.class_id),
      'lesson_title', (select title from public.lessons where id = v_s.lesson_id),
      'environment_name', (select name from public.environment_policies where id = v_s.environment_id)),
    'settings', jsonb_build_object('allow_spotlight', v_settings.allow_spotlight, 'allow_group_chat', v_settings.allow_group_chat,
                                   'allow_screen_capture', v_settings.allow_screen_capture,
                                   'store_event_screenshots', v_settings.store_event_screenshots,
                                   'thumbnail_interval_seconds', v_settings.thumbnail_interval_seconds),
    'server_now', now(),
    'roster', (select coalesce(jsonb_agg(jsonb_build_object(
        'student_id', u.id, 'name', u.full_name,
        'presence', case when p.user_id is null then 'not_joined'
                         when p.left_at is not null or p.last_seen_at < now() - interval '45 seconds' then 'offline'
                         else p.status end,
        'last_seen_at', p.last_seen_at, 'current_slide', p.current_slide,
        'web', case when p.user_id is null then null else jsonb_build_object(
                 'sharing', p.screen_sharing and p.last_seen_at > now() - interval '45 seconds',
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
      from public.class_members m join public.users u on u.id = m.user_id
      left join public.session_participants p on p.session_id = p_session and p.user_id = u.id
      where m.class_id = v_s.class_id and m.role = 'student'),
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
    'activity', case when v_s.active_activity_id is null then null
                     else public.activity_results(v_s.active_activity_id, p_session) end);
end$$;

-- Closing the lesson under lockdown counts as leaving (after the grace period).
create or replace function public.leave_session(p_session uuid) returns void
language sql volatile security definer set search_path = '' as $$
  update public.session_participants set left_at = now(), status = 'offline',
    away_since = coalesce(away_since, now()), away_reason = coalesce(away_reason, 'Closed the lesson')
  where session_id = p_session and user_id = auth.uid()
$$;

-- One thumbnail per student: the newest, whichever source it came from.
create or replace function public.session_screens(p_session uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_s public.class_sessions; v_interval int;
begin
  select * into v_s from public.class_sessions where id = p_session;
  if v_s.id is null or not app.can_manage_class(v_s.class_id) then raise exception 'Session not found.' using errcode = 'P0002'; end if;
  select thumbnail_interval_seconds into v_interval from public.tenant_settings where tenant_id = v_s.tenant_id;
  return (select coalesce(jsonb_agg(jsonb_build_object('student_id', sn.student_id, 'device_id', sn.device_id,
            'image', sn.image_data, 'captured_at', sn.captured_at, 'url', sn.url, 'source', sn.source,
            'stale', sn.captured_at < now() - make_interval(secs => greatest(v_interval * 3, 30)))), '[]'::jsonb)
          from (select distinct on (student_id) * from public.screen_snapshots
                where class_session_id = p_session and quality = 'thumbnail'
                order by student_id, captured_at desc) sn);
end$$;

-- Grants for the new functions:
revoke execute on function public.student_report(uuid, boolean, boolean, boolean, text, boolean),
                           public.student_screen_frame(uuid, text, int, int, text),
                           public.set_session_lockdown(uuid, boolean),
                           public.event_evidence(uuid),
                           app.raise_web_event(public.class_sessions, uuid, text, text),
                           app.web_leave_check(public.class_sessions) from public, anon;
grant execute on function public.student_report(uuid, boolean, boolean, boolean, text, boolean),
                          public.student_screen_frame(uuid, text, int, int, text),
                          public.set_session_lockdown(uuid, boolean),
                          public.event_evidence(uuid),
                          app.raise_web_event(public.class_sessions, uuid, text, text),
                          app.web_leave_check(public.class_sessions) to authenticated, service_role;

-- >>>>>>>>>>>>>>>>>>>> 20260901000750_operations.sql >>>>>>>>>>>>>>>>>>>>
-- =============================================================================
-- SwiftCipher — 0750 production operations
--
-- * Live screen thumbnails are deleted the moment a session ends (the privacy
--   notice promises this), so the database never accumulates screen images.
-- * Error log: the app reports client and server errors here; the platform
--   super admin reviews them in /super/errors. Deduplicated by fingerprint.
-- * Health check for uptime monitors.
-- * Scheduled maintenance (hourly): retention for every school, abandoned
--   sessions, expired codes, old error rows. Runs with pg_cron when the
--   database has it (Supabase does), and can also be triggered by the
--   service role (GitHub Actions workflow "maintenance").
-- * Terms of service acceptance is recorded as a consent.
-- =============================================================================

-- ---------- Thumbnails never outlive the session ----------
create or replace function app.on_session_ended() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'ended' and old.status is distinct from 'ended' then
    delete from public.screen_snapshots where class_session_id = new.id and quality <> 'event';
    update public.session_participants set away_since = null, away_reason = null, screen_sharing = false
     where session_id = new.id;
  end if;
  return new;
end$$;
drop trigger if exists class_sessions_ended on public.class_sessions;
create trigger class_sessions_ended after update of status on public.class_sessions
  for each row execute function app.on_session_ended();

-- ---------- Error log ----------
create table if not exists public.error_events (
  id            bigint generated always as identity primary key,
  fingerprint   text not null,
  source        text not null check (source in ('client','server','api')),
  message       text not null check (length(message) <= 2000),
  stack         text check (length(stack) <= 8000),
  url           text check (length(url) <= 2000),
  user_agent    text check (length(user_agent) <= 500),
  release       text check (length(release) <= 100),
  tenant_id     uuid references public.tenants(id) on delete set null,
  user_id       uuid,
  count         int not null default 1,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  resolved_at   timestamptz
);
create unique index if not exists error_events_open_fp on public.error_events(fingerprint) where resolved_at is null;
create index if not exists error_events_recent on public.error_events(last_seen_at desc);
alter table public.error_events enable row level security;
-- No policies: nobody reads or writes the table directly. Writes go through
-- log_error(); reads through the super-admin RPC below.
revoke all on public.error_events from anon, authenticated;

create or replace function public.log_error(
  p_source text, p_message text, p_stack text default null, p_url text default null,
  p_user_agent text default null, p_release text default null
) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_fp text; v_tenant uuid; v_recent int;
begin
  if p_source not in ('client','server','api') or coalesce(btrim(p_message), '') = '' then return; end if;
  -- Flood guard: at most 600 new rows an hour platform-wide (repeats only bump a counter).
  select count(*) into v_recent from public.error_events where first_seen_at > now() - interval '1 hour';
  v_fp := md5(p_source || '|' || left(p_message, 300) || '|' || coalesce(left(split_part(coalesce(p_stack, ''), E'\n', 2), 300), ''));
  begin v_tenant := app.tenant_id(); exception when others then v_tenant := null; end;
  update public.error_events set count = count + 1, last_seen_at = now(),
         url = coalesce(left(p_url, 2000), url), tenant_id = coalesce(v_tenant, tenant_id)
   where fingerprint = v_fp and resolved_at is null;
  if found or v_recent >= 600 then return; end if;
  insert into public.error_events (fingerprint, source, message, stack, url, user_agent, release, tenant_id, user_id)
    values (v_fp, p_source, left(p_message, 2000), left(p_stack, 8000), left(p_url, 2000), left(p_user_agent, 500),
            left(p_release, 100), v_tenant, auth.uid())
    on conflict (fingerprint) where resolved_at is null do update set count = public.error_events.count + 1, last_seen_at = now();
end$$;

create or replace function public.sa_errors(p_include_resolved boolean default false, p_limit int default 200) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.sa_require();
  return (select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'source', e.source, 'message', e.message, 'stack', e.stack,
            'url', e.url, 'user_agent', e.user_agent, 'release', e.release, 'tenant', t.name, 'count', e.count,
            'first_seen_at', e.first_seen_at, 'last_seen_at', e.last_seen_at, 'resolved_at', e.resolved_at)
            order by e.resolved_at nulls first, e.last_seen_at desc), '[]'::jsonb)
          from (select * from public.error_events where p_include_resolved or resolved_at is null
                order by last_seen_at desc limit least(greatest(p_limit, 1), 1000)) e
          left join public.tenants t on t.id = e.tenant_id);
end$$;

create or replace function public.sa_resolve_error(p_id bigint) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform app.sa_require();
  update public.error_events set resolved_at = now() where id = p_id and resolved_at is null;
end$$;

-- ---------- Health ----------
create or replace function public.health() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('ok', true, 'db_time', now(), 'schema', '0750')
$$;

-- ---------- Maintenance ----------
-- Sessions a teacher forgot to end: live for 12 h with nobody seen for 2 h.
create or replace function app.end_abandoned_sessions() returns int
language plpgsql volatile security definer set search_path = '' as $$
declare r record; v_n int := 0;
begin
  for r in select s.* from public.class_sessions s
           where s.status = 'live' and s.started_at < now() - interval '12 hours'
             and not exists (select 1 from public.session_participants p where p.session_id = s.id
                             and p.last_seen_at > now() - interval '2 hours') loop
    update public.class_sessions set status = 'ended', ended_at = now(), environment_active = false where id = r.id;
    update public.session_participants set left_at = coalesce(left_at, now()), status = 'offline' where session_id = r.id;
    update public.browser_sessions set ended_at = now() where class_session_id = r.id and ended_at is null;
    update public.environment_events set resolved_at = now() where class_session_id = r.id and resolved_at is null;
    update public.spotlights set ended_at = now() where session_id = r.id and ended_at is null;
    update public.teacher_commands set status = 'expired' where class_session_id = r.id and status in ('queued','delivered');
    perform app.audit('session.auto_ended', 'class_session', r.id::text, '{}'::jsonb, r.tenant_id, null);
    v_n := v_n + 1;
  end loop;
  return v_n;
end$$;

create or replace function app.run_maintenance() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_ended int;
begin
  v_ended := app.end_abandoned_sessions();
  perform app.apply_retention_all();
  delete from public.invites where expires_at < now() - interval '30 days';
  delete from public.error_events where last_seen_at < now() - interval '30 days';
  return jsonb_build_object('ok', true, 'ran_at', now(), 'sessions_auto_ended', v_ended);
end$$;

-- For the scheduled GitHub Action (service role only).
create or replace function public.run_maintenance() returns jsonb
language sql volatile security definer set search_path = '' as $$ select app.run_maintenance() $$;

-- Hourly with pg_cron where available (Supabase: Database → Extensions → pg_cron).
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.unschedule(jobid) from cron.job where jobname = 'swiftcipher-maintenance';
    perform cron.schedule('swiftcipher-maintenance', '17 * * * *', 'select app.run_maintenance()');
  end if;
exception when others then
  raise notice 'pg_cron not scheduled (%). Use the GitHub "maintenance" workflow instead.', sqlerrm;
end$$;

-- ---------- Terms of service consent ----------
alter table public.consents drop constraint if exists consents_kind_check;
alter table public.consents add constraint consents_kind_check
  check (kind in ('monitoring_notice','acceptable_use','privacy_notice','terms_of_service'));

create or replace function public.accept_notice(p_kind text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_me public.users := app.me(); v_version int;
begin
  if p_kind not in ('monitoring_notice','acceptable_use','privacy_notice','terms_of_service') then
    raise exception 'Unknown notice.' using errcode = '22023';
  end if;
  select case when p_kind = 'monitoring_notice' then monitoring_notice_version else 1 end into v_version
    from public.tenant_settings where tenant_id = v_me.tenant_id;
  insert into public.consents (tenant_id, user_id, kind, version)
    values (v_me.tenant_id, v_me.id, p_kind, coalesce(v_version, 1))
    on conflict (user_id, kind, version) do nothing;
end$$;

-- ---------- Privileges ----------
revoke execute on function public.log_error(text, text, text, text, text, text),
                           public.sa_errors(boolean, int), public.sa_resolve_error(bigint),
                           public.health(), public.run_maintenance(),
                           app.run_maintenance(), app.end_abandoned_sessions(), app.on_session_ended()
  from public, anon, authenticated;
grant execute on function public.log_error(text, text, text, text, text, text) to anon, authenticated, service_role;
grant execute on function public.health() to anon, authenticated, service_role;
grant execute on function public.sa_errors(boolean, int), public.sa_resolve_error(bigint) to authenticated, service_role;
grant execute on function public.run_maintenance(), app.run_maintenance(), app.end_abandoned_sessions() to service_role;

-- >>>>>>>>>>>>>>>>>>>> 20260901000760_scale.sql >>>>>>>>>>>>>>>>>>>>
-- =============================================================================
-- SwiftCipher — 0760 scale: 5,000,000 users / 50,000 schools
--
-- 1. Indexes: every foreign key and every tenant_id gets an index (RLS filters
--    by tenant_id on every query), plus composite (tenant_id, time) indexes for
--    lists and retention, keyset-pagination indexes and trigram search.
-- 2. Push, not poll: the database broadcasts tiny "something changed" signals
--    on private Realtime channels ("Broadcast from Database"); clients refetch
--    only when told. postgres_changes (which evaluates every change against
--    every subscriber) is no longer used, and tables leave the publication.
-- 3. The student tick (student_report) replaces the separate heartbeat, writes
--    only when something changed (or every 15 s for presence), and tells the
--    page when lesson state changed (state_version) so it refetches only then.
-- 4. Live screen frames no longer touch the database: the student's page sends
--    them on its own private channel screen:<session>:<student>, which only
--    that session's teachers can receive, and only while a teacher is watching.
-- 5. Retention is set-based and batched across all schools; platform stats are
--    cached; super-admin lists use keyset pagination.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Indexes
-- ---------------------------------------------------------------------------
-- Lists and retention scans: (tenant_id, time). These also serve the tenant_id FKs.
create index if not exists screen_snapshots_tenant_time_idx on public.screen_snapshots(tenant_id, captured_at);
create index if not exists browser_sessions_tenant_time_idx on public.browser_sessions(tenant_id, started_at);
create index if not exists teacher_commands_tenant_time_idx on public.teacher_commands(tenant_id, created_at);
create index if not exists rtc_signals_tenant_time_idx      on public.rtc_signals(tenant_id, created_at);
create index if not exists pairing_codes_tenant_exp_idx     on public.device_pairing_codes(tenant_id, expires_at);
create index if not exists quiz_attempts_tenant_time_idx    on public.quiz_attempts(tenant_id, started_at);
create index if not exists game_sessions_tenant_time_idx    on public.game_sessions(tenant_id, created_at);
create index if not exists chat_messages_tenant_time_idx    on public.chat_messages(tenant_id, created_at);
create index if not exists notifications_tenant_time_idx    on public.notifications(tenant_id, created_at);
create index if not exists class_sessions_tenant_time_idx   on public.class_sessions(tenant_id, created_at desc);
create index if not exists class_sessions_teacher_live_idx  on public.class_sessions(teacher_id) where status = 'live';
create index if not exists class_sessions_live_idx          on public.class_sessions(started_at) where status = 'live';
create index if not exists devices_online_idx               on public.devices(last_seen_at) where status = 'active';
create index if not exists error_events_first_seen_idx      on public.error_events(first_seen_at);
-- Keyset pagination for the platform console.
create index if not exists tenants_created_idx              on public.tenants(created_at desc, id desc);
create index if not exists users_created_idx                on public.users(created_at desc, id desc);
create index if not exists users_tenant_created_idx         on public.users(tenant_id, created_at desc, id desc);
create index if not exists users_tenant_name_idx            on public.users(tenant_id, full_name, id);

-- Every remaining foreign key gets an index on its columns unless an index
-- already starts with the key's first column (lookups, joins and cascading
-- deletes stay index-driven). Small lookup tables (plans, roles) are skipped.
do $$
declare r record; v_name text;
begin
  for r in
    select c.conrelid::regclass as tbl, c.conrelid, c.conkey,
           (select string_agg(quote_ident(a.attname), ', ' order by k.ord)
              from unnest(c.conkey) with ordinality k(attnum, ord)
              join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) as cols,
           (select string_agg(a.attname, '_' order by k.ord)
              from unnest(c.conkey) with ordinality k(attnum, ord)
              join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) as colnames,
           (select relname from pg_class where oid = c.conrelid) as relname
    from pg_constraint c join pg_namespace n on n.oid = c.connamespace
    where c.contype = 'f' and n.nspname = 'public'
      and c.confrelid not in ('public.plans'::regclass, 'public.roles'::regclass)
  loop
    if not exists (select 1 from pg_index i where i.indrelid = r.conrelid and i.indkey[0] = r.conkey[1]) then
      v_name := left(r.relname || '_' || r.colnames, 52) || '_fkx';
      execute format('create index if not exists %I on %s (%s)', v_name, r.tbl, r.cols);
    end if;
  end loop;
end$$;

-- Fast "contains" search on names and emails (Supabase ships pg_trgm).
do $$
declare v_schema text;
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_trgm') then
    create extension if not exists pg_trgm with schema extensions;
    -- pg_trgm may already live in another schema (e.g. public) on older projects.
    select n.nspname into v_schema from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
    execute format('create index if not exists users_name_trgm on public.users using gin (full_name %I.gin_trgm_ops)', v_schema);
    execute format('create index if not exists users_email_trgm on public.users using gin (email %I.gin_trgm_ops)', v_schema);
    execute format('create index if not exists tenants_name_trgm on public.tenants using gin (name %I.gin_trgm_ops)', v_schema);
  end if;
exception when others then
  raise notice 'pg_trgm search indexes skipped: %', sqlerrm;
end$$;

-- ---------------------------------------------------------------------------
-- 2. Broadcast from Database
-- ---------------------------------------------------------------------------
-- Sends a tiny signal on a private Realtime channel. Never blocks the write.
create or replace function app.broadcast(p_topic text, p_event text, p_payload jsonb default '{}'::jsonb) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  if to_regprocedure('realtime.send(jsonb, text, text, boolean)') is null then return; end if;
  execute 'select realtime.send($1, $2, $3, true)' using coalesce(p_payload, '{}'::jsonb), p_event, p_topic;
exception when others then
  null; -- a missed signal is recovered by the next poll/tick; the data write must succeed
end$$;

alter table public.class_sessions
  add column if not exists state_version   bigint not null default 0,
  add column if not exists teacher_seen_at timestamptz;

-- Anything students must refetch bumps state_version (and broadcasts).
create or replace function app.session_version_bump() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (to_jsonb(new) - 'teacher_seen_at' - 'state_version' - 'updated_at')
     is distinct from (to_jsonb(old) - 'teacher_seen_at' - 'state_version' - 'updated_at')
     and new.state_version = old.state_version then
    new.state_version := old.state_version + 1;
  end if;
  return new;
end$$;
drop trigger if exists class_sessions_version on public.class_sessions;
create trigger class_sessions_version before update on public.class_sessions
  for each row execute function app.session_version_bump();

create or replace function app.session_changed() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.state_version is distinct from old.state_version then
    perform app.broadcast('session:' || new.id, 'state', jsonb_build_object('v', new.state_version));
    perform app.broadcast('staff:' || new.id, 'state', '{}'::jsonb);
  end if;
  return null;
end$$;
drop trigger if exists class_sessions_broadcast on public.class_sessions;
create trigger class_sessions_broadcast after update on public.class_sessions
  for each row execute function app.session_changed();

-- Child rows that change what students see: bump the session's version.
create or replace function app.touch_session() returns trigger
language plpgsql security definer set search_path = '' as $$
declare r jsonb := to_jsonb(coalesce(new, old)); v_session uuid;
begin
  v_session := coalesce((r ->> 'class_session_id')::uuid, (r ->> 'session_id')::uuid);
  if v_session is not null then
    update public.class_sessions set state_version = state_version + 1 where id = v_session;
    if tg_table_name = 'environment_events' then
      perform app.broadcast('staff:' || v_session, 'alert', '{}'::jsonb);
    end if;
  end if;
  return null;
end$$;
do $$
declare t text;
begin
  foreach t in array array['announcements','spotlights','environment_events','rtc_rooms'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_touch_session', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function app.touch_session()', t || '_touch_session', t);
  end loop;
end$$;

-- Teacher-only signals: roster changes and raised hands. Answers are not
-- signalled one by one (a 500,000-player quiz would flood the channel); the
-- teacher's responses panel refreshes every few seconds instead.
create or replace function app.staff_signal() returns trigger
language plpgsql security definer set search_path = '' as $$
declare r jsonb := to_jsonb(coalesce(new, old)); v_session uuid := (r ->> 'session_id')::uuid; v_event text;
begin
  if tg_table_name = 'session_participants' then
    -- Presence ticks (last_seen_at only) are not worth a signal.
    if tg_op = 'UPDATE' and (to_jsonb(new) - 'last_seen_at') = (to_jsonb(old) - 'last_seen_at') then return null; end if;
    v_event := 'roster';
  else
    v_event := 'hand';
  end if;
  if v_session is not null then perform app.broadcast('staff:' || v_session, v_event, '{}'::jsonb); end if;
  return null;
end$$;
do $$
declare t text;
begin
  foreach t in array array['session_participants','raise_hands'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_staff_signal', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function app.staff_signal()', t || '_staff_signal', t);
  end loop;
end$$;

-- Per-user, per-thread, per-board and per-game signals.
create or replace function app.row_signal() returns trigger
language plpgsql security definer set search_path = '' as $$
declare r jsonb := to_jsonb(coalesce(new, old));
begin
  case tg_table_name
    when 'notifications' then perform app.broadcast('user:' || (r ->> 'user_id'), 'notification', '{}'::jsonb);
    when 'chat_messages' then perform app.broadcast('thread:' || (r ->> 'thread_id'), 'message', '{}'::jsonb);
    when 'collab_posts'  then perform app.broadcast('board:' || (r ->> 'board_id'), 'post', '{}'::jsonb);
    when 'game_sessions' then perform app.broadcast('game:' || (r ->> 'id'), 'state', '{}'::jsonb);
    when 'game_players'  then perform app.broadcast('game:' || (r ->> 'game_id'), 'players', '{}'::jsonb);
    else null;
  end case;
  return null;
end$$;
do $$
declare t text;
begin
  foreach t in array array['notifications','chat_messages','collab_posts','game_sessions','game_players'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_signal', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function app.row_signal()', t || '_signal', t);
  end loop;
end$$;

-- Nothing uses postgres_changes any more: take every table out of the publication.
do $$
declare r record;
begin
  for r in select tablename from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' loop
    execute format('alter publication supabase_realtime drop table public.%I', r.tablename);
  end loop;
end$$;

-- Topic rules (also unit-tested directly):
--   session:<s>        students in the class + the session's teachers
--   staff:<s>          the session's teachers
--   screen:<s>:<u>     listen: the session's teachers; send: student <u> only, while in the class
--   user:<u>           that user
--   thread:<t> / board:<b> / game:<g>   whoever can read that row (RLS decides)
create or replace function app.can_listen(p_topic text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v_kind text := split_part(p_topic, ':', 1); v_id uuid;
begin
  begin v_id := nullif(split_part(p_topic, ':', 2), '')::uuid; exception when others then return false; end;
  if v_id is null or app.tenant_id() is null then return false; end if;
  return case v_kind
    when 'session' then app.in_session(v_id) or app.can_manage_session(v_id)
    when 'staff'   then app.can_manage_session(v_id)
    when 'screen'  then app.can_manage_session(v_id)
    when 'user'    then v_id = auth.uid()
    when 'thread'  then exists (select 1 from public.chat_threads t where t.id = v_id and t.tenant_id = app.tenant_id()
                                and (t.student_id = auth.uid() or t.teacher_id = auth.uid()
                                     or (t.kind = 'group' and app.in_session(t.session_id)) or app.can_manage_class(t.class_id)))
    -- boards and games: exactly the people who can read the row (mirrors their RLS policies)
    when 'board'   then exists (select 1 from public.collab_boards b where b.id = v_id and b.tenant_id = app.tenant_id()
                                and (b.owner_id = auth.uid()
                                     or (b.session_id is not null and (app.can_manage_session(b.session_id) or app.in_session(b.session_id)))
                                     or (b.session_id is null and app.is_teacher())))
    when 'game'    then exists (select 1 from public.game_sessions g where g.id = v_id and g.tenant_id = app.tenant_id()
                                and (app.can_manage_class(g.class_id) or app.in_class(g.class_id)))
    when 'annot'   then app.in_session(v_id) or app.can_manage_session(v_id)
    else false end;
end$$;

create or replace function app.can_send(p_topic text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v_kind text := split_part(p_topic, ':', 1); v_id uuid; v_user uuid;
begin
  begin
    v_id := nullif(split_part(p_topic, ':', 2), '')::uuid;
    v_user := nullif(split_part(p_topic, ':', 3), '')::uuid;
  exception when others then return false; end;
  if v_id is null then return false; end if;
  return case v_kind
    when 'screen' then v_user = auth.uid() and app.in_session(v_id)
                       and exists (select 1 from public.class_sessions s where s.id = v_id and s.status = 'live')
    when 'annot'  then app.can_manage_session(v_id)
    else false end;
end$$;

-- Private channel authorisation (Supabase Realtime checks these on join/send).
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'realtime' and table_name = 'messages') then
    execute 'drop policy if exists "swiftcipher channels: listen" on realtime.messages';
    execute 'drop policy if exists "swiftcipher channels: send" on realtime.messages';
    execute $p$
      create policy "swiftcipher channels: listen" on realtime.messages for select to authenticated
      using (app.can_listen(realtime.topic()))$p$;
    execute $p$
      create policy "swiftcipher channels: send" on realtime.messages for insert to authenticated
      with check (app.can_send(realtime.topic()))$p$;
  end if;
end$$;


-- ---------------------------------------------------------------------------
-- 3. The student tick
-- ---------------------------------------------------------------------------
-- Platform-wide knobs the operator can turn without a deploy, e.g. at peak load:
--   update public.platform_config set value = '30' where key = 'student_tick_seconds';
-- Every student page adopts it on its next tick; presence and leave detection
-- widen their windows to match.
create table if not exists public.platform_config (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.platform_config enable row level security;
revoke all on public.platform_config from anon, authenticated;
insert into public.platform_config (key, value) values ('student_tick_seconds', '10') on conflict (key) do nothing;

create or replace function app.tick_seconds() returns int
language sql stable security definer set search_path = '' as $$
  select least(greatest(coalesce((select (value #>> '{}')::int from public.platform_config where key = 'student_tick_seconds'), 10), 5), 60)
$$;

-- How long a student may be silent before counting as gone: three ticks plus slack, at least 45 s.
create or replace function app.presence_window() returns interval
language sql stable security definer set search_path = '' as $$
  select make_interval(secs => greatest(45, app.tick_seconds() * 3 + 15))
$$;

drop function if exists public.student_report(uuid, boolean, boolean, boolean, text, boolean);
create or replace function public.student_report(
  p_session uuid, p_visible boolean, p_fullscreen boolean, p_sharing boolean,
  p_surface text default null, p_unsupported boolean default false,
  p_slide int default null, p_idle boolean default false
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_s        public.class_sessions;
  v_p        public.session_participants;
  v_old      public.session_participants;
  v_set      public.tenant_settings;
  v_reason   text;
  v_setup    boolean := false;
  v_status   text := case when p_idle then 'idle' else 'online' end;
  v_slide    int;
  v_changed  boolean;
  v_returned int;
begin
  select * into v_s from public.class_sessions where id = p_session;
  if v_s.id is null or not app.in_class(v_s.class_id) then raise exception 'Session not found.' using errcode = 'P0002'; end if;
  if v_s.status <> 'live' then return jsonb_build_object('status', v_s.status, 'state_version', v_s.state_version); end if;
  select * into v_set from public.tenant_settings where tenant_id = v_s.tenant_id;

  v_reason := case
    when not v_s.lockdown then null
    when not coalesce(p_visible, true) then 'Left the lesson (switched tab, app or window)'
    when not coalesce(p_fullscreen, false) and not p_unsupported then 'Left full-screen mode'
    when v_set.allow_screen_capture and not coalesce(p_sharing, false) and not p_unsupported then 'Stopped sharing their screen'
  end;

  select * into v_old from public.session_participants where session_id = p_session and user_id = auth.uid();
  if v_old.session_id is null then
    insert into public.session_participants (session_id, user_id, tenant_id, status, current_slide)
      values (p_session, auth.uid(), v_s.tenant_id, v_status, v_s.current_slide)
      on conflict (session_id, user_id) do nothing;
    select * into v_old from public.session_participants where session_id = p_session and user_id = auth.uid();
  end if;

  if v_reason is not null and v_old.ready_at is null then
    if v_old.joined_at > now() - interval '2 minutes' then v_reason := null; v_setup := true;
    else v_reason := 'Did not start the lesson (screen share and full screen are required)'; end if;
  end if;

  v_slide := case when v_s.mode = 'student_paced' then coalesce(case when p_slide >= 0 then p_slide end, v_old.current_slide)
                  else v_s.current_slide end;

  v_changed := v_old.left_at is not null
    or v_old.status is distinct from v_status
    or v_old.current_slide is distinct from v_slide
    or v_old.tab_visible is distinct from coalesce(p_visible, true)
    or v_old.fullscreen is distinct from coalesce(p_fullscreen, false)
    or v_old.screen_sharing is distinct from coalesce(p_sharing, false)
    or v_old.share_unsupported is distinct from coalesce(p_unsupported, false)
    or v_old.screen_surface is distinct from left(p_surface, 20)
    or v_old.away_reason is distinct from v_reason
    or (v_reason is null and not v_setup and v_old.ready_at is null);

  -- Presence only needs a write every 15 s; everything else writes on change.
  if v_changed or v_old.last_seen_at < now() - make_interval(secs => app.tick_seconds() * 1.5) then
    update public.session_participants set
      last_seen_at = now(), left_at = null, status = v_status, current_slide = v_slide,
      tab_visible = coalesce(p_visible, true), fullscreen = coalesce(p_fullscreen, false),
      screen_sharing = coalesce(p_sharing, false), share_unsupported = coalesce(p_unsupported, false),
      screen_surface = left(p_surface, 20),
      ready_at = case when v_reason is null and not v_setup then coalesce(ready_at, now()) else ready_at end,
      away_since = case when v_reason is null then null else coalesce(away_since, now()) end,
      away_reason = v_reason
    where session_id = p_session and user_id = auth.uid()
    returning * into v_p;
  else
    v_p := v_old;
  end if;

  if v_setup then
    null;
  elsif v_reason is null then
    -- Only look for alerts to close if the student may have had one.
    if v_old.away_since is not null or v_old.left_at is not null or v_old.last_seen_at < now() - interval '40 seconds' then
      update public.environment_events set resolved_at = now()
       where class_session_id = p_session and student_id = auth.uid() and resolved_at is null
         and kind = 'environment_left' and device_id is null;
      get diagnostics v_returned = row_count;
      if v_returned > 0 then
        perform app.notify(v_s.teacher_id, 'student_returned',
          (select full_name from public.users where id = auth.uid()) || ' returned to the class', null,
          '/teacher/live/' || p_session, 'info', jsonb_build_object('student_id', auth.uid()));
      end if;
    end if;
  else
    perform app.web_leave_check(v_s);
  end if;

  return jsonb_build_object(
    'status', v_s.status,
    'lockdown', v_s.lockdown,
    'away', v_reason is not null,
    'reason', v_reason,
    'setting_up', v_setup,
    'tick_seconds', app.tick_seconds(),
    'state_version', v_s.state_version,
    'current_slide', v_s.current_slide,
    'active_activity_id', v_s.active_activity_id,
    'capture', jsonb_build_object(
      'enabled', v_set.allow_screen_capture,
      -- frames are only worth sending while a teacher has the live room open
      'send', v_set.allow_screen_capture and coalesce(v_s.teacher_seen_at > now() - interval '45 seconds', false),
      'interval_seconds', greatest(v_set.thumbnail_interval_seconds, 5),
      'high_quality', v_p.hq_requested_at is not null and v_p.hq_requested_at > now() - interval '30 seconds'
                      or exists (select 1 from public.spotlights sp where sp.session_id = p_session
                                 and sp.student_id = auth.uid() and sp.ended_at is null)));
end$$;
revoke execute on function public.student_report(uuid, boolean, boolean, boolean, text, boolean, int, boolean) from public, anon;
grant execute on function public.student_report(uuid, boolean, boolean, boolean, text, boolean, int, boolean) to authenticated, service_role;

-- New schools refresh rail thumbnails every 10 s (admins can change it).
alter table public.tenant_settings alter column thumbnail_interval_seconds set default 10;

-- Presence is written every 15 s now, so "stopped responding" means 45 s of silence.
create or replace function app.web_leave_check(p_s public.class_sessions) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare r record; v_grace int; v_default int; v_keep boolean; v_img text;
begin
  if p_s.status <> 'live' or not p_s.lockdown then return; end if;
  select default_grace_seconds, store_event_screenshots into v_default, v_keep
    from public.tenant_settings where tenant_id = p_s.tenant_id;
  for r in select p.user_id,
                  case when p.away_since is not null then p.away_since
                       when p.left_at is not null then p.left_at
                       else p.last_seen_at + app.presence_window() end as since,
                  coalesce(p.away_reason, case when p.left_at is not null then 'Closed the lesson'
                                               else 'Lesson page stopped responding (closed or lost connection)' end) as why
           from public.session_participants p
           where p.session_id = p_s.id
             and (p.away_since is not null or p.left_at is not null or p.last_seen_at < now() - app.presence_window())
             -- a student still setting up (first 2 minutes, never fully in class) hasn't left
             and (p.ready_at is not null or p.joined_at < now() - interval '2 minutes')
             -- students monitored by the extension are covered by its own leave rules
             and not exists (select 1 from public.browser_sessions b where b.class_session_id = p_s.id
                             and b.student_id = p.user_id and b.last_heartbeat_at > now() - interval '45 seconds') loop
    v_grace := coalesce((app.effective_policy(p_s, r.user_id)).grace_seconds, v_default, 15);
    if now() - r.since >= make_interval(secs => v_grace) then
      v_img := case when v_keep then (select image_data from public.screen_snapshots
                     where class_session_id = p_s.id and student_id = r.user_id and quality in ('thumbnail','spotlight')
                     order by captured_at desc limit 1) end;
      perform app.raise_web_event(p_s, r.user_id, r.why, v_img);
    end if;
  end loop;
end$$;

-- The live room records that a teacher is watching (frames are only sent then).
create or replace function public.teacher_session_state(p_session uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_s        public.class_sessions;
  v_settings public.tenant_settings;
  r          public.browser_sessions;
begin
  select * into v_s from public.class_sessions where id = p_session;
  if v_s.id is null or not app.can_manage_class(v_s.class_id) then raise exception 'Session not found.' using errcode = 'P0002'; end if;
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

  return jsonb_build_object(
    'session', to_jsonb(v_s) || jsonb_build_object(
      'class_name', (select name from public.classes where id = v_s.class_id),
      'lesson_title', (select title from public.lessons where id = v_s.lesson_id),
      'environment_name', (select name from public.environment_policies where id = v_s.environment_id)),
    'settings', jsonb_build_object('allow_spotlight', v_settings.allow_spotlight, 'allow_group_chat', v_settings.allow_group_chat,
                                   'allow_screen_capture', v_settings.allow_screen_capture,
                                   'store_event_screenshots', v_settings.store_event_screenshots,
                                   'thumbnail_interval_seconds', v_settings.thumbnail_interval_seconds),
    'server_now', now(),
    'roster', (select coalesce(jsonb_agg(jsonb_build_object(
        'student_id', u.id, 'name', u.full_name,
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
      from public.class_members m join public.users u on u.id = m.user_id
      left join public.session_participants p on p.session_id = p_session and p.user_id = u.id
      where m.class_id = v_s.class_id and m.role = 'student'),
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
    'activity', case when v_s.active_activity_id is null then null
                     else public.activity_results(v_s.active_activity_id, p_session) end);
end$$;

-- ---------------------------------------------------------------------------
-- 4. Retention across 50,000 schools: set-based, batched, time-boxed
-- ---------------------------------------------------------------------------
-- Deletes rows older than each school's retention, at most p_batch per round,
-- using the (tenant_id, time) indexes: one index probe per school per table.
create or replace function app.purge_expired(p_table text, p_time_col text, p_setting text, p_fixed interval default null,
                                             p_batch int default 20000, p_deadline timestamptz default null) returns bigint
language plpgsql volatile security definer set search_path = '' as $$
declare v_total bigint := 0; v_n bigint; v_age text;
begin
  v_age := case when p_fixed is not null then quote_literal(p_fixed) || '::interval'
                else format('make_interval(days => s.%I)', p_setting) end;
  loop
    execute format(
      'delete from public.%1$I x where x.ctid = any (array(
         select e.ctid from public.tenant_settings s
         cross join lateral (select y.ctid from public.%1$I y
                             where y.tenant_id = s.tenant_id and y.%2$I < now() - %3$s
                             limit 2000) e
         limit %4$s))', p_table, p_time_col, v_age, p_batch);
    get diagnostics v_n = row_count;
    v_total := v_total + v_n;
    exit when v_n < p_batch or clock_timestamp() > coalesce(p_deadline, clock_timestamp() + interval '1 minute');
  end loop;
  return v_total;
end$$;

create or replace function app.apply_retention_all() returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_deadline timestamptz := clock_timestamp() + interval '4 minutes';
begin
  perform app.purge_expired('browser_events',     'created_at',  'telemetry_retention_days', null, 20000, v_deadline);
  perform app.purge_expired('screen_snapshots',   'captured_at', 'telemetry_retention_days', null, 20000, v_deadline);
  perform app.purge_expired('environment_events', 'created_at',  'telemetry_retention_days', null, 20000, v_deadline);
  perform app.purge_expired('browser_sessions',   'started_at',  'telemetry_retention_days', null, 20000, v_deadline);
  perform app.purge_expired('teacher_commands',   'created_at',  'telemetry_retention_days', null, 20000, v_deadline);
  perform app.purge_expired('rtc_signals',        'created_at',  null, interval '1 day', 20000, v_deadline);
  perform app.purge_expired('device_pairing_codes','expires_at', null, interval '1 day', 20000, v_deadline);
  perform app.purge_expired('quiz_attempts',      'started_at',  'learning_retention_days', null, 20000, v_deadline);
  perform app.purge_expired('game_sessions',      'created_at',  'learning_retention_days', null, 20000, v_deadline);
  perform app.purge_expired('chat_messages',      'created_at',  'learning_retention_days', null, 20000, v_deadline);
  perform app.purge_expired('notifications',      'created_at',  null, interval '90 days', 20000, v_deadline);
  -- Live thumbnails of ended sessions (normally already removed by trigger).
  delete from public.screen_snapshots sn using public.class_sessions s
   where sn.class_session_id = s.id and s.status = 'ended' and sn.quality <> 'event'
     and s.ended_at > now() - interval '2 hours';
end$$;

-- ---------------------------------------------------------------------------
-- 5. Platform console at scale
-- ---------------------------------------------------------------------------
create table if not exists public.platform_stats (
  id          int primary key default 1 check (id = 1),
  stats       jsonb not null,
  computed_at timestamptz not null default now()
);
alter table public.platform_stats enable row level security;
revoke all on public.platform_stats from anon, authenticated;

create or replace function app.refresh_platform_stats() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v jsonb;
begin
  v := jsonb_build_object(
    'tenants', (select count(*) from public.tenants),
    'tenants_suspended', (select count(*) from public.tenants where status = 'suspended'),
    'users', (select count(*) from public.users),
    'users_suspended', (select count(*) from public.users where status = 'suspended'),
    'by_role', (select coalesce(jsonb_object_agg(role, n), '{}'::jsonb) from (select role, count(*) n from public.users group by role) r),
    'devices', (select count(*) from public.devices where status = 'active'),
    'sessions_30d', (select count(*) from public.class_sessions where created_at > now() - interval '30 days'),
    'by_plan', (select coalesce(jsonb_object_agg(plan_code, n), '{}'::jsonb) from (select plan_code, count(*) n from public.tenants group by plan_code) p));
  insert into public.platform_stats (id, stats, computed_at) values (1, v, now())
    on conflict (id) do update set stats = excluded.stats, computed_at = excluded.computed_at;
  return v;
end$$;

create or replace function public.sa_overview() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v public.platform_stats;
begin
  perform app.sa_require();
  select * into v from public.platform_stats where id = 1;
  if v.id is null or v.computed_at < now() - interval '1 hour' then
    perform app.refresh_platform_stats();
    select * into v from public.platform_stats where id = 1;
  end if;
  -- Live figures come from small partial indexes; totals are at most an hour old.
  return v.stats || jsonb_build_object(
    'live_sessions', (select count(*) from public.class_sessions where status = 'live'),
    'devices_online', (select count(*) from public.devices where status = 'active' and last_seen_at > now() - interval '45 seconds'),
    'stats_at', v.computed_at);
end$$;

-- Keyset pagination: fetch one row more than asked to know whether a next page exists.
drop function if exists public.sa_list_tenants(text);
create or replace function public.sa_list_tenants(p_search text default null, p_cursor text default null, p_limit int default 50) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_at timestamptz; v_id uuid; v_rows jsonb; v_next text;
  v_q text := nullif(btrim(p_search), '');
begin
  perform app.sa_require();
  if p_cursor is not null then
    v_at := split_part(p_cursor, '|', 1)::timestamptz; v_id := split_part(p_cursor, '|', 2)::uuid;
  end if;
  with page as (
    select t.* from public.tenants t
    where (v_q is null or t.name ilike '%' || v_q || '%' or t.slug ilike '%' || v_q || '%')
      and (v_at is null or (t.created_at, t.id) < (v_at, v_id))
    order by t.created_at desc, t.id desc
    limit v_limit + 1),
  numbered as (select p.*, row_number() over (order by p.created_at desc, p.id desc) rn, count(*) over () total from page p)
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', t.id, 'name', t.name, 'slug', t.slug, 'plan_code', t.plan_code, 'status', t.status, 'country', t.country,
      'created_at', t.created_at, 'suspended_at', t.suspended_at, 'suspended_reason', t.suspended_reason,
      'users', u.users, 'students', u.students, 'staff', u.staff,
      'classes', (select count(*) from public.classes c where c.tenant_id = t.id),
      'devices', (select count(*) from public.devices d where d.tenant_id = t.id and d.status = 'active'),
      'last_session_at', (select s.created_at from public.class_sessions s where s.tenant_id = t.id order by s.created_at desc limit 1))
      order by t.rn) filter (where t.rn <= v_limit), '[]'::jsonb),
    max(case when t.rn = v_limit and t.total > v_limit then t.created_at::text || '|' || t.id::text end)
  into v_rows, v_next
  from numbered t
  cross join lateral (select count(*) users, count(*) filter (where x.role = 'student') students,
                             count(*) filter (where x.role in ('teacher','school_admin','it_admin')) staff
                      from public.users x where x.tenant_id = t.id and t.rn <= v_limit) u;
  return jsonb_build_object('rows', v_rows, 'next_cursor', v_next);
end$$;

drop function if exists public.sa_list_users(text, uuid);
create or replace function public.sa_list_users(p_search text default null, p_tenant uuid default null,
                                                p_cursor text default null, p_limit int default 50) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_at timestamptz; v_id uuid; v_rows jsonb; v_next text;
  v_q text := nullif(btrim(p_search), '');
begin
  perform app.sa_require();
  if p_cursor is not null then
    v_at := split_part(p_cursor, '|', 1)::timestamptz; v_id := split_part(p_cursor, '|', 2)::uuid;
  end if;
  with page as (
    select u.id, u.created_at, u.full_name, u.email, u.role, u.status, u.tenant_id
    from public.users u
    where (p_tenant is null or u.tenant_id = p_tenant)
      and (v_q is null or u.full_name ilike '%' || v_q || '%' or u.email ilike '%' || v_q || '%')
      and (v_at is null or (u.created_at, u.id) < (v_at, v_id))
    order by u.created_at desc, u.id desc
    limit v_limit + 1),
  numbered as (select p.*, row_number() over (order by p.created_at desc, p.id desc) rn, count(*) over () total from page p)
  select coalesce(jsonb_agg(jsonb_build_object('id', n.id, 'full_name', n.full_name, 'email', n.email, 'role', n.role,
             'status', n.status, 'created_at', n.created_at, 'tenant_id', t.id, 'tenant', t.name, 'tenant_status', t.status)
             order by n.rn) filter (where n.rn <= v_limit), '[]'::jsonb),
         max(case when n.rn = v_limit and n.total > v_limit then n.created_at::text || '|' || n.id::text end)
  into v_rows, v_next
  from numbered n join public.tenants t on t.id = n.tenant_id;
  return jsonb_build_object('rows', v_rows, 'next_cursor', v_next);
end$$;

-- ---------------------------------------------------------------------------
-- Maintenance also refreshes the platform stats.
-- ---------------------------------------------------------------------------
create or replace function app.run_maintenance() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_ended int;
begin
  v_ended := app.end_abandoned_sessions();
  perform app.apply_retention_all();
  delete from public.invites where expires_at < now() - interval '30 days';
  delete from public.error_events where last_seen_at < now() - interval '30 days';
  perform app.refresh_platform_stats();
  return jsonb_build_object('ok', true, 'ran_at', now(), 'sessions_auto_ended', v_ended);
end$$;

create or replace function public.health() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('ok', true, 'db_time', now(), 'schema', '0760')
$$;

-- ---------- Privileges ----------
revoke execute on function app.broadcast(text, text, jsonb), app.purge_expired(text, text, text, interval, int, timestamptz),
                           app.refresh_platform_stats(), app.can_listen(text), app.can_send(text)
  from public, anon;
grant execute on function app.can_listen(text), app.can_send(text) to authenticated;
revoke execute on function public.sa_list_tenants(text, text, int), public.sa_list_users(text, uuid, text, int) from public, anon;
grant execute on function public.sa_list_tenants(text, text, int), public.sa_list_users(text, uuid, text, int) to authenticated, service_role;

-- >>>>>>>>>>>>>>>>>>>> 20260901000770_screen_channel_join.sql >>>>>>>>>>>>>>>>>>>>
-- =============================================================================
-- SwiftCipher — 0770 let a student join their own screen channel
--
-- Supabase Realtime checks the "listen" (SELECT) policy when a client joins a
-- private channel, even if the client only sends. 0760 allowed only the
-- session's teachers to listen on screen:<session>:<student>, so students
-- could not join their own channel and frames went through the REST fallback
-- (which Supabase is deprecating). The student may now join their OWN screen
-- channel while in the class; they still cannot join anyone else's.
-- =============================================================================

create or replace function app.can_listen(p_topic text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v_kind text := split_part(p_topic, ':', 1); v_id uuid; v_user uuid;
begin
  begin
    v_id := nullif(split_part(p_topic, ':', 2), '')::uuid;
    v_user := nullif(split_part(p_topic, ':', 3), '')::uuid;
  exception when others then return false; end;
  if v_id is null or app.tenant_id() is null then return false; end if;
  return case v_kind
    when 'session' then app.in_session(v_id) or app.can_manage_session(v_id)
    when 'staff'   then app.can_manage_session(v_id)
    -- teachers watch; the student may join only their own channel (to send frames)
    when 'screen'  then app.can_manage_session(v_id) or (v_user = auth.uid() and app.in_session(v_id))
    when 'user'    then v_id = auth.uid()
    when 'thread'  then exists (select 1 from public.chat_threads t where t.id = v_id and t.tenant_id = app.tenant_id()
                                and (t.student_id = auth.uid() or t.teacher_id = auth.uid()
                                     or (t.kind = 'group' and app.in_session(t.session_id)) or app.can_manage_class(t.class_id)))
    -- boards and games: exactly the people who can read the row (mirrors their RLS policies)
    when 'board'   then exists (select 1 from public.collab_boards b where b.id = v_id and b.tenant_id = app.tenant_id()
                                and (b.owner_id = auth.uid()
                                     or (b.session_id is not null and (app.can_manage_session(b.session_id) or app.in_session(b.session_id)))
                                     or (b.session_id is null and app.is_teacher())))
    when 'game'    then exists (select 1 from public.game_sessions g where g.id = v_id and g.tenant_id = app.tenant_id()
                                and (app.can_manage_class(g.class_id) or app.in_class(g.class_id)))
    when 'annot'   then app.in_session(v_id) or app.can_manage_session(v_id)
    else false end;
end$$;

create or replace function public.health() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('ok', true, 'db_time', now(), 'schema', '0770')
$$;

-- >>>>>>>>>>>>>>>>>>>> 20260901000780_anti_gaming_consent.sql >>>>>>>>>>>>>>>>>>>>
-- =============================================================================
-- SwiftCipher — 0780 anti-gaming + parental monitoring consent
--
-- 1. Games: a much larger list of game sites, a pattern check for game-site
--    copies ("unblocked games", "...games.io", game pages on free hosting such as
--    sites.google.com / github.io), used by the policy engine for managed browsers.
-- 2. Every school gets a ready-made environment "Lesson focus: no games or
--    social media" (games, social, chat, streaming, gambling, adult blocked).
-- 3. Parental monitoring consent: schools record the signed undertakings parents
--    gave (bulk, with a reference), parents can confirm or withdraw in the parent
--    portal, and a school may require consent before a student's screen is shown.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Game sites
-- ---------------------------------------------------------------------------
insert into public.domain_categories (domain, category) values
  ('roblox.com','games'),('rbxcdn.com','games'),('minecraft.net','games'),('fortnite.com','games'),('epicgames.com','games'),
  ('ea.com','games'),('origin.com','games'),('ubisoft.com','games'),('blizzard.com','games'),('battle.net','games'),
  ('riotgames.com','games'),('leagueoflegends.com','games'),('playvalorant.com','games'),('steampowered.com','games'),
  ('steamcommunity.com','games'),('xbox.com','games'),('playstation.com','games'),('nintendo.com','games'),
  ('coolmathgames.com','games'),('coolmath-games.com','games'),('poki.com','games'),('poki.io','games'),('crazygames.com','games'),
  ('miniclip.com','games'),('friv.com','games'),('friv.io','games'),('y8.com','games'),('kizi.com','games'),('agame.com','games'),
  ('armorgames.com','games'),('kongregate.com','games'),('newgrounds.com','games'),('addictinggames.com','games'),
  ('gamepix.com','games'),('gamedistribution.com','games'),('silvergames.com','games'),('mathplayground.com','games'),
  ('hoodamath.com','games'),('abcya.com','games'),('pbskids.org','games'),('nitrotype.com','games'),('typeracer.com','games'),
  ('itch.io','games'),('gamejolt.com','games'),('kbhgames.com','games'),('twoplayergames.org','games'),('1001games.com','games'),
  ('mousebreaker.com','games'),('bigfishgames.com','games'),('pogo.com','games'),('arkadium.com','games'),('msn-games.com','games'),
  ('games.co.uk','games'),('gameflare.com','games'),('lagged.com','games'),('snokido.com','games'),('gogy.com','games'),
  ('bgames.com','games'),('funnygames.org','games'),('gamesgames.com','games'),('spelletjes.nl','games'),('jeux.fr','games'),
  ('slither.io','games'),('agar.io','games'),('diep.io','games'),('krunker.io','games'),('shellshock.io','games'),
  ('zombsroyale.io','games'),('surviv.io','games'),('moomoo.io','games'),('paper-io.com','games'),('paper.io','games'),
  ('hole-io.com','games'),('skribbl.io','games'),('gartic.io','games'),('gartic.com','games'),('smashkarts.io','games'),
  ('bloxd.io','games'),('ev.io','games'),('venge.io','games'),('narrow.one','games'),('1v1.lol','games'),('justbuild.lol','games'),
  ('taming.io','games'),('starve.io','games'),('mope.io','games'),('wings.io','games'),('yohoho.io','games'),('iogames.space','games'),
  ('io-games.io','games'),('slope-game.com','games'),('slopegame.io','games'),('run3.io','games'),('retrobowl.me','games'),
  ('retro-bowl.com','games'),('geometrydash.io','games'),('geometry-dash.io','games'),('subway-surfers.org','games'),
  ('subwaysurfers.com','games'),('templerun.io','games'),('cookieclicker.eu','games'),('orteil.dashnet.org','games'),
  ('chess.com','games'),('lichess.org','games'),('chess24.com','games'),('solitaired.com','games'),('solitr.com','games'),
  ('freecell.net','games'),('2048game.com','games'),('play2048.co','games'),('tetris.com','games'),('jstris.jezevec10.com','games'),
  ('tetr.io','games'),('pacman.live','games'),('snake.io','games'),('googlesnakemods.com','games'),('neal.fun','games'),
  ('powerlinegames.com','games'),('scratch.mit.edu','education'),('code.org','education'),
  ('unblocked-games.s3.amazonaws.com','games'),('unblockedgames66.com','games'),('unblockedgames76.com','games'),
  ('unblockedgames77.com','games'),('unblockedgames911.com','games'),('tyrone-games.com','games'),('classroom6x.com','games'),
  ('now.gg','games'),('now.us','games'),('xbox.gg','games'),('geforcenow.com','games'),('play.geforcenow.com','games'),
  ('boosteroid.com','games'),('shadow.tech','games'),('luna.amazon.com','games'),('stadia.google.com','games'),
  ('bet9ja.com','gambling'),('sportybet.com','gambling'),('betking.com','gambling'),('1xbet.com','gambling'),
  ('betway.com','gambling'),('bet365.com','gambling'),('nairabet.com','gambling'),('merrybet.com','gambling'),
  ('stake.com','gambling'),('pokerstars.com','gambling')
on conflict (domain) do update set category = excluded.category;

-- Free-hosting sites where game copies live: judge them by the page address.
create or replace function app.url_category(p_url text) returns text
language sql stable set search_path = '' as $$
  with h as (select app.url_host(p_url) as host, lower(coalesce(p_url, '')) as url)
  select coalesce(
    app.domain_category(h.host),
    case
      -- the host name itself says "games"/"unblocked"/"arcade" (e.g. unblocked-games-66.github.io, slope-games.io)
      when h.host ~ '(^|[.-])(unblocked|games?|gaming|arcade|minigames?|freegames|playgames|poki|friv|y8|kizi)([0-9]*)([.-]|$)' then 'games'
      when h.host ~ '(^|\.)[a-z0-9-]*(games?|arcade)[a-z0-9-]*\.(io|lol|gg|fun|online|xyz|site|space|club|app|me)$' then 'games'
      -- game pages on free hosting (Google Sites, GitHub Pages, Glitch, Netlify, Vercel, Weebly, Wix, Replit)
      when h.host ~ '(^|\.)(sites\.google\.com|github\.io|gitlab\.io|glitch\.me|netlify\.app|vercel\.app|pages\.dev|weebly\.com|wixsite\.com|replit\.app|repl\.co|firebaseapp\.com|web\.app)$'
           and h.url ~ '(unblocked|[^a-z](games?|gaming|arcade)([^a-z]|$)|slope|retro-?bowl|1v1|minecraft|roblox|fortnite|subway|geometry-?dash|cookie-?clicker|drift|moto-?x3m|basketball-?stars|run-?3|smash-?karts)'
        then 'games'
    end)
  from h
$$;

-- The policy engine now uses url_category (domain list + patterns).

create or replace function app.evaluate_url(
  p_policy public.environment_policies, p_url text, p_tab_count int, p_app_host text
) returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  v_host text := app.url_host(p_url);
  v_cat  text;
  v_hit  text;
begin
  if v_host is null then
    return jsonb_build_object('verdict', 'neutral', 'rule', 'Browser page', 'domain', null);
  end if;
  v_cat := app.url_category(p_url);
  if p_app_host is not null and app.domain_matches(v_host, p_app_host) then
    return jsonb_build_object('verdict', 'allowed', 'rule', 'SwiftCipher', 'domain', v_host, 'category', v_cat);
  end if;
  if p_policy.id is null then
    return jsonb_build_object('verdict', 'allowed', 'rule', 'No environment active', 'domain', v_host, 'category', v_cat);
  end if;

  v_hit := app.domain_in(v_host, p_policy.blocked_domains);
  if v_hit is not null then
    return jsonb_build_object('verdict', 'violation', 'kind', 'domain_blocked', 'severity', 'critical',
                              'rule', 'Blocked domain: ' || app.normalize_domain(v_hit), 'domain', v_host, 'category', v_cat);
  end if;
  if v_cat is not null and v_cat = any (p_policy.blocked_categories) then
    return jsonb_build_object('verdict', 'violation', 'kind', 'domain_blocked', 'severity', 'warning',
                              'rule', 'Blocked category: ' || v_cat, 'domain', v_host, 'category', v_cat);
  end if;

  if app.domain_in(v_host, p_policy.allowed_domains) is not null
     or app.domain_in(v_host, p_policy.required_urls) is not null
     or (p_policy.lesson_url is not null and app.domain_matches(v_host, p_policy.lesson_url)) then
    if p_policy.tab_limit is not null and coalesce(p_tab_count, 0) > p_policy.tab_limit then
      return jsonb_build_object('verdict', 'warning', 'kind', 'tab_limit', 'severity', 'info',
                                'rule', 'More than ' || p_policy.tab_limit || ' tabs open', 'domain', v_host, 'category', v_cat);
    end if;
    return jsonb_build_object('verdict', 'allowed', 'rule', 'Allowed domain', 'domain', v_host, 'category', v_cat);
  end if;

  if p_policy.focus_mode or p_policy.lock_screen then
    return jsonb_build_object('verdict', 'violation', 'kind', 'environment_left', 'severity', 'warning',
                              'rule', 'Outside the class environment', 'domain', v_host, 'category', v_cat);
  end if;

  if v_cat in ('games','social','video','streaming','shopping','chat','gambling','adult') then
    return jsonb_build_object('verdict', 'off_task', 'kind', 'off_task', 'severity', 'info',
                              'rule', 'Looks unrelated to ' || coalesce(nullif(p_policy.subject, ''), 'the lesson') || ' (' || v_cat || ')',
                              'domain', v_host, 'category', v_cat);
  end if;

  if coalesce(array_length(p_policy.allowed_domains, 1), 0) + coalesce(array_length(p_policy.required_urls, 1), 0) > 0 then
    return jsonb_build_object('verdict', 'warning', 'kind', 'environment_left', 'severity', 'info',
                              'rule', 'Not on the class resource list', 'domain', v_host, 'category', v_cat);
  end if;
  if p_policy.tab_limit is not null and coalesce(p_tab_count, 0) > p_policy.tab_limit then
    return jsonb_build_object('verdict', 'warning', 'kind', 'tab_limit', 'severity', 'info',
                              'rule', 'More than ' || p_policy.tab_limit || ' tabs open', 'domain', v_host, 'category', v_cat);
  end if;
  return jsonb_build_object('verdict', 'allowed', 'rule', 'No rule matched', 'domain', v_host, 'category', v_cat);
end$$;

-- ---------------------------------------------------------------------------
-- 2. Ready-made "Lesson focus" environment for every school
-- ---------------------------------------------------------------------------
create or replace function app.ensure_lesson_focus(p_tenant uuid, p_owner uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  if p_owner is null or exists (select 1 from public.environment_policies
                                where tenant_id = p_tenant and name = 'Lesson focus: no games or social media') then
    return;
  end if;
  insert into public.environment_policies (tenant_id, owner_id, name, description, blocked_categories, grace_seconds, is_template, notify)
    values (p_tenant, p_owner, 'Lesson focus: no games or social media',
            'Blocks game, social media, chat, streaming, gambling and adult sites on school-managed browsers during the lesson. Students who open one are sent back and the teacher is alerted.',
            array['games','social','chat','streaming','gambling','adult'], 5, true,
            '{"banner":true,"sound":true,"browser":true,"email":false}'::jsonb);
end$$;

-- Existing schools: owned by their first administrator.
select app.ensure_lesson_focus(t.id, (select u.id from public.users u where u.tenant_id = t.id and u.role = 'school_admin'
                                        order by u.created_at limit 1))
from public.tenants t;

-- New schools: as soon as their first administrator exists.
create or replace function app.on_admin_created() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.role = 'school_admin' then perform app.ensure_lesson_focus(new.tenant_id, new.id); end if;
  return null;
end$$;
drop trigger if exists users_lesson_focus on public.users;
create trigger users_lesson_focus after insert or update of role on public.users
  for each row execute function app.on_admin_created();

-- ---------------------------------------------------------------------------
-- 3. Parental monitoring consent
-- ---------------------------------------------------------------------------
alter table public.tenant_settings
  add column if not exists require_monitoring_consent boolean not null default false;

create table if not exists public.monitoring_consents (
  student_id  uuid primary key,
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  method      text not null check (method in ('signed_undertaking','parent_portal')),
  reference   text check (length(reference) <= 200),
  recorded_by uuid,
  recorded_at timestamptz not null default now(),
  revoked_at  timestamptz,
  revoked_by  uuid,
  revoke_reason text check (length(revoke_reason) <= 500),
  foreign key (student_id, tenant_id) references public.users(id, tenant_id) on delete cascade
);
create index if not exists monitoring_consents_tenant_idx on public.monitoring_consents(tenant_id);
alter table public.monitoring_consents enable row level security;
revoke all on public.monitoring_consents from anon, authenticated;
grant select on public.monitoring_consents to authenticated;
drop policy if exists monitoring_consents_read on public.monitoring_consents;
create policy monitoring_consents_read on public.monitoring_consents for select to authenticated
  using (tenant_id = (select app.tenant_id())
         and (student_id = (select auth.uid()) or (select app.is_admin()) or app.is_parent_of(student_id) or app.teaches_student(student_id)));

create or replace function app.has_monitoring_consent(p_student uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.monitoring_consents c where c.student_id = p_student and c.revoked_at is null)
$$;

-- Admin: record signed undertakings (all students, or a list), with a reference such as "Admissions pack 2026".
create or replace function public.record_monitoring_consent(p_reference text, p_students uuid[] default null) returns int
language plpgsql volatile security definer set search_path = '' as $$
declare v_n int;
begin
  if not app.is_admin() then raise exception 'Administrators only.' using errcode = '42501'; end if;
  if coalesce(btrim(p_reference), '') = '' then raise exception 'Give a reference for the signed undertakings (e.g. "Admissions pack 2026").' using errcode = '22023'; end if;
  insert into public.monitoring_consents (student_id, tenant_id, method, reference, recorded_by)
    select u.id, u.tenant_id, 'signed_undertaking', left(btrim(p_reference), 200), auth.uid()
    from public.users u
    where u.tenant_id = app.tenant_id() and u.role = 'student'
      and (p_students is null or u.id = any (p_students))
  on conflict (student_id) do update
    set method = 'signed_undertaking', reference = excluded.reference, recorded_by = excluded.recorded_by,
        recorded_at = now(), revoked_at = null, revoked_by = null, revoke_reason = null;
  get diagnostics v_n = row_count;
  perform app.audit('privacy.monitoring_consent_recorded', 'tenant', app.tenant_id()::text,
                    jsonb_build_object('students', v_n, 'reference', left(btrim(p_reference), 200)));
  return v_n;
end$$;

-- Parent (linked, portal enabled): confirm or withdraw consent for their child.
create or replace function public.parent_monitoring_consent(p_student uuid, p_consent boolean, p_reason text default null) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_tenant uuid;
begin
  if not app.is_parent_of(p_student) then raise exception 'Not your child.' using errcode = '42501'; end if;
  select tenant_id into v_tenant from public.users where id = p_student;
  if p_consent then
    insert into public.monitoring_consents (student_id, tenant_id, method, reference, recorded_by)
      values (p_student, v_tenant, 'parent_portal', 'Confirmed in the parent portal', auth.uid())
      on conflict (student_id) do update set method = 'parent_portal', reference = excluded.reference,
        recorded_by = excluded.recorded_by, recorded_at = now(), revoked_at = null, revoked_by = null, revoke_reason = null;
  else
    update public.monitoring_consents set revoked_at = now(), revoked_by = auth.uid(), revoke_reason = left(p_reason, 500)
     where student_id = p_student and revoked_at is null;
  end if;
  perform app.audit(case when p_consent then 'privacy.monitoring_consent_given' else 'privacy.monitoring_consent_withdrawn' end,
                    'user', p_student::text, '{}'::jsonb, v_tenant, auth.uid());
end$$;

-- Admin: withdraw (e.g. a parent asked in writing).
create or replace function public.revoke_monitoring_consent(p_student uuid, p_reason text) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not app.is_admin() then raise exception 'Administrators only.' using errcode = '42501'; end if;
  update public.monitoring_consents set revoked_at = now(), revoked_by = auth.uid(), revoke_reason = left(p_reason, 500)
   where student_id = p_student and tenant_id = app.tenant_id() and revoked_at is null;
  perform app.audit('privacy.monitoring_consent_withdrawn', 'user', p_student::text, jsonb_build_object('reason', left(p_reason, 500)));
end$$;

-- Admin overview: how many students have consent on file, and who doesn't (first 200).
create or replace function public.monitoring_consent_summary() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.is_admin() then raise exception 'Administrators only.' using errcode = '42501'; end if;
  return jsonb_build_object(
    'required', (select require_monitoring_consent from public.tenant_settings where tenant_id = app.tenant_id()),
    'students', (select count(*) from public.users where tenant_id = app.tenant_id() and role = 'student'),
    'with_consent', (select count(*) from public.monitoring_consents c where c.tenant_id = app.tenant_id() and c.revoked_at is null),
    'missing', (select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'name', u.full_name, 'email', u.email) order by u.full_name), '[]'::jsonb)
                from (select * from public.users u where u.tenant_id = app.tenant_id() and u.role = 'student'
                      and not app.has_monitoring_consent(u.id) order by u.full_name limit 200) u));
end$$;

revoke execute on function public.record_monitoring_consent(text, uuid[]), public.parent_monitoring_consent(uuid, boolean, text),
                           public.revoke_monitoring_consent(uuid, text), public.monitoring_consent_summary(),
                           app.has_monitoring_consent(uuid), app.url_category(text), app.ensure_lesson_focus(uuid, uuid)
  from public, anon;
grant execute on function public.record_monitoring_consent(text, uuid[]), public.parent_monitoring_consent(uuid, boolean, text),
                          public.revoke_monitoring_consent(uuid, text), public.monitoring_consent_summary()
  to authenticated, service_role;
grant execute on function app.has_monitoring_consent(uuid), app.url_category(text) to authenticated, service_role;

-- Screens are only requested from students whose consent is on file, when the school requires it.
create or replace function public.student_report(
  p_session uuid, p_visible boolean, p_fullscreen boolean, p_sharing boolean,
  p_surface text default null, p_unsupported boolean default false,
  p_slide int default null, p_idle boolean default false
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_s        public.class_sessions;
  v_p        public.session_participants;
  v_old      public.session_participants;
  v_set      public.tenant_settings;
  v_reason   text;
  v_setup    boolean := false;
  v_status   text := case when p_idle then 'idle' else 'online' end;
  v_slide    int;
  v_changed  boolean;
  v_returned int;
  v_capture  boolean;
begin
  select * into v_s from public.class_sessions where id = p_session;
  if v_s.id is null or not app.in_class(v_s.class_id) then raise exception 'Session not found.' using errcode = 'P0002'; end if;
  if v_s.status <> 'live' then return jsonb_build_object('status', v_s.status, 'state_version', v_s.state_version); end if;
  select * into v_set from public.tenant_settings where tenant_id = v_s.tenant_id;
  -- Screen sharing is requested only if the school allows it and, where the school
  -- requires it, a parent/guardian monitoring consent is on file for this student.
  v_capture := v_set.allow_screen_capture and (not v_set.require_monitoring_consent or app.has_monitoring_consent(auth.uid()));

  v_reason := case
    when not v_s.lockdown then null
    when not coalesce(p_visible, true) then 'Left the lesson (switched tab, app or window)'
    when not coalesce(p_fullscreen, false) and not p_unsupported then 'Left full-screen mode'
    when v_capture and not coalesce(p_sharing, false) and not p_unsupported then 'Stopped sharing their screen'
  end;

  select * into v_old from public.session_participants where session_id = p_session and user_id = auth.uid();
  if v_old.session_id is null then
    insert into public.session_participants (session_id, user_id, tenant_id, status, current_slide)
      values (p_session, auth.uid(), v_s.tenant_id, v_status, v_s.current_slide)
      on conflict (session_id, user_id) do nothing;
    select * into v_old from public.session_participants where session_id = p_session and user_id = auth.uid();
  end if;

  if v_reason is not null and v_old.ready_at is null then
    if v_old.joined_at > now() - interval '2 minutes' then v_reason := null; v_setup := true;
    else v_reason := 'Did not start the lesson (screen share and full screen are required)'; end if;
  end if;

  v_slide := case when v_s.mode = 'student_paced' then coalesce(case when p_slide >= 0 then p_slide end, v_old.current_slide)
                  else v_s.current_slide end;

  v_changed := v_old.left_at is not null
    or v_old.status is distinct from v_status
    or v_old.current_slide is distinct from v_slide
    or v_old.tab_visible is distinct from coalesce(p_visible, true)
    or v_old.fullscreen is distinct from coalesce(p_fullscreen, false)
    or v_old.screen_sharing is distinct from coalesce(p_sharing, false)
    or v_old.share_unsupported is distinct from coalesce(p_unsupported, false)
    or v_old.screen_surface is distinct from left(p_surface, 20)
    or v_old.away_reason is distinct from v_reason
    or (v_reason is null and not v_setup and v_old.ready_at is null);

  -- Presence only needs a write every 15 s; everything else writes on change.
  if v_changed or v_old.last_seen_at < now() - make_interval(secs => app.tick_seconds() * 1.5) then
    update public.session_participants set
      last_seen_at = now(), left_at = null, status = v_status, current_slide = v_slide,
      tab_visible = coalesce(p_visible, true), fullscreen = coalesce(p_fullscreen, false),
      screen_sharing = coalesce(p_sharing, false), share_unsupported = coalesce(p_unsupported, false),
      screen_surface = left(p_surface, 20),
      ready_at = case when v_reason is null and not v_setup then coalesce(ready_at, now()) else ready_at end,
      away_since = case when v_reason is null then null else coalesce(away_since, now()) end,
      away_reason = v_reason
    where session_id = p_session and user_id = auth.uid()
    returning * into v_p;
  else
    v_p := v_old;
  end if;

  if v_setup then
    null;
  elsif v_reason is null then
    -- Only look for alerts to close if the student may have had one.
    if v_old.away_since is not null or v_old.left_at is not null or v_old.last_seen_at < now() - interval '40 seconds' then
      update public.environment_events set resolved_at = now()
       where class_session_id = p_session and student_id = auth.uid() and resolved_at is null
         and kind = 'environment_left' and device_id is null;
      get diagnostics v_returned = row_count;
      if v_returned > 0 then
        perform app.notify(v_s.teacher_id, 'student_returned',
          (select full_name from public.users where id = auth.uid()) || ' returned to the class', null,
          '/teacher/live/' || p_session, 'info', jsonb_build_object('student_id', auth.uid()));
      end if;
    end if;
  else
    perform app.web_leave_check(v_s);
  end if;

  return jsonb_build_object(
    'status', v_s.status,
    'lockdown', v_s.lockdown,
    'away', v_reason is not null,
    'reason', v_reason,
    'setting_up', v_setup,
    'tick_seconds', app.tick_seconds(),
    'state_version', v_s.state_version,
    'current_slide', v_s.current_slide,
    'active_activity_id', v_s.active_activity_id,
    'capture', jsonb_build_object(
      'enabled', v_capture,
      -- frames are only worth sending while a teacher has the live room open
      'send', v_capture and coalesce(v_s.teacher_seen_at > now() - interval '45 seconds', false),
      'interval_seconds', greatest(v_set.thumbnail_interval_seconds, 5),
      'high_quality', v_p.hq_requested_at is not null and v_p.hq_requested_at > now() - interval '30 seconds'
                      or exists (select 1 from public.spotlights sp where sp.session_id = p_session
                                 and sp.student_id = auth.uid() and sp.ended_at is null)));
end$$;

-- Admins change the new setting from Admin → Settings (column-level grant, like the others).
grant update (require_monitoring_consent) on public.tenant_settings to authenticated;

create or replace function public.health() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('ok', true, 'db_time', now(), 'schema', '0780')
$$;

-- >>>>>>>>>>>>>>>>>>>> 20260901000790_engaging_learning.sql >>>>>>>>>>>>>>>>>>>>
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

-- >>>>>>>>>>>>>>>>>>>> 20260901000800_fair_play.sql >>>>>>>>>>>>>>>>>>>>
-- =============================================================================
-- SwiftCipher — 0800 fair play: what teachers complain about in Kahoot, Blooket,
-- Gimkit, Wayground (Quizizz) and Nearpod, fixed; what they love, included.
--
-- Answers are locked once revealed. With instant feedback a student could see
--   the correct answer and resubmit it for full marks; now a revealed answer is
--   final. Optional "second chance" (Wayground's redemption questions): a wrong
--   answer may be tried once more for half credit, and the correct answer is
--   only shown after that second try.
-- Accuracy over speed (the top complaint about Kahoot): games can run untimed,
--   with no speed bonus, so careful thinkers and English learners are not
--   punished. A "class goal" mode makes the whole class work together towards
--   one target instead of ranking children against each other.
-- Lock the game (Kahoot's lobby lock): no one else can join once the teacher
--   has started, and players stay signed-in students of the class (no bots).
-- Learning supports (Wayground's accommodations), set privately per student:
--   read aloud, easy-to-read font, extra time on timed work, calm mode.
-- Students write questions (Gimkit's KitCollab): the teacher opens a quiz for
--   question writing, students submit questions with an explanation, the
--   teacher approves them into the quiz; approved authors earn XP and a badge.
-- Gradebook export (a Nearpod complaint): one CSV per class, every student and
--   every assignment.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Schema
-- ---------------------------------------------------------------------------
alter table public.quiz_answers
  add column if not exists tries smallint not null default 1 check (tries between 1 and 2),
  add column if not exists revealed boolean not null default false;

create table if not exists public.student_supports (
  student_id      uuid primary key,
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  read_aloud      boolean not null default false,
  readable_font   boolean not null default false,
  extra_time_pct  smallint not null default 0 check (extra_time_pct in (0, 25, 50, 100)),
  calm_mode       boolean not null default false,
  note            text check (length(note) <= 500),   -- staff only, never shown to the student
  updated_by      uuid,
  updated_at      timestamptz not null default now(),
  foreign key (student_id, tenant_id) references public.users(id, tenant_id) on delete cascade
);
create index if not exists student_supports_tenant_idx on public.student_supports(tenant_id);

create table if not exists public.question_collabs (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  class_id    uuid not null,
  activity_id uuid not null,
  opened_by   uuid not null,
  is_open     boolean not null default true,
  prompt      text check (length(prompt) <= 500),    -- what the teacher wants questions about
  created_at  timestamptz not null default now(),
  unique (class_id, activity_id),
  unique (id, tenant_id),
  foreign key (class_id, tenant_id) references public.classes(id, tenant_id) on delete cascade,
  foreign key (activity_id, tenant_id) references public.activities(id, tenant_id) on delete cascade,
  foreign key (opened_by, tenant_id) references public.users(id, tenant_id) deferrable initially deferred
);
create index if not exists question_collabs_activity_idx on public.question_collabs(activity_id);
create index if not exists question_collabs_tenant_idx on public.question_collabs(tenant_id);

create table if not exists public.question_submissions (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  collab_id    uuid not null,
  student_id   uuid not null,
  prompt       text not null check (length(btrim(prompt)) between 5 and 1000),
  options      jsonb not null,             -- [{ "label": text, "correct": bool }], 2–6 items, exactly one correct
  explanation  text not null check (length(btrim(explanation)) between 10 and 1000),
  status       text not null default 'pending' check (status in ('pending','approved','returned')),
  feedback     text check (length(feedback) <= 1000),
  question_id  uuid,
  reviewed_by  uuid,
  reviewed_at  timestamptz,
  created_at   timestamptz not null default now(),
  unique (id, tenant_id),
  foreign key (collab_id, tenant_id) references public.question_collabs(id, tenant_id) on delete cascade,
  foreign key (student_id, tenant_id) references public.users(id, tenant_id) on delete cascade,
  foreign key (question_id) references public.questions(id) on delete set null (question_id),
  foreign key (reviewed_by) references public.users(id) on delete set null (reviewed_by)
);
create index if not exists question_submissions_collab_idx on public.question_submissions(collab_id, status);
create index if not exists question_submissions_student_idx on public.question_submissions(student_id);
create index if not exists question_submissions_tenant_idx on public.question_submissions(tenant_id);
create index if not exists question_submissions_question_idx on public.question_submissions(question_id) where question_id is not null;
create index if not exists question_submissions_reviewer_idx on public.question_submissions(reviewed_by) where reviewed_by is not null;
create index if not exists question_collabs_opened_by_idx on public.question_collabs(opened_by);

-- XP and a badge for approved questions.
alter table public.xp_events drop constraint if exists xp_events_source_check;
alter table public.xp_events add constraint xp_events_source_check
  check (source in ('answer','reasoning','completion','perfect','game','teacher','question'));
alter table public.student_badges drop constraint if exists student_badges_badge_check;
alter table public.student_badges add constraint student_badges_badge_check
  check (badge in ('first_steps','rising_star','scholar','deep_thinker','perfectionist','challenger','shout_out','game_on','author'));

-- Reads go through RPCs; students may read their own supports and submissions directly.
alter table public.student_supports enable row level security;
alter table public.question_collabs enable row level security;
alter table public.question_submissions enable row level security;
revoke all on public.student_supports, public.question_collabs, public.question_submissions from anon, authenticated;
grant select on public.student_supports, public.question_collabs, public.question_submissions to authenticated;
drop policy if exists student_supports_read on public.student_supports;
create policy student_supports_read on public.student_supports for select to authenticated
  using (tenant_id = (select app.tenant_id())
         and (student_id = (select auth.uid()) or (select app.is_admin()) or app.teaches_student(student_id)));
drop policy if exists question_collabs_read on public.question_collabs;
create policy question_collabs_read on public.question_collabs for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (app.in_class(class_id) or app.can_manage_class(class_id)));
drop policy if exists question_submissions_read on public.question_submissions;
create policy question_submissions_read on public.question_submissions for select to authenticated
  using (tenant_id = (select app.tenant_id())
         and (student_id = (select auth.uid())
              or exists (select 1 from public.question_collabs c where c.id = collab_id and app.can_manage_class(c.class_id))));

-- ---------------------------------------------------------------------------
-- Badges: add "Question author"
-- ---------------------------------------------------------------------------
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
        when 'shout_out' then 'Teacher shout-out' when 'game_on' then 'Game on' when 'author' then 'Question author'
        else p_badge end,
      null, '/student', 'info', jsonb_build_object('badge', p_badge));
  end if;
end$$;

-- ---------------------------------------------------------------------------
-- Answers: locked once revealed; optional second chance for half credit
-- ---------------------------------------------------------------------------
create or replace function public.submit_answer(
  p_attempt uuid, p_question uuid, p_response jsonb, p_elapsed_ms int default null
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me       public.users := app.me();
  v_attempt  public.quiz_attempts;
  v_act      public.activities;
  v_q        public.questions;
  v_prev     public.quiz_answers;
  v_grade    jsonb;
  v_feedback text;
  v_instant  boolean;
  v_second   boolean;
  v_tries    smallint := 1;
  v_score    numeric;
  v_reveal   boolean;
begin
  select * into v_attempt from public.quiz_attempts where id = p_attempt and student_id = v_me.id for update;
  if v_attempt.id is null then raise exception 'Attempt not found.' using errcode = 'P0002'; end if;
  if v_attempt.status <> 'in_progress' then raise exception 'This attempt has already been submitted.' using errcode = 'P0001'; end if;
  if v_attempt.deadline_at is not null and now() > v_attempt.deadline_at + interval '5 seconds' then
    perform public.finish_attempt(p_attempt);
    raise exception 'Time is up — your attempt was submitted.' using errcode = 'P0001';
  end if;
  if length(p_response::text) > 200000 then raise exception 'Response is too large.' using errcode = '22023'; end if;

  select * into v_q from public.questions where id = p_question and activity_id = v_attempt.activity_id;
  if v_q.id is null then raise exception 'Question not in this activity.' using errcode = 'P0002'; end if;
  select * into v_act from public.activities where id = v_attempt.activity_id;
  v_feedback := coalesce(v_act.settings ->> 'show_feedback', 'after_submit');
  v_second := coalesce((v_act.settings ->> 'redemption')::boolean, false);
  v_grade := app.grade_response(v_q, p_response);
  v_instant := v_feedback = 'immediately' and v_grade ->> 'status' = 'auto_graded';
  v_score := (v_grade ->> 'score')::numeric;

  select * into v_prev from public.quiz_answers where attempt_id = p_attempt and question_id = p_question;
  if v_prev.id is not null then
    -- Once the correct answer has been shown, the answer is final.
    if v_prev.revealed then
      raise exception 'You have already answered this question. Move on to the next one.' using errcode = 'P0001';
    end if;
    -- Second chance: only after a wrong first try with instant feedback. Worth half,
    -- but never less than any partial credit the first try already earned.
    if v_instant and v_second and v_prev.is_correct is false and v_prev.tries = 1 then
      v_tries := 2;
      v_score := greatest(round(coalesce(v_score, 0) * 0.5, 2), coalesce(v_prev.auto_score, 0));
    end if;
  end if;

  -- With a second chance on, a wrong first try says "not quite" without showing the answer.
  v_reveal := v_instant and not (v_second and v_tries = 1 and (v_grade ->> 'is_correct')::boolean is false);

  insert into public.quiz_answers (tenant_id, attempt_id, question_id, response, is_correct, auto_score, status, elapsed_ms, tries, revealed)
    values (v_me.tenant_id, p_attempt, p_question, p_response, (v_grade ->> 'is_correct')::boolean,
            v_score, v_grade ->> 'status', greatest(coalesce(p_elapsed_ms, 0), 0), v_tries, v_reveal)
    on conflict (attempt_id, question_id) do update
      set response = excluded.response, is_correct = excluded.is_correct, auto_score = excluded.auto_score,
          status = excluded.status, elapsed_ms = excluded.elapsed_ms, answered_at = now(),
          tries = excluded.tries, revealed = excluded.revealed;

  if v_instant and v_reveal then
    return jsonb_build_object('saved', true, 'status', v_grade ->> 'status', 'tries', v_tries,
                              'is_correct', (v_grade ->> 'is_correct')::boolean, 'score', v_score)
           || app.reveal_answer(v_q);
  elsif v_instant then
    return jsonb_build_object('saved', true, 'status', v_grade ->> 'status', 'tries', v_tries,
                              'is_correct', false, 'second_chance', true);
  end if;
  return jsonb_build_object('saved', true, 'status', v_grade ->> 'status');
end$$;

-- ---------------------------------------------------------------------------
-- Extra time: start_attempt (0790) with the student's extra-time support applied
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
  v_extra    int;
  v_shuffle_q boolean;
  v_shuffle_o boolean;
  v_level    smallint;
  v_retry    boolean;
begin
  select * into v_act from public.activities where id = p_activity and tenant_id = v_me.tenant_id;
  if v_act.id is null then raise exception 'Activity not found.' using errcode = 'P0002'; end if;
  -- Second chances exist only with instant feedback (otherwise right/wrong stays hidden until submit).
  v_retry := coalesce(v_act.settings ->> 'show_feedback', 'after_submit') = 'immediately'
             and coalesce((v_act.settings ->> 'redemption')::boolean, false);
  if not app.attempt_context_ok(v_act, p_session, p_assignment, p_share) then
    raise exception 'This activity is not open for you right now.' using errcode = '42501';
  end if;

  -- Resume an unfinished attempt in the same context (§30 reconnect).
  select * into v_attempt from public.quiz_attempts
   where activity_id = p_activity and student_id = v_me.id and status = 'in_progress'
     and session_id is not distinct from p_session and assignment_id is not distinct from p_assignment
   order by attempt_no desc limit 1;

  if v_attempt.id is null then
    if coalesce((v_act.settings ->> 'differentiate')::boolean, false) then
      select coalesce(m.level, 2) into v_level from public.class_members m
       where m.user_id = v_me.id and m.role = 'student'
         and m.class_id = coalesce((select s.class_id from public.class_sessions s where s.id = p_session),
                                   (select a.class_id from public.assignments a where a.id = p_assignment));
      v_level := coalesce(v_level, 2);
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
    select coalesce(extra_time_pct, 0) into v_extra from public.student_supports where student_id = v_me.id;
    if v_limit is not null and coalesce(v_extra, 0) > 0 then
      v_limit := v_limit + (v_limit * v_extra / 100);
    end if;
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
                from public.quiz_answers a where a.attempt_id = v_attempt.id),
    -- Which answers are final (already revealed) and which are on their second try.
    'locked', (select coalesce(jsonb_object_agg(a.question_id, jsonb_build_object('revealed', a.revealed, 'tries', a.tries, 'is_correct', a.is_correct)), '{}'::jsonb)
               from public.quiz_answers a where a.attempt_id = v_attempt.id
                and (a.revealed or (v_retry and a.tries = 1 and a.is_correct is false))));
end$$;

-- ---------------------------------------------------------------------------
-- Games: untimed (accuracy first), class goal, lobby lock
-- ---------------------------------------------------------------------------
create or replace function app.game_settings(p jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    -- 0 = untimed: the teacher moves on when the class is ready; no speed bonus.
    'question_seconds', case when coalesce((p ->> 'question_seconds')::int, 20) = 0 then 0
                             else least(greatest(coalesce((p ->> 'question_seconds')::int, 20), 5), 240) end,
    'speed_bonus',      coalesce((p ->> 'speed_bonus')::boolean, true) and coalesce((p ->> 'question_seconds')::int, 20) <> 0,
    'streak_bonus',     coalesce((p ->> 'streak_bonus')::boolean, true),
    'rank_visibility',  case when coalesce((p ->> 'class_goal')::boolean, false) then 'hidden'
                             when p ->> 'rank_visibility' in ('after_each','end_only','hidden') then p ->> 'rank_visibility' else 'after_each' end,
    'display_mode',     case when p ->> 'display_mode' in ('first_name_initial','nickname','anonymous') then p ->> 'display_mode' else 'first_name_initial' end,
    'team_mode',        coalesce((p ->> 'team_mode')::boolean, false),
    'team_count',       least(greatest(coalesce((p ->> 'team_count')::int, 2), 2), 6),
    'shuffle_questions', coalesce((p ->> 'shuffle_questions')::boolean, false),
    'shuffle_options',  coalesce((p ->> 'shuffle_options')::boolean, true),
    'podium_size',      least(greatest(coalesce((p ->> 'podium_size')::int, 3), 1), 10),
    'certificates',     coalesce((p ->> 'certificates')::boolean, true),
    -- Whole class works towards one target: this share of all answers correct.
    'class_goal',       coalesce((p ->> 'class_goal')::boolean, false),
    'goal_percent',     least(greatest(coalesce((p ->> 'goal_percent')::int, 70), 30), 100),
    'locked',           coalesce((p ->> 'locked')::boolean, false))
$$;

create or replace function app.open_question(p_game public.game_sessions, p_index int) returns void
language sql volatile security definer set search_path = '' as $$
  update public.game_sessions set status = 'question', current_index = p_index,
    question_started_at = now(),
    -- Untimed questions stay open (up to an hour) until everyone answers or the teacher moves on.
    question_ends_at = now() + case when (p_game.settings ->> 'question_seconds')::int = 0 then interval '1 hour'
                                    else make_interval(secs => (p_game.settings ->> 'question_seconds')::int) end,
    started_at = coalesce(started_at, now())
  where id = p_game.id
$$;

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
  if coalesce((v_game.settings ->> 'locked')::boolean, false) then
    raise exception 'Your teacher has locked this game. Ask them to let you in.' using errcode = 'P0001';
  end if;

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
    when 'lock' then
      update public.game_sessions set settings = settings || '{"locked": true}'::jsonb where id = p_game;
    when 'unlock' then
      update public.game_sessions set settings = settings || '{"locked": false}'::jsonb where id = p_game;
    else raise exception 'Unknown action.' using errcode = '22023';
  end case;
  perform app.audit('game.' || p_action, 'game', p_game::text);
  select * into v from public.game_sessions where id = p_game;
  return jsonb_build_object('status', v.status, 'current_index', v.current_index, 'locked', coalesce((v.settings ->> 'locked')::boolean, false));
end$$;

-- Class goal progress, for the host and every player.
create or replace function public.game_goal(p_game uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v public.game_sessions; v_players int; v_asked int; v_correct int;
begin
  select * into v from public.game_sessions where id = p_game;
  if v.id is null then raise exception 'Game not found.' using errcode = 'P0002'; end if;
  if not app.can_manage_class(v.class_id) and not app.in_class(v.class_id) then raise exception 'Not your game.' using errcode = '42501'; end if;
  select count(*) into v_players from public.game_players where game_id = p_game;
  v_asked := greatest(v.current_index + 1, 0);
  select count(*) into v_correct from public.game_answers where game_id = p_game and is_correct;
  return jsonb_build_object('enabled', coalesce((v.settings ->> 'class_goal')::boolean, false),
    'correct', v_correct,
    'target', ceil(v_players * coalesce(array_length(v.question_order, 1), 0) * (v.settings ->> 'goal_percent')::numeric / 100),
    'possible_so_far', v_players * v_asked,
    'goal_percent', (v.settings ->> 'goal_percent')::int);
end$$;

-- ---------------------------------------------------------------------------
-- Learning supports (accommodations), set privately by the student's teachers
-- ---------------------------------------------------------------------------
create or replace function public.set_student_supports(
  p_class uuid, p_student uuid, p_read_aloud boolean, p_readable_font boolean, p_extra_time_pct int,
  p_calm_mode boolean, p_note text default null
) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_me public.users := app.me();
begin
  if not app.can_manage_class(p_class) then raise exception 'Not your class.' using errcode = '42501'; end if;
  if not exists (select 1 from public.class_members where class_id = p_class and user_id = p_student and role = 'student') then
    raise exception 'That student is not in this class.' using errcode = 'P0002';
  end if;
  if coalesce(p_extra_time_pct, 0) not in (0, 25, 50, 100) then
    raise exception 'Extra time is 0, 25, 50 or 100 percent.' using errcode = '22023';
  end if;
  insert into public.student_supports (student_id, tenant_id, read_aloud, readable_font, extra_time_pct, calm_mode, note, updated_by, updated_at)
    values (p_student, v_me.tenant_id, coalesce(p_read_aloud, false), coalesce(p_readable_font, false),
            coalesce(p_extra_time_pct, 0), coalesce(p_calm_mode, false), nullif(btrim(coalesce(p_note, '')), ''), v_me.id, now())
    on conflict (student_id) do update set read_aloud = excluded.read_aloud, readable_font = excluded.readable_font,
      extra_time_pct = excluded.extra_time_pct, calm_mode = excluded.calm_mode, note = excluded.note,
      updated_by = excluded.updated_by, updated_at = now();
  perform app.audit('student.supports_set', 'user', p_student::text,
    jsonb_build_object('class_id', p_class, 'read_aloud', p_read_aloud, 'readable_font', p_readable_font,
                       'extra_time_pct', p_extra_time_pct, 'calm_mode', p_calm_mode));
end$$;

create or replace function public.class_supports(p_class uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.can_manage_class(p_class) then raise exception 'Not your class.' using errcode = '42501'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'student_id', u.id, 'name', u.full_name,
      'read_aloud', coalesce(s.read_aloud, false), 'readable_font', coalesce(s.readable_font, false),
      'extra_time_pct', coalesce(s.extra_time_pct, 0), 'calm_mode', coalesce(s.calm_mode, false), 'note', s.note)
      order by u.full_name), '[]'::jsonb)
    from public.class_members m join public.users u on u.id = m.user_id
    left join public.student_supports s on s.student_id = u.id
    where m.class_id = p_class and m.role = 'student');
end$$;

-- The student's own supports (the staff note is never included).
create or replace function public.my_supports() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('read_aloud', coalesce(s.read_aloud, false), 'readable_font', coalesce(s.readable_font, false),
                            'extra_time_pct', coalesce(s.extra_time_pct, 0), 'calm_mode', coalesce(s.calm_mode, false))
  from (select 1) x left join public.student_supports s on s.student_id = auth.uid()
$$;

-- ---------------------------------------------------------------------------
-- Students write questions (teacher approves)
-- ---------------------------------------------------------------------------
create or replace function public.open_question_collab(p_class uuid, p_activity uuid, p_open boolean, p_prompt text default null)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_me public.users := app.me(); v public.question_collabs; v_title text;
begin
  if not app.can_manage_class(p_class) then raise exception 'Not your class.' using errcode = '42501'; end if;
  select title into v_title from public.activities where id = p_activity and tenant_id = v_me.tenant_id;
  if v_title is null or not app.can_view_activity(p_activity) then raise exception 'Quiz not found.' using errcode = 'P0002'; end if;
  insert into public.question_collabs (tenant_id, class_id, activity_id, opened_by, is_open, prompt)
    values (v_me.tenant_id, p_class, p_activity, v_me.id, p_open, nullif(btrim(coalesce(p_prompt, '')), ''))
    on conflict (class_id, activity_id) do update set is_open = excluded.is_open,
      prompt = coalesce(excluded.prompt, public.question_collabs.prompt)
    returning * into v;
  if p_open then
    perform app.notify(m.user_id, 'question_collab', 'Write a question for ' || v_title,
                       coalesce(v.prompt, 'Your teacher wants your best question. Include the right answer and why.'),
                       '/student', 'info', jsonb_build_object('collab_id', v.id))
    from public.class_members m where m.class_id = p_class and m.role = 'student';
  end if;
  perform app.audit(case when p_open then 'collab.opened' else 'collab.closed' end, 'question_collab', v.id::text);
  return to_jsonb(v);
end$$;

create or replace function public.my_collabs() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', c.id, 'title', a.title, 'class', cl.name, 'prompt', c.prompt,
      'mine', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'prompt', s.prompt, 'status', s.status, 'feedback', s.feedback)
                                         order by s.created_at desc), '[]'::jsonb)
               from public.question_submissions s where s.collab_id = c.id and s.student_id = auth.uid()))
      order by c.created_at desc), '[]'::jsonb)
  from public.question_collabs c
  join public.class_members m on m.class_id = c.class_id and m.user_id = auth.uid() and m.role = 'student'
  join public.activities a on a.id = c.activity_id
  join public.classes cl on cl.id = c.class_id
  where c.is_open
$$;

create or replace function public.submit_question(p_collab uuid, p_prompt text, p_options jsonb, p_explanation text)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_me public.users := app.me(); v_c public.question_collabs; v_n int; v_correct int; v_id uuid;
begin
  select * into v_c from public.question_collabs where id = p_collab;
  if v_c.id is null or not v_c.is_open then raise exception 'Question writing is closed for this quiz.' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.class_members where class_id = v_c.class_id and user_id = v_me.id and role = 'student') then
    raise exception 'This is for another class.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_options) <> 'array' then raise exception 'Add answer choices.' using errcode = '22023'; end if;
  v_n := jsonb_array_length(p_options);
  select count(*) into v_correct from jsonb_array_elements(p_options) o where (o ->> 'correct')::boolean;
  if v_n < 2 or v_n > 6 then raise exception 'Give between 2 and 6 answer choices.' using errcode = '22023'; end if;
  if v_correct <> 1 then raise exception 'Mark exactly one choice as correct.' using errcode = '22023'; end if;
  if exists (select 1 from jsonb_array_elements(p_options) o where length(btrim(coalesce(o ->> 'label', ''))) not between 1 and 300) then
    raise exception 'Every choice needs text (up to 300 characters).' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_explanation, ''))) < 10 then
    raise exception 'Explain why the correct answer is right (at least one sentence).' using errcode = '22023';
  end if;
  if (select count(*) from public.question_submissions where collab_id = p_collab and student_id = v_me.id and status = 'pending') >= 5 then
    raise exception 'You have 5 questions waiting for your teacher. Wait for feedback before adding more.' using errcode = 'P0001';
  end if;
  insert into public.question_submissions (tenant_id, collab_id, student_id, prompt, options, explanation)
    values (v_me.tenant_id, p_collab, v_me.id, btrim(p_prompt),
            (select jsonb_agg(jsonb_build_object('label', btrim(o ->> 'label'), 'correct', coalesce((o ->> 'correct')::boolean, false)))
             from jsonb_array_elements(p_options) o),
            btrim(p_explanation))
    returning id into v_id;
  return jsonb_build_object('id', v_id);
end$$;

create or replace function public.collab_submissions(p_activity uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'id', s.id, 'student', u.full_name, 'class', cl.name, 'prompt', s.prompt, 'options', s.options,
      'explanation', s.explanation, 'status', s.status, 'feedback', s.feedback, 'created_at', s.created_at)
      order by (s.status = 'pending') desc, s.created_at), '[]'::jsonb)
    from public.question_submissions s
    join public.question_collabs c on c.id = s.collab_id
    join public.users u on u.id = s.student_id
    join public.classes cl on cl.id = c.class_id
    where c.activity_id = p_activity and app.can_manage_class(c.class_id));
end$$;

create or replace function public.review_question_submission(p_submission uuid, p_action text, p_feedback text default null)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_me public.users := app.me(); v_s public.question_submissions; v_c public.question_collabs; v_q uuid; v_pos int; v_name text;
begin
  select * into v_s from public.question_submissions where id = p_submission for update;
  if v_s.id is null then raise exception 'Question not found.' using errcode = 'P0002'; end if;
  select * into v_c from public.question_collabs where id = v_s.collab_id;
  if not app.can_manage_class(v_c.class_id) then raise exception 'Not your class.' using errcode = '42501'; end if;
  if v_s.status = 'approved' then raise exception 'Already added to the quiz.' using errcode = 'P0001'; end if;

  if p_action = 'approve' then
    select coalesce(max(position), -1) + 1 into v_pos from public.questions where activity_id = v_c.activity_id;
    select full_name into v_name from public.users where id = v_s.student_id;
    insert into public.questions (tenant_id, activity_id, owner_id, kind, prompt, explanation, points, position, config)
      values (v_s.tenant_id, v_c.activity_id, v_me.id, 'mcq', v_s.prompt, v_s.explanation, 1, v_pos,
              jsonb_build_object('authored_by', app.display_name(v_name)))
      returning id into v_q;
    insert into public.question_options (tenant_id, question_id, label, is_correct, position)
      select v_s.tenant_id, v_q, o.value ->> 'label', (o.value ->> 'correct')::boolean, (o.ordinality - 1)::int
      from jsonb_array_elements(v_s.options) with ordinality o;
    update public.question_submissions set status = 'approved', question_id = v_q, feedback = nullif(btrim(coalesce(p_feedback, '')), ''),
      reviewed_by = v_me.id, reviewed_at = now() where id = p_submission;
    perform app.give_xp(v_s.tenant_id, v_s.student_id, v_c.class_id, 'question', v_s.id, 25, 'Your question was added to the quiz');
    perform app.give_badge(v_s.tenant_id, v_s.student_id, 'author');
  elsif p_action = 'return' then
    if length(btrim(coalesce(p_feedback, ''))) < 3 then
      raise exception 'Tell the student what to improve.' using errcode = '22023';
    end if;
    update public.question_submissions set status = 'returned', feedback = btrim(p_feedback),
      reviewed_by = v_me.id, reviewed_at = now() where id = p_submission;
    perform app.notify(v_s.student_id, 'question_returned', 'Your teacher sent your question back', btrim(p_feedback), '/student', 'info',
                       jsonb_build_object('submission_id', v_s.id));
  else
    raise exception 'Unknown action.' using errcode = '22023';
  end if;
  perform app.audit('collab.' || p_action, 'question_submission', p_submission::text);
  return jsonb_build_object('status', case when p_action = 'approve' then 'approved' else 'returned' end, 'question_id', v_q);
end$$;

-- ---------------------------------------------------------------------------
-- Gradebook: every student and every assignment in a class (CSV export)
-- ---------------------------------------------------------------------------
create or replace function public.class_gradebook(p_class uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.can_manage_class(p_class) then raise exception 'Not your class.' using errcode = '42501'; end if;
  return jsonb_build_object(
    'assignments', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'title', a.title, 'due_at', a.due_at,
                      'points', a.points_possible) order by a.due_at nulls last, a.created_at), '[]'::jsonb)
                    from public.assignments a where a.class_id = p_class and a.status <> 'draft'),
    'students', (select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'name', u.full_name, 'email', u.email,
                   'scores', (select coalesce(jsonb_object_agg(a.id, jsonb_build_object(
                        'score', case when g.score is not null then g.score
                                      when t.max_score > 0 and t.score is not null then round(t.score / t.max_score * a.points_possible, 2) end,
                        'late', s.is_late, 'status', s.status)), '{}'::jsonb)
                      from public.assignments a
                      join lateral (select * from public.submissions s where s.assignment_id = a.id and s.student_id = u.id
                                    order by s.attempt_no desc limit 1) s on true
                      left join public.grades g on g.submission_id = s.id
                      left join public.quiz_attempts t on t.id = s.attempt_id
                      where a.class_id = p_class and a.status <> 'draft'))
                   order by u.full_name), '[]'::jsonb)
                 from public.class_members m join public.users u on u.id = m.user_id
                 where m.class_id = p_class and m.role = 'student'));
end$$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
revoke execute on function public.game_goal(uuid), public.set_student_supports(uuid, uuid, boolean, boolean, int, boolean, text),
  public.class_supports(uuid), public.my_supports(), public.open_question_collab(uuid, uuid, boolean, text), public.my_collabs(),
  public.submit_question(uuid, text, jsonb, text), public.collab_submissions(uuid),
  public.review_question_submission(uuid, text, text), public.class_gradebook(uuid)
  from public, anon;
grant execute on function public.game_goal(uuid), public.set_student_supports(uuid, uuid, boolean, boolean, int, boolean, text),
  public.class_supports(uuid), public.my_supports(), public.open_question_collab(uuid, uuid, boolean, text), public.my_collabs(),
  public.submit_question(uuid, text, jsonb, text), public.collab_submissions(uuid),
  public.review_question_submission(uuid, text, text), public.class_gradebook(uuid)
  to authenticated, service_role;

create or replace function public.health() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('ok', true, 'db_time', now(), 'schema', '0800')
$$;

-- >>>>>>>>>>>>>>>>>>>> 20260901000810_audit_fixes.sql >>>>>>>>>>>>>>>>>>>>
-- =============================================================================
-- SwiftCipher — 0810 fixes from the full-project audit
--
-- Slide order is written in one atomic statement. The editor used to renumber
-- slides with one UPDATE per slide from the browser; a dropped connection part
-- way through left duplicate or missing positions (slides shown out of order).
-- =============================================================================

-- p_order: every slide id of the lesson, in the new order. Positions become 0..n-1.
create or replace function public.reorder_slides(p_lesson uuid, p_order uuid[]) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_count int;
begin
  if not app.can_edit_lesson(p_lesson) then raise exception 'You can''t edit this lesson.' using errcode = '42501'; end if;
  select count(*) into v_count from public.lesson_slides where lesson_id = p_lesson;
  if coalesce(array_length(p_order, 1), 0) <> v_count
     or (select count(distinct x) from unnest(p_order) x) <> v_count
     or exists (select 1 from unnest(p_order) x where not exists (
          select 1 from public.lesson_slides s where s.id = x and s.lesson_id = p_lesson)) then
    raise exception 'The slide list changed. Reload the lesson and try again.' using errcode = 'P0001';
  end if;
  update public.lesson_slides s set position = o.ord - 1
    from unnest(p_order) with ordinality o(id, ord)
   where s.id = o.id and s.lesson_id = p_lesson and s.position is distinct from o.ord - 1;
end$$;

revoke execute on function public.reorder_slides(uuid, uuid[]) from public, anon;
grant execute on function public.reorder_slides(uuid, uuid[]) to authenticated, service_role;

create or replace function public.health() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('ok', true, 'db_time', now(), 'schema', '0810')
$$;

-- =============================================================================
-- Done. Quick check: this should return 5 plans.
-- =============================================================================
select code, name from public.plans order by sort;
