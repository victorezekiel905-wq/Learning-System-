-- 1070: "too many attempts" limits kept in the database, so they hold across
-- every app server (guest joining, wrong codes, AI drafts, API sign-ins).
--
-- A token bucket per key: up to p_per_minute requests, refilled continuously.
-- Called by the app server with the service key only (rate_allow); old buckets
-- are cleared by maintenance.

create table if not exists public.rate_buckets (
  key    text primary key check (length(key) <= 200),
  tokens double precision not null,
  at     timestamptz not null default now()
);
alter table public.rate_buckets enable row level security;
revoke all on public.rate_buckets from anon, authenticated;

create or replace function public.rate_allow(p_key text, p_per_minute int) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare v_b public.rate_buckets; v_tokens double precision;
begin
  if p_per_minute < 1 then return false; end if;
  insert into public.rate_buckets (key, tokens, at) values (p_key, p_per_minute, now())
    on conflict (key) do nothing;
  select * into v_b from public.rate_buckets where key = p_key for update;
  v_tokens := least(p_per_minute, v_b.tokens + extract(epoch from (now() - v_b.at)) / 60.0 * p_per_minute);
  if v_tokens < 1 then
    update public.rate_buckets set tokens = v_tokens, at = now() where key = p_key;
    return false;
  end if;
  update public.rate_buckets set tokens = v_tokens - 1, at = now() where key = p_key;
  return true;
end$$;
revoke execute on function public.rate_allow(text, int) from public, anon, authenticated;
grant execute on function public.rate_allow(text, int) to service_role;

create or replace function app.run_maintenance() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_ended int;
begin
  v_ended := app.end_abandoned_sessions() + app.end_teacherless_sessions();
  perform app.apply_retention_all();
  delete from public.invites where expires_at < now() - interval '30 days';
  delete from public.error_events where last_seen_at < now() - interval '30 days';
  delete from public.rate_buckets where at < now() - interval '1 hour';
  perform app.refresh_platform_stats();
  return jsonb_build_object('ok', true, 'ran_at', now(), 'sessions_auto_ended', v_ended);
end$$;

create or replace function public.health() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('ok', true, 'db_time', now(), 'schema', '1070')
$$;
