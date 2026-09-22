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
