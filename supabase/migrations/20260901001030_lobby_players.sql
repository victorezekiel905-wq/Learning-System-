-- 1030: students see who else is in the lobby.
--
-- Before the teacher starts, everyone in the lesson sees the others who have
-- joined: their avatar and first name with an initial ("Ada O."), the way the
-- projector already shows them. Only while the lesson is in its lobby, only to
-- people in that lesson, at most 60, and no names when the teacher chose
-- anonymous names for the lesson.

create or replace function public.session_lobby(p_session uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_s    public.class_sessions;
  v_anon boolean;
begin
  select * into v_s from public.class_sessions where id = p_session;
  if v_s.id is null or not (app.in_session(v_s.id) or app.can_manage_session(v_s.id)) then
    raise exception 'Session not found.' using errcode = 'P0002';
  end if;
  if v_s.status <> 'live' or v_s.phase <> 'lobby' then return '[]'::jsonb; end if;
  v_anon := coalesce((v_s.settings ->> 'anonymous_names')::boolean, false);
  return coalesce((
    select jsonb_agg(jsonb_build_object('name', case when v_anon then null else x.name end, 'avatar', x.avatar, 'me', x.me) order by x.joined_at)
      from (select app.display_name(coalesce(g.display_name, u.full_name)) as name, sp.avatar, sp.user_id = auth.uid() as me, sp.joined_at
              from public.session_participants sp
              join public.users u on u.id = sp.user_id
              left join public.session_guests g on g.session_id = sp.session_id and g.user_id = sp.user_id
             where sp.session_id = p_session and sp.user_id <> v_s.teacher_id and sp.left_at is null and sp.removed_at is null
               and sp.last_seen_at > now() - app.presence_window()
             order by sp.joined_at
             limit 60) x), '[]'::jsonb);
end$$;
revoke execute on function public.session_lobby(uuid) from public, anon;
grant execute on function public.session_lobby(uuid) to authenticated;

create or replace function public.health() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('ok', true, 'db_time', now(), 'schema', '1030')
$$;
