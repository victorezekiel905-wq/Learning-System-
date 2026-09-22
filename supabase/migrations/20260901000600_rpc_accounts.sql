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
