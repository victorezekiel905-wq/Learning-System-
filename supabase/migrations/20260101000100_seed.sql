-- Demo seed (run AFTER init). Requires service-role key normally.
-- Pass an auth.users.id for the teacher.

do $$
declare
  v_tenant uuid;
  v_teacher uuid;
  v_class uuid;
  v_lesson uuid;
  v_activity uuid;
  v_session uuid;
begin
  insert into public.tenants (name, slug) values ('Lincoln High', 'lincoln-high')
    on conflict (slug) do nothing returning id into v_tenant;
  if v_tenant is null then select id into v_tenant from public.tenants where slug='lincoln-high'; end if;

  -- Use first auth.users row as the demo teacher if any exist; else skip.
  select id into v_teacher from auth.users limit 1;
  if v_teacher is not null then
    insert into public.users (id, tenant_id, email, full_name, role)
    values (v_teacher, v_tenant, (select email from auth.users where id=v_teacher), 'Demo Teacher', 'teacher')
    on conflict (id) do nothing;

    insert into public.classes (tenant_id, name, join_code, teacher_id)
    values (v_tenant, 'Period 3 Algebra', 'JOIN3', v_teacher)
    on conflict do nothing returning id into v_class;
    if v_class is null then select id into v_class from public.classes where join_code='JOIN3'; end if;

    insert into public.lessons (tenant_id, owner_id, title, status, mode)
    values (v_tenant, v_teacher, 'Solving Linear Equations', 'published', 'live_participation')
    returning id into v_lesson;

    insert into public.lesson_slides (lesson_id, idx, kind, payload)
    values
      (v_lesson, 0, 'title', '{"heading":"Linear Equations","subheading":"Day 1"}'::jsonb),
      (v_lesson, 1, 'text', '{"markdown":"Warm up: what does x + 5 = 12 mean?"}'::jsonb),
      (v_lesson, 2, 'image', '{"url":"","alt":"equation diagram","caption":""}'::jsonb);

    insert into public.activities (lesson_id, kind, title, config)
    values (v_lesson, 'multiple_choice', 'MCQ — solving for x',
            '{"shuffle":true,"time_limit_seconds":30}'::jsonb)
    returning id into v_activity;

    insert into public.questions (activity_id, prompt, options, answer_key, points)
    values (v_activity, 'Solve: 2x + 4 = 12',
            '["3","4","5","6"]'::jsonb,
            '{"correct":"4"}'::jsonb, 10);

    insert into public.environment_policies (tenant_id, name, allowlist, blocklist, mode)
    values (v_tenant, 'Focus Mode', ARRAY['classroom.google.com','wikipedia.org'],
            ARRAY['youtube.com','tiktok.com','instagram.com','facebook.com'], 'focus');

    insert into public.class_sessions (class_id, lesson_id, mode, join_code, state)
    values (v_class, v_lesson, 'live_participation', 'LIVE1', 'live')
    returning id into v_session;

    raise notice 'Seed complete. Tenant: %, Teacher: %, Class: %, Lesson: %, Session: %',
      v_tenant, v_teacher, v_class, v_lesson, v_session;
  end if;
end$$;
