-- 0960: who is signing up, and the platform's support account in a school.
--
-- * redeem_code takes who is joining (p_as: student, parent or staff) and
--   refuses a code meant for someone else before creating anything.
-- * "Open as admin" from the platform console: each school gets one support
--   account ("SwiftCipher support", a school admin, marked is_support). The
--   console signs the super admin into it; the school's audit log shows
--   "SwiftCipher support", the platform audit log shows who. It never counts
--   towards the school's staff limit.

drop function if exists public.redeem_code(text, text);

create or replace function public.redeem_code(p_code text, p_full_name text default null, p_as text default null)
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
  -- Guessing protection: class codes are short enough to type, so wrong guesses are limited.
  if (select count(*) from public.code_attempts where user_id = v_uid and at > now() - interval '15 minutes') >= 8 then
    raise exception 'Too many wrong codes. Wait 15 minutes, then check the code with your teacher.' using errcode = 'P0001';
  end if;
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
    -- The sign-up form says who is joining (student, parent or staff): a code for someone else is refused
    -- before anything is created, so a parent can't become a student by typing the wrong code.
    if p_as is not null and not (case when p_as = 'staff' then v_invite.role in ('teacher', 'school_admin', 'it_admin')
                                      else v_invite.role = p_as end) then
      raise exception '%', case v_invite.role when 'parent' then 'That is a parent code. Choose "Parent" to use it.'
                                              when 'student' then 'That code is for a student. Choose "Student" to use it.'
                                              else 'That is a staff invite. Choose "Staff" to use it.' end using errcode = 'P0001';
    end if;
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
      raise exception 'No class or invite matches that code.' using errcode = 'P0002';
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
    -- Returned, not raised: raising would roll back the attempt we need to count.
    delete from public.code_attempts where user_id = v_uid and at < now() - interval '1 day';
    insert into public.code_attempts (user_id) values (v_uid);
    return jsonb_build_object('error', 'No class or invite matches that code.', 'code', 'P0002');
  end if;

  if p_as is not null and p_as <> 'student' then
    raise exception '%', case p_as when 'parent' then 'That is a class code for students. Parents use the parent code from the school, not the class code.'
                                   else 'That is a class code for students. Staff join with an invite from the school admin.' end using errcode = 'P0001';
  end if;
  if v_user.id is null then
    insert into public.users (id, tenant_id, email, full_name, role)
      values (v_uid, v_class.tenant_id, coalesce(v_email, ''), v_name, 'student')
      returning * into v_user;
    insert into public.student_profiles (user_id, tenant_id) values (v_uid, v_class.tenant_id);
  elsif v_user.tenant_id <> v_class.tenant_id then
    raise exception 'No class or invite matches that code.' using errcode = 'P0002';
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
         (select count(*) from public.users where tenant_id = v_me.tenant_id and role in ('teacher','school_admin') and not is_support)) then
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

create table if not exists public.support_accounts (
  tenant_id  uuid primary key references public.tenants(id) on delete cascade,
  user_id    uuid not null unique references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.support_accounts enable row level security;
revoke all on public.support_accounts from anon, authenticated;

/** The address of a school's support account (never sent to; it has no password). */
create or replace function app.support_email(p_tenant uuid) returns text
language sql immutable set search_path = '' as $$
  select 'support-' || left(replace(p_tenant::text, '-', ''), 16) || '@support.swiftcipher.invalid'
$$;

/**
 * Super admin: the school's support account (its auth user id, or null when it
 * still has to be created) and the address to sign it in with. Records the visit.
 */
create or replace function public.sa_support_account(p_tenant uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_t public.tenants; v_user uuid;
begin
  perform app.sa_require();
  select * into v_t from public.tenants where id = p_tenant;
  if v_t.id is null then raise exception 'School not found.' using errcode = 'P0002'; end if;
  select user_id into v_user from public.support_accounts where tenant_id = p_tenant;
  if v_user is not null then
    -- The super admin's authority: the account is always an active admin of this school.
    update public.users set status = 'active', role = 'school_admin', is_support = true where id = v_user and tenant_id = p_tenant;
    if not found then v_user := null; end if;
  end if;
  insert into public.platform_audit (actor_id, action, tenant_id, target_type, target_id)
    values (auth.uid(), 'support.enter', p_tenant, 'tenant', p_tenant::text);
  return jsonb_build_object('user_id', v_user, 'email', app.support_email(p_tenant), 'school', v_t.name, 'status', v_t.status);
end$$;

/** Super admin: makes the auth user just created for the school its support account. */
create or replace function public.sa_register_support(p_tenant uuid, p_user uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform app.sa_require();
  if not exists (select 1 from auth.users where id = p_user and lower(email) = app.support_email(p_tenant)) then
    raise exception 'Not a support account.' using errcode = '22023';
  end if;
  if exists (select 1 from public.users where id = p_user and tenant_id <> p_tenant) then
    raise exception 'Not a support account.' using errcode = '22023';
  end if;
  insert into public.users (id, tenant_id, email, full_name, role, is_support)
    values (p_user, p_tenant, app.support_email(p_tenant), 'SwiftCipher support', 'school_admin', true)
    on conflict (id) do update set status = 'active', role = 'school_admin', is_support = true;
  insert into public.teacher_profiles (user_id, tenant_id) values (p_user, p_tenant) on conflict do nothing;
  insert into public.support_accounts (tenant_id, user_id) values (p_tenant, p_user)
    on conflict (tenant_id) do update set user_id = excluded.user_id;
  perform app.audit('support.account_created', 'user', p_user::text, '{}'::jsonb, p_tenant, p_user);
end$$;

revoke execute on function public.sa_support_account(uuid), public.sa_register_support(uuid, uuid) from public, anon;
grant execute on function public.sa_support_account(uuid), public.sa_register_support(uuid, uuid) to authenticated;
revoke execute on function public.redeem_code(text, text, text) from public, anon;
grant execute on function public.redeem_code(text, text, text) to authenticated;

-- The profile says when it is the platform's support account (for the "Return to console" bar).
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
                                  'role', v_user.role, 'status', v_user.status, 'is_support', v_user.is_support),
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

create or replace function public.health() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('ok', true, 'db_time', now(), 'schema', '0960')
$$;
