-- 1110: coming back to a lesson without hassle, and deleting lessons.
--
-- * A guest whose phone died can join again from another device with the same
--   name: when that guest is offline, the new device takes over their place,
--   points and answers (join_session_as_guest), and the teacher is told. While
--   the first device is still connected the name stays taken, so nobody can step
--   into a classmate who is present.
-- * my_open_lessons: the live lessons this person is in, so the join page and the
--   student's home offer "Rejoin" after a restart or a lost connection.
-- * delete_lesson: a lesson never taught is deleted; one that has been taught is
--   moved to Deleted (archived), keeping students' results and reports, and can be
--   restored. A lesson running live can't be deleted.

create or replace function public.join_session_as_guest(p_code text, p_name text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid  uuid := auth.uid();
  v_code text := upper(regexp_replace(coalesce(p_code, ''), '\s', '', 'g'));
  v_name text := regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g');
  v_s    public.class_sessions;
  v_user public.users;
  v_pass public.session_guests;
  v_old  uuid;   -- the same guest on an earlier device, now offline (1110)
begin
  if v_uid is null or not app.is_anonymous() then
    raise exception 'Use the guest sign-in to join as a guest.' using errcode = '42501';
  end if;
  if (select count(*) from public.code_attempts where user_id = v_uid and at > now() - interval '15 minutes') >= 8 then
    raise exception 'Too many wrong codes. Wait 15 minutes, then check the code with your teacher.' using errcode = 'P0001';
  end if;
  if length(v_name) < 2 or length(v_name) > 40 or v_name !~ '^[[:alnum:]][[:alnum:] .''_-]*$' then
    raise exception 'Use 2 to 40 letters or numbers for your name.' using errcode = '22023';
  end if;

  select * into v_s from public.class_sessions where join_code = v_code and status = 'live';
  if v_s.id is null then
    insert into public.code_attempts (user_id) values (v_uid);
    return jsonb_build_object('error', 'No live lesson has that code. Check it with your teacher.', 'code', 'P0002');
  end if;
  if exists (select 1 from public.tenants t where t.id = v_s.tenant_id and t.status <> 'active') then
    raise exception 'This school isn''t available right now.' using errcode = '42501';
  end if;

  select * into v_user from public.users where id = v_uid;
  if v_user.id is not null and v_user.tenant_id <> v_s.tenant_id then
    return jsonb_build_object('error', 'Start a new guest sign-in for this school.', 'code', 'GUEST_OTHER_SCHOOL');
  end if;

  select * into v_pass from public.session_guests where session_id = v_s.id and user_id = v_uid;
  if v_pass.removed_at is not null then
    raise exception 'Your teacher removed you from this lesson.' using errcode = '42501';
  end if;
  if v_pass.session_id is null then
    if v_s.phase <> 'lobby' and not coalesce((v_s.settings ->> 'late_join')::boolean, true) then
      raise exception 'This lesson has already started and isn''t taking late joiners.' using errcode = 'P0001';
    end if;
    if v_s.guests_closed then
      raise exception 'This lesson isn''t taking new guests. Ask your teacher.' using errcode = 'P0001';
    end if;
    if (select count(*) from public.session_guests where session_id = v_s.id and removed_at is null) >= 300 then
      raise exception 'This lesson is full.' using errcode = 'P0001';
    end if;
    -- The same name: if that guest is offline (phone died, another device), this is them coming back,
    -- so they take over their place, points and answers. If they are still here, it's someone else.
    select g.user_id into v_old from public.session_guests g
      left join public.session_participants p on p.session_id = g.session_id and p.user_id = g.user_id
     where g.session_id = v_s.id and g.removed_at is null and lower(g.display_name) = lower(v_name)
       and (p.user_id is null or p.left_at is not null or p.last_seen_at < now() - app.presence_window())
     limit 1;
    if v_old is null and exists (select 1 from public.session_guests where session_id = v_s.id and removed_at is null
                and lower(display_name) = lower(v_name)) then
      raise exception 'Someone in this lesson already uses that name. Add a surname or a number.' using errcode = 'P0001';
    end if;
  end if;

  if v_user.id is null then
    insert into public.users (id, tenant_id, email, full_name, role)
      values (v_uid, v_s.tenant_id, '', v_name, 'guest');
  else
    update public.users set full_name = v_name where id = v_uid;
  end if;
  -- Joining as a guest means accepting the Terms of Service, as the join page says.
  insert into public.consents (tenant_id, user_id, kind, version)
    values (v_s.tenant_id, v_uid, 'terms_of_service', 1) on conflict (user_id, kind, version) do nothing;

  insert into public.session_guests (session_id, user_id, tenant_id, display_name)
    values (v_s.id, v_uid, v_s.tenant_id, v_name)
    on conflict (session_id, user_id) do update set display_name = excluded.display_name;
  insert into public.session_participants (session_id, user_id, tenant_id, status, current_slide)
    values (v_s.id, v_uid, v_s.tenant_id, 'online', v_s.current_slide)
    on conflict (session_id, user_id) do update set status = 'online', left_at = null, last_seen_at = now();
  if v_old is not null then
    -- Move the earlier device's place to this one: the pass, the score, the answers, a raised hand.
    delete from public.session_guests where session_id = v_s.id and user_id = v_uid;
    delete from public.session_participants where session_id = v_s.id and user_id = v_uid;
    update public.session_guests set user_id = v_uid where session_id = v_s.id and user_id = v_old;
    update public.session_participants set user_id = v_uid, status = 'online', left_at = null, last_seen_at = now(),
           away_since = null, away_reason = null where session_id = v_s.id and user_id = v_old;
    update public.quiz_attempts set student_id = v_uid where session_id = v_s.id and student_id = v_old;
    update public.raise_hands set student_id = v_uid where session_id = v_s.id and student_id = v_old;
    perform app.audit('session.guest_rejoined', 'class_session', v_s.id::text, jsonb_build_object('name', v_name), v_s.tenant_id);
    perform app.broadcast('staff:' || v_s.id, 'roster', jsonb_build_object('rejoined', v_name));
  end if;
  delete from public.code_attempts where user_id = v_uid;
  perform app.audit('session.guest_joined', 'class_session', v_s.id::text, jsonb_build_object('name', v_name), v_s.tenant_id);
  return jsonb_build_object('session_id', v_s.id, 'title', v_s.title, 'rejoined', v_old is not null);
end$$;

/** The live lessons the signed-in person is in (as a student or a guest), newest first. */
create or replace function public.my_open_lessons() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'title', s.title, 'guest', g.user_id is not null,
                                               'name', coalesce(g.display_name, u.full_name), 'homework', s.is_homework)
                            order by p.joined_at desc), '[]'::jsonb)
    from public.session_participants p
    join public.class_sessions s on s.id = p.session_id
    join public.users u on u.id = p.user_id
    left join public.session_guests g on g.session_id = p.session_id and g.user_id = p.user_id
   where p.user_id = auth.uid() and s.status = 'live' and p.removed_at is null and s.teacher_id <> auth.uid()
     and (g.user_id is null or g.removed_at is null)
$$;
revoke execute on function public.my_open_lessons() from public, anon;
grant execute on function public.my_open_lessons() to authenticated;

/** Delete a lesson: gone if never taught, otherwise moved to Deleted with its results kept. */
create or replace function public.delete_lesson(p_lesson uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_l public.lessons; v_used boolean;
begin
  select * into v_l from public.lessons where id = p_lesson;
  if v_l.id is null or not app.can_edit_lesson(p_lesson) then raise exception 'Lesson not found.' using errcode = 'P0002'; end if;
  if exists (select 1 from public.class_sessions where lesson_id = p_lesson and status = 'live') then
    raise exception 'This lesson is running live or set as homework. End it first.' using errcode = 'P0001';
  end if;
  v_used := exists (select 1 from public.class_sessions where lesson_id = p_lesson)
         or exists (select 1 from public.quiz_attempts t join public.activities a on a.id = t.activity_id where a.lesson_id = p_lesson);
  if v_used then
    update public.lessons set status = 'archived' where id = p_lesson;
    perform app.audit('lesson.archived', 'lesson', p_lesson::text, '{}'::jsonb);
    return jsonb_build_object('deleted', false, 'archived', true);
  end if;
  delete from public.lessons where id = p_lesson;
  perform app.audit('lesson.deleted', 'lesson', p_lesson::text, jsonb_build_object('title', v_l.title));
  return jsonb_build_object('deleted', true, 'archived', false);
end$$;

/** Bring a deleted (archived) lesson back as a draft. */
create or replace function public.restore_lesson(p_lesson uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not app.can_edit_lesson(p_lesson) then raise exception 'Lesson not found.' using errcode = 'P0002'; end if;
  update public.lessons set status = 'draft' where id = p_lesson and status = 'archived';
  if not found then raise exception 'That lesson isn''t in Deleted.' using errcode = 'P0002'; end if;
  perform app.audit('lesson.restored', 'lesson', p_lesson::text, '{}'::jsonb);
end$$;

revoke execute on function public.delete_lesson(uuid), public.restore_lesson(uuid) from public, anon;
grant execute on function public.delete_lesson(uuid), public.restore_lesson(uuid) to authenticated;

create or replace function public.health() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('ok', true, 'db_time', now(), 'schema', '1110')
$$;
