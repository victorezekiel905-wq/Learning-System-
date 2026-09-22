-- =============================================================================
-- SwiftCipher — 0500 row-level security
--
-- Rules of thumb:
--   * anon can read nothing but public catalogues; every anon action is an RPC.
--   * Writes that need invariants (codes, limits, grading, audit) are RPC-only:
--     those tables simply have no INSERT/UPDATE policy for clients.
--   * Helper calls are wrapped in (select ...) so Postgres evaluates them once
--     per statement instead of once per row.
-- =============================================================================

-- ---------- Extra helpers that depend on learning/classroom tables ----------
create or replace function app.can_edit_lesson(p_lesson uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.lessons l
                 where l.id = p_lesson and l.tenant_id = app.tenant_id()
                   and (l.owner_id = auth.uid() or app.is_admin()))
$$;

create or replace function app.can_view_lesson(p_lesson uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.lessons l
                 where l.id = p_lesson and l.tenant_id = app.tenant_id()
                   and (l.owner_id = auth.uid() or app.is_admin()
                        or (app.is_teacher() and (l.status = 'published' or l.is_template))))
$$;

create or replace function app.can_edit_activity(p_activity uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.activities a
                 where a.id = p_activity and a.tenant_id = app.tenant_id()
                   and (a.owner_id = auth.uid() or app.is_admin()
                        or (a.lesson_id is not null and app.can_edit_lesson(a.lesson_id))))
$$;

create or replace function app.can_view_activity(p_activity uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.activities a
                 where a.id = p_activity and a.tenant_id = app.tenant_id()
                   and (a.owner_id = auth.uid() or app.is_admin()
                        or (a.lesson_id is not null and app.can_view_lesson(a.lesson_id))
                        or (a.lesson_id is null and app.is_teacher())))
$$;

create or replace function app.session_class(p_session uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select s.class_id from public.class_sessions s where s.id = p_session
$$;

create or replace function app.can_manage_session(p_session uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.can_manage_class(app.session_class(p_session))
$$;

create or replace function app.in_session(p_session uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.in_class(app.session_class(p_session))
$$;

-- ---------- Baseline privileges ----------
-- Supabase grants ALL on public tables to anon/authenticated by default; pull
-- anon back to nothing and give authenticated only what policies can gate.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke insert, update, delete, truncate, references, trigger on all tables in schema public from authenticated;
grant select on public.roles, public.plans to anon;

-- Enable RLS everywhere.
do $$
declare r record;
begin
  for r in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'r'
  loop
    execute format('alter table public.%I enable row level security', r.relname);
  end loop;
end$$;

-- ---------- Catalogues ----------
create policy roles_read on public.roles for select using (true);
create policy plans_read on public.plans for select using (true);
create policy domain_categories_read on public.domain_categories for select to authenticated using (true);

-- ---------- Tenancy ----------
create policy tenants_read on public.tenants for select to authenticated
  using (id = (select app.tenant_id()));
grant update (name, country, timezone) on public.tenants to authenticated;
create policy tenants_admin_update on public.tenants for update to authenticated
  using (id = (select app.tenant_id()) and (select app.is_admin()))
  with check (id = (select app.tenant_id()));

create policy tenant_settings_read on public.tenant_settings for select to authenticated
  using (tenant_id = (select app.tenant_id()));
grant update (allow_spotlight, allow_group_chat, allow_screen_capture, store_event_screenshots,
              parent_portal_enabled, email_alerts_enabled, nickname_mode, learning_retention_days,
              telemetry_retention_days, default_grace_seconds, default_idle_seconds,
              thumbnail_interval_seconds, monitoring_notice, support_access_until)
  on public.tenant_settings to authenticated;
create policy tenant_settings_admin_update on public.tenant_settings for update to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.is_admin()))
  with check (tenant_id = (select app.tenant_id()));

create policy schools_read on public.schools for select to authenticated
  using (tenant_id = (select app.tenant_id()));
grant insert, update, delete on public.schools, public.departments to authenticated;
create policy schools_admin_write on public.schools for all to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.is_admin()))
  with check (tenant_id = (select app.tenant_id()) and (select app.is_admin()));
create policy departments_read on public.departments for select to authenticated
  using (tenant_id = (select app.tenant_id()));
create policy departments_admin_write on public.departments for all to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.is_admin()))
  with check (tenant_id = (select app.tenant_id()) and (select app.is_admin()));

-- Users: staff see the tenant directory; students/parents see themselves,
-- staff (to message teachers) and — for parents — their linked students.
create policy users_read on public.users for select to authenticated
  using (tenant_id = (select app.tenant_id())
         and ((select app.is_staff())
              or id = (select auth.uid())
              or role in ('teacher','school_admin')
              or app.is_parent_of(id)));
grant update (full_name, nickname, last_seen_at) on public.users to authenticated;
create policy users_self_update on public.users for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy student_profiles_read on public.student_profiles for select to authenticated
  using (tenant_id = (select app.tenant_id())
         and (user_id = (select auth.uid()) or (select app.is_staff()) or app.is_parent_of(user_id)));
grant insert, update on public.student_profiles, public.teacher_profiles to authenticated;
create policy student_profiles_staff_write on public.student_profiles for all to authenticated
  using (tenant_id = (select app.tenant_id()) and ((select app.is_admin()) or app.teaches_student(user_id)))
  with check (tenant_id = (select app.tenant_id()) and ((select app.is_admin()) or app.teaches_student(user_id)));
create policy teacher_profiles_read on public.teacher_profiles for select to authenticated
  using (tenant_id = (select app.tenant_id()));
create policy teacher_profiles_write on public.teacher_profiles for all to authenticated
  using (tenant_id = (select app.tenant_id()) and (user_id = (select auth.uid()) or (select app.is_admin())))
  with check (tenant_id = (select app.tenant_id()) and (user_id = (select auth.uid()) or (select app.is_admin())));

-- ---------- Classes ----------
create policy classes_read on public.classes for select to authenticated
  using (tenant_id = (select app.tenant_id())
         and ((select app.is_admin()) or (select app.is_it())
              or teacher_id = (select auth.uid()) or app.in_class(id)));
grant update (name, subject, grade_level, archived_at, school_id, department_id) on public.classes to authenticated;
create policy classes_manage_update on public.classes for update to authenticated
  using (app.can_manage_class(id)) with check (tenant_id = (select app.tenant_id()));

create policy class_members_read on public.class_members for select to authenticated
  using (tenant_id = (select app.tenant_id())
         and (user_id = (select auth.uid()) or app.can_manage_class(class_id) or (select app.is_it())
              or (role = 'teacher' and app.in_class(class_id))));
grant insert, delete on public.class_members to authenticated;
create policy class_members_manage_insert on public.class_members for insert to authenticated
  with check (tenant_id = (select app.tenant_id()) and app.can_manage_class(class_id)
              and (role = 'student' or (select app.is_admin())
                   or exists (select 1 from public.classes c where c.id = class_id and c.teacher_id = (select auth.uid()))));
create policy class_members_manage_delete on public.class_members for delete to authenticated
  using (app.can_manage_class(class_id));

create policy student_groups_read on public.student_groups for select to authenticated
  using (app.can_manage_class(class_id) or (tenant_id = (select app.tenant_id()) and (select app.is_it())));
grant insert, update, delete on public.student_groups, public.student_group_members to authenticated;
create policy student_groups_write on public.student_groups for all to authenticated
  using (app.can_manage_class(class_id))
  with check (tenant_id = (select app.tenant_id()) and app.can_manage_class(class_id));
create policy student_group_members_read on public.student_group_members for select to authenticated
  using (exists (select 1 from public.student_groups g where g.id = group_id));
create policy student_group_members_write on public.student_group_members for all to authenticated
  using (exists (select 1 from public.student_groups g where g.id = group_id and app.can_manage_class(g.class_id)))
  with check (tenant_id = (select app.tenant_id())
              and exists (select 1 from public.student_groups g where g.id = group_id and app.can_manage_class(g.class_id))
              and exists (select 1 from public.class_members m join public.student_groups g on g.class_id = m.class_id
                          where g.id = group_id and m.user_id = student_group_members.user_id));

create policy invites_read on public.invites for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (created_by = (select auth.uid()) or (select app.is_admin())));
grant update (revoked_at) on public.invites to authenticated;
create policy invites_revoke on public.invites for update to authenticated
  using (tenant_id = (select app.tenant_id()) and (created_by = (select auth.uid()) or (select app.is_admin())));

create policy parent_links_read on public.parent_links for select to authenticated
  using (tenant_id = (select app.tenant_id())
         and (parent_id = (select auth.uid()) or student_id = (select auth.uid())
              or (select app.is_admin()) or app.teaches_student(student_id)));
grant update (revoked_at) on public.parent_links to authenticated;
create policy parent_links_admin_revoke on public.parent_links for update to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.is_admin()));

-- ---------- Billing / flags / audit / notifications / consents ----------
create policy subscriptions_admin_read on public.subscriptions for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.is_admin()));
create policy invoices_admin_read on public.invoices for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.is_admin()));

create policy feature_flags_read on public.feature_flags for select to authenticated
  using (tenant_id is null or tenant_id = (select app.tenant_id()));
grant insert, update, delete on public.feature_flags to authenticated;
create policy feature_flags_admin_write on public.feature_flags for all to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.is_admin()))
  with check (tenant_id = (select app.tenant_id()) and (select app.is_admin()));

create policy audit_logs_admin_read on public.audit_logs for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.is_admin()));

create policy notifications_own_read on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));
grant update (read_at) on public.notifications to authenticated;
grant delete on public.notifications to authenticated;
create policy notifications_own_update on public.notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy notifications_own_delete on public.notifications for delete to authenticated
  using (user_id = (select auth.uid()));

create policy consents_read on public.consents for select to authenticated
  using (user_id = (select auth.uid()) or (tenant_id = (select app.tenant_id()) and (select app.is_admin())));
grant insert on public.consents to authenticated;
create policy consents_own_insert on public.consents for insert to authenticated
  with check (user_id = (select auth.uid()) and tenant_id = (select app.tenant_id()));

-- ---------- Studio ----------
-- Row-column checks (not app.can_view_lesson(id)) so INSERT ... RETURNING can
-- see the row it just wrote; helper lookups use the pre-statement snapshot.
create policy lessons_read on public.lessons for select to authenticated
  using (tenant_id = (select app.tenant_id())
         and (owner_id = (select auth.uid()) or (select app.is_admin())
              or ((select app.is_teacher()) and (status = 'published' or is_template))));
grant insert, update, delete on public.lessons to authenticated;
create policy lessons_insert on public.lessons for insert to authenticated
  with check (tenant_id = (select app.tenant_id()) and owner_id = (select auth.uid()) and (select app.is_teacher()));
create policy lessons_update on public.lessons for update to authenticated
  using (app.can_edit_lesson(id)) with check (tenant_id = (select app.tenant_id()));
create policy lessons_delete on public.lessons for delete to authenticated
  using (app.can_edit_lesson(id));

create policy lesson_versions_read on public.lesson_versions for select to authenticated
  using (app.can_view_lesson(lesson_id));

create policy lesson_slides_read on public.lesson_slides for select to authenticated
  using (app.can_view_lesson(lesson_id));
grant insert, update, delete on public.lesson_slides to authenticated;
create policy lesson_slides_write on public.lesson_slides for all to authenticated
  using (app.can_edit_lesson(lesson_id))
  with check (tenant_id = (select app.tenant_id()) and app.can_edit_lesson(lesson_id));

create policy media_folders_read on public.media_folders for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.is_teacher()));
grant insert, update, delete on public.media_folders, public.lesson_media to authenticated;
create policy media_folders_write on public.media_folders for all to authenticated
  using (tenant_id = (select app.tenant_id()) and (owner_id = (select auth.uid()) or (select app.is_admin())))
  with check (tenant_id = (select app.tenant_id()) and owner_id = (select auth.uid()) and (select app.is_teacher()));

create policy lesson_media_read on public.lesson_media for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.is_teacher()));
create policy lesson_media_write on public.lesson_media for all to authenticated
  using (tenant_id = (select app.tenant_id()) and (owner_id = (select auth.uid()) or (select app.is_admin())))
  with check (tenant_id = (select app.tenant_id()) and owner_id = (select auth.uid()) and (select app.is_teacher())
              and storage_path like (select app.tenant_id())::text || '/' || (select auth.uid())::text || '/%');

create policy lesson_shares_read on public.lesson_shares for select to authenticated
  using (app.can_edit_lesson(lesson_id));
grant update (revoked_at) on public.lesson_shares to authenticated;
create policy lesson_shares_revoke on public.lesson_shares for update to authenticated
  using (app.can_edit_lesson(lesson_id));

create policy activities_read on public.activities for select to authenticated
  using (tenant_id = (select app.tenant_id())
         and (owner_id = (select auth.uid()) or (select app.is_admin())
              or (lesson_id is not null and app.can_view_lesson(lesson_id))
              or (lesson_id is null and (select app.is_teacher()))));
grant insert, update, delete on public.activities to authenticated;
create policy activities_insert on public.activities for insert to authenticated
  with check (tenant_id = (select app.tenant_id()) and owner_id = (select auth.uid()) and (select app.is_teacher())
              and (lesson_id is null or app.can_edit_lesson(lesson_id)));
create policy activities_update on public.activities for update to authenticated
  using (app.can_edit_activity(id))
  with check (tenant_id = (select app.tenant_id()) and (lesson_id is null or app.can_edit_lesson(lesson_id)));
create policy activities_delete on public.activities for delete to authenticated
  using (app.can_edit_activity(id));

-- Questions/options carry answer keys: staff only. Students use RPCs.
create policy questions_read on public.questions for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.is_teacher())
         and (owner_id = (select auth.uid()) or in_bank
              or (activity_id is not null and app.can_view_activity(activity_id))));
grant insert, update, delete on public.questions, public.question_options to authenticated;
create policy questions_write on public.questions for all to authenticated
  using (tenant_id = (select app.tenant_id())
         and (owner_id = (select auth.uid()) or (activity_id is not null and app.can_edit_activity(activity_id))))
  with check (tenant_id = (select app.tenant_id()) and (select app.is_teacher())
              and (activity_id is null or app.can_edit_activity(activity_id)));

create policy question_options_read on public.question_options for select to authenticated
  using (exists (select 1 from public.questions q where q.id = question_id));
create policy question_options_write on public.question_options for all to authenticated
  using (exists (select 1 from public.questions q where q.id = question_id
                 and (q.owner_id = (select auth.uid()) or (q.activity_id is not null and app.can_edit_activity(q.activity_id)))))
  with check (tenant_id = (select app.tenant_id())
              and exists (select 1 from public.questions q where q.id = question_id
                          and (q.owner_id = (select auth.uid()) or (q.activity_id is not null and app.can_edit_activity(q.activity_id)))));

create policy video_checkpoints_read on public.video_checkpoints for select to authenticated
  using (exists (select 1 from public.lesson_slides s where s.id = slide_id));
grant insert, update, delete on public.video_checkpoints to authenticated;
create policy video_checkpoints_write on public.video_checkpoints for all to authenticated
  using (exists (select 1 from public.lesson_slides s where s.id = slide_id and app.can_edit_lesson(s.lesson_id)))
  with check (tenant_id = (select app.tenant_id())
              and exists (select 1 from public.lesson_slides s where s.id = slide_id and app.can_edit_lesson(s.lesson_id)));

-- ---------- Assessment ----------
create policy rubrics_read on public.rubrics for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.is_teacher()));
grant insert, update, delete on public.rubrics to authenticated;
create policy rubrics_write on public.rubrics for all to authenticated
  using (tenant_id = (select app.tenant_id()) and (owner_id = (select auth.uid()) or (select app.is_admin())))
  with check (tenant_id = (select app.tenant_id()) and owner_id = (select auth.uid()) and (select app.is_teacher()));

create policy assignments_read on public.assignments for select to authenticated
  using (app.can_manage_class(class_id) or (status <> 'draft' and app.in_class(class_id)));
grant insert, update, delete on public.assignments to authenticated;
create policy assignments_write on public.assignments for all to authenticated
  using (app.can_manage_class(class_id))
  with check (tenant_id = (select app.tenant_id()) and app.can_manage_class(class_id) and created_by = (select auth.uid()));

create policy quiz_attempts_read on public.quiz_attempts for select to authenticated
  using (student_id = (select auth.uid())
         or (tenant_id = (select app.tenant_id()) and ((select app.is_admin()) or app.teaches_student(student_id))));

create policy quiz_answers_read on public.quiz_answers for select to authenticated
  using (exists (select 1 from public.quiz_attempts a where a.id = attempt_id));

create policy submissions_read on public.submissions for select to authenticated
  using (student_id = (select auth.uid())
         or exists (select 1 from public.assignments a where a.id = assignment_id and app.can_manage_class(a.class_id)));

create policy grades_read on public.grades for select to authenticated
  using (exists (select 1 from public.submissions s join public.assignments a on a.id = s.assignment_id
                 where s.id = submission_id
                   and (app.can_manage_class(a.class_id) or (s.student_id = (select auth.uid()) and released_at is not null))));

create policy collab_boards_read on public.collab_boards for select to authenticated
  using (tenant_id = (select app.tenant_id())
         and (owner_id = (select auth.uid())
              or (session_id is not null and (app.can_manage_session(session_id) or app.in_session(session_id)))
              or (session_id is null and (select app.is_teacher()))));
grant insert, update, delete on public.collab_boards to authenticated;
create policy collab_boards_write on public.collab_boards for all to authenticated
  using (owner_id = (select auth.uid()) or (session_id is not null and app.can_manage_session(session_id)))
  with check (tenant_id = (select app.tenant_id()) and (select app.is_teacher())
              and (session_id is null or app.can_manage_session(session_id)));

create policy collab_posts_read on public.collab_posts for select to authenticated
  using (exists (select 1 from public.collab_boards b where b.id = board_id
                 and (not hidden or author_id = (select auth.uid()) or b.owner_id = (select auth.uid())
                      or (b.session_id is not null and app.can_manage_session(b.session_id)))));
grant insert, update, delete on public.collab_posts to authenticated;
create policy collab_posts_insert on public.collab_posts for insert to authenticated
  with check (author_id = (select auth.uid()) and tenant_id = (select app.tenant_id()) and not hidden
              and exists (select 1 from public.collab_boards b where b.id = board_id and not b.locked));
create policy collab_posts_update on public.collab_posts for update to authenticated
  using (author_id = (select auth.uid())
         or exists (select 1 from public.collab_boards b where b.id = board_id
                    and (b.owner_id = (select auth.uid()) or (b.session_id is not null and app.can_manage_session(b.session_id)))))
  with check (tenant_id = (select app.tenant_id()));
create policy collab_posts_delete on public.collab_posts for delete to authenticated
  using (author_id = (select auth.uid())
         or exists (select 1 from public.collab_boards b where b.id = board_id
                    and (b.owner_id = (select auth.uid()) or (b.session_id is not null and app.can_manage_session(b.session_id)))));

-- ---------- Live classroom ----------
create policy class_sessions_read on public.class_sessions for select to authenticated
  using (tenant_id = (select app.tenant_id())
         and (app.can_manage_class(class_id) or app.in_class(class_id) or (select app.is_it())));

create policy session_participants_read on public.session_participants for select to authenticated
  using (user_id = (select auth.uid()) or app.can_manage_session(session_id));

create policy announcements_read on public.announcements for select to authenticated
  using (app.can_manage_class(class_id) or app.in_class(class_id));
grant insert on public.announcements to authenticated;
create policy announcements_insert on public.announcements for insert to authenticated
  with check (tenant_id = (select app.tenant_id()) and author_id = (select auth.uid()) and app.can_manage_class(class_id)
              and (session_id is null or app.session_class(session_id) = class_id));

create policy chat_threads_read on public.chat_threads for select to authenticated
  using (tenant_id = (select app.tenant_id())
         and ((kind = 'direct' and (student_id = (select auth.uid()) or teacher_id = (select auth.uid())))
              or (kind = 'group' and (app.can_manage_class(class_id) or app.in_class(class_id)))));

create policy chat_messages_read on public.chat_messages for select to authenticated
  using (exists (select 1 from public.chat_threads t where t.id = thread_id)
         and (not hidden or sender_id = (select auth.uid())
              or exists (select 1 from public.chat_threads t where t.id = thread_id and app.can_manage_class(t.class_id))));

create policy raise_hands_read on public.raise_hands for select to authenticated
  using (student_id = (select auth.uid()) or app.can_manage_session(session_id));
grant insert on public.raise_hands to authenticated;
create policy raise_hands_insert on public.raise_hands for insert to authenticated
  with check (student_id = (select auth.uid()) and tenant_id = (select app.tenant_id())
              and status = 'open' and app.in_session(session_id)
              and exists (select 1 from public.class_sessions s where s.id = session_id and s.status = 'live'));

create policy spotlights_read on public.spotlights for select to authenticated
  using (app.can_manage_session(session_id) or student_id = (select auth.uid())
         or (show_to_class and ended_at is null and app.in_session(session_id)));

create policy attendance_read on public.attendance for select to authenticated
  using (student_id = (select auth.uid()) or app.can_manage_class(class_id) or app.is_parent_of(student_id));
grant insert, update on public.attendance to authenticated;
create policy attendance_write on public.attendance for all to authenticated
  using (app.can_manage_class(class_id))
  with check (tenant_id = (select app.tenant_id()) and app.can_manage_class(class_id)
              and exists (select 1 from public.class_members m where m.class_id = attendance.class_id
                          and m.user_id = attendance.student_id and m.role = 'student'));

create policy rtc_rooms_read on public.rtc_rooms for select to authenticated
  using (app.can_manage_session(session_id) or app.in_session(session_id));
create policy rtc_peers_read on public.rtc_peers for select to authenticated
  using (exists (select 1 from public.rtc_rooms r where r.id = room_id));
create policy rtc_signals_read on public.rtc_signals for select to authenticated
  using (exists (select 1 from public.rtc_peers p where p.id = to_peer_id and p.user_id = (select auth.uid())));

-- ---------- Games ----------
create policy game_sessions_read on public.game_sessions for select to authenticated
  using (app.can_manage_class(class_id) or app.in_class(class_id));
create policy game_teams_read on public.game_teams for select to authenticated
  using (exists (select 1 from public.game_sessions g where g.id = game_id));
-- Students only see their own player row; rankings go through game_leaderboard()
-- so the teacher's visibility settings (§13) are enforced.
create policy game_players_read on public.game_players for select to authenticated
  using (user_id = (select auth.uid())
         or exists (select 1 from public.game_sessions g where g.id = game_id and app.can_manage_class(g.class_id)));
create policy game_answers_read on public.game_answers for select to authenticated
  using (exists (select 1 from public.game_players p where p.id = player_id and p.user_id = (select auth.uid()))
         or exists (select 1 from public.game_sessions g where g.id = game_id and app.can_manage_class(g.class_id)));
create policy leaderboard_entries_read on public.leaderboard_entries for select to authenticated
  using (exists (select 1 from public.game_sessions g where g.id = game_id and app.can_manage_class(g.class_id)));
create policy game_flags_read on public.game_flags for select to authenticated
  using (exists (select 1 from public.game_sessions g where g.id = game_id and app.can_manage_class(g.class_id)));

-- ---------- Guard ----------
create policy environment_policies_read on public.environment_policies for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.is_staff()));
grant insert, update, delete on public.environment_policies to authenticated;
create policy environment_policies_insert on public.environment_policies for insert to authenticated
  with check (tenant_id = (select app.tenant_id()) and owner_id = (select auth.uid()) and (select app.is_staff()));
create policy environment_policies_update on public.environment_policies for update to authenticated
  using (tenant_id = (select app.tenant_id()) and (owner_id = (select auth.uid()) or (select app.is_it())))
  with check (tenant_id = (select app.tenant_id()));
create policy environment_policies_delete on public.environment_policies for delete to authenticated
  using (tenant_id = (select app.tenant_id()) and (owner_id = (select auth.uid()) or (select app.is_it())));

create policy scenes_read on public.scenes for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.is_staff()));
grant insert, update, delete on public.scenes, public.scene_rules to authenticated;
create policy scenes_write on public.scenes for all to authenticated
  using (tenant_id = (select app.tenant_id()) and (owner_id = (select auth.uid()) or (select app.is_it())))
  with check (tenant_id = (select app.tenant_id()) and (select app.is_staff())
              and exists (select 1 from public.environment_policies p where p.id = policy_id));
create policy scene_rules_read on public.scene_rules for select to authenticated
  using (exists (select 1 from public.scenes s where s.id = scene_id));
create policy scene_rules_write on public.scene_rules for all to authenticated
  using (exists (select 1 from public.scenes s where s.id = scene_id
                 and (s.owner_id = (select auth.uid()) or (select app.is_it()))))
  with check (tenant_id = (select app.tenant_id())
              and exists (select 1 from public.scenes s where s.id = scene_id
                          and (s.owner_id = (select auth.uid()) or (select app.is_it()))));

-- Devices: the secret hash is never selectable, even by admins.
revoke select on public.devices from authenticated;
grant select (id, tenant_id, student_id, label, os, browser, agent_version, status,
              enrolled_by, enrolled_at, last_seen_at) on public.devices to authenticated;
create policy devices_read on public.devices for select to authenticated
  using (tenant_id = (select app.tenant_id())
         and ((select app.is_it()) or student_id = (select auth.uid())
              or (student_id is not null and app.teaches_student(student_id))));
grant update (label) on public.devices to authenticated;
create policy devices_it_update on public.devices for update to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.is_it()))
  with check (tenant_id = (select app.tenant_id()));

create policy device_enrollments_read on public.device_enrollments for select to authenticated
  using (tenant_id = (select app.tenant_id()) and ((select app.is_it()) or student_id = (select auth.uid())));
create policy device_pairing_codes_read on public.device_pairing_codes for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (created_by = (select auth.uid()) or (select app.is_it())));

create policy browser_sessions_read on public.browser_sessions for select to authenticated
  using (student_id = (select auth.uid()) or app.can_manage_session(class_session_id));
create policy browser_events_read on public.browser_events for select to authenticated
  using (student_id = (select auth.uid()) or app.can_manage_session(class_session_id)
         or (tenant_id = (select app.tenant_id()) and (select app.is_it())));
create policy screen_snapshots_read on public.screen_snapshots for select to authenticated
  using (student_id = (select auth.uid()) or app.can_manage_session(class_session_id));
create policy environment_events_read on public.environment_events for select to authenticated
  using (student_id = (select auth.uid()) or app.can_manage_session(class_session_id));
create policy off_task_feedback_read on public.off_task_feedback for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.is_staff()));
create policy off_task_mutes_read on public.off_task_mutes for select to authenticated
  using (app.can_manage_session(class_session_id));
create policy teacher_commands_read on public.teacher_commands for select to authenticated
  using (app.can_manage_session(class_session_id)
         or (tenant_id = (select app.tenant_id()) and (select app.is_admin())));

-- ---------- Views run with the caller's rights ----------
grant select on public.quizzes, public.student_presence to authenticated;
