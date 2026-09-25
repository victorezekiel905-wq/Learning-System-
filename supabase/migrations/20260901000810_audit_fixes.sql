-- =============================================================================
-- SwiftCipher — 0810 fixes from the full-project audit
--
-- Join codes can't be brute-forced: wrong class codes are limited per account.
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

-- ---------------------------------------------------------------------------
-- Join-code guessing protection. Class codes are 6 characters (easy for
-- children to type); with ~1M active classes a script could otherwise find a
-- real class in about 900 guesses and enrol itself as a student. Wrong codes
-- are now limited to 8 per account per 15 minutes, and the teacher is still
-- told whenever a student joins.
-- ---------------------------------------------------------------------------
create table if not exists public.code_attempts (
  id      bigint generated always as identity primary key,
  user_id uuid not null,
  at      timestamptz not null default now()
);
create index if not exists code_attempts_user_idx on public.code_attempts(user_id, at desc);
alter table public.code_attempts enable row level security;
revoke all on public.code_attempts from anon, authenticated;

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

create or replace function public.health() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('ok', true, 'db_time', now(), 'schema', '0810')
$$;
