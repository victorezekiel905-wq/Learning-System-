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
