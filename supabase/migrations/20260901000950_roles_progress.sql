-- 0950: roles and the school's view of progress.
--
-- * Schools never learn that other schools exist: a code from another school
--   gets the same answer as a code that doesn't exist (joining a lesson,
--   redeeming a class or invite code).
-- * Teachers see a student's progress only for their own lessons and classes;
--   the student, their parents and the school's admins see everything.
-- * Parent codes: each student has a standing code (up to 4 parents), seen by
--   staff only (parent_codes for a class, new_parent_code to replace one).
--   A parent signs up with it, or adds another child with it.
-- * Parent feedback to the teacher of each of the child's classes, with one
--   reply; teachers see their own, school admins see all.
-- * school_progress: for admins, where pupils struggle by subject and topic,
--   and the pupils who need help (whole school or one class, any period).
-- * users.is_support: the platform's support account inside a school.

drop function if exists app.progress_answers(uuid, timestamptz, timestamptz);
drop function if exists app.progress_lessons(uuid, timestamptz, timestamptz);

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

create or replace function public.join_session(p_code text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me   public.users := app.me();
  v_s    public.class_sessions;
  v_pass public.session_guests;
begin
  select * into v_s from public.class_sessions
   where join_code = upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g')) and status = 'live';
  if v_s.id is null then raise exception 'No live lesson has that code.' using errcode = 'P0002'; end if;
  if v_s.tenant_id <> v_me.tenant_id then
    -- Same answer as an unknown code: a school never learns that another school exists.
    raise exception 'No live lesson has that code.' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.session_participants where session_id = v_s.id and user_id = v_me.id and removed_at is not null) then
    raise exception 'Your teacher removed you from this lesson.' using errcode = '42501';
  end if;
  if not app.in_class(v_s.class_id) and not app.can_manage_session(v_s.id) then
    if v_me.role <> 'student' then raise exception 'Only students can join a lesson with a code.' using errcode = '42501'; end if;
    select * into v_pass from public.session_guests where session_id = v_s.id and user_id = v_me.id;
    if v_pass.removed_at is not null then raise exception 'Your teacher removed you from this lesson.' using errcode = '42501'; end if;
    if v_pass.session_id is null then
      if v_s.phase <> 'lobby' and not coalesce((v_s.settings ->> 'late_join')::boolean, true) then
        raise exception 'This lesson has already started and isn''t taking late joiners.' using errcode = 'P0001';
      end if;
      if v_s.guests_closed then raise exception 'This lesson isn''t taking new joiners. Ask your teacher.' using errcode = 'P0001'; end if;
      insert into public.session_guests (session_id, user_id, tenant_id, display_name, is_guest)
        values (v_s.id, v_me.id, v_s.tenant_id,
                case when length(btrim(v_me.full_name)) < 2 then rpad(btrim(v_me.full_name), 2, '.')
                     else left(btrim(v_me.full_name), 40) end, false);
    end if;
  end if;
  insert into public.session_participants (session_id, user_id, tenant_id, status, current_slide)
    values (v_s.id, v_me.id, v_me.tenant_id, 'online', v_s.current_slide)
    on conflict (session_id, user_id) do update set status = 'online', left_at = null, last_seen_at = now();
  return jsonb_build_object('session_id', v_s.id, 'title', v_s.title);
end$$;

create or replace function app.progress_answers(p_student uuid, p_from timestamptz, p_to timestamptz, p_teacher uuid default null)
returns table (at timestamptz, session_id uuid, subject text, topic text, is_correct boolean)
language sql stable security definer set search_path = '' as $$
  select qa.answered_at, t.session_id,
         coalesce(nullif(btrim(l.subject), ''), nullif(btrim(c.subject), ''), c.name, 'Other lessons'),
         coalesce(nullif(btrim(q.topic), ''), l.title, a.title),
         qa.is_correct
    from public.quiz_attempts t
    join public.quiz_answers qa on qa.attempt_id = t.id
    join public.questions q on q.id = qa.question_id
    join public.activities a on a.id = t.activity_id
    left join public.lessons l on l.id = a.lesson_id
    left join public.class_sessions s on s.id = t.session_id
    left join public.classes c on c.id = s.class_id
   where t.student_id = p_student and qa.answered_at >= p_from and qa.answered_at < p_to
     -- A teacher sees only their own lessons and classes.
     and (p_teacher is null or s.teacher_id = p_teacher or app.can_manage_class(s.class_id)
          or (t.session_id is null and a.owner_id = p_teacher))
$$;

create or replace function app.progress_lessons(p_student uuid, p_from timestamptz, p_to timestamptz, p_teacher uuid default null)
returns table (session_id uuid, title text, subject text, started_at timestamptz, attended boolean, points int)
language sql stable security definer set search_path = '' as $$
  select s.id, s.title,
         coalesce(nullif(btrim(l.subject), ''), nullif(btrim(c.subject), ''), c.name, 'Other lessons'),
         s.started_at, p.user_id is not null, coalesce(p.total_score, 0)
    from public.class_sessions s
    left join public.lessons l on l.id = s.lesson_id
    left join public.classes c on c.id = s.class_id
    left join public.session_participants p on p.session_id = s.id and p.user_id = p_student
   where s.tenant_id = (select u.tenant_id from public.users u where u.id = p_student)
     and s.started_at >= p_from and s.started_at < p_to
     and (p_teacher is null or s.teacher_id = p_teacher or app.can_manage_class(s.class_id))
     and (p.user_id is not null
          or exists (select 1 from public.class_members m where m.class_id = s.class_id and m.user_id = p_student and m.role = 'student'))
$$;

create or replace function public.progress_report(p_student uuid, p_period text default 'week', p_date date default null)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_st    public.users;
  v_tz    text;
  v_today date;
  v_day   date;
  v_b     record;
  v_pb    record;
  v_ps    date;    -- previous period, null when there is none
  v_pe    date;
  v_from  timestamptz; v_to timestamptz; v_pfrom timestamptz; v_pto timestamptz;
  v_step  interval;
  v_unit  text;
  v_terms jsonb;
  v_scope uuid;   -- a teacher: only their own lessons and classes
begin
  select * into v_st from public.users where id = p_student and role = 'student';
  if v_st.id is null or not app.can_see_student(p_student) then raise exception 'Report not found.' using errcode = 'P0002'; end if;
  v_scope := case when auth.uid() = p_student or app.is_parent_of(p_student)
                       or (app.is_admin() and v_st.tenant_id = app.tenant_id()) then null else auth.uid() end;
  if p_period not in ('day', 'week', 'month', 'term', 'year') then
    raise exception 'Period is day, week, month, term or year.' using errcode = '22023';
  end if;
  select coalesce(t.timezone, 'UTC') into v_tz from public.tenants t where t.id = v_st.tenant_id;
  v_today := (now() at time zone v_tz)::date;
  v_day := coalesce(p_date, v_today);
  select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'school_year', t.school_year,
                                               'starts_on', t.starts_on, 'ends_on', t.ends_on) order by t.starts_on), '[]'::jsonb)
    into v_terms from public.school_terms t where t.tenant_id = v_st.tenant_id;

  select * into v_b from app.period_bounds(v_st.tenant_id, p_period, v_day);
  if v_b.starts is null then
    return jsonb_build_object('student', jsonb_build_object('id', v_st.id, 'name', v_st.full_name), 'period', p_period,
                              'date', v_day, 'today', v_today, 'needs_terms', true, 'terms', v_terms);
  end if;
  select * into v_pb from app.period_bounds(v_st.tenant_id, p_period, v_b.starts - 1);
  if v_pb.starts is distinct from v_b.starts then v_ps := v_pb.starts; v_pe := v_pb.ends; end if;   -- else: no earlier term
  v_from := v_b.starts::timestamp at time zone v_tz;
  v_to := v_b.ends::timestamp at time zone v_tz;
  v_pfrom := v_ps::timestamp at time zone v_tz;
  v_pto := v_pe::timestamp at time zone v_tz;
  v_unit := case p_period when 'week' then 'day' when 'month' then 'week' when 'term' then 'week' when 'year' then 'month' end;
  v_step := case v_unit when 'day' then interval '1 day' when 'week' then interval '7 days' when 'month' then interval '1 month' end;

  return (
    with ans as (select * from app.progress_answers(p_student, v_from, v_to, v_scope)),
    les as (select * from app.progress_lessons(p_student, v_from, v_to, v_scope)),
    pans as (select * from app.progress_answers(p_student, v_pfrom, v_pto, v_scope)),
    ples as (select * from app.progress_lessons(p_student, v_pfrom, v_pto, v_scope)),
    topics as (
      select a.subject, a.topic, count(*) as answers, count(a.is_correct) as graded,
             round(100.0 * count(*) filter (where a.is_correct) / nullif(count(a.is_correct), 0)) as accuracy
        from ans a group by a.subject, a.topic),
    subjects as (select x.subject from ans x union select y.subject from les y)
    select jsonb_build_object(
      'student', jsonb_build_object('id', v_st.id, 'name', v_st.full_name),
      'period', p_period, 'date', v_day, 'today', v_today, 'timezone', v_tz, 'needs_terms', false, 'terms', v_terms, 'scope', case when v_scope is null then 'all' else 'teacher' end,
      'from', v_b.starts, 'to', v_b.ends - 1, 'label', v_b.label, 'unit', v_unit,
      'prev_date', case when v_ps is not null then v_b.starts - 1 end,
      'next_date', case when v_b.ends <= v_today then v_b.ends end,
      'summary', jsonb_build_object(
        'held', (select count(*) from les), 'attended', (select count(*) from les where attended),
        'answers', (select count(*) from ans), 'correct', (select count(*) from ans where is_correct),
        'accuracy', (select round(100.0 * count(*) filter (where is_correct) / nullif(count(is_correct), 0)) from ans),
        'points', (select coalesce(sum(points), 0) from les where attended),
        'prev_held', case when v_ps is not null then (select count(*) from ples) end,
        'prev_attended', case when v_ps is not null then (select count(*) from ples where attended) end,
        'prev_answers', case when v_ps is not null then (select count(*) from pans) end,
        'prev_accuracy', (select round(100.0 * count(*) filter (where is_correct) / nullif(count(is_correct), 0)) from pans)),
      'trend', case when v_step is null then '[]'::jsonb else (
        select coalesce(jsonb_agg(jsonb_build_object(
                 'start', greatest(b::date, v_b.starts),
                 'answers', (select count(*) from ans a where (a.at at time zone v_tz) >= b and (a.at at time zone v_tz) < b + v_step),
                 'accuracy', (select round(100.0 * count(*) filter (where a.is_correct) / nullif(count(a.is_correct), 0)) from ans a
                              where (a.at at time zone v_tz) >= b and (a.at at time zone v_tz) < b + v_step),
                 'held', (select count(*) from les l where (l.started_at at time zone v_tz) >= b and (l.started_at at time zone v_tz) < b + v_step),
                 'attended', (select count(*) from les l where l.attended and (l.started_at at time zone v_tz) >= b and (l.started_at at time zone v_tz) < b + v_step))
               order by b), '[]'::jsonb)
          from generate_series(date_trunc(v_unit, v_b.starts::timestamp), (v_b.ends - 1)::timestamp, v_step) b) end,
      'subjects', (
        select coalesce(jsonb_agg(jsonb_build_object(
                 'subject', s.subject,
                 'held', (select count(*) from les l where l.subject = s.subject),
                 'attended', (select count(*) from les l where l.subject = s.subject and l.attended),
                 'answers', (select count(*) from ans a where a.subject = s.subject),
                 'accuracy', (select round(100.0 * count(*) filter (where a.is_correct) / nullif(count(a.is_correct), 0)) from ans a where a.subject = s.subject),
                 'prev_accuracy', (select round(100.0 * count(*) filter (where a.is_correct) / nullif(count(a.is_correct), 0)) from pans a where a.subject = s.subject),
                 'topics', (select coalesce(jsonb_agg(jsonb_build_object('topic', t.topic, 'answers', t.answers, 'accuracy', t.accuracy)
                                     order by t.accuracy asc nulls last, t.answers desc), '[]'::jsonb)
                              from topics t where t.subject = s.subject))
               order by (select count(*) from ans a where a.subject = s.subject) desc, s.subject), '[]'::jsonb)
          from subjects s),
      'strengths', (select coalesce(jsonb_agg(jsonb_build_object('subject', t.subject, 'topic', t.topic, 'answers', t.answers, 'accuracy', t.accuracy)
                                     order by t.accuracy desc, t.graded desc), '[]'::jsonb)
                      from (select * from topics where graded >= 3 and accuracy >= 80 order by accuracy desc, graded desc limit 5) t),
      'needs_help', (select coalesce(jsonb_agg(jsonb_build_object('subject', t.subject, 'topic', t.topic, 'answers', t.answers, 'accuracy', t.accuracy)
                                      order by t.accuracy asc, t.graded desc), '[]'::jsonb)
                       from (select * from topics where graded >= 3 and accuracy < 60 order by accuracy asc, graded desc limit 5) t),
      'lessons', (select coalesce(jsonb_agg(jsonb_build_object(
                   'session_id', l.session_id, 'title', l.title, 'subject', l.subject, 'started_at', l.started_at,
                   'attended', l.attended, 'points', l.points,
                   'answers', (select count(*) from ans a where a.session_id = l.session_id),
                   'accuracy', (select round(100.0 * count(*) filter (where a.is_correct) / nullif(count(a.is_correct), 0)) from ans a where a.session_id = l.session_id))
                 order by l.started_at desc), '[]'::jsonb)
                    from (select * from les order by started_at desc limit 60) l))
  );
end$$;

-- ---------------------------------------------------------------------------
-- Parent codes: one standing code per student, seen by staff only
-- ---------------------------------------------------------------------------
alter table public.invites add column if not exists standing boolean not null default false;
create unique index if not exists invites_standing_parent_uidx on public.invites(student_id)
  where standing and revoked_at is null;

/** The student's parent code, made when first needed (up to 4 parents per code). */
create or replace function app.parent_code_for(p_student uuid) returns public.invites
language plpgsql volatile security definer set search_path = '' as $$
declare v_i public.invites; v_st public.users;
begin
  select * into v_i from public.invites
   where student_id = p_student and standing and revoked_at is null and expires_at > now() and uses < max_uses;
  if v_i.id is not null then return v_i; end if;
  -- Used up or expired: retire it and make a fresh one.
  update public.invites set revoked_at = now() where student_id = p_student and standing and revoked_at is null;
  select * into v_st from public.users where id = p_student;
  loop
    begin
      insert into public.invites (tenant_id, code, role, student_id, created_by, max_uses, expires_at, standing)
        values (v_st.tenant_id, app.gen_code(10), 'parent', p_student, auth.uid(), 4, now() + interval '5 years', true)
        returning * into v_i;
      exit;
    exception when unique_violation then null;  -- the random code was taken: try another
    end;
  end loop;
  return v_i;
end$$;
revoke execute on function app.parent_code_for(uuid) from public, anon, authenticated;

/** Parent codes for every student in a class: for its teachers and the school's admins. */
create or replace function public.parent_codes(p_class uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_c public.classes; v_out jsonb := '[]'::jsonb; r record; v_i public.invites;
begin
  select * into v_c from public.classes where id = p_class;
  if v_c.id is null or not (app.can_manage_class(p_class) or (app.is_admin() and v_c.tenant_id = app.tenant_id())) then
    raise exception 'Class not found.' using errcode = 'P0002';
  end if;
  for r in select u.id, u.full_name from public.class_members m join public.users u on u.id = m.user_id
            where m.class_id = p_class and m.role = 'student' order by u.full_name loop
    v_i := app.parent_code_for(r.id);
    v_out := v_out || jsonb_build_object('student_id', r.id, 'name', r.full_name, 'code', v_i.code, 'uses', v_i.uses, 'max_uses', v_i.max_uses,
      'parents', (select coalesce(jsonb_agg(p.full_name order by p.full_name), '[]'::jsonb) from public.parent_links pl
                    join public.users p on p.id = pl.parent_id where pl.student_id = r.id and pl.revoked_at is null));
  end loop;
  return jsonb_build_object('class', jsonb_build_object('id', v_c.id, 'name', v_c.name),
                            'school', (select name from public.tenants where id = v_c.tenant_id), 'students', v_out);
end$$;

/** A new parent code for one student (the old one stops working; linked parents stay linked). */
create or replace function public.new_parent_code(p_student uuid) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare v_i public.invites;
begin
  if not (app.teaches_student(p_student)
          or (app.is_admin() and exists (select 1 from public.users where id = p_student and role = 'student' and tenant_id = app.tenant_id()))) then
    raise exception 'Student not found.' using errcode = 'P0002';
  end if;
  update public.invites set revoked_at = now() where student_id = p_student and standing and revoked_at is null;
  v_i := app.parent_code_for(p_student);
  perform app.audit('parent_code.renewed', 'user', p_student::text, '{}'::jsonb);
  return v_i.code;
end$$;

revoke execute on function public.parent_codes(uuid), public.new_parent_code(uuid) from public, anon;
grant execute on function public.parent_codes(uuid), public.new_parent_code(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Parent feedback to subject teachers (with one reply)
-- ---------------------------------------------------------------------------
create table if not exists public.parent_feedback (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  student_id  uuid not null,
  parent_id   uuid not null,
  teacher_id  uuid not null,
  class_id    uuid,
  subject     text not null,
  body        text not null check (length(btrim(body)) between 2 and 2000),
  created_at  timestamptz not null default now(),
  read_at     timestamptz,
  reply       text check (reply is null or length(btrim(reply)) between 1 and 2000),
  replied_at  timestamptz,
  foreign key (student_id, tenant_id) references public.users(id, tenant_id) on delete cascade,
  foreign key (parent_id, tenant_id) references public.users(id, tenant_id) on delete cascade,
  foreign key (teacher_id, tenant_id) references public.users(id, tenant_id) on delete cascade,
  foreign key (class_id, tenant_id) references public.classes(id, tenant_id) on delete set null (class_id)
);
create index if not exists parent_feedback_teacher_idx on public.parent_feedback(teacher_id, created_at desc);
create index if not exists parent_feedback_parent_idx on public.parent_feedback(parent_id, created_at desc);
create index if not exists parent_feedback_tenant_idx on public.parent_feedback(tenant_id, created_at desc);
create index if not exists parent_feedback_student_idx on public.parent_feedback(student_id);
create index if not exists parent_feedback_class_idx on public.parent_feedback(class_id) where class_id is not null;
alter table public.parent_feedback enable row level security;
revoke all on public.parent_feedback from anon;
revoke insert, update, delete on public.parent_feedback from authenticated;
grant select on public.parent_feedback to authenticated;
drop policy if exists parent_feedback_read on public.parent_feedback;
create policy parent_feedback_read on public.parent_feedback for select to authenticated
  using (tenant_id = (select app.tenant_id())
         and (parent_id = (select auth.uid()) or teacher_id = (select auth.uid()) or (select app.is_admin())));

/** Who a parent can write to about a child: the teacher of each of the child's classes. */
create or replace function public.feedback_targets(p_student uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('class_id', c.id, 'subject', coalesce(nullif(btrim(c.subject), ''), c.name),
                                               'class', c.name, 'teacher_id', t.id, 'teacher', t.full_name)
                            order by coalesce(nullif(btrim(c.subject), ''), c.name)), '[]'::jsonb)
    from public.class_members m join public.classes c on c.id = m.class_id join public.users t on t.id = c.teacher_id
   where m.user_id = p_student and m.role = 'student' and c.archived_at is null and app.is_parent_of(p_student)
$$;

create or replace function public.send_parent_feedback(p_student uuid, p_class uuid, p_body text) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare v_me public.users := app.me(); v_c public.classes; v_id uuid; v_child text;
begin
  if v_me.role <> 'parent' or not app.is_parent_of(p_student) then raise exception 'Not your child.' using errcode = '42501'; end if;
  select c.* into v_c from public.classes c join public.class_members m on m.class_id = c.id
   where c.id = p_class and m.user_id = p_student and m.role = 'student';
  if v_c.id is null then raise exception 'That class isn''t one of your child''s.' using errcode = 'P0002'; end if;
  if (select count(*) from public.parent_feedback where parent_id = v_me.id and created_at > now() - interval '1 day') >= 20 then
    raise exception 'You''ve sent a lot of feedback today. Please try again tomorrow.' using errcode = 'P0001';
  end if;
  insert into public.parent_feedback (tenant_id, student_id, parent_id, teacher_id, class_id, subject, body)
    values (v_me.tenant_id, p_student, v_me.id, v_c.teacher_id, v_c.id, coalesce(nullif(btrim(v_c.subject), ''), v_c.name), btrim(p_body))
    returning id into v_id;
  select full_name into v_child from public.users where id = p_student;
  perform app.notify(v_c.teacher_id, 'parent_feedback', 'Feedback from ' || v_me.full_name, 'About ' || v_child || ' in ' || v_c.name,
                     '/teacher/feedback', 'info', jsonb_build_object('feedback_id', v_id));
  return v_id;
end$$;

create or replace function public.reply_parent_feedback(p_feedback uuid, p_reply text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_f public.parent_feedback;
begin
  select * into v_f from public.parent_feedback where id = p_feedback and teacher_id = auth.uid() for update;
  if v_f.id is null then raise exception 'Feedback not found.' using errcode = 'P0002'; end if;
  update public.parent_feedback set reply = btrim(p_reply), replied_at = now(), read_at = coalesce(read_at, now()) where id = p_feedback;
  perform app.notify(v_f.parent_id, 'feedback_reply', 'Your ' || v_f.subject || ' teacher replied', left(btrim(p_reply), 140),
                     '/parent?child=' || v_f.student_id, 'info', jsonb_build_object('feedback_id', v_f.id));
end$$;

/** Feedback the caller may see: a parent's own, a teacher's inbox, or the whole school for admins. */
create or replace function public.parent_feedback_list(p_student uuid default null, p_unread_only boolean default false) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_me public.users := app.me(); v_out jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'student_id', f.student_id, 'student', s.full_name, 'parent', p.full_name,
           'teacher_id', f.teacher_id, 'teacher', t.full_name, 'class_id', f.class_id, 'subject', f.subject, 'body', f.body,
           'created_at', f.created_at, 'read_at', f.read_at, 'reply', f.reply, 'replied_at', f.replied_at,
           'mine', f.teacher_id = v_me.id) order by f.created_at desc), '[]'::jsonb)
    into v_out
    from (select * from public.parent_feedback x
           where x.tenant_id = v_me.tenant_id
             and (x.parent_id = v_me.id or x.teacher_id = v_me.id or app.is_admin())
             and (p_student is null or x.student_id = p_student)
             and (not p_unread_only or x.read_at is null)
           order by x.created_at desc limit 300) f
    join public.users s on s.id = f.student_id join public.users p on p.id = f.parent_id join public.users t on t.id = f.teacher_id;
  -- A teacher opening their inbox has read what was sent to them.
  update public.parent_feedback set read_at = now() where teacher_id = v_me.id and read_at is null
     and (p_student is null or student_id = p_student);
  return v_out;
end$$;

revoke execute on function public.feedback_targets(uuid), public.send_parent_feedback(uuid, uuid, text),
  public.reply_parent_feedback(uuid, text), public.parent_feedback_list(uuid, boolean) from public, anon;
grant execute on function public.feedback_targets(uuid), public.send_parent_feedback(uuid, uuid, text),
  public.reply_parent_feedback(uuid, text), public.parent_feedback_list(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- School-wide progress for admins: where pupils struggle
-- ---------------------------------------------------------------------------
create or replace function public.school_progress(p_period text default 'term', p_date date default null, p_class uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_tenant uuid := app.tenant_id();
  v_tz text; v_today date; v_day date; v_b record; v_from timestamptz; v_to timestamptz;
begin
  if v_tenant is null or not app.is_admin() then raise exception 'Only school admins can see this.' using errcode = '42501'; end if;
  if p_class is not null and not exists (select 1 from public.classes where id = p_class and tenant_id = v_tenant) then
    raise exception 'Class not found.' using errcode = 'P0002';
  end if;
  select coalesce(timezone, 'UTC') into v_tz from public.tenants where id = v_tenant;
  v_today := (now() at time zone v_tz)::date;
  v_day := coalesce(p_date, v_today);
  select * into v_b from app.period_bounds(v_tenant, p_period, v_day);
  if v_b.starts is null then
    return jsonb_build_object('period', p_period, 'date', v_day, 'needs_terms', true);
  end if;
  v_from := v_b.starts::timestamp at time zone v_tz;
  v_to := v_b.ends::timestamp at time zone v_tz;

  return (
    with pupils as (
      select u.id, u.full_name from public.users u
       where u.tenant_id = v_tenant and u.role = 'student' and u.status = 'active'
         and (p_class is null or exists (select 1 from public.class_members m where m.class_id = p_class and m.user_id = u.id and m.role = 'student'))),
    ans as (
      select t.student_id, qa.is_correct,
             coalesce(nullif(btrim(l.subject), ''), nullif(btrim(c.subject), ''), c.name, 'Other lessons') as subject,
             coalesce(nullif(btrim(q.topic), ''), l.title, a.title) as topic
        from public.quiz_attempts t
        join pupils pu on pu.id = t.student_id
        join public.quiz_answers qa on qa.attempt_id = t.id
        join public.questions q on q.id = qa.question_id
        join public.activities a on a.id = t.activity_id
        left join public.lessons l on l.id = a.lesson_id
        left join public.class_sessions s on s.id = t.session_id
        left join public.classes c on c.id = s.class_id
       where t.tenant_id = v_tenant and qa.answered_at >= v_from and qa.answered_at < v_to),
    per_topic as (
      select subject, topic, count(*) as answers, count(is_correct) as graded,
             round(100.0 * count(*) filter (where is_correct) / nullif(count(is_correct), 0)) as accuracy,
             count(distinct student_id) as pupils
        from ans group by subject, topic),
    per_pupil_topic as (
      select student_id, subject, topic, round(100.0 * count(*) filter (where is_correct) / nullif(count(is_correct), 0)) as accuracy
        from ans group by student_id, subject, topic having count(is_correct) >= 2),
    per_pupil as (
      select a.student_id, count(*) as answers, round(100.0 * count(*) filter (where a.is_correct) / nullif(count(a.is_correct), 0)) as accuracy
        from ans a group by a.student_id)
    select jsonb_build_object(
      'period', p_period, 'date', v_day, 'today', v_today, 'needs_terms', false, 'label', v_b.label, 'from', v_b.starts, 'to', v_b.ends - 1,
      'prev_date', v_b.starts - 1, 'next_date', case when v_b.ends <= v_today then v_b.ends end,
      'classes', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name) order by c.name), '[]'::jsonb)
                    from public.classes c where c.tenant_id = v_tenant and c.archived_at is null),
      'summary', jsonb_build_object(
        'pupils', (select count(*) from pupils), 'active', (select count(distinct student_id) from ans),
        'answers', (select count(*) from ans),
        'accuracy', (select round(100.0 * count(*) filter (where is_correct) / nullif(count(is_correct), 0)) from ans)),
      'subjects', (select coalesce(jsonb_agg(jsonb_build_object(
          'subject', sb.subject, 'answers', sb.answers, 'accuracy', sb.accuracy, 'pupils', sb.pupils,
          'topics', (select coalesce(jsonb_agg(jsonb_build_object('topic', t.topic, 'answers', t.answers, 'accuracy', t.accuracy, 'pupils', t.pupils,
                       'struggling', (select count(*) from per_pupil_topic x where x.subject = t.subject and x.topic = t.topic and x.accuracy < 50))
                       order by t.accuracy asc nulls last, t.answers desc), '[]'::jsonb)
                     from per_topic t where t.subject = sb.subject))
          order by sb.answers desc), '[]'::jsonb)
        from (select subject, count(*) as answers, count(distinct student_id) as pupils,
                     round(100.0 * count(*) filter (where is_correct) / nullif(count(is_correct), 0)) as accuracy
                from ans group by subject) sb),
      'hardest', (select coalesce(jsonb_agg(jsonb_build_object('subject', t.subject, 'topic', t.topic, 'answers', t.answers,
                     'accuracy', t.accuracy, 'pupils', t.pupils,
                     'struggling', (select count(*) from per_pupil_topic x where x.subject = t.subject and x.topic = t.topic and x.accuracy < 50))
                     order by t.accuracy asc, t.answers desc), '[]'::jsonb)
                    from (select * from per_topic where graded >= 5 and accuracy < 60 order by accuracy asc, answers desc limit 10) t),
      'pupils_needing_help', (select coalesce(jsonb_agg(jsonb_build_object('student_id', pp.student_id, 'name', u.full_name,
                     'answers', pp.answers, 'accuracy', pp.accuracy,
                     'weakest', (select jsonb_build_object('subject', x.subject, 'topic', x.topic, 'accuracy', x.accuracy)
                                   from per_pupil_topic x where x.student_id = pp.student_id order by x.accuracy asc limit 1),
                     'classes', (select coalesce(jsonb_agg(c.name order by c.name), '[]'::jsonb) from public.class_members m
                                   join public.classes c on c.id = m.class_id where m.user_id = pp.student_id and m.role = 'student'))
                     order by pp.accuracy asc, pp.answers desc), '[]'::jsonb)
                    from (select * from per_pupil where answers >= 5 and accuracy < 50 order by accuracy asc limit 30) pp
                    join public.users u on u.id = pp.student_id),
      'feedback', (select jsonb_build_object('total', count(*), 'unanswered', count(*) filter (where reply is null))
                     from public.parent_feedback where tenant_id = v_tenant and created_at >= v_from and created_at < v_to))
  );
end$$;
revoke execute on function public.school_progress(text, date, uuid) from public, anon;
grant execute on function public.school_progress(text, date, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Platform support accounts ("Open as admin" from the platform console)
-- ---------------------------------------------------------------------------
alter table public.users add column if not exists is_support boolean not null default false;

revoke execute on function app.progress_answers(uuid, timestamptz, timestamptz, uuid), app.progress_lessons(uuid, timestamptz, timestamptz, uuid)
  from public, anon, authenticated;

create or replace function public.health() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('ok', true, 'db_time', now(), 'schema', '0950')
$$;
