-- =========================================================================
-- EduClass Fusion — attendance, parent view, reports alignment (v39 pass)
-- Apply AFTER 20260101000800_extra_modules.sql.
-- =========================================================================

-- ---- Attendance hardening -------------------------------------------------
alter table public.attendance enable row level security;
create unique index if not exists attendance_class_student_date_uidx
  on public.attendance(class_id, student_id, date);
create index if not exists attendance_class_date_idx
  on public.attendance(class_id, date desc);
create index if not exists attendance_student_date_idx
  on public.attendance(student_id, date desc);

drop policy if exists attendance_select on public.attendance;
create policy attendance_select on public.attendance for select using (
  student_id = auth.uid()
  or exists (
    select 1 from public.classes c
    where c.id = attendance.class_id and c.teacher_id = auth.uid()
  )
  or exists (
    select 1 from public.classes c
    join public.users u on u.tenant_id = c.tenant_id
    where c.id = attendance.class_id
      and u.id = auth.uid()
      and u.role in ('school_admin','it_admin','platform_admin')
  )
  or exists (
    select 1 from public.parent_links pl
    where pl.parent_user_id = auth.uid()
      and pl.student_user_id = attendance.student_id
      and pl.revoked_at is null
  )
);

drop policy if exists attendance_insert on public.attendance;
create policy attendance_insert on public.attendance for insert with check (
  exists (
    select 1 from public.classes c
    where c.id = attendance.class_id and c.teacher_id = auth.uid()
  )
  or exists (
    select 1 from public.classes c
    join public.users u on u.tenant_id = c.tenant_id
    where c.id = attendance.class_id
      and u.id = auth.uid()
      and u.role in ('school_admin','it_admin','platform_admin')
  )
);

drop policy if exists attendance_update on public.attendance;
create policy attendance_update on public.attendance for update using (
  exists (
    select 1 from public.classes c
    where c.id = attendance.class_id and c.teacher_id = auth.uid()
  )
  or exists (
    select 1 from public.classes c
    join public.users u on u.tenant_id = c.tenant_id
    where c.id = attendance.class_id
      and u.id = auth.uid()
      and u.role in ('school_admin','it_admin','platform_admin')
  )
) with check (
  exists (
    select 1 from public.classes c
    where c.id = attendance.class_id and c.teacher_id = auth.uid()
  )
  or exists (
    select 1 from public.classes c
    join public.users u on u.tenant_id = c.tenant_id
    where c.id = attendance.class_id
      and u.id = auth.uid()
      and u.role in ('school_admin','it_admin','platform_admin')
  )
);

grant select, insert, update on public.attendance to authenticated;

-- ---- Reports table alignment ----------------------------------------------
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'reports' and column_name = 'name'
  ) then
    alter table public.reports add column name text not null default 'report';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'reports' and column_name = 'created_at'
  ) then
    alter table public.reports add column created_at timestamptz not null default now();
  end if;
end$$;

update public.reports
   set created_at = coalesce(created_at, generated_at, now())
 where created_at is null;

create index if not exists reports_tenant_created_idx on public.reports(tenant_id, created_at desc);

drop policy if exists reports_tenant on public.reports;
create policy reports_tenant on public.reports for select using (
  exists (
    select 1 from public.users u
    where u.id = auth.uid() and u.tenant_id = reports.tenant_id
  )
);

drop policy if exists reports_insert on public.reports;
create policy reports_insert on public.reports for insert with check (
  exists (
    select 1 from public.users u
    where u.id = auth.uid()
      and u.tenant_id = reports.tenant_id
      and u.role in ('teacher','school_admin','it_admin','platform_admin')
  )
);

grant select, insert on public.reports to authenticated;

-- ---- Report aggregate: add attendance summary ------------------------------
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
  elsif p_kind = 'attendance' then
    select jsonb_build_object(
      'present', (select count(*) from public.attendance where class_id = p_class and status='present'),
      'tardy',   (select count(*) from public.attendance where class_id = p_class and status='tardy'),
      'excused', (select count(*) from public.attendance where class_id = p_class and status='excused'),
      'absent',  (select count(*) from public.attendance where class_id = p_class and status='absent'),
      'last',    (select jsonb_agg(a) from (
                     select student_id, date, status from public.attendance
                     where class_id = p_class
                     order by date desc limit 20
                   ) a)
    ) into v_payload;
  else
    return jsonb_build_object('error','unknown_kind');
  end if;
  return v_payload;
end$$;
grant execute on function public.report_aggregate(uuid, text) to authenticated;
