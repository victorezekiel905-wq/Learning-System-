-- Students' screens are on by default: everyone who joins gets the "Start learning"
-- step (one tap, then the browser's own Share box), whether or not Lockdown is on.
-- Guests are included by default too; the teacher can still turn guests off in the
-- control room, and where the school requires parental consent guests are never captured.
alter table public.class_sessions alter column guest_monitoring set default true;

create or replace function public.health() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('ok', true, 'db_time', now(), 'schema', '1140')
$$;
