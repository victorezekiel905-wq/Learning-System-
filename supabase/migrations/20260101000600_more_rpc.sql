-- =========================================================================
-- EduClass Fusion — device-agent RPCs (v2) + plan seed
-- Apply AFTER 20260101000400_agent_rpc.sql.
-- =========================================================================

-- Heartbeat without emitting a browser event row.
create or replace function public.device_heartbeat(p_device_uid text)
returns jsonb
language plpgsql security definer
as $$
declare v_dev uuid;
begin
  select id into v_dev from public.devices where device_uid = p_device_uid;
  if v_dev is null then raise exception 'device not enrolled'; end if;
  update public.devices set status = 'active', last_seen_at = now() where id = v_dev;
  return jsonb_build_object('ok', true);
end$$;
grant execute on function public.device_heartbeat(text) to anon, authenticated;

-- Poll queued teacher commands for the student who owns this device.
create or replace function public.device_poll_commands_by_device(p_device_uid text)
returns table (id uuid, kind text, payload jsonb, created_at timestamptz)
language plpgsql security definer
as $$
declare v_stu uuid; v_cmd uuid;
begin
  select de.student_id into v_stu
  from public.device_enrollments de
  join public.devices d on d.id = de.device_id
  where d.device_uid = p_device_uid and de.revoked_at is null
  order by de.enrolled_at desc limit 1;
  if v_stu is null then return; end if;

  for v_cmd in
    select tc.id from public.teacher_commands tc
    where tc.target_student_id = v_stu and tc.state = 'queued'
    order by tc.created_at limit 5
  loop
    return query select tc.id, tc.kind, tc.payload, tc.created_at
      from public.teacher_commands tc where tc.id = v_cmd;
    update public.teacher_commands set state = 'delivered', delivered_at = now()
      where id = v_cmd;
  end loop;
end$$;
grant execute on function public.device_poll_commands_by_device(text) to anon, authenticated;

-- ---------- Plans seed (§25) ----------
insert into public.plans (name, features, price_cents) values
  ('Free Teacher',
   '{"classes": 3, "students": 30, "storage_mb": 500, "activities": "mcq/poll/open-ended", "games": false, "device_control": false, "analytics": false}'::jsonb, 0),
  ('Teacher Pro',
   '{"classes": 0, "students": 0, "storage_mb": 10240, "activities": "all types", "games": true, "device_control": true, "analytics": true}'::jsonb, 1499),
  ('School',
   '{"central_admin": true, "device_control": true, "reporting": true, "sso": false, "ai": false}'::jsonb, 4999),
  ('School Plus',
   '{"central_admin": true, "device_control": true, "reporting": true, "sso": true, "ai": true, "parent_reports": true}'::jsonb, 9999),
  ('Enterprise/District',
   '{"custom_limits": true, "integrations": true, "dedicated_support": true, "security_controls": true}'::jsonb, 19999)
on conflict do nothing;

-- ---------- Browser telemetry readable by tenant peers (Guard page) ----------
drop policy if exists browser_events_tenant_select on public.browser_events;
create policy browser_events_tenant_select on public.browser_events for select using (
  exists (
    select 1 from public.devices d
    join public.users u on u.id = auth.uid()
    where d.id = browser_events.device_id and u.tenant_id = d.tenant_id
  )
);

-- devices visible to tenant peers already handled by devices_select (init).
-- Students may read published lesson slides (needed for student-paced).
grant execute on function public.class_lookup_by_code(text) to anon, authenticated;
