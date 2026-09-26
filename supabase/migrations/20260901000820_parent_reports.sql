-- =============================================================================
-- SwiftCipher — 0820 parent reports, parent alerts, parent–teacher messaging
--
-- What parents get (the school turns the parent portal on):
--   • A daily and a weekly report for each child, per subject: lessons
--     attended and time in class, participation ("interactiveness"), answers
--     and accuracy, explained reasoning, hands raised, XP and badges,
--     assignments (done / late / missing), released grades, and the trend over
--     the last six weeks.
--   • Focus: every time the child left the lesson — when, which lesson and
--     slide or activity they were on, where they went (the site and page title
--     on school-managed browsers; the reason on other devices), how long they
--     were away and whether they came back. Schools can limit parents to
--     counts only. Screenshots are never shown to parents: they can contain
--     other children's messages and names.
--   • Alerts they choose per child (Canvas Parent-style): the moment the child
--     leaves a lesson, a grade below their own threshold, and a weekly summary
--     every Friday afternoon (school time zone). Every guardian linked to the
--     child gets their own settings (unlike tools with one parent per child).
--   • Private messages with each subject teacher about their child (the child
--     cannot see them), next to the report.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------------
alter table public.tenant_settings
  add column if not exists parent_focus_details boolean not null default true;
grant update (parent_focus_details) on public.tenant_settings to authenticated;

-- ---------------------------------------------------------------------------
-- Leave events remember what the student was doing and where they went
-- ---------------------------------------------------------------------------
alter table public.environment_events
  add column if not exists page_title      text,
  add column if not exists lesson_context  jsonb,
  add column if not exists away_started_at timestamptz;
create index if not exists environment_events_student_time_idx on public.environment_events(student_id, created_at desc);

create or replace function app.event_context() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_s public.class_sessions; v_slide int; v_away timestamptz; v_lesson text; v_heading text; v_activity text; v_class text;
begin
  select * into v_s from public.class_sessions where id = new.class_session_id;
  if v_s.id is null then return new; end if;
  select p.current_slide, p.away_since into v_slide, v_away
    from public.session_participants p where p.session_id = new.class_session_id and p.user_id = new.student_id;
  v_slide := case when v_s.mode = 'student_paced' then coalesce(v_slide, v_s.current_slide) else v_s.current_slide end;
  select title into v_lesson from public.lessons where id = v_s.lesson_id;
  select nullif(btrim(content ->> 'heading'), '') into v_heading
    from public.lesson_slides where lesson_id = v_s.lesson_id and position = v_slide limit 1;
  select title into v_activity from public.activities where id = v_s.active_activity_id;
  select name into v_class from public.classes where id = v_s.class_id;
  new.lesson_context := jsonb_strip_nulls(jsonb_build_object(
    'class', v_class, 'lesson', v_lesson,
    'slide', case when v_s.lesson_id is not null then v_slide + 1 end, 'slide_heading', v_heading, 'activity', v_activity));
  -- Managed browsers (extension) know the page the student switched to.
  if new.page_title is null then
    select left(b.active_title, 300) into new.page_title from public.browser_sessions b
     where b.class_session_id = new.class_session_id and b.student_id = new.student_id
     order by b.last_heartbeat_at desc limit 1;
  end if;
  new.away_started_at := coalesce(new.away_started_at, v_away, now());
  return new;
end$$;
drop trigger if exists environment_events_context on public.environment_events;
create trigger environment_events_context before insert on public.environment_events
  for each row execute function app.event_context();

-- ---------------------------------------------------------------------------
-- Parent alert preferences (one row per guardian per child)
-- ---------------------------------------------------------------------------
create table if not exists public.parent_alert_prefs (
  parent_id       uuid not null,
  student_id      uuid not null,
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  alert_on_leave  boolean not null default false,
  weekly_digest   boolean not null default true,
  low_score_below smallint check (low_score_below is null or low_score_below between 1 and 100),
  last_digest_at  timestamptz,
  updated_at      timestamptz not null default now(),
  primary key (parent_id, student_id),
  foreign key (parent_id, tenant_id) references public.users(id, tenant_id) on delete cascade,
  foreign key (student_id, tenant_id) references public.users(id, tenant_id) on delete cascade
);
create index if not exists parent_alert_prefs_student_idx on public.parent_alert_prefs(student_id);
create index if not exists parent_alert_prefs_tenant_idx on public.parent_alert_prefs(tenant_id);
alter table public.parent_alert_prefs enable row level security;
revoke all on public.parent_alert_prefs from anon, authenticated;
grant select on public.parent_alert_prefs to authenticated;
drop policy if exists parent_alert_prefs_read on public.parent_alert_prefs;
create policy parent_alert_prefs_read on public.parent_alert_prefs for select to authenticated
  using (parent_id = (select auth.uid()));

create or replace function public.parent_alerts(p_student uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v public.parent_alert_prefs;
begin
  if not app.is_parent_of(p_student) then raise exception 'Not your child.' using errcode = '42501'; end if;
  select * into v from public.parent_alert_prefs where parent_id = auth.uid() and student_id = p_student;
  return jsonb_build_object('alert_on_leave', coalesce(v.alert_on_leave, false), 'weekly_digest', coalesce(v.weekly_digest, true),
                            'low_score_below', v.low_score_below);
end$$;

create or replace function public.set_parent_alerts(p_student uuid, p_alert_on_leave boolean, p_weekly_digest boolean, p_low_score_below int default null)
returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_me public.users := app.me();
begin
  if not app.is_parent_of(p_student) then raise exception 'Not your child.' using errcode = '42501'; end if;
  if p_low_score_below is not null and p_low_score_below not between 1 and 100 then
    raise exception 'Choose a percentage between 1 and 100.' using errcode = '22023';
  end if;
  insert into public.parent_alert_prefs (parent_id, student_id, tenant_id, alert_on_leave, weekly_digest, low_score_below, updated_at)
    values (v_me.id, p_student, v_me.tenant_id, coalesce(p_alert_on_leave, false), coalesce(p_weekly_digest, true), p_low_score_below, now())
    on conflict (parent_id, student_id) do update set alert_on_leave = excluded.alert_on_leave, weekly_digest = excluded.weekly_digest,
      low_score_below = excluded.low_score_below, updated_at = now();
end$$;

-- Tell opted-in guardians the moment their child leaves a lesson (never for a lost connection).
create or replace function app.event_parent_alert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_child text; v_where text; v_ctx text;
begin
  if new.kind not in ('environment_left', 'domain_blocked') then return null; end if;
  select full_name into v_child from public.users where id = new.student_id;
  v_ctx := concat_ws(', ', new.lesson_context ->> 'lesson',
                     case when new.lesson_context ? 'slide' then 'slide ' || (new.lesson_context ->> 'slide') end,
                     new.lesson_context ->> 'activity');
  v_where := coalesce(nullif(new.page_title, ''), new.domain);
  perform app.notify(pl.parent_id, 'child_left_lesson',
      coalesce(split_part(v_child, ' ', 1), 'Your child') || ' left ' || coalesce(new.lesson_context ->> 'class', 'a lesson'),
      concat_ws(' · ', new.rule, case when v_where is not null and ts.parent_focus_details then 'went to: ' || v_where end,
                case when v_ctx <> '' then 'during ' || v_ctx end),
      '/parent?child=' || new.student_id || '&period=day', 'warning',
      jsonb_build_object('student_id', new.student_id, 'event_id', new.id))
    from public.parent_links pl
    join public.parent_alert_prefs pr on pr.parent_id = pl.parent_id and pr.student_id = pl.student_id and pr.alert_on_leave
    join public.tenant_settings ts on ts.tenant_id = pl.tenant_id and ts.parent_portal_enabled
   where pl.student_id = new.student_id and pl.revoked_at is null;
  return null;
end$$;
drop trigger if exists environment_events_parent_alert on public.environment_events;
create trigger environment_events_parent_alert after insert on public.environment_events
  for each row execute function app.event_parent_alert();

-- A released grade below a guardian's own threshold.
create or replace function app.grade_parent_alert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_student uuid; v_title text; v_points numeric; v_pct numeric;
begin
  if new.released_at is null or (tg_op = 'UPDATE' and old.released_at is not null) then return null; end if;
  select s.student_id, a.title, a.points_possible into v_student, v_title, v_points
    from public.submissions s join public.assignments a on a.id = s.assignment_id where s.id = new.submission_id;
  if v_student is null or coalesce(v_points, 0) <= 0 then return null; end if;
  v_pct := round(100 * new.score / v_points);
  perform app.notify(pl.parent_id, 'child_low_score', 'Grade below ' || pr.low_score_below || '%: ' || v_title,
      v_pct || '% (' || new.score || ' of ' || v_points || '). The teacher''s feedback is in the report.',
      '/parent?child=' || v_student || '&period=week', 'info', jsonb_build_object('student_id', v_student))
    from public.parent_links pl
    join public.parent_alert_prefs pr on pr.parent_id = pl.parent_id and pr.student_id = pl.student_id
    join public.tenant_settings ts on ts.tenant_id = pl.tenant_id and ts.parent_portal_enabled
   where pl.student_id = v_student and pl.revoked_at is null and pr.low_score_below is not null and v_pct < pr.low_score_below;
  return null;
end$$;
drop trigger if exists grades_parent_alert on public.grades;
create trigger grades_parent_alert after insert or update of released_at on public.grades
  for each row execute function app.grade_parent_alert();

-- Weekly summary: Friday from 15:00 in the school's time zone, once a week per guardian and child.
create or replace function app.send_parent_digests() returns int
language plpgsql volatile security definer set search_path = '' as $$
declare r record; v_n int := 0;
begin
  for r in
    select pl.parent_id, pl.student_id, pl.tenant_id, u.full_name
      from public.parent_links pl
      join public.users u on u.id = pl.student_id
      join public.tenants t on t.id = pl.tenant_id
      join public.tenant_settings ts on ts.tenant_id = pl.tenant_id and ts.parent_portal_enabled
      left join public.parent_alert_prefs pr on pr.parent_id = pl.parent_id and pr.student_id = pl.student_id
     where pl.revoked_at is null and coalesce(pr.weekly_digest, true)
       and extract(isodow from now() at time zone t.timezone) = 5
       and extract(hour from now() at time zone t.timezone) >= 15
       and (pr.last_digest_at is null or pr.last_digest_at < now() - interval '6 days')
  loop
    perform app.notify(r.parent_id, 'weekly_report', 'Weekly report for ' || split_part(r.full_name, ' ', 1) || ' is ready',
                       'Lessons, participation, progress by subject and focus for this week.',
                       '/parent?child=' || r.student_id || '&period=week', 'info', jsonb_build_object('student_id', r.student_id));
    insert into public.parent_alert_prefs (parent_id, student_id, tenant_id, last_digest_at)
      values (r.parent_id, r.student_id, r.tenant_id, now())
      on conflict (parent_id, student_id) do update set last_digest_at = now();
    v_n := v_n + 1;
  end loop;
  return v_n;
end$$;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('swiftcipher-parent-digest', '5 * * * *', 'select app.send_parent_digests()');
  end if;
exception when others then
  raise notice 'pg_cron not scheduled (%). Call app.send_parent_digests() hourly from the maintenance workflow.', sqlerrm;
end$$;

-- ---------------------------------------------------------------------------
-- The report
-- ---------------------------------------------------------------------------
-- Participation 0–100, explained to parents as its parts:
--   30% attendance, 35% answering (5 answers a lesson = full marks), 15% explained
--   reasoning, 5% asking for help, 15% staying focused (each time they left: −25%).
create or replace function app.class_period(p_student uuid, p_class uuid, p_from timestamptz, p_to timestamptz, p_details boolean)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_held int; v_attended int; v_minutes numeric; v_answers int; v_graded int; v_correct int; v_reasoned int;
  v_done int; v_hands int; v_xp int; v_focus int; v_score int;
begin
  select count(*) into v_held from public.class_sessions s
   where s.class_id = p_class and s.started_at >= p_from and s.started_at < p_to;
  select count(*), coalesce(sum(least(greatest(extract(epoch from (
            least(coalesce(p.left_at, s.ended_at, p.last_seen_at), coalesce(s.ended_at, p.last_seen_at)) - p.joined_at)), 0), 14400)) / 60, 0)
    into v_attended, v_minutes
    from public.session_participants p join public.class_sessions s on s.id = p.session_id
   where s.class_id = p_class and p.user_id = p_student and s.started_at >= p_from and s.started_at < p_to;
  select count(*), count(a.is_correct), count(*) filter (where a.is_correct),
         count(*) filter (where length(btrim(coalesce(a.response ->> 'reasoning', ''))) >= 15)
    into v_answers, v_graded, v_correct, v_reasoned
    from public.quiz_answers a join public.quiz_attempts t on t.id = a.attempt_id
   where t.student_id = p_student and app.attempt_class(t) = p_class and a.answered_at >= p_from and a.answered_at < p_to;
  select count(*) into v_done from public.quiz_attempts t
   where t.student_id = p_student and t.status <> 'in_progress' and app.attempt_class(t) = p_class
     and t.submitted_at >= p_from and t.submitted_at < p_to;
  select count(*) into v_hands from public.raise_hands h join public.class_sessions s on s.id = h.session_id
   where s.class_id = p_class and h.student_id = p_student and h.created_at >= p_from and h.created_at < p_to;
  select coalesce(sum(points), 0) into v_xp from public.xp_events
   where student_id = p_student and class_id = p_class and created_at >= p_from and created_at < p_to;
  select count(*) into v_focus from public.environment_events e
   where e.student_id = p_student and e.class_id = p_class and e.created_at >= p_from and e.created_at < p_to
     and e.kind in ('environment_left', 'domain_blocked', 'off_task', 'tab_limit');

  if v_held > 0 or v_answers > 0 then
    v_score := round(100 * (
        0.30 * case when v_held > 0 then least(v_attended::numeric / v_held, 1) else 1 end
      + 0.35 * least(v_answers::numeric / (5 * greatest(v_attended, 1)), 1)
      + 0.15 * case when v_answers > 0 then v_reasoned::numeric / v_answers else 0 end
      + 0.05 * least(v_hands::numeric / greatest(v_attended, 1), 1)
      + 0.15 * greatest(0, 1 - 0.25 * v_focus)));
  end if;

  return jsonb_build_object(
    'sessions_held', v_held, 'sessions_attended', v_attended, 'minutes', round(v_minutes),
    'answers', v_answers, 'accuracy', case when v_graded > 0 then round(100.0 * v_correct / v_graded) end,
    'reasoned', v_reasoned, 'activities_completed', v_done, 'hands_raised', v_hands, 'xp', v_xp,
    'focus_events', v_focus, 'participation', v_score,
    'focus', case when not p_details then '[]'::jsonb else (
      select coalesce(jsonb_agg(jsonb_build_object(
          'at', e.away_started_at, 'kind', e.kind, 'reason', e.rule, 'site', e.domain, 'page_title', e.page_title,
          'context', e.lesson_context, 'returned', e.resolved_at is not null,
          'away_minutes', case when e.resolved_at is not null
                               then greatest(1, round(extract(epoch from (e.resolved_at - coalesce(e.away_started_at, e.created_at))) / 60)) end)
          order by e.created_at desc), '[]'::jsonb)
      from (select * from public.environment_events e
             where e.student_id = p_student and e.class_id = p_class and e.created_at >= p_from and e.created_at < p_to
               and e.kind in ('environment_left', 'domain_blocked', 'off_task', 'tab_limit')
             order by e.created_at desc limit 25) e) end);
end$$;

create or replace function public.parent_report(p_student uuid, p_period text default 'week', p_date date default null)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_student public.users; v_tz text; v_day date; v_from timestamptz; v_to timestamptz; v_span interval;
  v_details boolean; v_subjects jsonb;
begin
  select * into v_student from public.users where id = p_student;
  if v_student.id is null or not (app.is_parent_of(p_student) or app.teaches_student(p_student)
                                  or (app.is_admin() and v_student.tenant_id = app.tenant_id())) then
    raise exception 'Report not found.' using errcode = 'P0002';
  end if;
  if p_period not in ('day', 'week') then raise exception 'Period is day or week.' using errcode = '22023'; end if;
  select t.timezone, ts.parent_focus_details into v_tz, v_details
    from public.tenants t join public.tenant_settings ts on ts.tenant_id = t.id where t.id = v_student.tenant_id;
  v_tz := coalesce(v_tz, 'UTC');
  v_day := coalesce(p_date, (now() at time zone v_tz)::date);
  if p_period = 'week' then v_day := v_day - (extract(isodow from v_day)::int - 1); v_span := interval '7 days';
  else v_span := interval '1 day'; end if;
  v_from := v_day::timestamp at time zone v_tz;
  v_to := v_from + v_span;
  -- Staff always see details; parents as the school decides.
  v_details := coalesce(v_details, true) or not app.is_parent_of(p_student);

  select coalesce(jsonb_agg(x order by x ->> 'class'), '[]'::jsonb) into v_subjects from (
    select jsonb_build_object(
        'class_id', c.id, 'class', c.name, 'subject', c.subject, 'teacher', tu.full_name, 'teacher_id', c.teacher_id,
        'now', app.class_period(p_student, c.id, v_from, v_to, v_details),
        'before', app.class_period(p_student, c.id, v_from - v_span, v_from, false) - 'focus',
        -- Six weeks ending with this one, for the learning-progress chart.
        'trend', (select coalesce(jsonb_agg(jsonb_build_object('week', (w at time zone v_tz)::date,
                      'accuracy', cp -> 'accuracy', 'xp', cp -> 'xp', 'participation', cp -> 'participation') order by w), '[]'::jsonb)
                  from generate_series((date_trunc('week', v_from at time zone v_tz) - interval '5 weeks') at time zone v_tz,
                                       date_trunc('week', v_from at time zone v_tz) at time zone v_tz, interval '7 days') w
                  cross join lateral (select app.class_period(p_student, c.id, w, w + interval '7 days', false) as cp) z),
        'assignments', (select jsonb_build_object(
              'due', count(*),
              'submitted', count(*) filter (where exists (select 1 from public.submissions s where s.assignment_id = a.id and s.student_id = p_student)),
              'late', count(*) filter (where exists (select 1 from public.submissions s where s.assignment_id = a.id and s.student_id = p_student and s.is_late)),
              'missing', count(*) filter (where a.due_at < now() and not exists (select 1 from public.submissions s where s.assignment_id = a.id and s.student_id = p_student)),
              'missing_titles', coalesce(jsonb_agg(a.title) filter (where a.due_at < now() and not exists (
                  select 1 from public.submissions s where s.assignment_id = a.id and s.student_id = p_student)), '[]'::jsonb))
            from public.assignments a
           where a.class_id = c.id and a.status <> 'draft' and a.due_at >= v_from and a.due_at < v_to),
        'grades', (select coalesce(jsonb_agg(jsonb_build_object('assignment', a.title, 'score', g.score, 'out_of', a.points_possible,
                      'feedback', g.feedback, 'released_at', g.released_at) order by g.released_at desc), '[]'::jsonb)
                   from public.grades g join public.submissions s on s.id = g.submission_id join public.assignments a on a.id = s.assignment_id
                   where a.class_id = c.id and s.student_id = p_student and g.released_at >= v_from and g.released_at < v_to)) as x
    from public.class_members m
    join public.classes c on c.id = m.class_id
    left join public.users tu on tu.id = c.teacher_id
    where m.user_id = p_student and m.role = 'student') q;

  return jsonb_build_object(
    'student', jsonb_build_object('id', v_student.id, 'name', v_student.full_name),
    'period', p_period, 'from', v_from, 'to', v_to, 'date', v_day, 'timezone', v_tz, 'focus_details', v_details,
    'progress', (select jsonb_build_object('xp', coalesce(sum(points), 0), 'level', app.xp_level(coalesce(sum(points), 0)))
                 from public.xp_events where student_id = p_student),
    'badges', (select coalesce(jsonb_agg(jsonb_build_object('badge', b.badge, 'earned_at', b.earned_at) order by b.earned_at), '[]'::jsonb)
               from public.student_badges b where b.student_id = p_student and b.earned_at >= v_from and b.earned_at < v_to),
    'subjects', v_subjects);
end$$;

-- ---------------------------------------------------------------------------
-- Parent ↔ teacher messages about a child (the child can't see them)
-- ---------------------------------------------------------------------------
alter table public.chat_threads add column if not exists parent_id uuid;
do $$ begin
  alter table public.chat_threads add constraint chat_threads_parent_fkey
    foreign key (parent_id, tenant_id) references public.users(id, tenant_id) on delete cascade;
exception when duplicate_object then null; end $$;
create index if not exists chat_threads_parent_idx on public.chat_threads(parent_id) where parent_id is not null;
alter table public.chat_threads drop constraint if exists chat_threads_kind_check;
alter table public.chat_threads drop constraint if exists chat_threads_check;
alter table public.chat_threads drop constraint if exists chat_threads_shape_check;
alter table public.chat_threads add constraint chat_threads_shape_check check (
     (kind = 'direct' and student_id is not null and teacher_id is not null and parent_id is null)
  or (kind = 'group' and session_id is not null and parent_id is null)
  or (kind = 'parent' and student_id is not null and teacher_id is not null and parent_id is not null));
create unique index if not exists chat_threads_parent_uidx on public.chat_threads(class_id, student_id, teacher_id, parent_id) where kind = 'parent';

drop policy if exists chat_threads_read on public.chat_threads;
create policy chat_threads_read on public.chat_threads for select to authenticated
  using (tenant_id = (select app.tenant_id())
         and ((kind = 'direct' and (student_id = (select auth.uid()) or teacher_id = (select auth.uid())))
              or (kind = 'parent' and (parent_id = (select auth.uid()) or teacher_id = (select auth.uid())))
              or (kind = 'group' and (app.can_manage_class(class_id) or app.in_class(class_id)))));

create or replace function public.open_parent_thread(p_student uuid, p_class uuid, p_parent uuid default null) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare v_me public.users := app.me(); v_teacher uuid; v_parent uuid; v_id uuid;
begin
  if not exists (select 1 from public.class_members where class_id = p_class and user_id = p_student and role = 'student') then
    raise exception 'That child is not in this class.' using errcode = 'P0002';
  end if;
  if v_me.role = 'parent' then
    if not app.is_parent_of(p_student) then raise exception 'Not your child.' using errcode = '42501'; end if;
    v_parent := v_me.id;
    select teacher_id into v_teacher from public.classes where id = p_class;
  elsif app.can_manage_class(p_class) and v_me.role <> 'student' then
    v_teacher := v_me.id; v_parent := p_parent;
    if not exists (select 1 from public.parent_links where parent_id = p_parent and student_id = p_student and revoked_at is null) then
      raise exception 'That parent is not linked to this child.' using errcode = 'P0002';
    end if;
  else
    raise exception 'Not your class.' using errcode = '42501';
  end if;
  select id into v_id from public.chat_threads
   where class_id = p_class and kind = 'parent' and student_id = p_student and teacher_id = v_teacher and parent_id = v_parent;
  if v_id is null then
    insert into public.chat_threads (tenant_id, class_id, kind, student_id, teacher_id, parent_id)
      values (v_me.tenant_id, p_class, 'parent', p_student, v_teacher, v_parent) returning id into v_id;
  end if;
  return v_id;
end$$;

create or replace function public.send_message(p_thread uuid, p_body text) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare v_me public.users := app.me(); v_t public.chat_threads; v_id uuid; v_to uuid; v_link text;
begin
  select * into v_t from public.chat_threads where id = p_thread and tenant_id = v_me.tenant_id;
  if v_t.id is null then raise exception 'Conversation not found.' using errcode = 'P0002'; end if;
  if length(btrim(coalesce(p_body, ''))) not between 1 and 2000 then raise exception 'Messages are 1-2000 characters.' using errcode = '22023'; end if;
  if v_t.kind = 'direct' then
    if v_me.id not in (v_t.student_id, v_t.teacher_id) then raise exception 'Not your conversation.' using errcode = '42501'; end if;
    v_to := case when v_me.id = v_t.student_id then v_t.teacher_id else v_t.student_id end;
    v_link := '/messages?thread=' || p_thread;
  elsif v_t.kind = 'parent' then
    if v_me.id not in (v_t.parent_id, v_t.teacher_id) then raise exception 'Not your conversation.' using errcode = '42501'; end if;
    if v_me.id = v_t.parent_id and not app.is_parent_of(v_t.student_id) then raise exception 'Not your child.' using errcode = '42501'; end if;
    v_to := case when v_me.id = v_t.parent_id then v_t.teacher_id else v_t.parent_id end;
    v_link := case when v_me.id = v_t.parent_id then '/messages?thread=' || p_thread
                   else '/parent?child=' || v_t.student_id || '&thread=' || p_thread end;
  else
    if not (app.can_manage_class(v_t.class_id)
            or (app.in_class(v_t.class_id) and exists (select 1 from public.class_sessions s where s.id = v_t.session_id
                                                       and s.status = 'live' and s.group_chat_enabled))) then
      raise exception 'Group chat is off for this session.' using errcode = 'P0001';
    end if;
  end if;
  insert into public.chat_messages (tenant_id, thread_id, sender_id, body)
    values (v_me.tenant_id, p_thread, v_me.id, btrim(p_body)) returning id into v_id;
  if v_to is not null then
    perform app.notify(v_to, 'chat_message', 'New message from ' || v_me.full_name, left(btrim(p_body), 140),
                       v_link, 'info', jsonb_build_object('thread_id', p_thread));
  end if;
  return v_id;
end$$;

create or replace function app.can_listen(p_topic text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v_kind text := split_part(p_topic, ':', 1); v_id uuid; v_user uuid;
begin
  begin
    v_id := nullif(split_part(p_topic, ':', 2), '')::uuid;
    v_user := nullif(split_part(p_topic, ':', 3), '')::uuid;
  exception when others then return false; end;
  if v_id is null or app.tenant_id() is null then return false; end if;
  return case v_kind
    when 'session' then app.in_session(v_id) or app.can_manage_session(v_id)
    when 'staff'   then app.can_manage_session(v_id)
    -- teachers watch; the student may join only their own channel (to send frames)
    when 'screen'  then app.can_manage_session(v_id) or (v_user = auth.uid() and app.in_session(v_id))
    when 'user'    then v_id = auth.uid()
    -- parent threads: only the parent and the teacher (never the child, nor other staff)
    when 'thread'  then exists (select 1 from public.chat_threads t where t.id = v_id and t.tenant_id = app.tenant_id()
                                and case when t.kind = 'parent' then auth.uid() in (t.parent_id, t.teacher_id)
                                         else (t.student_id = auth.uid() or t.teacher_id = auth.uid()
                                               or (t.kind = 'group' and app.in_session(t.session_id)) or app.can_manage_class(t.class_id)) end)
    -- boards and games: exactly the people who can read the row (mirrors their RLS policies)
    when 'board'   then exists (select 1 from public.collab_boards b where b.id = v_id and b.tenant_id = app.tenant_id()
                                and (b.owner_id = auth.uid()
                                     or (b.session_id is not null and (app.can_manage_session(b.session_id) or app.in_session(b.session_id)))
                                     or (b.session_id is null and app.is_teacher())))
    when 'game'    then exists (select 1 from public.game_sessions g where g.id = v_id and g.tenant_id = app.tenant_id()
                                and (app.can_manage_class(g.class_id) or app.in_class(g.class_id)))
    when 'annot'   then app.in_session(v_id) or app.can_manage_session(v_id)
    else false end;
end$$;

-- Parents linked to a child in a class (for the teacher's "Message parent").
create or replace function public.class_parents(p_class uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.can_manage_class(p_class) then raise exception 'Not your class.' using errcode = '42501'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('student_id', pl.student_id, 'parent_id', pl.parent_id,
                    'parent', pu.full_name, 'relation', pl.relation) order by pu.full_name), '[]'::jsonb)
          from public.parent_links pl join public.class_members m on m.user_id = pl.student_id and m.class_id = p_class and m.role = 'student'
          join public.users pu on pu.id = pl.parent_id
          where pl.revoked_at is null);
end$$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
revoke execute on function public.parent_report(uuid, text, date), public.parent_alerts(uuid),
  public.set_parent_alerts(uuid, boolean, boolean, int), public.open_parent_thread(uuid, uuid, uuid), public.class_parents(uuid),
  app.class_period(uuid, uuid, timestamptz, timestamptz, boolean), app.send_parent_digests()
  from public, anon;
grant execute on function public.parent_report(uuid, text, date), public.parent_alerts(uuid),
  public.set_parent_alerts(uuid, boolean, boolean, int), public.open_parent_thread(uuid, uuid, uuid), public.class_parents(uuid)
  to authenticated, service_role;
grant execute on function app.send_parent_digests() to service_role;

create or replace function public.health() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('ok', true, 'db_time', now(), 'schema', '0820')
$$;
