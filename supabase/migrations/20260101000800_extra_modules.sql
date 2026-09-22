-- =========================================================================
-- EduClass Fusion — extra modules (v3 build pass)
-- Interactive video timestamps, collab-board state, parent portal,
-- roster import, report export, code sandbox submissions, WebRTC rooms.
-- All idempotent. Apply AFTER 000700_game_rpc.sql.
-- =========================================================================

-- ---- Interactive video timestamps (§3.1) ----
create table if not exists public.video_timestamps (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  lesson_id       uuid not null references public.lessons(id) on delete cascade,
  video_url       text not null,
  t_seconds       int  not null check (t_seconds >= 0),
  kind            text not null check (kind in ('question','note')),
  payload         jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);
create index if not exists video_timestamps_lesson_idx on public.video_timestamps(lesson_id, t_seconds);
alter table public.video_timestamps enable row level security;
drop policy if exists video_ts_tenant on public.video_timestamps;
create policy video_ts_tenant on public.video_timestamps for all using (
  exists (select 1 from public.users u where u.id = auth.uid() and u.tenant_id = video_timestamps.tenant_id)
) with check (
  exists (select 1 from public.users u where u.id = auth.uid() and u.tenant_id = video_timestamps.tenant_id)
);
grant select, insert, update, delete on public.video_timestamps to authenticated;

-- ---- Whiteboard / collab board (§3.4) ----
create table if not exists public.collab_boards (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  owner_id        uuid not null references public.users(id),
  session_id      uuid references public.class_sessions(id) on delete cascade,
  title           text not null,
  -- Strokes are deltas: each row is a single element append/replace.
  strokes         jsonb not null default '[]'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists collab_boards_session_idx on public.collab_boards(session_id);
alter table public.collab_boards enable row level security;
drop policy if exists collab_boards_tenant on public.collab_boards;
create policy collab_boards_tenant on public.collab_boards for all using (
  exists (select 1 from public.users u where u.id = auth.uid() and u.tenant_id = collab_boards.tenant_id)
) with check (
  exists (select 1 from public.users u where u.id = auth.uid() and u.tenant_id = collab_boards.tenant_id)
);
grant select, insert, update, delete on public.collab_boards to authenticated;

-- ---- Parent consent + link (§5) ----
create table if not exists public.parent_links (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  parent_user_id  uuid not null references public.users(id) on delete cascade,
  student_user_id uuid not null references public.users(id) on delete cascade,
  relation        text not null default 'guardian',
  scopes          jsonb not null default '["attendance","summary","screen_time"]'::jsonb,
  consent_at      timestamptz not null default now(),
  revoked_at      timestamptz,
  unique (parent_user_id, student_user_id)
);
create index if not exists parent_links_parent_idx on public.parent_links(parent_user_id);
create index if not exists parent_links_student_idx on public.parent_links(student_user_id);
alter table public.parent_links enable row level security;
drop policy if exists parent_links_parent_read on public.parent_links;
create policy parent_links_parent_read on public.parent_links for select using (parent_user_id = auth.uid());
drop policy if exists parent_links_admin_write on public.parent_links;
create policy parent_links_admin_write on public.parent_links for insert with check (
  exists (select 1 from public.users u where u.id = auth.uid() and u.tenant_id = parent_links.tenant_id
          and u.role in ('school_admin','it_admin','platform_admin'))
);
drop policy if exists parent_links_admin_update on public.parent_links;
create policy parent_links_admin_update on public.parent_links for update using (
  exists (select 1 from public.users u where u.id = auth.uid() and u.tenant_id = parent_links.tenant_id
          and u.role in ('school_admin','it_admin','platform_admin'))
);
grant select, insert, update, delete on public.parent_links to authenticated;

-- ---- Roster bulk-import batch jobs (§19) ----
create table if not exists public.roster_imports (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  class_id        uuid not null references public.classes(id) on delete cascade,
  uploaded_by     uuid not null references public.users(id),
  filename        text not null,
  rows_total      int  not null default 0,
  rows_added      int  not null default 0,
  rows_updated    int  not null default 0,
  rows_errored    int  not null default 0,
  errors          jsonb not null default '[]'::jsonb,
  created_at      timestamptz not null default now()
);
create index if not exists roster_imports_class_idx on public.roster_imports(class_id);
alter table public.roster_imports enable row level security;
drop policy if exists roster_imports_tenant on public.roster_imports;
create policy roster_imports_tenant on public.roster_imports for all using (
  exists (select 1 from public.users u where u.id = auth.uid() and u.tenant_id = roster_imports.tenant_id
          and u.role in ('teacher','school_admin','it_admin','platform_admin'))
) with check (
  exists (select 1 from public.users u where u.id = auth.uid() and u.tenant_id = roster_imports.tenant_id
          and u.role in ('teacher','school_admin','it_admin','platform_admin'))
);
grant select, insert, update on public.roster_imports to authenticated;

-- ---- Code-activity sandbox submissions (§3.2) ----
create table if not exists public.code_submissions (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  activity_id     uuid not null references public.activities(id) on delete cascade,
  student_id      uuid not null references public.users(id) on delete cascade,
  language        text not null check (language in ('javascript','python','html','css')),
  source          text not null,
  stdout          text,
  stderr          text,
  grader_feedback jsonb not null default '{}'::jsonb,
  passed          boolean,
  created_at      timestamptz not null default now()
);
create index if not exists code_submissions_student_idx on public.code_submissions(student_id);
alter table public.code_submissions enable row level security;
drop policy if exists code_subs_student on public.code_submissions;
create policy code_subs_student on public.code_submissions for all using (student_id = auth.uid()) with check (student_id = auth.uid());
drop policy if exists code_subs_teacher on public.code_submissions;
create policy code_subs_teacher on public.code_submissions for select using (
  exists (select 1 from public.activities a where a.id = code_submissions.activity_id and a.owner_id = auth.uid())
);
grant select, insert, update on public.code_submissions to authenticated;

-- ---- Reports row metadata (server-side export pipeline) ----
-- Already in core (`reports`). Add a `format` discriminator + status.
do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='reports' and column_name='format') then
    alter table public.reports add column format text not null default 'pdf';
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='reports' and column_name='status') then
    alter table public.reports add column status text not null default 'ready';
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='reports' and column_name='payload') then
    alter table public.reports add column payload jsonb not null default '{}'::jsonb;
  end if;
end$$;

-- ---- WebRTC signalling rooms (§3.7 peer option) ----
create table if not exists public.rtc_rooms (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  session_id      uuid not null references public.class_sessions(id) on delete cascade,
  host_user_id    uuid not null references public.users(id),
  state           text not null default 'open' check (state in ('open','closed')),
  created_at      timestamptz not null default now()
);
create index if not exists rtc_rooms_session_idx on public.rtc_rooms(session_id);
alter table public.rtc_rooms enable row level security;
drop policy if exists rtc_rooms_tenant on public.rtc_rooms;
create policy rtc_rooms_tenant on public.rtc_rooms for all using (
  exists (select 1 from public.users u where u.id = auth.uid() and u.tenant_id = rtc_rooms.tenant_id)
) with check (
  exists (select 1 from public.users u where u.id = auth.uid() and u.tenant_id = rtc_rooms.tenant_id)
);
grant select, insert, update on public.rtc_rooms to authenticated;

-- ---- Realtime publication additions (idempotent) ----
do $$
begin
  begin
    alter publication supabase_realtime add table public.video_timestamps;
  exception when duplicate_object then null; end;
  begin
    alter publication supabase_realtime add table public.collab_boards;
  exception when duplicate_object then null; end;
  begin
    alter publication supabase_realtime add table public.code_submissions;
  exception when duplicate_object then null; end;
end$$;

-- ---- RPC: server-side CSV roster parser (§19) ----
create or replace function public.roster_csv_apply(
  p_class_id uuid,
  p_rows jsonb
) returns jsonb
language plpgsql security definer
as $$
declare
  v_teacher uuid;
  v_tenant  uuid;
  v_added   int := 0;
  v_updated int := 0;
  v_errs    jsonb := '[]'::jsonb;
  r         jsonb;
  v_email   text;
  v_full    text;
  v_role    text;
  v_user    uuid;
begin
  select teacher_id, tenant_id into v_teacher, v_tenant
    from public.classes where id = p_class_id;
  if v_teacher is null then
    return jsonb_build_object('error','class not found');
  end if;
  if v_teacher <> auth.uid() then
    if not exists (
      select 1 from public.users u where u.id = auth.uid()
        and u.tenant_id = v_tenant and u.role in ('school_admin','it_admin','platform_admin')
    ) then
      return jsonb_build_object('error','forbidden');
    end if;
  end if;

  for r in select * from jsonb_array_elements(p_rows)
  loop
    v_email := lower(coalesce(r->>'email',''));
    v_full  := coalesce(r->>'full_name', split_part(v_email,'@',1));
    v_role  := coalesce(r->>'role','student');
    if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
      v_errs := v_errs || jsonb_build_object('row', r, 'error','invalid_email');
      continue;
    end if;
    if v_role not in ('student','teacher','school_admin','it_admin') then
      v_role := 'student';
    end if;

    select id into v_user from public.users where email = v_email and tenant_id = v_tenant limit 1;
    if v_user is null then
      -- Create a placeholder; the real identity lives in auth.users (the actual
      -- invite is sent via the platform's invite endpoint, not here).
      insert into public.users (id, tenant_id, email, full_name, role)
        values (gen_random_uuid(), v_tenant, v_email, v_full, v_role)
        returning id into v_user;
      v_added := v_added + 1;
    else
      update public.users set full_name = v_full, role = v_role where id = v_user;
      v_updated := v_updated + 1;
    end if;

    insert into public.class_members (class_id, user_id, role)
      values (p_class_id, v_user, v_role)
      on conflict (class_id, user_id) do nothing;
  end loop;

  insert into public.roster_imports (tenant_id, class_id, uploaded_by, filename,
                                     rows_total, rows_added, rows_updated, rows_errored, errors)
    values (v_tenant, p_class_id, auth.uid(),
            coalesce(nullif(current_setting('request.headers', true),''),'upload.csv'),
            jsonb_array_length(p_rows), v_added, v_updated, jsonb_array_length(v_errs), v_errs)
    on conflict do nothing;

  return jsonb_build_object(
    'total', jsonb_array_length(p_rows),
    'added', v_added,
    'updated', v_updated,
    'errored', jsonb_array_length(v_errs),
    'errors', v_errs
  );
end$$;
grant execute on function public.roster_csv_apply(uuid, jsonb) to authenticated;

-- ---- RPC: report generator (server-side counts → JSON payload) §18 ----
create or replace function public.report_aggregate(
  p_class uuid, p_kind text
) returns jsonb
language plpgsql security definer stable
as $$
declare
  v_tenant uuid;
  v_payload jsonb;
begin
  select tenant_id into v_tenant from public.classes where id = p_class;
  if v_tenant is null then return jsonb_build_object('error','class_not_found'); end if;
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.tenant_id = v_tenant) then
    return jsonb_build_object('error','forbidden');
  end if;

  if p_kind = 'participation' then
    select jsonb_build_object(
      'students',   (select count(*) from public.class_members where class_id = p_class and role='student'),
      'responses',  (select count(*) from public.activity_responses r
                       join public.activities a on a.id = r.activity_id
                      where a.class_id = p_class),
      'correct',    (select count(*) from public.activity_responses r
                       join public.activities a on a.id = r.activity_id
                      where a.class_id = p_class and r.correct),
      'in_class',   (select count(*) from public.student_presence where class_id = p_class)
    ) into v_payload;
  elsif p_kind = 'env_alerts' then
    select jsonb_build_object(
      'informational', (select count(*) from public.environment_events
                         where class_id = p_class and severity='informational'),
      'warning',       (select count(*) from public.environment_events
                         where class_id = p_class and severity='warn'),
      'critical',      (select count(*) from public.environment_events
                         where class_id = p_class and severity='critical'),
      'last',          (select jsonb_agg(e) from (
                          select id, kind, severity, ts from public.environment_events
                          where class_id = p_class order by ts desc limit 10
                        ) e)
    ) into v_payload;
  elsif p_kind = 'devices' then
    select jsonb_build_object(
      'active', (select count(*) from public.devices d
                   where d.tenant_id = v_tenant and d.status='active'),
      'idle',   (select count(*) from public.devices d
                   where d.tenant_id = v_tenant and d.status='idle'),
      'offline',(select count(*) from public.devices d
                   where d.tenant_id = v_tenant and d.status='offline')
    ) into v_payload;
  else
    return jsonb_build_object('error','unknown_kind');
  end if;
  return v_payload;
end$$;
grant execute on function public.report_aggregate(uuid, text) to authenticated;
