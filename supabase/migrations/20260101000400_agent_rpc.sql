-- =========================================================================
-- EduClass Fusion — browser-agent RPCs (v2)
-- Security-definer entrypoints so the extension operates WITHOUT broad
-- anonymous RLS grants. Telemetry in, narrow reads out.
-- Apply AFTER 20260101000300_runtime_rpc.sql.
-- =========================================================================

-- Agent: poll queued commands for a student in a live session; mark delivered.
create or replace function public.device_poll_commands(p_session uuid, p_student uuid)
returns table (id uuid, kind text, payload jsonb, created_at timestamptz)
language plpgsql security definer
as $$
declare v_id uuid;
begin
  for v_id in
    select tc.id from public.teacher_commands tc
    where tc.session_id = p_session and tc.target_student_id = p_student
      and tc.state = 'queued'
    order by tc.created_at
    limit 5
  loop
    return query select tc.id, tc.kind, tc.payload, tc.created_at
      from public.teacher_commands tc where tc.id = v_id;
    update public.teacher_commands set state = 'delivered', delivered_at = now()
      where id = v_id;
  end loop;
end$$;
grant execute on function public.device_poll_commands(uuid, uuid) to anon, authenticated;

-- Agent: acknowledge a delivered command.
create or replace function public.device_ack_command(p_id uuid)
returns void
language sql security definer
as $$
  update public.teacher_commands set state = 'acked', acked_at = now() where id = p_id;
$$;
grant execute on function public.device_ack_command(uuid) to anon, authenticated;

-- Agent: post a browser telemetry event; evaluate environment policy;
-- record an environment_event with severity when the policy fires.
create or replace function public.device_post_event(
  p_device_uid text, p_kind text, p_url text default null,
  p_session uuid default null, p_title text default null
) returns jsonb
language plpgsql security definer
as $$
declare
  v_dev uuid;
  v_eval jsonb;
  v_sev text := 'info';
  v_reason text := '';
begin
  select id into v_dev from public.devices where device_uid = p_device_uid;
  if v_dev is null then raise exception 'device not enrolled'; end if;

  update public.devices set status = 'active', last_seen_at = now() where id = v_dev;

  insert into public.browser_events (device_id, session_id, kind, url, title)
  values (v_dev, p_session, p_kind, p_url, p_title);

  if p_session is not null and p_url is not null then
    select evaluate_environment(p_session, p_url) into v_eval;
    v_sev := coalesce(v_eval->>'severity', 'info');
    v_reason := coalesce(v_eval->>'reason', '');
    if (v_eval->>'violation')::boolean then
      insert into public.environment_events
        (session_id, policy_id, kind, url, severity)
      select p_session, cs.policy_id,
             case when p_kind = 'idle' then 'idle' else 'domain_blocked' end,
             p_url, v_sev
      from public.class_sessions cs where cs.id = p_session
      on conflict do nothing;
    end if;
  end if;

  return jsonb_build_object('ok', true, 'severity', v_sev, 'reason', v_reason);
end$$;
grant execute on function public.device_post_event(text, text, text, uuid, text) to anon, authenticated;

-- Agent: post a low-res screen snapshot.
create or replace function public.device_post_snapshot(
  p_device_uid text, p_session uuid, p_data_url text,
  p_url text default null, p_title text default null
) returns jsonb
language plpgsql security definer
as $$
declare v_dev uuid;
begin
  select id into v_dev from public.devices where device_uid = p_device_uid;
  if v_dev is null then raise exception 'device not enrolled'; end if;
  update public.devices set status = 'active', last_seen_at = now() where id = v_dev;
  insert into public.screen_snapshots (device_id, session_id, data_url, url, title)
  values (v_dev, p_session, p_data_url, p_url, p_title);
  return jsonb_build_object('ok', true);
end$$;
grant execute on function public.device_post_snapshot(text, uuid, text, text, text) to anon, authenticated;

-- ---------- class_lookup_by_code may already exist from the extend migration;
-- make sure it is still executable by anon for signup flows.
grant execute on function public.class_lookup_by_code(text) to anon, authenticated;
