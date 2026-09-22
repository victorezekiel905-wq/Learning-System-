-- =============================================================================
-- SwiftCipher — 0630 Guard RPCs: policy engine (§14), device agent (§21),
-- leave detection (§3.6, §16), off-task (§3.8), commands, screens (§15).
--
-- The agent authenticates every call with (device_id, secret); the secret is
-- compared against its sha256. The extension never holds a user JWT.
-- =============================================================================

-- ---------- URL helpers (pure, unit-tested) ----------
-- Lower-case host without scheme, credentials, port or leading "www.".
-- Returns null for non-web pages (new tab, settings, extensions, files).
create or replace function app.url_host(p_url text) returns text
language sql immutable set search_path = '' as $$
  select nullif(regexp_replace(
           lower(substring(btrim(coalesce(p_url, '')) from '^[hH][tT][tT][pP][sS]?://(?:[^@/?#]*@)?([^/:?#]+)')),
           '^www\.', ''), '')
$$;

-- Normalises a policy entry ("https://www.Example.com/path", "*.example.com") to a bare domain.
create or replace function app.normalize_domain(p text) returns text
language sql immutable set search_path = '' as $$
  select nullif(regexp_replace(regexp_replace(regexp_replace(lower(btrim(coalesce(p, ''))),
           '^[a-z]+://', ''), '^(\*\.|www\.)', ''), '[/:?#].*$', ''), '')
$$;

-- Label-boundary match: "example.com" matches example.com and a.example.com,
-- never badexample.com.
create or replace function app.domain_matches(p_host text, p_pattern text) returns boolean
language sql immutable set search_path = '' as $$
  select p_host is not null and app.normalize_domain(p_pattern) is not null
     and (p_host = app.normalize_domain(p_pattern) or right(p_host, length(app.normalize_domain(p_pattern)) + 1) = '.' || app.normalize_domain(p_pattern))
$$;

create or replace function app.domain_in(p_host text, p_list text[]) returns text
language sql immutable set search_path = '' as $$
  select x from unnest(coalesce(p_list, '{}'::text[])) x where app.domain_matches(p_host, x) limit 1
$$;

-- Longest-suffix category lookup.
create or replace function app.domain_category(p_host text) returns text
language sql stable set search_path = '' as $$
  select dc.category from public.domain_categories dc
  where app.domain_matches(p_host, dc.domain)
  order by length(dc.domain) desc limit 1
$$;

-- ---------------------------------------------------------------------------
-- Deterministic policy evaluation (§14). Returns:
--   { verdict: allowed|neutral|warning|violation|off_task, kind, severity, rule, domain, category }
-- verdict semantics (§16): allowed → nothing; warning → soft notice to the
-- student only; violation → ENVIRONMENT_LEFT event after the grace period;
-- off_task → assistive teacher alert with a confidence score (§3.8).
-- ---------------------------------------------------------------------------
create or replace function app.evaluate_url(
  p_policy public.environment_policies, p_url text, p_tab_count int, p_app_host text
) returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  v_host text := app.url_host(p_url);
  v_cat  text;
  v_hit  text;
begin
  if v_host is null then
    return jsonb_build_object('verdict', 'neutral', 'rule', 'Browser page', 'domain', null);
  end if;
  v_cat := app.domain_category(v_host);
  if p_app_host is not null and app.domain_matches(v_host, p_app_host) then
    return jsonb_build_object('verdict', 'allowed', 'rule', 'SwiftCipher', 'domain', v_host, 'category', v_cat);
  end if;
  if p_policy.id is null then
    return jsonb_build_object('verdict', 'allowed', 'rule', 'No environment active', 'domain', v_host, 'category', v_cat);
  end if;

  v_hit := app.domain_in(v_host, p_policy.blocked_domains);
  if v_hit is not null then
    return jsonb_build_object('verdict', 'violation', 'kind', 'domain_blocked', 'severity', 'critical',
                              'rule', 'Blocked domain: ' || app.normalize_domain(v_hit), 'domain', v_host, 'category', v_cat);
  end if;
  if v_cat is not null and v_cat = any (p_policy.blocked_categories) then
    return jsonb_build_object('verdict', 'violation', 'kind', 'domain_blocked', 'severity', 'warning',
                              'rule', 'Blocked category: ' || v_cat, 'domain', v_host, 'category', v_cat);
  end if;

  if app.domain_in(v_host, p_policy.allowed_domains) is not null
     or app.domain_in(v_host, p_policy.required_urls) is not null
     or (p_policy.lesson_url is not null and app.domain_matches(v_host, p_policy.lesson_url)) then
    if p_policy.tab_limit is not null and coalesce(p_tab_count, 0) > p_policy.tab_limit then
      return jsonb_build_object('verdict', 'warning', 'kind', 'tab_limit', 'severity', 'info',
                                'rule', 'More than ' || p_policy.tab_limit || ' tabs open', 'domain', v_host, 'category', v_cat);
    end if;
    return jsonb_build_object('verdict', 'allowed', 'rule', 'Allowed domain', 'domain', v_host, 'category', v_cat);
  end if;

  if p_policy.focus_mode or p_policy.lock_screen then
    return jsonb_build_object('verdict', 'violation', 'kind', 'environment_left', 'severity', 'warning',
                              'rule', 'Outside the class environment', 'domain', v_host, 'category', v_cat);
  end if;

  if v_cat in ('games','social','video','streaming','shopping','chat','gambling','adult') then
    return jsonb_build_object('verdict', 'off_task', 'kind', 'off_task', 'severity', 'info',
                              'rule', 'Looks unrelated to ' || coalesce(nullif(p_policy.subject, ''), 'the lesson') || ' (' || v_cat || ')',
                              'domain', v_host, 'category', v_cat);
  end if;

  if coalesce(array_length(p_policy.allowed_domains, 1), 0) + coalesce(array_length(p_policy.required_urls, 1), 0) > 0 then
    return jsonb_build_object('verdict', 'warning', 'kind', 'environment_left', 'severity', 'info',
                              'rule', 'Not on the class resource list', 'domain', v_host, 'category', v_cat);
  end if;
  if p_policy.tab_limit is not null and coalesce(p_tab_count, 0) > p_policy.tab_limit then
    return jsonb_build_object('verdict', 'warning', 'kind', 'tab_limit', 'severity', 'info',
                              'rule', 'More than ' || p_policy.tab_limit || ' tabs open', 'domain', v_host, 'category', v_cat);
  end if;
  return jsonb_build_object('verdict', 'allowed', 'rule', 'No rule matched', 'domain', v_host, 'category', v_cat);
end$$;

-- Session-level environment first; a student's group auto-start policy
-- (§23 "student groups and auto-start environments") overrides it.
create or replace function app.effective_policy(p_session public.class_sessions, p_student uuid)
returns public.environment_policies
language plpgsql stable security definer set search_path = '' as $$
declare v public.environment_policies;
begin
  select ep.* into v
  from public.student_group_members gm
  join public.student_groups g on g.id = gm.group_id
  join public.environment_policies ep on ep.id = g.auto_start_policy_id
  where gm.user_id = p_student and g.class_id = p_session.class_id
  order by g.created_at limit 1;
  if v.id is null and p_session.environment_active then
    select * into v from public.environment_policies where id = p_session.environment_id;
  end if;
  return v;
end$$;

-- ---------------------------------------------------------------------------
-- Pairing & enrolment (§21 secure extension enrolment)
-- ---------------------------------------------------------------------------
create or replace function public.create_pairing_code(p_student uuid default null) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me      public.users := app.me();
  v_student uuid := coalesce(p_student, v_me.id);
  v_method  text;
  v_code    text;
  v_exp     timestamptz := now() + interval '15 minutes';
begin
  if v_student = v_me.id then
    if v_me.role <> 'student' then raise exception 'Only student devices are paired.' using errcode = '22023'; end if;
    v_method := 'student_pairing';
  else
    if not (app.is_it() or app.teaches_student(v_student)) then
      raise exception 'You cannot enrol devices for this student.' using errcode = '42501';
    end if;
    if not exists (select 1 from public.users where id = v_student and tenant_id = v_me.tenant_id and role = 'student') then
      raise exception 'Student not found.' using errcode = 'P0002';
    end if;
    v_method := 'admin_pairing';
  end if;
  if (select count(*) from public.device_pairing_codes where student_id = v_student and used_at is null and expires_at > now()) >= 5 then
    raise exception 'Too many unused pairing codes; wait for them to expire.' using errcode = 'P0001';
  end if;
  v_code := app.unique_code(8, 'device_pairing_codes');
  insert into public.device_pairing_codes (code, tenant_id, student_id, created_by, method, expires_at)
    values (v_code, v_me.tenant_id, v_student, v_me.id, v_method, v_exp);
  perform app.audit('device.pairing_code_created', 'user', v_student::text, jsonb_build_object('method', v_method));
  return jsonb_build_object('code', v_code, 'expires_at', v_exp);
end$$;

create or replace function public.device_pair(
  p_code text, p_label text, p_os text default null, p_browser text default null, p_version text default null
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_pc     public.device_pairing_codes;
  v_secret text := app.gen_secret();
  v_device uuid;
  v_count  bigint;
  v_name   text;
  v_notice text;
begin
  select * into v_pc from public.device_pairing_codes
   where code = upper(btrim(coalesce(p_code, ''))) and used_at is null and expires_at > now() for update;
  if v_pc.code is null then raise exception 'Pairing code is invalid or expired.' using errcode = 'P0002'; end if;
  if not app.feature(v_pc.tenant_id, 'device_control') then
    raise exception 'Device monitoring is not included in this school''s plan.' using errcode = 'P0001';
  end if;
  select count(*) into v_count from public.devices where tenant_id = v_pc.tenant_id and status = 'active';
  if not app.within_limit(v_pc.tenant_id, 'managed_devices', v_count) then
    raise exception 'This school has reached its managed-device limit.' using errcode = 'P0001';
  end if;

  insert into public.devices (tenant_id, student_id, label, os, browser, agent_version, secret_hash, enrolled_by)
    values (v_pc.tenant_id, v_pc.student_id, left(coalesce(nullif(btrim(p_label), ''), 'Browser'), 120),
            left(p_os, 60), left(p_browser, 60), left(p_version, 20), app.hash_secret(v_secret), v_pc.created_by)
    returning id into v_device;
  insert into public.device_enrollments (tenant_id, device_id, student_id, enrolled_by, method)
    values (v_pc.tenant_id, v_device, v_pc.student_id, v_pc.created_by, v_pc.method);
  update public.device_pairing_codes set used_at = now(), device_id = v_device where code = v_pc.code;

  select full_name into v_name from public.users where id = v_pc.student_id;
  select monitoring_notice into v_notice from public.tenant_settings where tenant_id = v_pc.tenant_id;
  perform app.audit('device.enrolled', 'device', v_device::text, jsonb_build_object('method', v_pc.method),
                    v_pc.tenant_id, v_pc.created_by);
  return jsonb_build_object('device_id', v_device, 'secret', v_secret, 'student_name', v_name, 'notice', v_notice);
end$$;

create or replace function app.device_auth(p_device uuid, p_secret text) returns public.devices
language plpgsql volatile security definer set search_path = '' as $$
declare v public.devices;
begin
  select * into v from public.devices where id = p_device;
  if v.id is null or v.secret_hash <> app.hash_secret(p_secret) then
    raise exception 'Invalid device credentials.' using errcode = '28000';
  end if;
  if v.status <> 'active' then
    raise exception 'This device has been %.', v.status using errcode = '28000';
  end if;
  return v;
end$$;

-- The live session a device belongs to right now (privacy gate, §36).
create or replace function app.device_live_session(p_student uuid) returns public.class_sessions
language sql stable security definer set search_path = '' as $$
  select s.* from public.class_sessions s
  join public.class_members m on m.class_id = s.class_id and m.user_id = p_student and m.role = 'student'
  where s.status = 'live'
  order by s.started_at desc nulls last limit 1
$$;

-- Open or refresh an environment event; notifies the teacher only when new.
create or replace function app.raise_event(
  p_bs public.browser_sessions, p_session public.class_sessions, p_policy uuid,
  p_kind text, p_severity text, p_rule text, p_url text, p_domain text, p_confidence numeric default null
) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare v_id uuid; v_name text; v_notify jsonb;
begin
  insert into public.environment_events (tenant_id, class_session_id, class_id, student_id, device_id, policy_id,
                                         kind, severity, rule, url, domain, confidence)
    values (p_bs.tenant_id, p_session.id, p_session.class_id, p_bs.student_id, p_bs.device_id, p_policy,
            p_kind, p_severity, p_rule, left(p_url, 2000), p_domain, p_confidence)
    on conflict (class_session_id, student_id, kind) where resolved_at is null do nothing
    returning id into v_id;
  if v_id is null then return false; end if;
  select full_name into v_name from public.users where id = p_bs.student_id;
  perform app.notify(p_session.teacher_id, p_kind,
    v_name || case p_kind when 'environment_left' then ' left the class environment'
                          when 'domain_blocked' then ' opened a blocked site'
                          when 'off_task' then ' may be off-task'
                          when 'idle' then ' has been idle'
                          when 'connection_lost' then '''s device lost connection'
                          else ' triggered ' || p_kind end,
    p_rule, '/teacher/live/' || p_session.id, p_severity,
    jsonb_build_object('event_id', v_id, 'session_id', p_session.id, 'student_id', p_bs.student_id));
  return true;
end$$;

create or replace function app.resolve_events(p_session uuid, p_student uuid, p_kinds text[]) returns int
language plpgsql volatile security definer set search_path = '' as $$
declare v_n int;
begin
  update public.environment_events set resolved_at = now()
   where class_session_id = p_session and student_id = p_student and resolved_at is null and kind = any (p_kinds);
  get diagnostics v_n = row_count;
  return v_n;
end$$;

-- ---------------------------------------------------------------------------
-- The agent's single "tick": heartbeat + telemetry + evaluation + directives.
-- ---------------------------------------------------------------------------
create or replace function app.device_tick(
  p_device public.devices, p_kind text, p_url text, p_title text, p_tab_count int,
  p_idle_state text, p_version text, p_app_host text
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_session  public.class_sessions;
  v_settings public.tenant_settings;
  v_bs       public.browser_sessions;
  v_policy   public.environment_policies;
  v_eval     jsonb;
  v_verdict  text;
  v_grace    int;
  v_idle_s   int;
  v_host     text := app.url_host(p_url);
  v_idle     text := case when p_idle_state in ('active','idle','locked') then p_idle_state else 'active' end;
  v_prev_url text;
  v_prev_idle text;
  v_fb       public.off_task_feedback;
  v_conf     numeric;
  v_cmds     jsonb;
  v_notice   text;
  v_spot     boolean;
  v_returned int;
begin
  update public.devices set last_seen_at = now(), agent_version = coalesce(left(p_version, 20), agent_version)
   where id = p_device.id;
  select * into v_settings from public.tenant_settings where tenant_id = p_device.tenant_id;

  if p_device.student_id is null then
    return jsonb_build_object('state', 'unassigned', 'poll_seconds', 120);
  end if;
  v_session := app.device_live_session(p_device.student_id);
  if v_session.id is null then
    -- Outside class: nothing is recorded.
    return jsonb_build_object('state', 'idle', 'poll_seconds', 60,
                              'notice_version', v_settings.monitoring_notice_version);
  end if;

  select * into v_bs from public.browser_sessions where device_id = p_device.id and class_session_id = v_session.id for update;
  if v_bs.id is null then
    insert into public.browser_sessions (tenant_id, device_id, class_session_id, student_id)
      values (p_device.tenant_id, p_device.id, v_session.id, p_device.student_id) returning * into v_bs;
  end if;
  v_prev_url := v_bs.active_url;
  v_prev_idle := v_bs.idle_state;

  -- Reconnected after a connection loss (§17 "Student returned").
  if v_bs.connection_lost_at is not null then
    perform app.resolve_events(v_session.id, p_device.student_id, array['connection_lost']);
  end if;

  update public.browser_sessions set
    last_heartbeat_at = now(), ended_at = null, connection_lost_at = null,
    active_url = coalesce(left(p_url, 2000), active_url), active_domain = coalesce(v_host, case when p_url is not null then null else active_domain end),
    active_title = coalesce(left(p_title, 300), active_title),
    tab_count = coalesce(p_tab_count, tab_count), idle_state = v_idle,
    idle_since = case when v_idle = 'active' then null else coalesce(idle_since, now()) end
  where id = v_bs.id returning * into v_bs;

  if p_url is not null and p_url is distinct from v_prev_url then
    insert into public.browser_events (tenant_id, device_id, class_session_id, student_id, kind, url, domain, title)
      values (p_device.tenant_id, p_device.id, v_session.id, p_device.student_id,
              case when p_kind = 'navigation' then 'navigation' else 'tab_changed' end,
              left(p_url, 2000), v_host, left(p_title, 300));
  end if;
  if v_idle is distinct from v_prev_idle then
    insert into public.browser_events (tenant_id, device_id, class_session_id, student_id, kind)
      values (p_device.tenant_id, p_device.id, v_session.id, p_device.student_id, v_idle);
  end if;

  v_policy := app.effective_policy(v_session, p_device.student_id);
  v_eval := app.evaluate_url(v_policy, v_bs.active_url, v_bs.tab_count, p_app_host);
  v_verdict := v_eval ->> 'verdict';
  v_grace := coalesce(v_policy.grace_seconds, v_settings.default_grace_seconds);
  v_idle_s := coalesce(v_policy.idle_seconds, v_settings.default_idle_seconds);

  -- Violations must persist for the grace period before an event fires.
  if v_verdict = 'violation' then
    if v_bs.violation_since is null or v_bs.violation_kind is distinct from v_eval ->> 'kind'
       or v_bs.violation_url is distinct from v_eval ->> 'domain' then
      update public.browser_sessions set violation_since = now(), violation_kind = v_eval ->> 'kind',
             violation_rule = v_eval ->> 'rule', violation_url = v_eval ->> 'domain'
       where id = v_bs.id returning * into v_bs;
    end if;
    if now() - v_bs.violation_since >= make_interval(secs => v_grace) then
      perform app.raise_event(v_bs, v_session, v_policy.id, v_eval ->> 'kind', v_eval ->> 'severity',
                              v_eval ->> 'rule', v_bs.active_url, v_eval ->> 'domain');
    end if;
    v_notice := 'Your class session requires you to return to the lesson.';
  else
    if v_bs.violation_since is not null then
      update public.browser_sessions set violation_since = null, violation_kind = null, violation_rule = null, violation_url = null
       where id = v_bs.id;
    end if;
    v_returned := app.resolve_events(v_session.id, p_device.student_id, array['environment_left','domain_blocked']);
    if v_returned > 0 then
      perform app.notify(v_session.teacher_id, 'student_returned',
        (select full_name from public.users where id = p_device.student_id) || ' returned to the class environment',
        null, '/teacher/live/' || v_session.id, 'info', jsonb_build_object('student_id', p_device.student_id));
    end if;
    if v_verdict = 'warning' then
      v_notice := 'Please stay on your class resources.';
    end if;
  end if;

  -- Off-task: assistive, confidence-scored, suppressed by teacher feedback/mutes.
  if v_verdict = 'off_task' then
    if not exists (select 1 from public.off_task_mutes m where m.class_session_id = v_session.id
                   and (m.student_id is null or m.student_id = p_device.student_id)
                   and app.domain_matches(v_eval ->> 'domain', m.domain)) then
      select * into v_fb from public.off_task_feedback where tenant_id = p_device.tenant_id and domain = v_eval ->> 'domain';
      v_conf := least(0.95, greatest(0.05, 0.7 - 0.1 * coalesce(v_fb.dismissals, 0) + 0.05 * coalesce(v_fb.confirmations, 0)));
      if v_conf >= 0.4 and now() - coalesce(v_bs.violation_since, now()) >= interval '0 seconds' then
        perform app.raise_event(v_bs, v_session, v_policy.id, 'off_task', 'info', v_eval ->> 'rule',
                                v_bs.active_url, v_eval ->> 'domain', round(v_conf, 3));
      end if;
    end if;
  else
    perform app.resolve_events(v_session.id, p_device.student_id, array['off_task']);
  end if;

  -- Idle beyond the teacher's threshold.
  if v_bs.idle_since is not null and now() - v_bs.idle_since >= make_interval(secs => v_idle_s) then
    perform app.raise_event(v_bs, v_session, v_policy.id, 'idle', 'info',
                            'Idle for more than ' || (v_idle_s / 60) || ' min', null, null);
  elsif v_bs.idle_since is null then
    perform app.resolve_events(v_session.id, p_device.student_id, array['idle']);
  end if;

  -- Deliver queued commands (expired ones are marked, never executed late).
  update public.teacher_commands set status = 'expired'
   where device_id = p_device.id and status in ('queued','delivered') and expires_at < now();
  with next as (
    select id from public.teacher_commands
     where device_id = p_device.id and status = 'queued' order by created_at limit 10 for update skip locked)
  update public.teacher_commands c set status = 'delivered', delivered_at = now()
    from next where c.id = next.id;
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'kind', c.kind, 'payload', c.payload) order by c.created_at), '[]'::jsonb)
    into v_cmds
  from public.teacher_commands c where c.device_id = p_device.id and c.status = 'delivered' and c.delivered_at > now() - interval '5 seconds';

  v_spot := exists (select 1 from public.spotlights s where s.session_id = v_session.id
                    and s.student_id = p_device.student_id and s.ended_at is null);

  return jsonb_build_object(
    'state', 'active',
    'session', jsonb_build_object('id', v_session.id, 'title', v_session.title,
                                  'teacher', (select full_name from public.users where id = v_session.teacher_id)),
    'poll_seconds', 10,
    'verdict', v_verdict,
    'rule', v_eval ->> 'rule',
    'notice', v_notice,
    'policy', case when v_policy.id is null then null else jsonb_build_object(
      'focus_mode', v_policy.focus_mode, 'lock_screen', v_policy.lock_screen,
      'allowed_domains', v_policy.allowed_domains, 'blocked_domains', v_policy.blocked_domains,
      'required_urls', v_policy.required_urls, 'lesson_url', v_policy.lesson_url, 'tab_limit', v_policy.tab_limit) end,
    'capture', jsonb_build_object(
      'enabled', v_settings.allow_screen_capture,
      'interval_seconds', v_settings.thumbnail_interval_seconds,
      'high_quality', v_spot or (v_bs.snapshot_requested_at is not null and v_bs.snapshot_requested_at > now() - interval '30 seconds')),
    'spotlight', v_spot,
    'focus_locked', v_bs.focus_locked,
    'commands', v_cmds,
    'notice_version', v_settings.monitoring_notice_version);
end$$;

create or replace function public.device_heartbeat(
  p_device uuid, p_secret text, p_url text default null, p_title text default null, p_tab_count int default null,
  p_idle_state text default 'active', p_version text default null, p_app_host text default null
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
begin
  return app.device_tick(app.device_auth(p_device, p_secret), 'heartbeat', p_url, p_title, p_tab_count,
                         p_idle_state, p_version, p_app_host);
end$$;

create or replace function public.device_event(
  p_device uuid, p_secret text, p_kind text, p_url text default null, p_title text default null,
  p_tab_count int default null, p_idle_state text default 'active', p_app_host text default null
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
begin
  if p_kind not in ('tab_changed','navigation','idle','active','locked','tab_count') then
    raise exception 'Unknown event kind.' using errcode = '22023';
  end if;
  return app.device_tick(app.device_auth(p_device, p_secret), p_kind, p_url, p_title, p_tab_count,
                         p_idle_state, null, p_app_host);
end$$;

create or replace function public.device_snapshot(
  p_device uuid, p_secret text, p_image text, p_width int default null, p_height int default null,
  p_quality text default 'thumbnail', p_url text default null
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_dev      public.devices := app.device_auth(p_device, p_secret);
  v_session  public.class_sessions;
  v_settings public.tenant_settings;
  v_last     timestamptz;
  v_min_gap  interval;
begin
  if p_quality not in ('thumbnail','spotlight') then raise exception 'Unknown quality.' using errcode = '22023'; end if;
  if p_image is null or p_image not like 'data:image/%' or length(p_image) > 400000 then
    raise exception 'Snapshot must be a data:image URL under 400 KB.' using errcode = '22023';
  end if;
  select * into v_settings from public.tenant_settings where tenant_id = v_dev.tenant_id;
  if not v_settings.allow_screen_capture then
    return jsonb_build_object('stored', false, 'reason', 'screen capture disabled by school');
  end if;
  v_session := app.device_live_session(v_dev.student_id);
  if v_session.id is null then return jsonb_build_object('stored', false, 'reason', 'no live session'); end if;

  -- Rate limit (§15): thumbnails at most every half interval; spotlight frames every 2 s.
  v_min_gap := case when p_quality = 'thumbnail'
                    then make_interval(secs => greatest(v_settings.thumbnail_interval_seconds / 2, 2))
                    else interval '2 seconds' end;
  select captured_at into v_last from public.screen_snapshots
   where device_id = v_dev.id and class_session_id = v_session.id and quality = p_quality;
  if v_last is not null and now() - v_last < v_min_gap then
    return jsonb_build_object('stored', false, 'reason', 'rate limited');
  end if;

  insert into public.screen_snapshots (tenant_id, device_id, class_session_id, student_id, image_data, width, height, quality, url)
    values (v_dev.tenant_id, v_dev.id, v_session.id, v_dev.student_id, p_image, p_width, p_height, p_quality, left(p_url, 2000))
    on conflict (device_id, class_session_id, quality) where quality <> 'event'
    do update set image_data = excluded.image_data, width = excluded.width, height = excluded.height,
                  url = excluded.url, captured_at = now();

  -- Event screenshots only when the school explicitly enabled them (§15).
  if v_settings.store_event_screenshots and exists (
       select 1 from public.environment_events e where e.class_session_id = v_session.id and e.student_id = v_dev.student_id
       and e.resolved_at is null and e.kind in ('environment_left','domain_blocked') and e.created_at > now() - interval '60 seconds')
     and not exists (select 1 from public.screen_snapshots s where s.device_id = v_dev.id and s.class_session_id = v_session.id
                     and s.quality = 'event' and s.captured_at > now() - interval '60 seconds') then
    insert into public.screen_snapshots (tenant_id, device_id, class_session_id, student_id, image_data, width, height, quality, url)
      values (v_dev.tenant_id, v_dev.id, v_session.id, v_dev.student_id, p_image, p_width, p_height, 'event', left(p_url, 2000));
  end if;

  if p_quality = 'spotlight' then
    update public.browser_sessions set snapshot_requested_at = null where device_id = v_dev.id and class_session_id = v_session.id;
  end if;
  return jsonb_build_object('stored', true);
end$$;

create or replace function public.device_command_ack(
  p_device uuid, p_secret text, p_command uuid, p_ok boolean, p_error text default null
) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_dev public.devices := app.device_auth(p_device, p_secret); v_cmd public.teacher_commands;
begin
  update public.teacher_commands set status = case when p_ok then 'acked' else 'failed' end,
         acked_at = now(), error = case when p_ok then null else left(coalesce(p_error, 'failed'), 300) end
   where id = p_command and device_id = v_dev.id and status in ('queued','delivered')
   returning * into v_cmd;
  if v_cmd.id is not null and p_ok and v_cmd.kind in ('focus','lock','unfocus','unlock') then
    update public.browser_sessions set focus_locked = v_cmd.kind in ('focus','lock')
     where device_id = v_dev.id and class_session_id = v_cmd.class_session_id;
  end if;
end$$;

-- Agent-side status check (popup): who is this device for, is it enabled.
create or replace function public.device_status(p_device uuid, p_secret text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_dev public.devices := app.device_auth(p_device, p_secret);
begin
  return jsonb_build_object(
    'device_id', v_dev.id, 'label', v_dev.label, 'status', v_dev.status,
    'student_name', (select full_name from public.users where id = v_dev.student_id),
    'school', (select name from public.tenants where id = v_dev.tenant_id),
    'notice', (select monitoring_notice from public.tenant_settings where tenant_id = v_dev.tenant_id),
    'session', (select jsonb_build_object('id', s.id, 'title', s.title) from app.device_live_session(v_dev.student_id) s where s.id is not null));
end$$;

-- ---------------------------------------------------------------------------
-- IT administration (§3.5, §19, §21 remote disable/unenrol)
-- ---------------------------------------------------------------------------
create or replace function public.device_set_status(p_device uuid, p_status text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_me public.users := app.me();
begin
  if not app.is_it() then raise exception 'IT administrators only.' using errcode = '42501'; end if;
  if p_status not in ('active','disabled','unenrolled') then raise exception 'Unknown status.' using errcode = '22023'; end if;
  update public.devices set status = p_status where id = p_device and tenant_id = v_me.tenant_id;
  if not found then raise exception 'Device not found.' using errcode = 'P0002'; end if;
  if p_status = 'unenrolled' then
    update public.device_enrollments set revoked_at = now(), revoked_by = v_me.id
     where device_id = p_device and revoked_at is null;
  end if;
  perform app.audit('device.' || p_status, 'device', p_device::text);
end$$;

create or replace function public.device_assign(p_device uuid, p_student uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_me public.users := app.me();
begin
  if not app.is_it() then raise exception 'IT administrators only.' using errcode = '42501'; end if;
  if not exists (select 1 from public.users where id = p_student and tenant_id = v_me.tenant_id and role = 'student') then
    raise exception 'Student not found.' using errcode = 'P0002';
  end if;
  update public.devices set student_id = p_student where id = p_device and tenant_id = v_me.tenant_id;
  if not found then raise exception 'Device not found.' using errcode = 'P0002'; end if;
  update public.device_enrollments set revoked_at = now(), revoked_by = v_me.id where device_id = p_device and revoked_at is null;
  insert into public.device_enrollments (tenant_id, device_id, student_id, enrolled_by, method)
    values (v_me.tenant_id, p_device, p_student, v_me.id, 'admin_pairing');
  perform app.audit('device.assigned', 'device', p_device::text, jsonb_build_object('student_id', p_student));
end$$;

-- Connection diagnostics (§3.5).
create or replace function public.device_diagnostics(p_device uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v public.devices;
begin
  select * into v from public.devices where id = p_device and tenant_id = app.tenant_id();
  if v.id is null or not (app.is_it() or app.teaches_student(v.student_id)) then
    raise exception 'Device not found.' using errcode = 'P0002';
  end if;
  return jsonb_build_object(
    'device', jsonb_build_object('id', v.id, 'label', v.label, 'os', v.os, 'browser', v.browser,
                                 'agent_version', v.agent_version, 'status', v.status, 'last_seen_at', v.last_seen_at),
    'online', v.last_seen_at > now() - interval '45 seconds',
    'seconds_since_seen', case when v.last_seen_at is null then null else extract(epoch from now() - v.last_seen_at)::int end,
    'student_in_live_session', (app.device_live_session(v.student_id)).id is not null,
    'recent_commands', (select coalesce(jsonb_agg(jsonb_build_object('kind', c.kind, 'status', c.status, 'error', c.error,
                           'created_at', c.created_at, 'acked_at', c.acked_at) order by c.created_at desc), '[]'::jsonb)
                        from (select * from public.teacher_commands where device_id = v.id order by created_at desc limit 10) c),
    'enrollments', (select coalesce(jsonb_agg(jsonb_build_object('student', u.full_name, 'method', e.method,
                       'created_at', e.created_at, 'revoked_at', e.revoked_at) order by e.created_at desc), '[]'::jsonb)
                    from public.device_enrollments e left join public.users u on u.id = e.student_id where e.device_id = v.id));
end$$;

-- ---------------------------------------------------------------------------
-- Teacher controls
-- ---------------------------------------------------------------------------
create or replace function app.require_live_session(p_session uuid) returns public.class_sessions
language plpgsql stable security definer set search_path = '' as $$
declare v public.class_sessions;
begin
  select * into v from public.class_sessions where id = p_session;
  if v.id is null then raise exception 'Session not found.' using errcode = 'P0002'; end if;
  if not app.can_manage_class(v.class_id) then raise exception 'Not your session.' using errcode = '42501'; end if;
  if v.status <> 'live' then raise exception 'The session is not live.' using errcode = 'P0001'; end if;
  return v;
end$$;

create or replace function public.issue_command(
  p_session uuid, p_students uuid[], p_kind text, p_payload jsonb default '{}'::jsonb
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_s       public.class_sessions := app.require_live_session(p_session);
  v_url     text := p_payload ->> 'url';
  v_student uuid;
  v_queued  int := 0;
  v_results jsonb := '[]'::jsonb;
  v_devices int;
begin
  if p_kind not in ('open_tab','close_tab','redirect','focus','unfocus','lock','unlock','close_other_tabs','message','screenshot') then
    raise exception 'Unknown command.' using errcode = '22023';
  end if;
  if p_kind in ('open_tab','redirect','focus') and v_url is not null and app.url_host(v_url) is null then
    raise exception 'Commands can only open http(s) links.' using errcode = '22023';
  end if;
  if p_kind in ('open_tab','redirect') and v_url is null then
    raise exception 'A URL is required.' using errcode = '22023';
  end if;
  if p_kind = 'message' and length(btrim(coalesce(p_payload ->> 'text', ''))) not between 1 and 200 then
    raise exception 'Messages are 1-200 characters.' using errcode = '22023';
  end if;
  if coalesce(array_length(p_students, 1), 0) = 0 or array_length(p_students, 1) > 200 then
    raise exception 'Choose between 1 and 200 students.' using errcode = '22023';
  end if;
  if (select count(*) from public.teacher_commands where issued_by = auth.uid() and created_at > now() - interval '1 minute') > 300 then
    raise exception 'Too many commands; slow down.' using errcode = 'P0001';
  end if;

  foreach v_student in array p_students loop
    if not exists (select 1 from public.class_members m where m.class_id = v_s.class_id and m.user_id = v_student and m.role = 'student') then
      v_results := v_results || jsonb_build_object('student_id', v_student, 'result', 'not_in_class');
      continue;
    end if;
    insert into public.teacher_commands (tenant_id, class_session_id, student_id, device_id, issued_by, kind, payload)
      select v_s.tenant_id, p_session, v_student, d.id, auth.uid(), p_kind, coalesce(p_payload, '{}'::jsonb)
      from public.devices d where d.student_id = v_student and d.status = 'active'
        and d.last_seen_at > now() - interval '10 minutes';
    get diagnostics v_devices = row_count;
    v_queued := v_queued + v_devices;
    v_results := v_results || jsonb_build_object('student_id', v_student,
                                                 'result', case when v_devices > 0 then 'queued' else 'no_device' end);
  end loop;

  perform app.audit('command.' || p_kind, 'class_session', p_session::text,
                    jsonb_build_object('students', p_students, 'payload', p_payload, 'queued', v_queued));
  return jsonb_build_object('queued', v_queued, 'results', v_results);
end$$;

create or replace function public.retry_command(p_command uuid) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare v public.teacher_commands; v_new uuid;
begin
  select * into v from public.teacher_commands where id = p_command;
  if v.id is null then raise exception 'Command not found.' using errcode = 'P0002'; end if;
  perform app.require_live_session(v.class_session_id);
  if v.status not in ('failed','expired') then raise exception 'Only failed or expired commands can be retried.' using errcode = 'P0001'; end if;
  insert into public.teacher_commands (tenant_id, class_session_id, student_id, device_id, issued_by, kind, payload)
    values (v.tenant_id, v.class_session_id, v.student_id, v.device_id, auth.uid(), v.kind, v.payload)
    returning id into v_new;
  perform app.audit('command.retry', 'teacher_command', p_command::text);
  return v_new;
end$$;

create or replace function public.start_environment(p_session uuid, p_policy uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_s public.class_sessions := app.require_live_session(p_session);
begin
  if not exists (select 1 from public.environment_policies where id = p_policy and tenant_id = v_s.tenant_id) then
    raise exception 'Environment not found.' using errcode = 'P0002';
  end if;
  update public.class_sessions set environment_id = p_policy, environment_active = true where id = p_session;
  update public.browser_sessions set violation_since = null, violation_kind = null, violation_rule = null, violation_url = null
   where class_session_id = p_session;
  perform app.audit('environment.started', 'class_session', p_session::text, jsonb_build_object('policy_id', p_policy));
end$$;

create or replace function public.stop_environment(p_session uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_s public.class_sessions := app.require_live_session(p_session);
begin
  update public.class_sessions set environment_active = false where id = p_session;
  update public.environment_events set resolved_at = now()
   where class_session_id = p_session and resolved_at is null and kind in ('environment_left','domain_blocked','off_task','tab_limit');
  update public.browser_sessions set violation_since = null, violation_kind = null, violation_rule = null, violation_url = null
   where class_session_id = p_session;
  perform app.audit('environment.stopped', 'class_session', p_session::text);
end$$;

-- Scenes: switch the session's policy and run the scene's actions.
create or replace function public.apply_scene(p_session uuid, p_scene uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_s      public.class_sessions := app.require_live_session(p_session);
  v_scene  public.scenes;
  v_all    uuid[];
  r        record;
  v_sent   int := 0;
begin
  select * into v_scene from public.scenes where id = p_scene and tenant_id = v_s.tenant_id;
  if v_scene.id is null then raise exception 'Scene not found.' using errcode = 'P0002'; end if;
  perform public.start_environment(p_session, v_scene.policy_id);
  select array_agg(user_id) into v_all from public.class_members where class_id = v_s.class_id and role = 'student';
  if v_all is not null then
    for r in select * from public.scene_rules where scene_id = p_scene order by position loop
      perform public.issue_command(p_session, v_all,
        case r.rule_type when 'open_tab' then 'open_tab' when 'focus' then 'focus' when 'lock' then 'lock'
                         when 'close_other_tabs' then 'close_other_tabs' else 'message' end,
        case r.rule_type when 'open_tab' then jsonb_build_object('url', r.value)
                         when 'focus' then jsonb_build_object('url', r.value)
                         when 'message' then jsonb_build_object('text', r.value) else '{}'::jsonb end);
      v_sent := v_sent + 1;
    end loop;
  end if;
  perform app.audit('scene.applied', 'class_session', p_session::text, jsonb_build_object('scene_id', p_scene));
  return jsonb_build_object('policy_id', v_scene.policy_id, 'actions', v_sent);
end$$;

-- Teacher acknowledges / dismisses / confirms / mutes an alert (§3.8, §16).
create or replace function public.handle_environment_event(p_event uuid, p_action text, p_scope text default 'student')
returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v public.environment_events;
begin
  select * into v from public.environment_events where id = p_event;
  if v.id is null then raise exception 'Alert not found.' using errcode = 'P0002'; end if;
  if not app.can_manage_session(v.class_session_id) then raise exception 'Not your session.' using errcode = '42501'; end if;
  if p_action not in ('acknowledge','dismiss','confirm','mute') then raise exception 'Unknown action.' using errcode = '22023'; end if;

  update public.environment_events set
    status = case p_action when 'acknowledge' then 'acknowledged' when 'confirm' then 'confirmed' else 'dismissed' end,
    handled_by = auth.uid(), handled_at = now(),
    resolved_at = case when p_action in ('dismiss','mute') then coalesce(resolved_at, now()) else resolved_at end
  where id = p_event;

  if v.kind = 'off_task' and v.domain is not null and p_action in ('dismiss','confirm','mute') then
    insert into public.off_task_feedback (tenant_id, domain, dismissals, confirmations)
      values (v.tenant_id, v.domain, case when p_action in ('dismiss','mute') then 1 else 0 end,
              case when p_action = 'confirm' then 1 else 0 end)
      on conflict (tenant_id, domain) do update set
        dismissals = public.off_task_feedback.dismissals + excluded.dismissals,
        confirmations = public.off_task_feedback.confirmations + excluded.confirmations, updated_at = now();
  end if;
  if p_action = 'mute' and v.domain is not null then
    insert into public.off_task_mutes (tenant_id, class_session_id, student_id, domain, muted_by)
      values (v.tenant_id, v.class_session_id, case when p_scope = 'session' then null else v.student_id end, v.domain, auth.uid());
  end if;
  perform app.audit('alert.' || p_action, 'environment_event', p_event::text, jsonb_build_object('kind', v.kind));
end$$;

create or replace function public.request_screenshot(p_session uuid, p_student uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_s public.class_sessions := app.require_live_session(p_session);
begin
  if not (select allow_screen_capture from public.tenant_settings where tenant_id = v_s.tenant_id) then
    raise exception 'Screen capture is disabled by your school.' using errcode = 'P0001';
  end if;
  update public.browser_sessions set snapshot_requested_at = now()
   where class_session_id = p_session and student_id = p_student
     and (snapshot_requested_at is null or snapshot_requested_at < now() - interval '3 seconds');
  perform app.audit('screen.requested', 'user', p_student::text, jsonb_build_object('session_id', p_session));
end$$;
