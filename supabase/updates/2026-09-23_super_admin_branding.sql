-- =============================================================================
-- SwiftCipher update 2026-09-23: platform super admin, school suspension,
-- school branding, teacher-only focused screen view, safe school deletion.
--
-- For a database that already ran supabase/setup.sql BEFORE this date.
-- Supabase dashboard -> SQL Editor -> New query -> paste all -> Run (once).
-- =============================================================================

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


-- Done. Should return true:
select exists (select 1 from information_schema.tables where table_name = 'platform_admins') as super_admin_ready;
