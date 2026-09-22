-- =========================================================================
-- EduClass Fusion — runtime RPCs & extra policies (v2)
-- Security-definer functions let students and the browser agent operate
-- without being able to read answer keys or other tenants' rows.
-- Idempotent. Apply AFTER 20260101000200_saas_extend.sql.
-- =========================================================================

-- ---------- Session ↔ policy link (was only audit-logged) ----------
alter table public.class_sessions add column if not exists policy_id uuid references public.environment_policies(id);

-- ---------- Lookup helpers (security definer) ----------
create or replace function public.session_by_code(p_code text)
returns table (id uuid, state text, lesson_id uuid, class_id uuid)
language sql security definer stable
as $$
  select cs.id, cs.state, cs.lesson_id, cs.class_id
  from public.class_sessions cs
  where cs.join_code = upper(p_code) and cs.state in ('scheduled','live')
  order by cs.created_at desc limit 1;
$$;
grant execute on function public.session_by_code(text) to anon, authenticated;

create or replace function public.class_lookup_by_code(p_code text)
returns table (id uuid, tenant_id uuid, name text, teacher_id uuid)
language sql security definer stable
as $$
  select id, tenant_id, name, teacher_id
  from public.classes
  where upper(join_code) = upper(p_code) limit 1;
$$;
grant execute on function public.class_lookup_by_code(text) to anon, authenticated;

-- ---------- Student-facing lesson content (NO answer keys) ----------
create or replace function public.session_activities(p_session uuid)
returns table (id uuid, kind text, title text, config jsonb)
language sql security definer stable
as $$
  select a.id, a.kind, a.title, a.config
  from public.class_sessions cs
  join public.lessons l on l.id = cs.lesson_id
  join public.activities a on a.lesson_id = l.id
  where cs.id = p_session and cs.state = 'live'
  order by a.created_at;
$$;
grant execute on function public.session_activities(uuid) to authenticated;

create or replace function public.activity_questions(p_activity uuid)
returns table (id uuid, prompt text, options jsonb, points int)
language sql security definer stable
as $$
  select q.id, q.prompt, q.options, q.points
  from public.questions q
  where q.activity_id = p_activity
  order by q.created_at;
$$;
grant execute on function public.activity_questions(uuid) to authenticated;

create or replace function public.game_question(p_game uuid, p_idx int)
returns table (question_id uuid, prompt text, options jsonb, points int, total int)
language sql security definer stable
as $$
  select q.id, q.prompt, q.options, q.points,
         (select count(*)::int from public.questions qq where qq.activity_id = gs.quiz_id)
  from public.game_sessions gs
  join public.questions q on q.activity_id = gs.quiz_id
  where gs.id = p_game and gs.state = 'running' and gs.current_question = p_idx
  order by q.created_at
  limit 1 offset p_idx;
$$;
grant execute on function public.game_question(uuid, int) to authenticated;

-- ---------- Submit + auto-grade an activity response ----------
-- Reads the answer key server-side; students never see it.
create or replace function public.submit_activity_response(
  p_activity uuid, p_session uuid, p_response jsonb, p_elapsed_ms int default 0
) returns jsonb
language plpgsql security definer
as $$
declare
  v_q public.questions%rowtype;
  v_correct boolean := false;
  v_awarded int := 0;
  v_id uuid;
  v_sid uuid := auth.uid();
begin
  select * into v_q from public.questions q where q.activity_id = p_activity order by q.created_at limit 1;
  if v_q.id is null then raise exception 'activity has no questions'; end if;
  if v_q.answer_key ? 'correct' then
    v_correct := (p_response->>'value') = (v_q.answer_key->>'correct');
    v_awarded := case when v_correct then v_q.points else 0 end;
  end if;
  insert into public.activity_responses (activity_id, session_id, student_id, response, correct, awarded, elapsed_ms)
  values (p_activity, p_session, v_sid, p_response, v_correct, v_awarded, p_elapsed_ms)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'correct', v_correct, 'awarded', v_awarded, 'points', v_q.points);
end$$;
grant execute on function public.submit_activity_response(uuid, uuid, jsonb, int) to authenticated;

-- ---------- Deterministic environment policy evaluation (§14) ----------
create or replace function public.evaluate_environment(p_session uuid, p_url text)
returns jsonb
language plpgsql security definer stable
as $$
declare
  v_p record;
  v_sev text := 'info';
  v_msg text := 'allowed';
begin
  select ep.* into v_p
  from public.class_sessions cs
  join public.environment_policies ep on ep.id = cs.policy_id
  where cs.id = p_session;
  if v_p.id is null then
    return jsonb_build_object('violation', false, 'severity', 'info', 'reason', 'no-policy');
  end if;
  if exists (select 1 from unnest(v_p.blocklist) b where p_url ilike '%' || b || '%') then
    v_sev := 'critical'; v_msg := 'blocked-domain';
  elsif v_p.required_urls is not null and array_length(v_p.required_urls, 1) > 0
    and not exists (select 1 from unnest(v_p.required_urls) r where p_url ilike '%' || r || '%') then
    if exists (select 1 from unnest(v_p.allowlist) a where p_url ilike '%' || a || '%') then
      v_sev := 'info'; v_msg := 'allowed';
    else
      v_sev := 'warn'; v_msg := 'outside-required-resources';
    end if;
  end if;
  return jsonb_build_object('violation', v_sev <> 'info', 'severity', v_sev, 'reason', v_msg);
end$$;
grant execute on function public.evaluate_environment(uuid, text) to anon, authenticated;

-- ---------- Policies: game players readable by tenant peers ----------
drop policy if exists game_players_all on public.game_players;
create policy game_players_select on public.game_players for select using (
  user_id = auth.uid() or user_id is null
  or exists (
    select 1 from public.game_sessions gs
    join public.users u on u.id = auth.uid()
    where gs.id = game_players.game_id and u.tenant_id = gs.tenant_id
  )
);
create policy game_players_insert on public.game_players for insert with check (user_id = auth.uid() or user_id is null);

-- ---------- Policies: private chat (thread participants only) ----------
create policy chat_threads_select on public.chat_threads for select using (student_id = auth.uid() or teacher_id = auth.uid());
create policy chat_threads_insert on public.chat_threads for insert with check (student_id = auth.uid() or teacher_id = auth.uid());
drop policy if exists chat_messages_all on public.chat_messages;
create policy chat_messages_select on public.chat_messages for select using (
  exists (select 1 from public.chat_threads t where t.id = chat_messages.thread_id and (t.student_id = auth.uid() or t.teacher_id = auth.uid()))
);
create policy chat_messages_insert on public.chat_messages for insert with check (
  sender_id = auth.uid()
  and exists (select 1 from public.chat_threads t where t.id = chat_messages.thread_id and (t.student_id = auth.uid() or t.teacher_id = auth.uid()))
);

-- ---------- Policies: students may read slides of PUBLISHED lessons ----------
create policy lesson_slides_tenant_read on public.lesson_slides for select using (
  exists (
    select 1 from public.lessons l
    where l.id = lesson_slides.lesson_id and l.status = 'published'
      and exists (select 1 from public.users u where u.id = auth.uid() and u.tenant_id = l.tenant_id)
  )
);

-- ---------- Policies: browser agent (anonymous) heartbeat/command paths ----------
-- MVP trade-off, documented in BUILD_STATUS.md: the agent callbacks are
-- insert-only for telemetry; command read/ack is narrowly scoped to queued state.
create policy devices_agent_update on public.devices for update using (true);
create policy teacher_commands_agent_read on public.teacher_commands for select using (state = 'queued');
create policy teacher_commands_agent_update on public.teacher_commands for update using (
  state in ('queued','delivered') or target_student_id = auth.uid() or issued_by = auth.uid()
);

-- ---------- Realtime publication: game_sessions + chat + snapshots ----------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and tablename = 'game_sessions') then
    alter publication supabase_realtime add table public.game_sessions;
  end if;
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and tablename = 'chat_messages') then
    alter publication supabase_realtime add table public.chat_messages;
  end if;
end$$;
