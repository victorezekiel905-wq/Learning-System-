-- 0970: class rosters run by staff, promotion, and each student's own classes.
--
-- * Staff add students themselves (one by one, or from a CSV or Excel file).
--   The server creates each login (a username, or the student's email) with a
--   starting password; the student must choose a new one at first sign-in.
--   Usernames live in users.login_name; the admission number in
--   student_profiles.student_number.
-- * Staff edit a student's name and admission number, and reset the password
--   of school-made logins. School admins can delete a student's account.
-- * Promotion: a class's students (all or some) move to another class of the
--   school; admins can promote every class at once at the end of the year.
-- * my_classes: the classes a student is in, each with their own results this
--   term (or school year), for the student's home page.

alter table public.users add column if not exists login_name text;
alter table public.users add column if not exists must_change_password boolean not null default false;
alter table public.users drop constraint if exists users_login_name_check;
alter table public.users add constraint users_login_name_check check (login_name is null or login_name ~ '^[a-z0-9][a-z0-9.]{2,40}$');
create unique index if not exists users_login_name_uidx on public.users(login_name) where login_name is not null;

/** Staff who may look after this student: their teachers, or the school's admins. */
create or replace function app.can_manage_student(p_student uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.teaches_student(p_student)
      or (app.is_admin() and exists (select 1 from public.users u where u.id = p_student and u.role = 'student' and u.tenant_id = app.tenant_id()))
$$;
revoke execute on function app.can_manage_student(uuid) from public, anon;

/** A student who already has an account in this school joins the class (matched by email). */
create or replace function public.add_existing_student(p_class uuid, p_email text) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare v_c public.classes; v_id uuid;
begin
  select * into v_c from public.classes where id = p_class;
  if v_c.id is null or not app.can_manage_class(p_class) then raise exception 'Class not found.' using errcode = 'P0002'; end if;
  select id into v_id from public.users
   where tenant_id = v_c.tenant_id and role = 'student' and lower(email) = lower(btrim(p_email));
  if v_id is null then return null; end if;
  insert into public.class_members (class_id, user_id, tenant_id, role) values (p_class, v_id, v_c.tenant_id, 'student')
    on conflict (class_id, user_id) do nothing;
  return v_id;
end$$;

/**
 * Makes the login the server has just created (p_user, with address p_email) a
 * student of this class's school. Only a brand-new login with no school yet qualifies.
 */
create or replace function public.add_managed_student(
  p_class uuid, p_user uuid, p_email text, p_name text, p_login text default null, p_admission text default null
) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare v_c public.classes; v_count bigint;
begin
  select * into v_c from public.classes where id = p_class;
  if v_c.id is null or not app.can_manage_class(p_class) then raise exception 'Class not found.' using errcode = 'P0002'; end if;
  if v_c.archived_at is not null then raise exception 'This class is archived.' using errcode = 'P0001'; end if;
  if not exists (select 1 from auth.users where id = p_user and lower(email) = lower(p_email) and created_at > now() - interval '15 minutes')
     or exists (select 1 from public.users where id = p_user) then
    raise exception 'That login is not new.' using errcode = '22023';
  end if;
  select count(*) into v_count from public.class_members where class_id = p_class and role = 'student';
  if not app.within_limit(v_c.tenant_id, 'students_per_class', v_count) then
    raise exception 'This class is full on the current plan.' using errcode = 'P0001';
  end if;
  insert into public.users (id, tenant_id, email, full_name, role, login_name, must_change_password)
    values (p_user, v_c.tenant_id, lower(p_email), btrim(p_name), 'student', nullif(lower(btrim(p_login)), ''), true);
  insert into public.student_profiles (user_id, tenant_id, student_number) values (p_user, v_c.tenant_id, nullif(btrim(p_admission), ''));
  insert into public.class_members (class_id, user_id, tenant_id, role) values (p_class, p_user, v_c.tenant_id, 'student');
  perform app.audit('student.added', 'user', p_user::text, jsonb_build_object('class_id', p_class));
  return p_user;
end$$;

create or replace function public.update_student(p_student uuid, p_name text, p_admission text default null) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not app.can_manage_student(p_student) then raise exception 'Student not found.' using errcode = 'P0002'; end if;
  update public.users set full_name = btrim(p_name) where id = p_student and role = 'student';
  insert into public.student_profiles (user_id, tenant_id, student_number)
    select id, tenant_id, nullif(btrim(p_admission), '') from public.users where id = p_student
    on conflict (user_id) do update set student_number = excluded.student_number;
  perform app.audit('student.updated', 'user', p_student::text, '{}'::jsonb);
end$$;

/** Before the server sets a new starting password: only for school-made logins. */
create or replace function public.prepare_password_reset(p_student uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v public.users;
begin
  if not app.can_manage_student(p_student) then raise exception 'Student not found.' using errcode = 'P0002'; end if;
  select * into v from public.users where id = p_student;
  if v.login_name is null then
    raise exception 'This student signs in with their own email. They can use "Forgot password" on the sign-in page.' using errcode = 'P0001';
  end if;
  update public.users set must_change_password = true where id = p_student;
  perform app.audit('student.password_reset', 'user', p_student::text, '{}'::jsonb);
  return jsonb_build_object('login_name', v.login_name);
end$$;

/** The signed-in user has chosen their own password. */
create or replace function public.password_changed() returns void
language sql volatile security definer set search_path = '' as $$
  update public.users set must_change_password = false where id = auth.uid()
$$;

/** School admins only, typing the student's name: then the server deletes the login (and everything with it). */
create or replace function public.delete_student_check(p_student uuid, p_confirm_name text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v public.users;
begin
  select * into v from public.users where id = p_student and role = 'student';
  if v.id is null or not app.is_admin() or v.tenant_id <> app.tenant_id() then raise exception 'Student not found.' using errcode = 'P0002'; end if;
  if lower(btrim(coalesce(p_confirm_name, ''))) <> lower(btrim(v.full_name)) then
    raise exception 'Type the student''s full name exactly to confirm.' using errcode = '22023';
  end if;
  perform app.audit('student.deleted', 'user', p_student::text, jsonb_build_object('name', v.full_name));
end$$;

-- ---------------------------------------------------------------------------
-- Promotion
-- ---------------------------------------------------------------------------

/** Classes a class can be promoted into: the school's other open classes. */
create or replace function public.promotion_targets(p_class uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'subject', c.subject, 'teacher', t.full_name,
           'students', (select count(*) from public.class_members m where m.class_id = c.id and m.role = 'student')) order by c.name), '[]'::jsonb)
    from public.classes c left join public.users t on t.id = c.teacher_id
   where app.can_manage_class(p_class) and c.id <> p_class and c.archived_at is null
     and c.tenant_id = (select tenant_id from public.classes where id = p_class)
$$;

/** Moves students (all, or those listed) from one class to another. Their results stay with them. */
create or replace function public.promote_students(p_from uuid, p_to uuid, p_students uuid[] default null) returns int
language plpgsql volatile security definer set search_path = '' as $$
declare v_f public.classes; v_t public.classes; v_n int; v_after bigint;
begin
  select * into v_f from public.classes where id = p_from;
  select * into v_t from public.classes where id = p_to;
  if v_f.id is null or not app.can_manage_class(p_from) then raise exception 'Class not found.' using errcode = 'P0002'; end if;
  if v_t.id is null or v_t.tenant_id <> v_f.tenant_id or v_t.archived_at is not null or p_to = p_from then
    raise exception 'Choose another open class of your school.' using errcode = '22023';
  end if;
  select count(distinct user_id) into v_after from public.class_members
   where role = 'student' and (class_id = p_to or (class_id = p_from and (p_students is null or user_id = any(p_students))));
  if not app.within_limit(v_t.tenant_id, 'students_per_class', v_after - 1) then
    raise exception 'The next class would be over the plan''s class size.' using errcode = 'P0001';
  end if;
  with moving as (
         select user_id from public.class_members
          where class_id = p_from and role = 'student' and (p_students is null or user_id = any(p_students))),
       ins as (
         insert into public.class_members (class_id, user_id, tenant_id, role)
           select p_to, user_id, v_t.tenant_id, 'student' from moving
           on conflict (class_id, user_id) do nothing returning user_id),
       del as (
         delete from public.class_members m using moving
          where m.class_id = p_from and m.user_id = moving.user_id returning m.user_id)
  select count(*) into v_n from del;
  perform app.audit('class.promoted', 'class', p_from::text, jsonb_build_object('to', p_to, 'students', v_n));
  return v_n;
end$$;

/**
 * End of year, school admins: every class to its next class at once, e.g.
 * [{from: JSS 1, to: JSS 2}, {from: JSS 2, to: JSS 3}, {from: SS 3, to: null}].
 * "to": null means the students leave that class (finished school). Everyone
 * moves from where they were before the promotion, so chains work.
 */
create or replace function public.promote_school(p_moves jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_tenant uuid := app.tenant_id(); v_moved int; v_left int;
begin
  if v_tenant is null or not app.is_admin() then raise exception 'Only school admins can promote the whole school.' using errcode = '42501'; end if;
  if jsonb_typeof(p_moves) <> 'array' then raise exception 'Moves must be a list.' using errcode = '22023'; end if;
  if exists (select 1 from jsonb_array_elements(p_moves) e
              where not exists (select 1 from public.classes c where c.id = (e ->> 'from')::uuid and c.tenant_id = v_tenant)
                 or (nullif(e ->> 'to', '') is not null
                     and not exists (select 1 from public.classes c where c.id = (e ->> 'to')::uuid and c.tenant_id = v_tenant and c.archived_at is null))) then
    raise exception 'A class in the list is not one of your school''s open classes.' using errcode = '22023';
  end if;
  if (select count(*) from jsonb_array_elements(p_moves)) <> (select count(distinct e ->> 'from') from jsonb_array_elements(p_moves) e) then
    raise exception 'Each class can appear once.' using errcode = '22023';
  end if;
  with moves as (select (e ->> 'from')::uuid as f, nullif(e ->> 'to', '')::uuid as t from jsonb_array_elements(p_moves) e),
       cur as (select m.user_id, mv.f, mv.t from moves mv join public.class_members m on m.class_id = mv.f and m.role = 'student'),
       del as (delete from public.class_members m using cur where m.class_id = cur.f and m.user_id = cur.user_id returning 1),
       ins as (insert into public.class_members (class_id, user_id, tenant_id, role)
                 select cur.t, cur.user_id, v_tenant, 'student' from cur where cur.t is not null
                 on conflict (class_id, user_id) do nothing returning 1)
  select (select count(*) from ins), (select count(*) from cur where t is null) into v_moved, v_left;
  perform app.audit('school.promoted', 'tenant', v_tenant::text, jsonb_build_object('moved', v_moved, 'left', v_left, 'classes', jsonb_array_length(p_moves)));
  return jsonb_build_object('moved', v_moved, 'left', v_left);
end$$;

-- ---------------------------------------------------------------------------
-- A student's own classes, each with their results
-- ---------------------------------------------------------------------------
create or replace function public.my_classes() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_me public.users := app.me(); v_tz text; v_b record; v_from timestamptz; v_to timestamptz;
begin
  if v_me.id is null or v_me.role <> 'student' then return '[]'::jsonb; end if;
  select coalesce(timezone, 'UTC') into v_tz from public.tenants where id = v_me.tenant_id;
  select * into v_b from app.period_bounds(v_me.tenant_id, 'term', (now() at time zone v_tz)::date);
  if v_b.starts is null then select * into v_b from app.period_bounds(v_me.tenant_id, 'year', (now() at time zone v_tz)::date); end if;
  v_from := v_b.starts::timestamp at time zone v_tz;
  v_to := v_b.ends::timestamp at time zone v_tz;
  return (
    with mine as (
      select c.id, c.name, c.subject, t.full_name as teacher
        from public.class_members m join public.classes c on c.id = m.class_id left join public.users t on t.id = c.teacher_id
       where m.user_id = v_me.id and m.role = 'student' and c.archived_at is null),
    ans as (
      select s.class_id, qa.is_correct, coalesce(nullif(btrim(q.topic), ''), l.title, a.title) as topic
        from public.quiz_attempts qt
        join public.quiz_answers qa on qa.attempt_id = qt.id
        join public.questions q on q.id = qa.question_id
        join public.activities a on a.id = qt.activity_id
        left join public.lessons l on l.id = a.lesson_id
        join public.class_sessions s on s.id = qt.session_id
       where qt.student_id = v_me.id and qa.answered_at >= v_from and qa.answered_at < v_to
         and s.class_id in (select id from mine)),
    topics as (
      select class_id, topic, count(is_correct) as graded,
             round(100.0 * count(*) filter (where is_correct) / nullif(count(is_correct), 0)) as accuracy
        from ans group by class_id, topic having count(is_correct) >= 3)
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', c.id, 'name', c.name, 'subject', c.subject, 'teacher', c.teacher, 'period', v_b.label,
             'held', (select count(*) from public.class_sessions s where s.class_id = c.id and s.started_at >= v_from and s.started_at < v_to),
             'attended', (select count(*) from public.class_sessions s join public.session_participants p on p.session_id = s.id and p.user_id = v_me.id
                           where s.class_id = c.id and s.started_at >= v_from and s.started_at < v_to),
             'answers', (select count(*) from ans where ans.class_id = c.id),
             'accuracy', (select round(100.0 * count(*) filter (where is_correct) / nullif(count(is_correct), 0)) from ans where ans.class_id = c.id),
             'strongest', (select jsonb_build_object('topic', topic, 'accuracy', accuracy) from topics t
                            where t.class_id = c.id and t.accuracy >= 70 order by accuracy desc, graded desc limit 1),
             'weakest', (select jsonb_build_object('topic', topic, 'accuracy', accuracy) from topics t
                          where t.class_id = c.id and t.accuracy < 60 order by accuracy asc, graded desc limit 1))
             order by c.name), '[]'::jsonb)
      from mine c
  );
end$$;

revoke execute on function public.add_existing_student(uuid, text), public.add_managed_student(uuid, uuid, text, text, text, text),
  public.update_student(uuid, text, text), public.prepare_password_reset(uuid), public.password_changed(),
  public.delete_student_check(uuid, text), public.promotion_targets(uuid), public.promote_students(uuid, uuid, uuid[]),
  public.promote_school(jsonb), public.my_classes() from public, anon;
grant execute on function public.add_existing_student(uuid, text), public.add_managed_student(uuid, uuid, text, text, text, text),
  public.update_student(uuid, text, text), public.prepare_password_reset(uuid), public.password_changed(),
  public.delete_student_check(uuid, text), public.promotion_targets(uuid), public.promote_students(uuid, uuid, uuid[]),
  public.promote_school(jsonb), public.my_classes() to authenticated;

-- The profile says when the student must choose their own password (first sign-in, or after a reset).
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
                                  'role', v_user.role, 'status', v_user.status, 'is_support', v_user.is_support, 'must_change_password', v_user.must_change_password),
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
  select jsonb_build_object('ok', true, 'db_time', now(), 'schema', '0970')
$$;
