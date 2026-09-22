-- EduClass Fusion — WebRTC mesh signalling (v44 continuation)
-- Adds peer presence + signalling rows so teachers and students can join the
-- same A/V room during a live class session.

create table if not exists public.rtc_peers (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  room_id      uuid not null references public.rtc_rooms(id) on delete cascade,
  user_id      uuid not null references public.users(id) on delete cascade,
  display_name text,
  role         text not null default 'student',
  state        text not null default 'joined' check (state in ('joined','left')),
  media        jsonb not null default '{"audio": true, "video": true}'::jsonb,
  joined_at    timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (room_id, user_id)
);
create index if not exists rtc_peers_room_idx on public.rtc_peers(room_id, last_seen_at desc);
alter table public.rtc_peers enable row level security;

drop policy if exists rtc_peers_select on public.rtc_peers;
create policy rtc_peers_select on public.rtc_peers for select using (
  exists (
    select 1 from public.users u
    where u.id = auth.uid() and u.tenant_id = rtc_peers.tenant_id
  )
);

drop policy if exists rtc_peers_insert on public.rtc_peers;
create policy rtc_peers_insert on public.rtc_peers for insert with check (
  user_id = auth.uid() and
  exists (
    select 1 from public.users u
    where u.id = auth.uid() and u.tenant_id = rtc_peers.tenant_id
  )
);

drop policy if exists rtc_peers_update on public.rtc_peers;
create policy rtc_peers_update on public.rtc_peers for update using (
  user_id = auth.uid() and
  exists (
    select 1 from public.users u
    where u.id = auth.uid() and u.tenant_id = rtc_peers.tenant_id
  )
) with check (
  user_id = auth.uid() and
  exists (
    select 1 from public.users u
    where u.id = auth.uid() and u.tenant_id = rtc_peers.tenant_id
  )
);

drop policy if exists rtc_peers_delete on public.rtc_peers;
create policy rtc_peers_delete on public.rtc_peers for delete using (user_id = auth.uid());

grant select, insert, update, delete on public.rtc_peers to authenticated;

create table if not exists public.rtc_signals (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  room_id      uuid not null references public.rtc_rooms(id) on delete cascade,
  from_peer_id uuid not null references public.rtc_peers(id) on delete cascade,
  to_peer_id   uuid not null references public.rtc_peers(id) on delete cascade,
  kind         text not null check (kind in ('offer','answer','ice','bye')),
  payload      jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  consumed_at  timestamptz
);
create index if not exists rtc_signals_to_peer_idx on public.rtc_signals(to_peer_id, consumed_at, created_at);
create index if not exists rtc_signals_room_idx on public.rtc_signals(room_id, created_at desc);
alter table public.rtc_signals enable row level security;

drop policy if exists rtc_signals_select on public.rtc_signals;
create policy rtc_signals_select on public.rtc_signals for select using (
  exists (
    select 1
    from public.rtc_peers p
    where p.id in (rtc_signals.from_peer_id, rtc_signals.to_peer_id)
      and p.user_id = auth.uid()
  )
);

drop policy if exists rtc_signals_insert on public.rtc_signals;
create policy rtc_signals_insert on public.rtc_signals for insert with check (
  exists (
    select 1
    from public.rtc_peers p
    where p.id = rtc_signals.from_peer_id
      and p.user_id = auth.uid()
      and p.tenant_id = rtc_signals.tenant_id
  )
  and exists (
    select 1
    from public.rtc_peers p
    where p.id = rtc_signals.to_peer_id
      and p.room_id = rtc_signals.room_id
      and p.tenant_id = rtc_signals.tenant_id
  )
);

drop policy if exists rtc_signals_update on public.rtc_signals;
create policy rtc_signals_update on public.rtc_signals for update using (
  exists (
    select 1
    from public.rtc_peers p
    where p.id = rtc_signals.to_peer_id
      and p.user_id = auth.uid()
  )
) with check (
  exists (
    select 1
    from public.rtc_peers p
    where p.id = rtc_signals.to_peer_id
      and p.user_id = auth.uid()
  )
);

grant select, insert, update on public.rtc_signals to authenticated;

-- Realtime visibility for optional future live subscriptions.
do $$
begin
  begin
    alter publication supabase_realtime add table public.rtc_peers;
  exception when duplicate_object then null; end;
  begin
    alter publication supabase_realtime add table public.rtc_signals;
  exception when duplicate_object then null; end;
end$$;
