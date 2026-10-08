-- 0930: progress for students and parents (docs/LIVE_ENGINE.md, progress dashboards).
--
-- * Questions get a topic (e.g. "Fractions"), typed by the teacher. Results are
--   grouped by subject and topic; untagged questions count under the lesson title.
-- * School terms: the school admin enters the school year and each term's dates.
-- * progress_report(student, period, date): day, week, month, term or year.
--   Lessons held and attended, answers and accuracy (with the previous period),
--   a trend inside the period, each subject with its topics, strongest topics
--   and topics that need practice, and the lessons themselves.
--   Seen by the student, their linked parents (when the school has the parent
--   portal on), their teachers and the school's admins.
-- * Copying a lesson keeps each question's topic.

alter table public.questions add column if not exists topic text;
alter table public.questions drop constraint if exists questions_topic_check;
alter table public.questions add constraint questions_topic_check check (topic is null or length(btrim(topic)) between 1 and 60);

-- ---------------------------------------------------------------------------
-- School terms
-- ---------------------------------------------------------------------------
create table if not exists public.school_terms (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  school_year text not null check (length(btrim(school_year)) between 4 and 20),
  name        text not null check (length(btrim(name)) between 1 and 40),
  starts_on   date not null,
  ends_on     date not null,
  created_at  timestamptz not null default now(),
  check (ends_on >= starts_on and ends_on <= starts_on + 200),
  unique (tenant_id, starts_on)
);
create index if not exists school_terms_tenant_idx on public.school_terms(tenant_id, starts_on);
alter table public.school_terms enable row level security;
revoke all on public.school_terms from anon;
grant select, insert, update, delete on public.school_terms to authenticated;
drop policy if exists school_terms_read on public.school_terms;
create policy school_terms_read on public.school_terms for select to authenticated
  using (tenant_id = (select app.tenant_id()));
drop policy if exists school_terms_admin on public.school_terms;
create policy school_terms_admin on public.school_terms for all to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.is_admin()))
  with check (tenant_id = (select app.tenant_id()) and (select app.is_admin()));

create or replace function app.school_terms_no_overlap() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.school_terms t where t.tenant_id = new.tenant_id and t.id <> new.id
             and t.starts_on <= new.ends_on and new.starts_on <= t.ends_on) then
    raise exception 'Terms can''t overlap. Check the start and end dates.' using errcode = '23P01';
  end if;
  return new;
end$$;
drop trigger if exists school_terms_no_overlap on public.school_terms;
create trigger school_terms_no_overlap before insert or update on public.school_terms
  for each row execute function app.school_terms_no_overlap();

-- ---------------------------------------------------------------------------
-- Periods and the rows a report is built from
-- ---------------------------------------------------------------------------

/** [starts, ends) of the day, week, month, term or school year that contains p_date. */
create or replace function app.period_bounds(p_tenant uuid, p_period text, p_date date)
returns table (starts date, ends date, label text, term_id uuid)
language plpgsql stable security definer set search_path = '' as $$
declare v_t public.school_terms; v_mon date; v_y int;
begin
  if p_period = 'day' then
    return query select p_date, p_date + 1, to_char(p_date, 'FMDay FMDD FMMonth YYYY'), null::uuid;
  elsif p_period = 'week' then
    v_mon := p_date - (extract(isodow from p_date)::int - 1);
    return query select v_mon, v_mon + 7, 'Week of ' || to_char(v_mon, 'FMDD FMMonth YYYY'), null::uuid;
  elsif p_period = 'month' then
    return query select date_trunc('month', p_date)::date, (date_trunc('month', p_date) + interval '1 month')::date,
                        to_char(p_date, 'FMMonth YYYY'), null::uuid;
  elsif p_period in ('term', 'year') then
    -- The term in progress (or, in a holiday, the one just finished; before any, the first).
    select * into v_t from public.school_terms where tenant_id = p_tenant and starts_on <= p_date order by starts_on desc limit 1;
    if v_t.id is null then select * into v_t from public.school_terms where tenant_id = p_tenant order by starts_on limit 1; end if;
    if p_period = 'term' then
      if v_t.id is null then return; end if;
      return query select v_t.starts_on, v_t.ends_on + 1, v_t.name || ', ' || v_t.school_year, v_t.id;
    elsif v_t.id is not null then
      return query select min(t.starts_on), max(t.ends_on) + 1, 'School year ' || v_t.school_year, null::uuid
                     from public.school_terms t where t.tenant_id = p_tenant and t.school_year = v_t.school_year;
    else
      -- No terms entered: September to August.
      v_y := extract(year from p_date)::int - case when extract(month from p_date) >= 9 then 0 else 1 end;
      return query select make_date(v_y, 9, 1), make_date(v_y + 1, 9, 1), 'School year ' || v_y || '/' || (v_y + 1), null::uuid;
    end if;
  else
    raise exception 'Period is day, week, month, term or year.' using errcode = '22023';
  end if;
end$$;

/** Every answer the student gave in [p_from, p_to), with its subject and topic. */
create or replace function app.progress_answers(p_student uuid, p_from timestamptz, p_to timestamptz)
returns table (at timestamptz, session_id uuid, subject text, topic text, is_correct boolean)
language sql stable security definer set search_path = '' as $$
  select qa.answered_at, t.session_id,
         coalesce(nullif(btrim(l.subject), ''), nullif(btrim(c.subject), ''), c.name, 'Other lessons'),
         coalesce(nullif(btrim(q.topic), ''), l.title, a.title),
         qa.is_correct
    from public.quiz_attempts t
    join public.quiz_answers qa on qa.attempt_id = t.id
    join public.questions q on q.id = qa.question_id
    join public.activities a on a.id = t.activity_id
    left join public.lessons l on l.id = a.lesson_id
    left join public.class_sessions s on s.id = t.session_id
    left join public.classes c on c.id = s.class_id
   where t.student_id = p_student and qa.answered_at >= p_from and qa.answered_at < p_to
$$;

/** Live lessons in [p_from, p_to) for the student's classes, plus any they joined with a code. */
create or replace function app.progress_lessons(p_student uuid, p_from timestamptz, p_to timestamptz)
returns table (session_id uuid, title text, subject text, started_at timestamptz, attended boolean, points int)
language sql stable security definer set search_path = '' as $$
  select s.id, s.title,
         coalesce(nullif(btrim(l.subject), ''), nullif(btrim(c.subject), ''), c.name, 'Other lessons'),
         s.started_at, p.user_id is not null, coalesce(p.total_score, 0)
    from public.class_sessions s
    left join public.lessons l on l.id = s.lesson_id
    left join public.classes c on c.id = s.class_id
    left join public.session_participants p on p.session_id = s.id and p.user_id = p_student
   where s.tenant_id = (select u.tenant_id from public.users u where u.id = p_student)
     and s.started_at >= p_from and s.started_at < p_to
     and (p.user_id is not null
          or exists (select 1 from public.class_members m where m.class_id = s.class_id and m.user_id = p_student and m.role = 'student'))
$$;

create or replace function app.can_see_student(p_student uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() = p_student or app.is_parent_of(p_student) or app.teaches_student(p_student)
      or (app.is_admin() and exists (select 1 from public.users u where u.id = p_student and u.tenant_id = app.tenant_id()))
$$;

revoke execute on function app.period_bounds(uuid, text, date), app.progress_answers(uuid, timestamptz, timestamptz),
  app.progress_lessons(uuid, timestamptz, timestamptz) from public, anon, authenticated;
revoke execute on function app.can_see_student(uuid) from public, anon;

-- ---------------------------------------------------------------------------
-- The report
-- ---------------------------------------------------------------------------
create or replace function public.progress_report(p_student uuid, p_period text default 'week', p_date date default null)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_st    public.users;
  v_tz    text;
  v_today date;
  v_day   date;
  v_b     record;
  v_pb    record;
  v_ps    date;    -- previous period, null when there is none
  v_pe    date;
  v_from  timestamptz; v_to timestamptz; v_pfrom timestamptz; v_pto timestamptz;
  v_step  interval;
  v_unit  text;
  v_terms jsonb;
begin
  select * into v_st from public.users where id = p_student and role = 'student';
  if v_st.id is null or not app.can_see_student(p_student) then raise exception 'Report not found.' using errcode = 'P0002'; end if;
  if p_period not in ('day', 'week', 'month', 'term', 'year') then
    raise exception 'Period is day, week, month, term or year.' using errcode = '22023';
  end if;
  select coalesce(t.timezone, 'UTC') into v_tz from public.tenants t where t.id = v_st.tenant_id;
  v_today := (now() at time zone v_tz)::date;
  v_day := coalesce(p_date, v_today);
  select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'school_year', t.school_year,
                                               'starts_on', t.starts_on, 'ends_on', t.ends_on) order by t.starts_on), '[]'::jsonb)
    into v_terms from public.school_terms t where t.tenant_id = v_st.tenant_id;

  select * into v_b from app.period_bounds(v_st.tenant_id, p_period, v_day);
  if v_b.starts is null then
    return jsonb_build_object('student', jsonb_build_object('id', v_st.id, 'name', v_st.full_name), 'period', p_period,
                              'date', v_day, 'today', v_today, 'needs_terms', true, 'terms', v_terms);
  end if;
  select * into v_pb from app.period_bounds(v_st.tenant_id, p_period, v_b.starts - 1);
  if v_pb.starts is distinct from v_b.starts then v_ps := v_pb.starts; v_pe := v_pb.ends; end if;   -- else: no earlier term
  v_from := v_b.starts::timestamp at time zone v_tz;
  v_to := v_b.ends::timestamp at time zone v_tz;
  v_pfrom := v_ps::timestamp at time zone v_tz;
  v_pto := v_pe::timestamp at time zone v_tz;
  v_unit := case p_period when 'week' then 'day' when 'month' then 'week' when 'term' then 'week' when 'year' then 'month' end;
  v_step := case v_unit when 'day' then interval '1 day' when 'week' then interval '7 days' when 'month' then interval '1 month' end;

  return (
    with ans as (select * from app.progress_answers(p_student, v_from, v_to)),
    les as (select * from app.progress_lessons(p_student, v_from, v_to)),
    pans as (select * from app.progress_answers(p_student, v_pfrom, v_pto)),
    ples as (select * from app.progress_lessons(p_student, v_pfrom, v_pto)),
    topics as (
      select a.subject, a.topic, count(*) as answers, count(a.is_correct) as graded,
             round(100.0 * count(*) filter (where a.is_correct) / nullif(count(a.is_correct), 0)) as accuracy
        from ans a group by a.subject, a.topic),
    subjects as (select x.subject from ans x union select y.subject from les y)
    select jsonb_build_object(
      'student', jsonb_build_object('id', v_st.id, 'name', v_st.full_name),
      'period', p_period, 'date', v_day, 'today', v_today, 'timezone', v_tz, 'needs_terms', false, 'terms', v_terms,
      'from', v_b.starts, 'to', v_b.ends - 1, 'label', v_b.label, 'unit', v_unit,
      'prev_date', case when v_ps is not null then v_b.starts - 1 end,
      'next_date', case when v_b.ends <= v_today then v_b.ends end,
      'summary', jsonb_build_object(
        'held', (select count(*) from les), 'attended', (select count(*) from les where attended),
        'answers', (select count(*) from ans), 'correct', (select count(*) from ans where is_correct),
        'accuracy', (select round(100.0 * count(*) filter (where is_correct) / nullif(count(is_correct), 0)) from ans),
        'points', (select coalesce(sum(points), 0) from les where attended),
        'prev_held', case when v_ps is not null then (select count(*) from ples) end,
        'prev_attended', case when v_ps is not null then (select count(*) from ples where attended) end,
        'prev_answers', case when v_ps is not null then (select count(*) from pans) end,
        'prev_accuracy', (select round(100.0 * count(*) filter (where is_correct) / nullif(count(is_correct), 0)) from pans)),
      'trend', case when v_step is null then '[]'::jsonb else (
        select coalesce(jsonb_agg(jsonb_build_object(
                 'start', greatest(b::date, v_b.starts),
                 'answers', (select count(*) from ans a where (a.at at time zone v_tz) >= b and (a.at at time zone v_tz) < b + v_step),
                 'accuracy', (select round(100.0 * count(*) filter (where a.is_correct) / nullif(count(a.is_correct), 0)) from ans a
                              where (a.at at time zone v_tz) >= b and (a.at at time zone v_tz) < b + v_step),
                 'held', (select count(*) from les l where (l.started_at at time zone v_tz) >= b and (l.started_at at time zone v_tz) < b + v_step),
                 'attended', (select count(*) from les l where l.attended and (l.started_at at time zone v_tz) >= b and (l.started_at at time zone v_tz) < b + v_step))
               order by b), '[]'::jsonb)
          from generate_series(date_trunc(v_unit, v_b.starts::timestamp), (v_b.ends - 1)::timestamp, v_step) b) end,
      'subjects', (
        select coalesce(jsonb_agg(jsonb_build_object(
                 'subject', s.subject,
                 'held', (select count(*) from les l where l.subject = s.subject),
                 'attended', (select count(*) from les l where l.subject = s.subject and l.attended),
                 'answers', (select count(*) from ans a where a.subject = s.subject),
                 'accuracy', (select round(100.0 * count(*) filter (where a.is_correct) / nullif(count(a.is_correct), 0)) from ans a where a.subject = s.subject),
                 'prev_accuracy', (select round(100.0 * count(*) filter (where a.is_correct) / nullif(count(a.is_correct), 0)) from pans a where a.subject = s.subject),
                 'topics', (select coalesce(jsonb_agg(jsonb_build_object('topic', t.topic, 'answers', t.answers, 'accuracy', t.accuracy)
                                     order by t.accuracy asc nulls last, t.answers desc), '[]'::jsonb)
                              from topics t where t.subject = s.subject))
               order by (select count(*) from ans a where a.subject = s.subject) desc, s.subject), '[]'::jsonb)
          from subjects s),
      'strengths', (select coalesce(jsonb_agg(jsonb_build_object('subject', t.subject, 'topic', t.topic, 'answers', t.answers, 'accuracy', t.accuracy)
                                     order by t.accuracy desc, t.graded desc), '[]'::jsonb)
                      from (select * from topics where graded >= 3 and accuracy >= 80 order by accuracy desc, graded desc limit 5) t),
      'needs_help', (select coalesce(jsonb_agg(jsonb_build_object('subject', t.subject, 'topic', t.topic, 'answers', t.answers, 'accuracy', t.accuracy)
                                      order by t.accuracy asc, t.graded desc), '[]'::jsonb)
                       from (select * from topics where graded >= 3 and accuracy < 60 order by accuracy asc, graded desc limit 5) t),
      'lessons', (select coalesce(jsonb_agg(jsonb_build_object(
                   'session_id', l.session_id, 'title', l.title, 'subject', l.subject, 'started_at', l.started_at,
                   'attended', l.attended, 'points', l.points,
                   'answers', (select count(*) from ans a where a.session_id = l.session_id),
                   'accuracy', (select round(100.0 * count(*) filter (where a.is_correct) / nullif(count(a.is_correct), 0)) from ans a where a.session_id = l.session_id))
                 order by l.started_at desc), '[]'::jsonb)
                    from (select * from les order by started_at desc limit 60) l))
  );
end$$;

revoke execute on function public.progress_report(uuid, text, date) from public, anon;
grant execute on function public.progress_report(uuid, text, date) to authenticated;

-- Copying a lesson keeps each question's topic (otherwise unchanged).
create or replace function public.duplicate_lesson(p_lesson uuid, p_title text default null, p_as_template boolean default false)
returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me     public.users := app.me();
  v_src    public.lessons;
  v_new    uuid;
  v_map_a  jsonb := '{}'::jsonb;   -- old activity id -> new
  v_map_q  jsonb := '{}'::jsonb;   -- old question id -> new
  v_map_s  jsonb := '{}'::jsonb;   -- old slide id -> new
  r        record;
  v_id     uuid;
begin
  if not app.is_teacher() or not app.can_view_lesson(p_lesson) then
    raise exception 'You cannot copy this lesson.' using errcode = '42501';
  end if;
  select * into v_src from public.lessons where id = p_lesson;
  insert into public.lessons (tenant_id, owner_id, title, description, subject, grade_level, default_mode, is_template)
    values (v_me.tenant_id, v_me.id, coalesce(nullif(btrim(p_title), ''), left(v_src.title || ' (copy)', 200)),
            v_src.description, v_src.subject, v_src.grade_level, v_src.default_mode, p_as_template)
    returning id into v_new;

  for r in select * from public.activities where lesson_id = p_lesson loop
    insert into public.activities (tenant_id, lesson_id, owner_id, kind, title, instructions, settings)
      values (v_me.tenant_id, v_new, v_me.id, r.kind, r.title, r.instructions, r.settings) returning id into v_id;
    v_map_a := v_map_a || jsonb_build_object(r.id::text, v_id);
  end loop;

  for r in select q.* from public.questions q join public.activities a on a.id = q.activity_id where a.lesson_id = p_lesson loop
    insert into public.questions (tenant_id, activity_id, owner_id, kind, prompt, media, config, answer_key,
                                  explanation, points, position, tags, difficulty, topic)
      values (v_me.tenant_id, (v_map_a ->> r.activity_id::text)::uuid, v_me.id, r.kind, r.prompt, r.media, r.config,
              r.answer_key, r.explanation, r.points, r.position, r.tags, r.difficulty, r.topic)
      returning id into v_id;
    v_map_q := v_map_q || jsonb_build_object(r.id::text, v_id);
    insert into public.question_options (tenant_id, question_id, label, is_correct, feedback, position)
      select v_me.tenant_id, v_id, o.label, o.is_correct, o.feedback, o.position
      from public.question_options o where o.question_id = r.id;
  end loop;

  for r in select * from public.lesson_slides where lesson_id = p_lesson order by position loop
    insert into public.lesson_slides (tenant_id, lesson_id, position, kind, content, notes, activity_id)
      values (v_me.tenant_id, v_new, r.position, r.kind, r.content, r.notes, (v_map_a ->> r.activity_id::text)::uuid)
      returning id into v_id;
    v_map_s := v_map_s || jsonb_build_object(r.id::text, v_id);
  end loop;

  insert into public.video_checkpoints (tenant_id, slide_id, question_id, t_seconds, required)
    select v_me.tenant_id, (v_map_s ->> vc.slide_id::text)::uuid, (v_map_q ->> vc.question_id::text)::uuid,
           vc.t_seconds, vc.required
    from public.video_checkpoints vc join public.lesson_slides s on s.id = vc.slide_id
    where s.lesson_id = p_lesson and v_map_q ? vc.question_id::text;

  perform app.audit('lesson.duplicated', 'lesson', v_new::text, jsonb_build_object('source', p_lesson));
  return v_new;
end$$;

create or replace function public.health() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('ok', true, 'db_time', now(), 'schema', '0930')
$$;
