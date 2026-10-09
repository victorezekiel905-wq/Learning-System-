-- 1000: guests join with just the code and a name, whatever Supabase's settings.
--
-- Until now a guest had to be a Supabase anonymous sign-in, which works only
-- while "Allow anonymous sign-ins" is on, and then only about 30 an hour from
-- one internet address (a whole school). When that fails, the server now makes
-- the guest's account itself (POST /api/live/guest, with the service key): an
-- account marked app_metadata.guest = true. Only the service key can set
-- app_metadata, so nobody can mark their own account. A marked account is
-- treated exactly like an anonymous sign-in: it can only ever be a guest.

/** A guest account: an anonymous sign-in, or one the server made for a guest. */
create or replace function app.is_guest_account(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select a.is_anonymous or coalesce(a.raw_app_meta_data ->> 'guest', '') = 'true'
                     from auth.users a where a.id = p_user), false)
$$;
revoke execute on function app.is_guest_account(uuid) from public, anon, authenticated;

create or replace function app.is_anonymous() returns boolean
language sql stable security definer set search_path = '' as $$
  select app.is_guest_account(auth.uid())
$$;

create or replace function app.guard_guest_profile() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_anon boolean := app.is_guest_account(new.id);
begin
  if v_anon and new.role <> 'guest' then
    raise exception 'Create an account to join a school.' using errcode = '42501';
  end if;
  if new.role = 'guest' and not v_anon then
    raise exception 'Only a guest sign-in can be a guest.' using errcode = '42501';
  end if;
  return new;
end$$;

-- Guests are removed 30 days after their last lesson, and guest sign-ins that
-- never joined a lesson (a wrong code, a closed lesson) after a day.
create or replace function app.purge_guests() returns int
language plpgsql volatile security definer set search_path = '' as $$
declare v_n int;
begin
  delete from auth.users a
   where (a.is_anonymous or coalesce(a.raw_app_meta_data ->> 'guest', '') = 'true')
     and (exists (select 1 from public.users u where u.id = a.id and u.role = 'guest')
          or (not exists (select 1 from public.users u where u.id = a.id) and a.created_at < now() - interval '1 day'))
     and not exists (select 1 from public.session_guests g join public.class_sessions s on s.id = g.session_id
                      where g.user_id = a.id and (s.status = 'live' or coalesce(s.ended_at, s.created_at) > now() - interval '30 days'));
  get diagnostics v_n = row_count;
  return v_n;
end$$;
revoke execute on function app.purge_guests() from public, anon, authenticated;

create or replace function public.health() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('ok', true, 'db_time', now(), 'schema', '1000')
$$;
